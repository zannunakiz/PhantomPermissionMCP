# Access-Model & Version Schema — PhantomPermissionMCP (Step 21)

> Step 21 owns the `AccessModel` + `ModelVersion` durable-history
> boundary only. Steps 22–23 (simulations/reports, audit/idempotency)
> add their own tables + migrations. No creation/versioning logic here —
> use cases belong to Step 33; repository adapters to Step 25;
> tenant-isolation queries to Step 26.

## 1. Tables

| Table | Purpose | Key columns |
| --- | --- | --- |
| `AccessModel` | Tenant-scoped model metadata (overview §4, contracts §1). App-assigned `mdl_…` id. | `id` PK, `tenantId` FK → `Tenant.id` cascade, `name`, `currentVersion` (default 1), timestamps |
| `ModelVersion` | One immutable numbered snapshot (ADR-008). Append-only: inserted, never updated in place. Business key `(modelId, version)`; `id` is an internal row id. | `modelId` FK → `AccessModel.id` cascade, denormalised `tenantId`, `version` ≥ 1, `contentHash` (`sha256:<hex>`), `snapshot` jsonb, `operationCount`, `createdAt` |

## 2. Append-only + uniqueness rules

- `(tenantId, name)` unique on `AccessModel`: duplicate model names
  within a tenant are rejected (`validation_failed` 400); the constraint
  is the race backstop behind the Step 33 use-case check.
- `(modelId, version)` unique on `ModelVersion`: strictly increasing
  versions per model; the DB backstops the app-enforced sequence.
- `contentHash` indexed, deliberately **not** unique: identical snapshots
  across models/tenants are legitimate.
- `snapshot` stored whole as `jsonb` (verified live): snapshots are
  immutable and always read/written as a unit; no element-level queries
  exist in the v1 contract, so normalized element tables were rejected
  as over-modelling.

## 3. Optimistic-concurrency protocol (ADR-008, threat model T5)

1. Reader fetches model metadata (`currentVersion`) and the version row's
   `contentHash` (exposed as HTTP `ETag`).
2. Writer submits the new snapshot with `expectedVersion` (JSON) or
   `If-Match: "<etag>"` (HTTP).
3. Server compares against live `currentVersion` / `contentHash`:
   match → insert new `ModelVersion` row + advance `currentVersion`
   **in one transaction** (repository duty, Step 25); mismatch →
   `conflict_version` (HTTP 409).
4. The `(modelId, version)` unique constraint is the final race backstop
   if two writers pass the check concurrently.

## 4. Tenant relations

- `AccessModel.tenantId → Tenant.id` cascade; `ModelVersion.modelId →
  AccessModel.id` cascade. Removing a tenant removes its models and
  their versions — no orphaned snapshots.
- `ModelVersion.tenantId` is denormalised for join-free tenant-scoped
  reads (`tenant_forbidden` path, threat model T1).

## 5. Indexes and the lookups they serve

| Index | Serves |
| --- | --- |
| `AccessModel(tenantId, name)` unique | duplicate-name guard + per-tenant name lookup |
| `AccessModel(tenantId)` | per-tenant model listing |
| `AccessModel(tenantId, updatedAt)` | `orderBy=name\|createdAt` listing path (Step 30 pagination) |
| `ModelVersion(modelId, version)` unique | version fetch + race backstop |
| `ModelVersion(modelId, version)` index | ordered version-history reads |
| `ModelVersion(tenantId)` | tenant-scoped version reads without join |
| `ModelVersion(contentHash)` | ETag/`If-Match` correlation, dedupe detection |

## 6. Verification (Step 21 gate, 2026-10-15)

- `prisma validate` ✅ schema valid; `prisma generate` ✅ client v7.10.0.
- `prisma migrate dev --name add-access-models-versions` against
  `phantom-postgres` (`postgres:16-alpine`, host `5434`) ✅
  `Applying migration 20261015090150_add_access_models_versions` →
  in sync; `migrate status` ✅ `Database schema is up to date!`.
- Live introspection ✅ tables `AccessModel,ModelVersion`; all 9
  indexes as above; `snapshot` is `jsonb`; FK cascade confirmed.
- `typecheck / lint:check / format:check / test / test:e2e / build` ✅
  (recorded in the Act report); `src/domain/` has no Prisma imports
  (ADR-002 preserved).
