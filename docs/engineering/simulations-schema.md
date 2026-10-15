# Simulation & Report Schema — PhantomPermissionMCP (Step 22)

> Step 22 owns the `Simulation` durable-output boundary only.
> Step 23 (audit/idempotency) adds its own tables + migrations. No
> execution logic here — simulation/report use cases belong to
> Steps 34–35; repository adapters to Step 25; tenant-isolation
> queries to Step 26.

## 1. Table

| Table | Purpose | Key columns |
| --- | --- | --- |
| `Simulation` | One reproducible run (overview §4) with its report co-located. App-assigned `sim_…` id. Rows are never mutated after insert — a rerun creates a new row. | `tenantId` (denormalised), `modelId` FK → `AccessModel.id` cascade, `version` + `versionRowId` + `contentHash` provenance triple, `operations` jsonb, `status` enum, `summary`/`impacts`/`findings` jsonb, `disclaimer`, `createdAt` |

## 2. Single-table rationale

The report is 1──1 with its simulation, always read together
(`GET …/report`), and never queried element-wise in the v1 contract —
a separate `Report` table would add joins with zero benefit (same JSONB
reasoning as `ModelVersion.snapshot` in Step 21).

## 3. Provenance (exact-input traceability)

Each row copies the triple `(modelId, version, contentHash)` plus a
direct `versionRowId` link at insert time, so a saved report traces to
the exact immutable input version and request even if versions are ever
pruned. The real FK is `modelId → AccessModel` (cascade); the
`(modelId, version)` pairing is enforced by the Step 34/35 use case
against `ModelVersion`'s unique constraint — chosen over a composite FK
to avoid Prisma composite-FK brittleness with no cascade benefit.
Invalid `modelId` references fail at the FK (`23503`, proven below).

## 4. Status lifecycle

`SimulationStatus`: `COMPLETED` (default) · `FAILED` (validation-failure
records carry operations + empty impacts). Both values ship now so the
enum never needs a breaking migration later.

## 5. Indexes and the lookups they serve

| Index | Serves |
| --- | --- |
| `Simulation(tenantId)` | per-tenant listing, cascade path |
| `Simulation(tenantId, createdAt)` | newest-first report history |
| `Simulation(modelId, version)` | runs-against-version traceability |
| `Simulation(contentHash)` | input-hash correlation, dedupe detection |

## 6. Verification (Step 22 gate, 2026-10-15)

- `prisma validate` ✅ schema valid; `prisma generate` ✅ client v7.10.0.
- `prisma migrate dev --name add-simulations` against
  `phantom-postgres` (`postgres:16-alpine`, host `5434`) ✅
  `Applying migration 20261015090634_add_simulations` → in sync;
  `migrate status` ✅ `Database schema is up to date!`.
- Live round-trip (`scripts/step22-proof.js`, since removed) ✅
  `roundtrip: IDENTICAL` — insert tenant → model → version →
  simulation with known operations/summary/impacts/findings, retrieve,
  deep-compare; negative probe ✅ `FK-REJECTED code=23503` for a bogus
  `modelId`. Proof rows cleaned up afterwards.
- `typecheck / lint:check / format:check / test / test:e2e / build` ✅
  (recorded in the Act report); `src/domain/` has no Prisma imports
  (ADR-002 preserved).
