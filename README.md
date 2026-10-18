# PhantomPermissionMCP

Self-hostable, read-only **RBAC change-impact analysis** backend exposed through REST (`/api/v1`) and MCP tools. Submit a versioned access model plus proposed changes, get back a deterministic before/after impact simulation with explainable risk findings.

> Design principle: the service **never applies changes** to a customer system. It analyses supplied copies only. No live enforcement, no sync-back, no outbound network calls.

## Table of Contents

- [1. Overview](#1-overview)
- [2. Features](#2-features)
- [3. Tech Stack](#3-tech-stack)
- [4. Architecture](#4-architecture)
- [5. Project Structure](#5-project-structure)
- [6. Prerequisites](#6-prerequisites)
- [7. Getting Started](#7-getting-started)
- [8. Configuration](#8-configuration)
- [9. Database, Migrations and Seeding](#9-database-migrations-and-seeding)
- [10. Authentication and Tenant Provisioning](#10-authentication-and-tenant-provisioning)
- [11. REST API Reference](#11-rest-api-reference)
- [12. Usage Examples](#12-usage-examples)
- [13. MCP Integration](#13-mcp-integration)
- [14. Testing](#14-testing)
- [15. Code Quality](#15-code-quality)
- [16. Docker Deployment](#16-docker-deployment)
- [17. Monitoring and Observability](#17-monitoring-and-observability)
- [18. Postman and Newman](#18-postman-and-newman)
- [19. CI/CD](#19-cicd)
- [20. Security Model](#20-security-model)
- [21. Limits and Known Limitations](#21-limits-and-known-limitations)
- [22. Troubleshooting](#22-troubleshooting)
- [23. Contributing](#23-contributing)
- [24. License](#24-license)
- [25. Credits](#25-credits)

## 1. Overview

PhantomPermissionMCP answers the question *"what breaks if we change this role?"* before the change ships. Operators version their RBAC model (roles, permissions, bindings, inheritance, assignments), propose an ordered list of operations (grant, revoke, assign, add inheritance edge, and so on), and receive:

- Per-subject added/removed effective permissions.
- Affected-subject set with before/after diff.
- Explainable risk findings (privilege escalation patterns, risky inheritance, blast-radius violations).
- A persisted simulation report plus machine-readable JSON/CSV export.
- An append-only audit trail of who did what, under which tenant.

Every persisted resource is tenant-scoped. REST and MCP reuse the same application use cases, so both transports behave identically.

## 2. Features

- Deterministic, pure domain engine (no framework, HTTP, or DB dependencies).
- Immutable model versions with optimistic concurrency (`expectedVersion` / `If-Match` ETag).
- Idempotent mutating endpoints via `Idempotency-Key` scoped per tenant and endpoint.
- Tenant isolation, scoped API keys (`ppk_...`), revocation, expiry, and rotation.
- Full REST API with Swagger/OpenAPI, pagination, ETags, and standardised error envelope.
- Five MCP tools reusing the same use cases as REST.
- Health/readiness probes, Prometheus metrics, tracing hooks, structured JSON logs with request IDs.
- Jest unit, e2e, and Postgres-backed integration suites with coverage gates.
- Production Docker image plus Compose stack (app + Postgres) and optional monitoring stack.
- Postman API + scenario collections runnable with Newman in CI.
- GitHub Actions CI with lint, typecheck, tests, audit, Docker build, and Newman.

## 3. Tech Stack

| Layer | Technology | Notes |
| --- | --- | --- |
| Runtime | Node.js >= 22, TypeScript 5 | `engines` enforced in `package.json` |
| Framework | NestJS 11 (Express platform) | Modular monolith, `src/` modules |
| Validation | Zod 4 | Runtime schemas, `ZodValidationPipe` |
| Database | PostgreSQL 17 + Prisma 7 | `prisma/schema.prisma`, `prisma/migrations` |
| API docs | `@nestjs/swagger` 11 | UI at `/docs`, JSON at `/docs-json`, snapshot `docs/openapi.json` |
| MCP | `@modelcontextprotocol/server` + `client` v2 | Streamable HTTP/SSE + local stdio entrypoint |
| Testing | Jest 30, ts-jest, Supertest | Unit (`src/**/*.spec.ts`), e2e (`test/`), integration (Postgres) |
| Quality | ESLint 9, Prettier 3, `tsc --noEmit` | `lint:check`, `format:check`, `typecheck` |
| Containers | Docker (node:22-alpine, non-root) + Compose | `Dockerfile`, `docker-compose.yml` |
| Monitoring | Prometheus + Grafana (optional) | `docker-compose.monitoring.yml`, `monitoring/` |
| API testing | Postman + Newman 6 | `postman/` collections and environment |

## 4. Architecture

Layered design: thin REST and MCP adapters call shared application use cases, which orchestrate the pure domain engine and Prisma-backed persistence. Normative details live in `docs/architecture/overview.md` and ADRs in `docs/architecture/decisions.md`.

```text
                        +----------------------+
                        |   REST (/api/v1)      |
                        |  Controllers + DTOs  |
                        +----------+-----------+
                                   |
                        +----------v-----------+
                        |   MCP (5 tools)      |
                        |  Tools + Schemas     |
                        +----------+-----------+
                                   |
                     +-------------v--------------+
                     |  Application use cases     |
                     |  Validate / Version /      |
                     |  Simulate / Report /       |
                     |  Export / Compare / Audit  |
                     +------+------+------+------+
                            |      |      |
              +-------------v+ +----v----+ +v-------------+
              | Domain engine| | Tenancy | | Repositories |
              | (pure, deter-| | + Auth  | | (Prisma/PG)  |
              |  ministc)    | | guards  | + Audit log   |
              +--------------+ +---------+ +--------------+
```

Request flow for a simulation:

```text
Client
  |
  |  POST /api/v1/simulations (Bearer ppk_..., Idempotency-Key?)
  v
AuthGuard (digest check, tenant + scope) --> TenantScope (filter)
  |
  v
SimulationsService (shared use case)
  |-- load immutable snapshot (modelId + baseVersion)
  |-- Domain: validate ops --> apply immutably --> resolve
  |       effective permissions before/after --> diff impact
  |-- Domain: evaluate risk rules (escalation, inheritance, blast radius)
  |-- persist simulation + report + audit event (same tenant)
  v
201 Created { simulation id, summary, findings } (+ replay on idempotent retry)
```

MCP flow mirrors REST exactly, but transport identity maps to tenant/scopes instead of an HTTP bearer header, and no caller-supplied tenant id is accepted.

Domain vocabulary: `tenant`, `access model`, `model version/snapshot`, `role`, `permission`, `binding (grant)`, `inheritance edge`, `subject`, `assignment`, `operation`, `simulation`, `impact`, `risk finding`, `report/export`, `audit event`, `API key`, `scope`, `use case`. Resource IDs use stable prefixes (`mdl_`, `sim_`, `evt_`, key prefix `ppk_`); versions are integers from 1; snapshots carry a SHA-256 `contentHash` surfaced as HTTP `ETag`.

## 5. Project Structure

```text
src/
  main.ts                 # bootstrap: config, logging, HTTP guards, Swagger, shutdown hooks
  app.module.ts           # module wiring
  domain/                 # PURE engine: validate, cycles, resolve, apply, impact, risk rules
  models/                 # access-model use cases + REST controllers
  simulations/            # simulation/report/export use cases + controllers

## 6. Prerequisites

- Node.js `>= 22` and npm `>= 10` (check with `node --version` and `npm --version`).
- Docker Engine + Docker Compose v2 for the database and full-stack runs.
- Git and a POSIX-like shell (PowerShell or Git Bash both work on Windows).
- No paid services, hosted databases, or external AI dependencies are required.

## 7. Getting Started

Pick one path. Docker is recommended because it provisions Postgres with the correct credentials automatically.

```bash
# 0. Install dependencies and generate the Prisma client
npm ci
npm run prisma:generate

# 1a. Docker path (app + PostgreSQL, health-gated)
docker compose up -d --build
docker compose run --rm migrate     # prisma migrate deploy, idempotent
docker compose run --rm seed        # fictional demo data, idempotent
curl http://localhost:3000/health/ready

# 1b. Local Node path (needs Postgres running + DATABASE_URL in .env)
cp .env.example .env                # then edit DATABASE_URL / API_KEY_PEPPER
npm run db:deploy                   # or: npm run prisma:migrate:dev
npm run db:seed
npm run start:dev                   # watch mode; use npm start for plain start
```

Smoke checks after startup:

```bash
curl http://localhost:3000/health/live     # {"status":"ok"}
curl http://localhost:3000/health/ready    # {"status":"ok","database":"up"}
curl http://localhost:3000/docs-json | head -c 300
npm run mcp:smoke                          # MCP transport check
npm run mcp:stdio-smoke                    # MCP stdio check
```

Production start uses compiled output: `npm run build && npm run start:prod` (`node dist/src/main`).

## 8. Configuration

Copy `.env.example` to `.env` for local development. Never commit a real `.env` (it is git-ignored). Production refuses placeholder secrets and exits non-zero with a redacted error message.

| Variable | Purpose | Default / requirement |
| --- | --- | --- |
| `NODE_ENV` | `development`, `test`, or `production` | `development` |
| `PORT` | HTTP listen port (1-65535) | `3000` |
| `DATABASE_URL` | PostgreSQL connection string | Local default outside production; required in production |
| `API_KEY_PEPPER` | HMAC pepper for API-key digests | Placeholder locally; required and non-placeholder in production |
| `CORS_ORIGINS` | Comma-separated allowed origins | Empty means deny browser cross-origin |
| `LOG_LEVEL` | `debug`, `info`, `warn`, `error` | `info` |
| `REQUEST_BODY_LIMIT` | Max JSON body (Express-style, e.g. `1mb`) | `1mb` |
| `RATE_LIMIT_WINDOW_MS` | Rate-limit window per client | `60000` |
| `RATE_LIMIT_MAX` | Max requests per window per client | `100` |
| `METRICS_ENABLED` | Expose `GET /metrics` (`true`/`false`) | `true` |

Compose provides safe local defaults (see `docker-compose.yml` header); set `API_KEY_PEPPER` in a local `.env` for any shared environment.

## 9. Database, Migrations and Seeding

```bash
npm run prisma:validate        # validate prisma/schema.prisma syntax
npm run prisma:generate        # generate client (Prisma 7 does not auto-generate on install)
npm run prisma:migrate:dev     # create/apply a dev migration
npm run db:deploy              # prisma migrate deploy (CI / production)
npm run db:seed                # idempotent fictional demo seed
npm run db:reset               # migrate reset --force --skip-seed + reseed (destructive)
npm run prisma:studio          # visual DB browser
```

Migration history: `0000_init`, `add_tenants_api_keys`, `add_access_models_versions`, `add_simulations`, `add_audit_idempotency`. Schema reference docs live under `docs/engineering/` (`persistence-setup.md`, `local-database.md`, per-table schema notes).

The seed upserts tenant `Acme Demo` (`tnt_demo_acme`), model `billing-demo` (`mdl_demo_billing` with one snapshot), and a `DUMMY-DO-NOT-USE` key digest that can never authenticate. Re-running the seed never duplicates rows. Real keys must be issued through the provisioning CLI below.

## 10. Authentication and Tenant Provisioning

API keys look like `ppk_<random>`, are bound to exactly one tenant, and carry a scope set. Only an HMAC-SHA-256 digest (keyed by `API_KEY_PEPPER`) is stored; the raw key is printed once at issuance and never logged or persisted.

```bash
# Create a tenant
npm run tenant:create -- tenant:create --name "Acme" [--id tnt_acme]


## 11. REST API Reference

Base path `/api/v1` (auth `Authorization: Bearer ppk_...` unless noted). Full normative contract: `docs/api/v1-contract.md`; error wording: `docs/api/errors.md`; live docs: `GET /docs`; raw spec: `GET /docs-json` (snapshot in `docs/openapi.json`).

| Method and path | Scope | Purpose |
| --- | --- | --- |
| `GET /health/live` | none | Liveness probe |
| `GET /health/ready` | none | Readiness probe incl. DB check |
| `GET /metrics` | none (disable via `METRICS_ENABLED=false`) | Prometheus text metrics |
| `POST /api/v1/models` | `models:write` | Validate and create an access model (version 1) |
| `GET /api/v1/models?page=&pageSize=` | `models:read` | List models, paginated |
| `GET /api/v1/models/{id}` | `models:read` | Get model with version history (`ETag` = content hash) |
| `POST /api/v1/models/{id}/versions` | `models:write` | Append immutable version (`expectedVersion` or `If-Match`; `Idempotency-Key`) |
| `GET /api/v1/models/{id}/compare?from=&to=` | `models:read` | Diff two versions |
| `POST /api/v1/simulations` | `simulations:run` | Run deterministic simulation (`Idempotency-Key`) |
| `GET /api/v1/simulations/{id}` | `simulations:read` | Get simulation summary + findings |
| `GET /api/v1/simulations/{id}/report` | `simulations:read` | Paginated per-subject impact report |
| `GET /api/v1/simulations/{id}/export?format=json\|csv` | `exports:read` | Machine-readable export |
| `GET /api/v1/audit-events` | `audit:read` | Audit history, paginated and filterable |

Shared conventions: error envelope `{ "error": { "code", "message", "status", "details", "requestId" } }` on all 4xx/5xx plus `x-request-id` header; pagination `{ "data": [...], "page": { "page", "pageSize", "total" } }`; version reads return `ETag: "<contentHash>"`, writes accept `If-Match` or `expectedVersion`, stale writes fail `409 conflict_version`; `Idempotency-Key` scoped to (tenant, endpoint), same key + different payload fails `409 idempotency_conflict`. Production 5xx responses are generic (`internal_error`) with no stack, SQL, or secret detail.

## 12. Usage Examples

Create a model:

```bash
curl -X POST http://localhost:3000/api/v1/models \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name":"billing-rbac","roles":[{"id":"viewer","name":"viewer"},{"id":"admin","name":"admin"}],
       "permissions":[{"id":"invoice:read","value":"invoice:read"},{"id":"invoice:refund","value":"invoice:refund"}],
       "bindings":[{"roleId":"viewer","permissionId":"invoice:read"},{"roleId":"admin","permissionId":"invoice:refund"}],
       "inheritance":[],"assignments":[{"subjectId":"alice","roleId":"viewer"}]}'
```

Append a version (optimistic concurrency + idempotency):

```bash
curl -X POST http://localhost:3000/api/v1/models/mdl_demo_billing/versions \
  -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json" \
  -H "Idempotency-Key: version-002" \
  -d '{"expectedVersion":1,"roles":[{"id":"viewer","name":"viewer"},{"id":"admin","name":"admin"}],
       "permissions":[{"id":"invoice:read","value":"invoice:read"},{"id":"invoice:refund","value":"invoice:refund"}],
       "bindings":[{"roleId":"viewer","permissionId":"invoice:read"},{"roleId":"admin","permissionId":"invoice:refund"}],
       "inheritance":[],"assignments":[{"subjectId":"alice","roleId":"viewer"}]}'
```

Simulate a grant, then read the report and export:

```bash
curl -X POST http://localhost:3000/api/v1/simulations \
  -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json" \
  -H "Idempotency-Key: sim-001" \
  -d '{"modelId":"mdl_demo_billing","baseVersion":1,
       "operations":[{"type":"grant_permission","roleId":"viewer","permissionId":"invoice:refund"}]}'

curl "http://localhost:3000/api/v1/simulations/sim_.../report?page=1&pageSize=50" \
  -H "Authorization: Bearer $API_KEY"

curl "http://localhost:3000/api/v1/simulations/sim_.../export?format=csv" \
  -H "Authorization: Bearer $API_KEY" -o report.csv

## 13. MCP Integration

Five tools, implemented once as shared use cases and exposed over both transports:

| MCP tool | Mirrors REST | Description |
| --- | --- | --- |
| `validate_access_model` | `POST /api/v1/models`, `POST .../versions` | Validate a model snapshot, return structural findings |
| `simulate_permission_change` | `POST /api/v1/simulations` | Run a deterministic impact simulation |
| `explain_access_change` | `GET /api/v1/simulations/{id}(/report)` | Explain the before/after diff of a simulation |
| `find_privilege_escalation` | Report findings filter | Search findings matching escalation patterns |
| `compare_access_models` | `GET /api/v1/models/{id}/compare` | Diff two model versions |

Transports: HTTP/SSE against the running server (checked by `npm run mcp:smoke`), and local stdio via `npm run mcp:serve` (same NestJS providers REST uses; stdout reserved for protocol frames, diagnostics on stderr; checked by `npm run mcp:stdio-smoke`).

Security: MCP never accepts a caller-supplied tenant id — identity derives from the authenticated caller. Stdio is a trusted-pipe model (any OS user able to launch the process can use it), so every protected tool still requires an `apiKey` argument with the same scope checks as REST. Run one invocation per tenant operator; do not share the process across tenants.

## 14. Testing

```bash
npm test                    # unit suite: src/**/*.spec.ts (33 suites, 177 tests)
npm run test:cov            # coverage + scripts/check-domain-coverage.js gate
npm run test:e2e            # e2e suite: test/*.e2e-spec.ts (13 suites, 70 tests, no external services)
npm run test:integration    # Prisma repository tests, needs Postgres at localhost:5432
```

Coverage gates: global thresholds (statements 70, branches 55, functions 55, lines 68) plus stricter domain gates (statements 90, branches 75, functions 78, lines 90). Integration tests provision `phantom_permission_test` via `scripts/integration-test-db.js`; in CI a Postgres 17 service container supplies it. Strategy and fixture reuse are documented in `docs/engineering/testing-coverage.md`.

## 15. Code Quality

```bash
npm run lint:check          # ESLint, no --fix (CI gate)
npm run lint                # ESLint with --fix for local cleanup
npm run format:check        # Prettier check (CI gate)
npm run format              # Prettier write for local cleanup
npm run typecheck           # tsc -p tsconfig.build.json --noEmit
npm run build               # nest build to dist/
npm run validate            # lint + format + typecheck + test + e2e + build
```

Conventions: strict TypeScript, Zod runtime schemas at the boundary, shared error taxonomy (`docs/api/errors.md`), structured logs with request IDs, no `any` without justification (3 pre-existing `no-unsafe-argument` warnings are accepted).

## 16. Docker Deployment

```bash
docker build -t phantom-permission-mcp .   # production image: node:22-alpine, non-root user
docker compose up -d --build               # db (postgres:17-alpine) + app, health-gated
docker compose run --rm migrate            # prisma migrate deploy, idempotent
docker compose run --rm seed               # fictional demo data, idempotent
curl http://localhost:3000/health/ready
docker compose down -v                     # full reset, drops the pgdata volume
```

Notes: `migrate` and `seed` are one-shot `tools`-profile services and never start with plain `up`. Host Postgres port defaults to `5433` (`POSTGRES_PORT`) to avoid clashing with a local server. `docker compose config` validates the file without starting anything. Never bake real secrets into images; pass `API_KEY_PEPPER` and `DATABASE_URL` at runtime.

## 17. Monitoring and Observability

Optional local stack — the app runs fully without it. Prometheus scrapes `GET /metrics` (Prometheus text format: request counts, latency histogram, error counts, simulation counters); disable with `METRICS_ENABLED=false`.

```bash
npm run start:dev   # app on :3000 first
docker compose -f docker-compose.monitoring.yml --profile monitoring up -d
# Prometheus: http://localhost:9090
# Grafana:    http://localhost:3001 (admin/admin), dashboard "PhantomPermissionMCP - Overview"
docker compose -f docker-compose.monitoring.yml --profile monitoring down -v  # reset
```

Also built in: `GET /health/live` (liveness), `GET /health/ready` (readiness incl. DB), graceful shutdown on SIGTERM/SIGINT (drains HTTP, disconnects Prisma), tracing hooks (`src/tracing/`), and JSON logs with `requestId` on every request (`docs/engineering/logging.md`). Never expose `/metrics` or the monitoring stack to the public internet without authentication.

## 18. Postman and Newman

| File | Purpose |
| --- | --- |
| `postman/PhantomPermissionMCP-API.postman_collection.json` | Importable reference for every public route, with auth headers, examples, and response expectations |
| `postman/PhantomPermissionMCP-Scenarios.postman_collection.json` | Repeatable lifecycle + negative suite: validation, auth, scope denial, tenant isolation, version conflicts, idempotency, diffs, reports, exports, pagination, rate limits, audit |
| `postman/PhantomPermissionMCP-Local.postman_environment.json` | `baseUrl`, `api_key`, `api_key_readonly` variables — no real keys committed |

```bash
npx newman run postman/PhantomPermissionMCP-API.postman_collection.json \
  --env-var baseUrl=http://localhost:3000 --env-var api_key="$API_KEY"

npx newman run postman/PhantomPermissionMCP-Scenarios.postman_collection.json \
  --env-var baseUrl=http://localhost:3000 --env-var api_key="$API_KEY" \
  --env-var api_key_readonly="$RO_KEY"
```

In CI both collections run against the Compose stack with freshly issued keys (`provision.cli.js key:issue`), because the seed demo key is a dummy digest. The `run_rate_limit` scenario stays opt-in so the shared fixed window does not return 429 for later steps.

## 19. CI/CD

`.github/workflows/ci.yml` is self-contained and needs no paid secrets. Every job installs from the lockfile (`npm ci`) and runs the same `npm run ...` scripts developers use locally:

| Job | What it runs |
| --- | --- |
| `quality` | `prisma:generate`, `lint:check`, `format:check`, `prisma:validate`, `typecheck` |
| `unit` | `test:cov` (Jest thresholds + domain-coverage gate) |
| `e2e` | `build`, `test:e2e` |
| `integration` | Postgres 17 service + `test:integration` |
| `audit` | `npm audit --omit=dev --audit-level=high` (high+ fails), plus non-blocking `npm outdated` |
| `docker` | Production image build (push disabled — CI never pushes) |
| `api-scenarios` | Compose stack + Newman runs of both Postman collections |

Permissions are least-privilege (`contents: read`); CI never writes to the repository, pushes images, or performs releases.

## 20. Security Model

- Read-only by design: no enforcement path, no sync-back into customer systems, no outbound HTTP (no SSRF surface).
- Tenant isolation enforced on every query; cross-tenant access returns `tenant_forbidden`.
- API keys: `ppk_` prefix, HMAC-SHA-256 digest with server pepper, shown once, never logged or persisted raw; revocation, expiry, and rotation supported; least-privilege scopes checked per use case (`forbidden_scope` on denial).
- Immutable versions with optimistic concurrency (`expectedVersion` / `If-Match` ETag); stale writes fail `conflict_version`.
- `Idempotency-Key` scoped to (tenant, endpoint); same key + different payload fails `idempotency_conflict`.
- Append-only audit log of sensitive actions, never containing raw keys (scope `audit:read` to query).
- HTTP hardening: CORS allowlist (empty denies), JSON body size limit, fixed-window rate limiting, security headers, generic 5xx in production, request IDs on every response.

Threat model and rationale: `docs/security/threat-model.md`, `docs/architecture/overview.md`.


```

Compare versions and check audit history:

```bash
curl "http://localhost:3000/api/v1/models/mdl_demo_billing/compare?from=1&to=2" \

## 21. Limits and Known Limitations

Enforced v1 limits (see `docs/api/v1-contract.md`): roles <= 500, permissions <= 2000, bindings <= 10000, edges <= 2000, assignments <= 10000, subjects <= 5000, inheritance depth <= 25, operations per simulation <= 200, JSON body <= 1 MiB, report items per page <= 200, export rows <= 50000 (CSV), inline simulation summary <= 500 added+removed subjects (remainder via paged report).

Known limitations: RBAC with inheritance only (no ABAC/ReBAC or extra policy language); not an identity provider (no login, sessions, user directory, or live authorization decisions); no background workers, queues, Redis, or external services; rate limiting is in-memory per instance, not distributed; monitoring stack is for local development only; integration tests and Docker/Newman smoke checks need a local Postgres/Docker daemon where available (provided in CI).

## 22. Troubleshooting

| Symptom | Fix |
| --- | --- |
| Prisma client/type errors | Run `npm run prisma:generate` (Prisma 7 does not generate on install) |
| `P1000` auth failed / connection refused | Start Postgres (`docker compose up -d db`), check `DATABASE_URL` and credentials |
| Production refuses to start | Set a real `DATABASE_URL` and a non-placeholder `API_KEY_PEPPER` |
| `401 unauthorized` | Missing or malformed `Authorization: Bearer ppk_...`; key revoked or expired |
| `403 forbidden_scope` | Key lacks the scope required by the endpoint; issue a broader key |
| `403 tenant_forbidden` | Resource belongs to a different tenant than the key |
| `404 not_found` | Wrong id prefix or version; check `mdl_`/`sim_`/`evt_` ids |
| `409 conflict_version` | Stale `expectedVersion`/ETag; refetch the latest version first |
| `409 idempotency_conflict` | Same `Idempotency-Key` with a different payload; use a fresh key |
| `429 rate_limited` | Back off and retry; review `RATE_LIMIT_WINDOW_MS`/`RATE_LIMIT_MAX` |
| Port clash on Postgres | Compose maps host `5433` by default via `POSTGRES_PORT` |
| Docker daemon errors on Windows | Start Docker Desktop, then retry `docker compose` commands |
| `npm.ps1 cannot be loaded` in PowerShell | Use `npm.cmd ...` or enable script execution for your session |

## 23. Contributing

1. Respect the layering: domain stays pure (no NestJS/HTTP/MCP/DB imports); transports stay thin and delegate to shared use cases.
2. Use the canonical vocabulary and identifier rules from `docs/architecture/overview.md` for code, errors, docs, and fixtures.
3. Add or update tests with every behavior change: unit specs for the engine, e2e specs for REST/MCP behavior, fixtures under `test/fixtures`.
4. Run the gates before pushing: `npm run lint:check`, `npm run format:check`, `npm run typecheck`, `npm run test`, `npm run test:e2e`, `npm run build` (or `npm run validate` for all at once).
5. Regenerate `docs/openapi.json` via `npm run docs:openapi` when routes change, and keep both Postman collections in sync.
6. Do not commit `.env`, real API keys, or generated artifacts outside their documented locations.

## 24. License

MIT — see [LICENSE](LICENSE).

## 25. Credits

Crafted and maintained by [4SRG](https://github.com/zannunakiz).

  -H "Authorization: Bearer $API_KEY"

curl "http://localhost:3000/api/v1/audit-events?page=1&pageSize=20" \
  -H "Authorization: Bearer $API_KEY"
```

# Issue a key (save the printed ppk_... immediately — it is shown once)
npm run key:issue -- key:issue --tenant <tnt_id> \
  --scopes models:read,models:write,simulations:run,simulations:read,exports:read,audit:read \
  [--expires 2027-01-01T00:00:00.000Z]

# Revoke / rotate
npm run key:revoke -- key:revoke --tenant <tnt_id> --key-id <key_id>
npm run key:rotate -- key:rotate --tenant <tnt_id> --key-id <key_id> [--scopes models:read]
```

Available scopes: `models:read`, `models:write`, `simulations:run`, `simulations:read`, `exports:read`, `audit:read`. Every REST call sends `Authorization: Bearer ppk_...`. MCP stdio calls pass the same key as the `apiKey` tool argument. Cross-tenant access returns `tenant_forbidden`; missing scopes return `forbidden_scope`.

  auth/                   # API-key guard/service, scopes, provision.cli.ts
  tenancy/                # tenant context + scoping guards
  audit/                  # append-only audit log
  persistence/            # Prisma service + repositories wiring
  repositories/           # Prisma repository adapters
  common/                 # error envelope, http guards, logging, pagination
  config/                 # env validation (never logs secrets)
  health/                 # GET /health/live, GET /health/ready
  metrics/                # GET /metrics (Prometheus text)
  tracing/                # trace-context + middleware
  mcp/                    # 5 MCP tools + transport service
  docs/                   # Swagger setup + snapshot writer
prisma/
  schema.prisma           # tenants, keys, models, versions, simulations, audit, idempotency
  migrations/             # 0000_init + 4 feature migrations
  seed.ts                 # idempotent fictional demo data
test/                     # 13 e2e specs + fixtures + jest configs
scripts/                  # export-openapi, mcp-serve/smoke/stdio-smoke, integration DB helpers
postman/                  # API collection, scenario collection, local environment
docs/                     # architecture, api contract, domain, engineering, security, openapi.json
monitoring/               # prometheus.yml, Grafana dashboard provisioning
.github/workflows/ci.yml  # quality, unit, e2e, integration, audit, docker, newman
Dockerfile / docker-compose.yml / docker-compose.monitoring.yml
```

| CI | GitHub Actions | `.github/workflows/ci.yml`, no paid secrets |
