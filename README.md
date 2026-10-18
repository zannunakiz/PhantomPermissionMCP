# PhantomPermissionMCP

Self-hostable, **read-only RBAC change-impact analysis** backend exposed through REST (`/api/v1`) and MCP tools. A tenant submits a versioned access model (roles, permissions, inheritance, assignments) plus proposed changes; the service validates, simulates deterministically on an immutable copy, and returns before/after impact with explainable risk findings.

> The service **never applies changes** to a customer's live system. It analyses supplied copies only. No live enforcement, no provisioning back, no outbound calls.

## Prerequisites

- Node.js `>=22`, npm `>=10`
- Docker + Docker Compose (for Postgres / full local stack)
- No paid services, no hosted DB, no external AI required.

## Quick start (local)

```bash
npm ci
npm run prisma:generate
npm run build

# Option A — Docker (app + PostgreSQL, health-gated):
docker compose up -d --build
docker compose run --rm migrate   # prisma migrate deploy (idempotent)
docker compose run --rm seed      # fictional demo data (idempotent)
curl http://localhost:3000/health/ready

# Option B — host Node + local Postgres:
# set DATABASE_URL in .env (see .env.example), then:
npm run db:deploy   # or: npm run prisma:migrate:dev
npm run db:seed
npm run start:dev
```

Verify: `GET /health/live` (liveness), `GET /health/ready` (DB check), Swagger at `GET /docs`, OpenAPI JSON at `GET /docs-json`.

## Environment configuration

Copy `.env.example` to `.env`. Key variables:

| Variable | Default / required |
| --- | --- |
| `NODE_ENV` | `development` (`production` refuses placeholder secrets) |
| `PORT` | `3000` |
| `DATABASE_URL` | Local default outside production; **required** in production |
| `API_KEY_PEPPER` | Placeholder locally; **required, non-placeholder** in production |
| `CORS_ORIGINS` | Comma-separated allowlist; empty = deny browser cross-origin |
| `LOG_LEVEL` | `debug \| info \| warn \| error` |
| `REQUEST_BODY_LIMIT` | e.g. `1mb` |
| `RATE_LIMIT_WINDOW_MS` / `RATE_LIMIT_MAX` | e.g. `60000` / `100` |
| `METRICS_ENABLED` | `true \| false` |

Secrets are never logged; config errors print redacted messages and exit non-zero.

## Migrations and seeding

```bash
npm run prisma:validate        # schema syntax check
npm run prisma:generate        # generate client (Prisma 7: not auto on install)
npm run prisma:migrate:dev     # local dev migration
npm run db:deploy              # prisma migrate deploy (prod/CI)
npm run db:seed                # idempotent fictional demo data
npm run db:reset               # migrate reset --force --skip-seed + seed (destructive)
```

Seed creates tenant `Acme Demo` (`tnt_demo_acme`), model `billing-demo` (`mdl_demo_billing`), and a `DUMMY-DO-NOT-USE` key digest that can **never** authenticate. Issue real keys via provisioning below.


## Tenant and API-key provisioning

Keys are `ppk_<secret>`, bound to one tenant with scopes. Only an HMAC-SHA-256 digest (pepper from `API_KEY_PEPPER`) is persisted; the raw key is shown **once** at issuance and never logged.

```bash
npm run tenant:create -- tenant:create --name "Acme"
npm run key:issue -- key:issue --tenant <tnt_id> --scopes models:read,models:write,simulations:run,simulations:read,exports:read,audit:read
npm run key:revoke -- key:revoke --tenant <tnt_id> --key-id <key_id>
npm run key:rotate -- key:rotate --tenant <tnt_id> --key-id <key_id> --scopes models:read
```

Scopes (least privilege, checked per use case): `models:read models:write simulations:run simulations:read exports:read audit:read`. Every request sends `Authorization: Bearer ppk_...`. All resources are tenant-scoped; cross-tenant access returns `tenant_forbidden`.

## REST API (base `/api/v1`)

