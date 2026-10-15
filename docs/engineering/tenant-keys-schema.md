# Tenant & API-Key Schema — PhantomPermissionMCP (Step 20)

> Step 20 owns the `Tenant` + `ApiKey` persistence boundary only.
> Steps 21–23 (models/versions, simulations/reports, audit/idempotency)
> add their own tables + migrations. No auth logic here — issuance,
> verification, and scope enforcement belong to Steps 27–28; repository
> adapters belong to Step 25; tenant-isolation queries belong to Step 26.

## 1. Tables

| Table | Purpose | Key columns |
| --- | --- | --- |
| `Tenant` | Isolation boundary (overview §2, §8). App-assigned opaque `tnt_…` id. | `id` PK, `name` unique, `createdAt/updatedAt` |
| `ApiKey` | Machine credential lifecycle (ADR-007). One row per issued key, bound to exactly one tenant. | `id` (internal row id, NOT the secret), `tenantId` FK → `Tenant.id` cascade, `keyPrefix` (safe `ppk_…` prefix), `keyDigest` (HMAC hex, unique), `scopes text[]`, `status` enum, `expiresAt/revokedAt/lastUsedAt`, timestamps |

## 2. Digest-only credential rule (threat model T3/T4)

- Stored: `keyPrefix` + `keyDigest = HMAC-SHA-256(rawKey, serverPepper)`.
- Never stored: no `rawKey`/`secret`/`password` column exists (verified
  against `information_schema.columns` — `plaintext-cols: NONE`).
- `keyPrefix` is indexed for log correlation but authenticates nothing
  alone; `keyDigest` is `@unique` for constant-time lookup + duplicate
  prevention. Raw keys are rendered once at issuance (Step 28) and never
  logged, audited, or exported.

## 3. Tenant relations

- `ApiKey.tenantId → Tenant.id` with `ON DELETE CASCADE`: removing a
  tenant removes its keys (no orphaned credentials; tenants are
  operator-managed, not end-user-deleted).
- Future tables (Steps 21–23) must carry their own `tenantId` FK with
  the same cascade policy so every resource stays tenant-scoped.

## 4. Indexes and the lookups they serve

| Index | Serves |
| --- | --- |
| `Tenant.name` unique | tenant provisioning dedupe (Step 28) |
| `Tenant.createdAt` | operator listing / oldest-first cleanup |
| `ApiKey.keyDigest` unique | key verification lookup (Step 27) |
| `ApiKey(tenantId)` | per-tenant key listing, cascade path |
| `ApiKey(tenantId, status)` | active-key filtering per tenant |
| `ApiKey(keyPrefix)` | log-prefix → candidate correlation (never auth alone) |
| `ApiKey(expiresAt)` | expiry sweep / `EXPIRED` transitions |

## 5. Verification (Step 20 gate, 2026-10-15)

- `prisma validate` ✅ schema valid; `prisma generate` ✅ client v7.10.0.
- `prisma migrate dev --name add-tenants-api-keys` against
  `phantom-postgres` (`postgres:16-alpine`, host `5434`) ✅
  `Applying migration 20261015081514_add_tenants_api_keys` → in sync;
  `migrate status` ✅ `Database schema is up to date!`.
- Live introspection ✅ tables `ApiKey,Tenant`; 6 `ApiKey` + 3 `Tenant`
  indexes as above; FK `ApiKey_tenantId_fkey … ON DELETE CASCADE`;
  no plaintext/secret columns.
- `typecheck / lint:check / format:check / test / test:e2e / build` ✅
  (recorded in the Act report); `src/domain/` has no Prisma imports
  (ADR-002 preserved).
