# Persistence Setup — PhantomPermissionMCP (Step 19)

> Step 19 owns connection + migration plumbing only. Domain tables
> (tenants, API keys, models, versions, simulations, reports, audit,
> idempotency) belong to Steps 20-23. Do not add them here.

## 1. Stack

PostgreSQL + Prisma (ADR-003). No Redis or extra service in v1.
`src/domain/` stays framework-free: it must never import
`src/persistence/` or `@prisma/client` (ADR-002).

## 2. Files added by Step 19

| File | Purpose |
| --- | --- |
| `prisma/schema.prisma` | Generator + `postgresql` datasource (Prisma 7 keeps the URL in `prisma.config.ts`, not the schema). No models yet — intentional baseline so `validate/generate/migrate` are verifiable before Steps 20-23. |
| `prisma.config.ts` | Datasource URL from `DATABASE_URL` with the `.env.example` local fallback for offline `validate/generate`; migration history path `prisma/migrations`. |
| `src/persistence/prisma.service.ts` | Shared `PrismaClient` over `@prisma/adapter-pg` + `pg` pool built from validated `APP_CONFIG.databaseUrl` (no direct `process.env`). `$connect` / `$disconnect` lifecycle. No queries or repositories. |
| `src/persistence/prisma.module.ts` | `@Global()` module exporting the single `PrismaService`. |
| `src/persistence/index.ts` | Barrel export. |
| `src/app.module.ts` | Imports `PrismaModule` (wiring only). |

## 3. Prerequisites

- Node `>=22`, npm `>=10` (see `package.json` `engines`).
- Local PostgreSQL 16 listening on `localhost:5432` with role
  `phantom` / password `phantom` and database
  `phantom_permission_dev`, OR any reachable PostgreSQL URL.
- Copy `.env.example` to `.env` for local runs (never committed —
  `.env` is git-ignored). Adjust `DATABASE_URL` to your instance:

```bash
cp .env.example .env
# edit DATABASE_URL if your Postgres differs
```

Default: `postgresql://phantom:phantom@localhost:5432/phantom_permission_dev`

Quick-create the role + database on a stock local install:

```bash
createuser -s phantom          # or: CREATE USER phantom WITH PASSWORD 'phantom' SUPERUSER;
createdb -O phantom phantom_permission_dev
```

Docker alternative (used to verify this step; host port `5434` avoids
clashes with any local Postgres on `5432`):

```bash
docker run -d --name phantom-postgres \
  -e POSTGRES_USER=phantom -e POSTGRES_PASSWORD=phantom \
  -e POSTGRES_DB=phantom_permission_dev \
  -p 5434:5432 postgres:16-alpine
export DATABASE_URL='postgresql://phantom:phantom@localhost:5434/phantom_permission_dev'
```

Then `npm run prisma:migrate:dev` applies the `0000_init` baseline;
`npm run prisma:migrate:status`-equivalent
(`npx prisma migrate status`) reports `Database schema is up to
date!` afterwards.

## 4. Commands

| Task | Command |
| --- | --- |
| Validate schema | `npm run prisma:validate` |
| Generate client | `npm run prisma:generate` |
| New local migration | `npm run prisma:migrate:dev -- --name <name>` |
| Apply migrations (CI/prod) | `npm run prisma:migrate:deploy` |
| Open Prisma Studio | `npx prisma studio` |

Migrations are reproducible: `prisma/migrations/` is committed;
fresh checkout runs `prisma:migrate:deploy` against an empty
database and reaches the same schema. The `0000_init` baseline is
an intentional no-op (`SELECT 1`) — domain tables land in
Steps 20-23 via their own migrations.

## 5. Verification (Step 19 gate)

1. `npm run prisma:validate` — schema parses. ✅
2. `npm run prisma:generate` — client generates. ✅
3. `npm run prisma:migrate:dev` against local PG — connection +
   migration history work. ✅ Verified 2026-10-15 against
   `postgres:16-alpine` (`phantom-postgres` on host port `5434`):
   `Applying migration 0000_init` → `Your database is now in sync
   with your schema`; subsequent `prisma migrate status` reports
   `Database schema is up to date!`.
4. `npm run typecheck && npm run lint:check && npm run test && npm run build` —
   no regressions; domain tests stay DB/network-free. ✅

Note: host port `5432` in this environment is occupied by an
unrelated Postgres whose `phantom` credentials fail (`P1000`), so
verification used host port `5434` per §3. The default
`DATABASE_URL` (port `5432`) remains correct for a stock local
setup; override via `.env` when ports differ.
