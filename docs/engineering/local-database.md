# Local Database — PhantomPermissionMCP

> Reproducible setup, seed workflow, and health contract. Migration
> history itself lives in `prisma/migrations/`; the schema reference
> lives in `prisma/schema.prisma`.

## 1. Fresh-database verification

A clean database reaches the full schema via `deploy` alone (verified
against `phantom-postgres`, `postgres:16-alpine`):

```bash
export DATABASE_URL='postgresql://phantom:phantom@localhost:5434/phantom_permission_fresh'
npx prisma migrate deploy   # applies 0000_init + 4 table migrations
npx prisma migrate status   # Database schema is up to date!
```

## 2. Reset / seed workflow

```bash
npm run db:seed    # idempotent fictional seed (safe to re-run)
npm run db:reset   # migrate reset (destructive) + reseed
npm run db:deploy  # apply migrations without seeding (CI/prod path)
```

Seed contents (all fictional, `demo`-prefixed, safe to commit):

| Row | Value |
| --- | --- |
| Tenant | `tnt_demo_acme` / `Acme Demo` |
| API key | row `key_demo_row`, prefix `ppk_demo0000`, digest `DUMMY-DO-NOT-USE` — **never usable for auth**; real keys are issued by the provisioning flow |
| Model | `mdl_demo_billing` / `billing-demo`, `currentVersion: 1` |
| Version | 2-role/2-permission toy snapshot, real `sha256:` content hash |
| Simulation | 1 impact + 1 `SENSITIVE_PERMISSION` finding + advisory disclaimer |
| Audit event | `MODEL_CREATED` with redacted metadata (no key material) |

The script upserts by primary/unique key: seed → seed leaves exactly
1 row per table above (verified). No raw secrets exist anywhere in the
seed.

## 3. Health contract

| Endpoint | Auth | Success | DB down |
| --- | --- | --- | --- |
| `GET /health/live` | none | `200 { status: 'ok' }` | `200 { status: 'ok' }` (process is alive) |
| `GET /health/ready` | none | `200 { status: 'ok', database: 'up' }` | `200 { status: 'degraded', database: 'down' }` |

Readiness performs one `SELECT 1` round-trip through the shared client.
Failure responses carry status strings only — never connection strings,
driver messages, or error internals (covered by unit test).

Handoff note: full liveness/readiness semantics, monitoring, and
alerting integration belong to the later observability work; this
module provides the availability probe this persistence phase needs.
