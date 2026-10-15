# Repositories — PhantomPermissionMCP

> Ports (interfaces) + Prisma adapters. Application services depend on
> the ports; only `src/repositories/prisma/` imports the ORM client.
> No transport (REST/MCP) imports a repository directly — the shared
> use-case layer owns that seam, so behaviour cannot drift between
> surfaces.

## 1. Ports (framework-free)

| Port | Token | Distinct access pattern |
| --- | --- | --- |
| `TenantRepository` | `TENANT_REPOSITORY` | id + name lookup |
| `ApiKeyRepository` | `API_KEY_REPOSITORY` | digest lookup, revoke, last-used touch |
| `AccessModelRepository` | `ACCESS_MODEL_REPOSITORY` | tenant-scoped metadata CRUD |
| `ModelVersionRepository` | `MODEL_VERSION_REPOSITORY` | version sequencing + transactional advance |
| `SimulationRepository` | `SIMULATION_REPOSITORY` | write-once run + report reads |
| `IdempotencyRepository` | `IDEMPOTENCY_REPOSITORY` | replay lookup + expiry sweep |
| `AuditRepository` | `AUDIT_REPOSITORY` | append + newest-first reads |

One port per aggregate — no generic base class. Each table has a
distinct lookup shape (digest, version sequence, replay key), so a
shared abstraction would hide real differences instead of removing
duplication.

## 2. Tenant-first rule

Every method that touches tenant-owned data takes `tenantId` as its
first argument and applies it in the `where` clause. The single
exception is `ApiKeyRepository.findByDigest`, which resolves the tenant
from the row during authentication (the caller has no tenant yet).
Cross-tenant misuse returns `null` (read/update paths), never another
tenant's row. Behavioural attack-proofs belong to the later
tenant-isolation work; this layer makes the safe call the easy call.

## 3. Transactions and conflicts

- Version create + `currentVersion` advance run in one `$transaction`;
  racers collide on the `(modelId, version)` unique constraint.
- Duplicate model names and duplicate idempotency keys surface the
  driver's unique-constraint error with its cause intact; human-facing
  code mapping (`validation_failed`, `idempotency_conflict`) belongs to
  the use-case layer, which has the request context.
- No adapter catches and reinterprets database errors — translation at
  the boundary would duplicate the use cases' job.

## 4. Test strategy

- Unit suite stays hermetic: integration specs use the `*.int-spec.ts`
  suffix, which matches neither the unit `testRegex` (`*.spec.ts`) nor
  the e2e config (verified by the green default run). Run explicitly:
  `npm run test:integration` (requires `DATABASE_URL` → Docker DB).
- Integration cases use `repo-int-*` ids, assert round-trip + scoping +
  unique/conflict behaviour per port, and delete all rows in
  `afterAll`. Verified green (7/7) against `phantom-postgres`.

## 5. Deferred

Tenant-isolation attack tests, HMAC/auth/provisioning logic, and the
consuming use cases/endpoints all belong to later work. This layer
adds no behaviour beyond faithful port ↔ table mapping.