| Method and path | Purpose |
| --- | --- |
| `POST /api/v1/models` | Validate + create access model |
| `GET /api/v1/models?page=&pageSize=` | List models (paginated) |
| `GET /api/v1/models/{id}` | Get model with versions |
| `POST /api/v1/models/{id}/versions` | Append immutable version (`expectedVersion` or `If-Match` ETag; `Idempotency-Key` supported) |
| `GET /api/v1/models/{id}/compare?from=&to=` | Compare two versions |
| `POST /api/v1/simulations` | Run deterministic simulation (`Idempotency-Key` supported) |
| `GET /api/v1/simulations/{id}` | Get simulation |
| `GET /api/v1/simulations/{id}/report` | Paginated impact report |
| `GET /api/v1/simulations/{id}/export?format=json\|csv` | Machine-readable export |
| `GET /api/v1/audit-events` | Audit history (scope `audit:read`) |

Conventions: error envelope `{ error: { code, message, status, details, requestId } }` plus `x-request-id` header; pagination `{ data, page: { page, pageSize, total } }`; version reads return `ETag: "<contentHash>"`; stale writes fail `409 conflict_version`; v1 limits in `docs/api/v1-contract.md`.

Example — create a model:

```bash
curl -X POST http://localhost:3000/api/v1/models \
  -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json" \
  -d '{"name":"billing-rbac","roles":[{"id":"viewer","name":"viewer"}],"permissions":[{"id":"invoice:read","value":"invoice:read"}],"bindings":[{"roleId":"viewer","permissionId":"invoice:read"}],"inheritance":[],"assignments":[]}'
```

Example — simulate a grant:

```bash
curl -X POST http://localhost:3000/api/v1/simulations \
  -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json" \
  -H "Idempotency-Key: sim-001" \
  -d '{"modelId":"mdl_demo_billing","baseVersion":1,"operations":[{"type":"grant_permission","roleId":"viewer","permissionId":"invoice:refund"}]}'
```

Full contract: `docs/api/v1-contract.md`, errors: `docs/api/errors.md`.

## Swagger / OpenAPI

- Local UI: `GET /docs` ... JSON: `GET /docs-json`
- Committed snapshot: `docs/openapi.json`
- Regenerate: `npm run docs:openapi`

## MCP client setup

Five tools, same use cases as REST: `validate_access_model`, `simulate_permission_change`, `explain_access_change`, `find_privilege_escalation`, `compare_access_models`.

- stdio entrypoint: `npm run mcp:serve` (local trust — any OS user able to launch the process can use the pipe, so every protected tool still requires an `apiKey` argument)
- Smoke tests: `npm run mcp:smoke` and `npm run mcp:stdio-smoke`
- MCP never accepts a caller-supplied tenant id — identity derives from the authenticated caller.

## Docker

```bash
docker build -t phantom-permission-mcp .   # production image (node:22-alpine, non-root)
docker compose up -d --build               # db + app (health-gated)
docker compose run --rm migrate            # apply migrations
docker compose run --rm seed               # seed demo data
docker compose down -v                     # full reset (drops pgdata volume)
```

`migrate`/`seed` are one-shot `tools`-profile services; plain `up` never runs them. Host Postgres port defaults to `5433`.

## Monitoring

Optional local stack (app works fully without it): Prometheus scrapes `GET /metrics` (disable with `METRICS_ENABLED=false`).

```bash
npm run start:dev   # app on :3000 first
docker compose -f docker-compose.monitoring.yml --profile monitoring up -d
# Prometheus http://localhost:9090 ... Grafana http://localhost:3001 (admin/admin)
```

Details: `docs/monitoring.md`. Health: `GET /health/live`, `GET /health/ready`.


## Tests

```bash
npm test                    # unit (Jest, coverage gates via test:cov)
npm run test:cov            # coverage + domain-coverage gate
npm run test:e2e            # e2e contract/security suite (no external services)
npm run test:integration    # Prisma repo tests — needs Postgres on localhost:5432
npm run lint:check && npm run format:check && npm run typecheck && npm run build
npm run validate            # lint + format + typecheck + test + e2e + build
```

CI (`.github/workflows/ci.yml`) runs quality, unit+coverage, e2e, integration (Postgres service), `npm audit` (high+ fails), Docker build, and Newman scenarios — no paid secrets.

