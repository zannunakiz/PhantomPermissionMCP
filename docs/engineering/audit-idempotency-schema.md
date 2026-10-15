# Audit & Idempotency Schema — PhantomPermissionMCP (Step 23)

> Step 23 owns the `AuditEvent` + `IdempotencyRecord` storage boundary
> only. No write-path logic here — endpoint/use-case behaviour that
> writes these rows belongs to Steps 33–37; repository adapters to
> Step 25; seeds/health to Step 24.

## 1. Tables

| Table | Purpose | Key columns |
| --- | --- | --- |
| `AuditEvent` | Append-only trace of sensitive actions (v1-contract §4). App-assigned `evt_…` id. Inserted, never updated/deleted by the service. | `tenantId` FK cascade, `type` enum (8 values), `actorKeyPrefix` (`ppk_…` prefix only), `resourceType` + `resourceId` (typed string, intentionally no FK), `metadata` jsonb (redacted), `createdAt` |
| `IdempotencyRecord` | Retry-safe mutating requests (overview §8, ADR-009). One row per (tenant, endpoint, client key). | `tenantId` FK cascade, `endpoint`, `idempotencyKey`, `requestHash` (sha256 of canonical payload), `statusCode` + `responseBody` (replayed verbatim), `createdAt`, required `expiresAt` (no null TTL) |

## 2. Replay + conflict protocol

1. Mutating POST carries `Idempotency-Key` (header) or `idempotencyKey`
   (body, simulations).
2. Server looks up `(tenantId, endpoint, idempotencyKey)`: miss →
   execute, store row with `requestHash` + result; hit with equal
   `requestHash` → replay stored `statusCode`/`responseBody` without
   re-executing; hit with different `requestHash` →
   `idempotency_conflict` (HTTP 409).
3. The `@@unique([tenantId, endpoint, idempotencyKey])` constraint is the
   race backstop against double-insert; `expiresAt` bounds the retention
   sweep (Step 24/25 duty).

## 3. Retention

- `AuditEvent`: append-only, no service-side deletion; retention/deletion
  policy is operator-owned (threat-model residual risk §4.3).
- `IdempotencyRecord`: `expiresAt` required at insert (recommended TTL:
  24h, matching the proof run); sweep deletes `expiresAt < now()`
  (Step 24/25). The `(expiresAt)` index serves the sweep.

## 4. Redaction rule (threat model T4)

- `actorKeyPrefix` stores the safe `ppk_…` prefix — never digest or raw.
- `metadata` allowlist: names, versions, `contentHash`, statuses, counts,
  prefixes. Banned: raw keys, digests, full snapshots.
- Schema cannot enforce this structurally, so the gate includes a live
  column + value scan (see §6: `secret-cols: NONE`, `secret-values: NONE`).

## 5. Indexes and the lookups they serve

| Index | Serves |
| --- | --- |
| `AuditEvent(tenantId)` | per-tenant audit scope |
| `AuditEvent(tenantId, createdAt)` | newest-first paged listing (`GET /audit-events`) |
| `AuditEvent(tenantId, type, createdAt)` | type-filtered listing (`?type=`) |
| `AuditEvent(resourceType, resourceId)` | resource-trail lookup across tenants (operator) |
| `IdempotencyRecord(tenantId, endpoint, idempotencyKey)` unique | replay lookup + double-insert backstop |
| `IdempotencyRecord(tenantId)` | per-tenant key management |
| `IdempotencyRecord(expiresAt)` | retention sweep |

## 6. Verification (Step 23 gate, 2026-10-15)

- `prisma validate` ✅ schema valid; `prisma generate` ✅ client v7.10.0.
- `prisma migrate dev --name add-audit-idempotency` against
  `phantom-postgres` (`postgres:16-alpine`, host `5434`) ✅
  `Applying migration 20261015092503_add_audit_idempotency` → in sync;
  `migrate status` ✅ `Database schema is up to date!`.
- Live gate probes (`scripts/step23-proof.js`, since removed) ✅
  `audit-order: NEWest-FIRST-OK`, `replay: SAME-HASH-REPLAY-OK`,
  `conflict: DIFFERENT-HASH-CONFLICT-OK`,
  `unique: DUPLICATE-KEY-REJECTED code=23505`,
  `secret-cols: NONE`, `secret-values: NONE`. Proof rows cleaned up.
- `typecheck / lint:check / format:check / test / test:e2e / build` ✅
  (recorded in the Act report); `src/domain/` has no Prisma imports
  (ADR-002 preserved).
