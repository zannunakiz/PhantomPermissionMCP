# syntax=docker/dockerfile:1
# Step 57 — production image.
#
# Multi-stage: locked npm install → Prisma client generation → Nest build →
# dev-dependency prune → minimal runtime. Runs as the unprivileged `node`
# user, uses tini as PID 1 for correct SIGTERM handling (the app drains
# connections on shutdown via enableShutdownHooks), and ships no secrets,
# local databases, or development config.
#
# Migrations are intentionally NOT run by this image (see Step 58 for the
# Compose workflow); the image only runs the API process.
# `prisma/` and `prisma.config.ts` are included so `prisma migrate deploy`
# can be run against the image when desired.

FROM node:22-alpine AS build
WORKDIR /app

# Locked dependency install first for layer caching.
COPY package.json package-lock.json ./
RUN npm ci

# Generate the Prisma client (WASM query compiler + driver adapter — no
# engine binaries needed at runtime), then build the NestJS app.
COPY prisma ./prisma
COPY prisma.config.ts nest-cli.json tsconfig.json tsconfig.build.json ./
RUN npm run prisma:generate

COPY src ./src
RUN npm run build \
  # Keep only production dependencies; the generated Prisma client in
  # node_modules/.prisma is preserved (it is runtime code, not a dev dep).
  && npm prune --omit=dev

# ---------------------------------------------------------------------
FROM node:22-alpine AS runtime
# tini reaps zombies and forwards SIGTERM/SIGINT to the Node process so
# graceful shutdown (connection drain + Prisma disconnect) actually runs.
RUN apk add --no-cache tini

ENV NODE_ENV=production \
    PORT=3000

WORKDIR /app
# Ownership only; the process itself never runs as root (USER below).
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json package-lock.json prisma.config.ts ./
COPY --chown=node:node prisma ./prisma

USER node
EXPOSE 3000

# Liveness is a pure in-process answer — safe without a database.
HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
  CMD ["sh", "-c", "wget -qO- \"http://127.0.0.1:${PORT:-3000}/health/live\" >/dev/null || exit 1"]

ENTRYPOINT ["/sbin/tini", "--"]
# `nest build` emits dist/src/main.js (tsconfig spans src/, prisma/, scripts/).
CMD ["node", "dist/src/main"]