## Postman / Newman

- `postman/PhantomPermissionMCP-API.postman_collection.json` — every public route with auth headers, examples, expectations
- `postman/PhantomPermissionMCP-Scenarios.postman_collection.json` — lifecycle + negatives (validation, auth, scope denial, tenant isolation, version conflicts, idempotency, diffs, reports, exports, pagination, rate limits, audit)
- `postman/PhantomPermissionMCP-Local.postman_environment.json` — `baseUrl`, `api_key`, `api_key_readonly` (no real keys committed)

```bash
npx newman run postman/PhantomPermissionMCP-API.postman_collection.json \
  --env-var baseUrl=http://localhost:3000 --env-var api_key="$API_KEY"
npx newman run postman/PhantomPermissionMCP-Scenarios.postman_collection.json \
  --env-var baseUrl=http://localhost:3000 --env-var api_key="$API_KEY" \
  --env-var api_key_readonly="$RO_KEY"
```

In CI the keys are issued live via `provision.cli.js key:issue` (the seed demo key is a dummy digest); the `run_rate_limit` scenario stays opt-in so the shared fixed window does not 429 later steps.

## Security model

- Read-only analysis: no enforcement path, no sync-back, no outbound HTTP (SSRF surface: none).
- Tenant isolation on every query; `tenant_forbidden` on cross-tenant access.
- API keys: HMAC-SHA-256 digest + pepper, prefix `ppk_`, shown once, revocable/expirable, scoped per use case (`forbidden_scope` on denial).
- Idempotency-Key scoped to (tenant, endpoint); same key + different payload gives `409 idempotency_conflict`.
- Immutable model versions with `expectedVersion`/`If-Match` concurrency give `409 conflict_version`.
- Append-only audit log, never containing raw keys. CORS allowlist, JSON size limits, rate limiting, generic 5xx in production.

See `docs/security/threat-model.md`, `docs/architecture/overview.md`.

## Architecture

```text
REST (/api/v1) --\
                  +--> Application use cases --> Domain engine (pure, deterministic)
MCP (5 tools) ---/         |                        + Persistence adapters (Prisma/Postgres)
                           +--> Audit log (append-only)
```

Deterministic, immutable-where-practical domain engine with no NestJS/HTTP/MCP/DB dependencies. Layering, vocabulary, identifiers: `docs/architecture/overview.md`; ADRs: `docs/architecture/decisions.md`; domain contracts: `docs/domain/contracts.md`.

## Known limitations (v1)

- RBAC + inheritance only — no ABAC/ReBAC, no policy language beyond roles/permissions.
- Not an IdP: no login, sessions, user directory, or live authorization decisions.
- No background workers, queues, Redis, or external services.
- Simulation inline subject lists cap at 500 added+removed (remainder via paged report); export rows cap 50000 (CSV); model size limits in `docs/api/v1-contract.md`.
- Rate limiting is in-memory fixed-window (not distributed); `run_rate_limit` Newman scenario is opt-in.
- Monitoring stack is local-dev only; never expose `/metrics` publicly without auth.
- Integration tests and Docker/Newman smoke checks require a local Postgres/Docker daemon where available (CI provides them).

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `prisma generate` types missing / client errors | Run `npm run prisma:generate` (Prisma 7 does not generate on install) |
| DB connection refused | Start Postgres (`docker compose up -d db`) and check `DATABASE_URL` |
| `production` refuses to start | Set real `DATABASE_URL` + non-placeholder `API_KEY_PEPPER` |
| `401 unauthorized` | Missing/malformed `Authorization: Bearer ppk_...`, revoked/expired key |
| `403 forbidden_scope` / `tenant_forbidden` | Key lacks scope or resource belongs to another tenant |
| `409 conflict_version` | Stale `expectedVersion`/ETag — refetch latest version |
| `409 idempotency_conflict` | Same `Idempotency-Key` with a different payload — use a fresh key |
| `429 rate_limited` | Back off; check `RATE_LIMIT_*` settings |
| Port clash on 5432 | Compose maps host `5433` by default (`POSTGRES_PORT`) |

