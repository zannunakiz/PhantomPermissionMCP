# Architecture Decision Records — PhantomPermissionMCP

> Format: context → decision → consequences. Statuses: `accepted` (binding
> from Step 02) or `deferred` (owner step noted).

## ADR-001 — Modular monolith on NestJS (accepted)

- **Context:** Self-hosted single service, REST + MCP over the same logic. No
  scale or team pressure justifies distribution.
- **Decision:** One NestJS deployable, modules per bounded context (`models`,
  `simulations`, `reports`, `audit`, `tenancy`, `mcp`, `health`). No
  microservices, no shared-libraries repo in v1.
- **Consequences:** Simple local/Docker story; module boundaries enforced by
  import rules and review.

## ADR-002 — Framework-free deterministic domain engine (accepted)

- **Context:** Engine must be deterministic, immutable where practical,
  independently testable, separated from NestJS/persistence/HTTP/MCP.
- **Decision:** `domain/` is plain TypeScript: no `@nestjs/*`, no ORM, no
  HTTP/MCP imports. Pure functions; inputs never mutated; canonical JSON
  ordering; no clock/randomness inside analysis paths.
- **Consequences:** Engine unit/property tests run without Nest; adapters map
  DTOs ↔ domain types at the boundary.

## ADR-003 — PostgreSQL + Prisma for persistence (accepted)

- **Context:** No existing DB/ORM in the scaffold. Without one, use
  PostgreSQL + Prisma; no Redis unless needed.
- **Decision:** PostgreSQL + Prisma. Nothing in v1 needs a queue/cache, so no
  Redis or extra service is added.
- **Consequences:** Steps 19–24 define schema, migrations, seeds, health
  checks; integration tests use an isolated database (Step 54).

## ADR-004 — REST and MCP share application use cases (accepted)

- **Context:** REST and MCP must reuse the same use cases; drift between
  surfaces is a top correctness risk.
- **Decision:** Controllers and MCP tool handlers are thin mappers over
  identical use-case classes (§7 of `overview.md`). Tenant/scope checks live
  in the use case, never in the adapter.
- **Consequences:** Parity tests (Steps 42/44) assert REST ≡ MCP on the same
  fixtures.

## ADR-005 — URL-path API versioning under `/api/v1` (accepted)

- **Context:** Predictable evolution without header negotiation complexity.
- **Decision:** All public REST routes live under `/api/v1`; breaking changes
  require `/api/v2`. Pagination/envelope conventions standardised in Step 30.
- **Consequences:** Contract (`docs/api/v1-contract.md`) is version-pinned;
  OpenAPI is generated from v1 DTOs/controllers.

## ADR-006 — Synchronous, bounded simulation execution (accepted)

- **Context:** Simulations must be reproducible and testable locally without workers.
- **Decision:** `SimulatePermissionChange` runs synchronously with documented
  input/output limits (graph size, depth, operations per request, report
  caps). No job queue in v1; `Idempotency-Key` makes retries safe.
- **Consequences:** Oversized inputs fail fast with `payload_too_large` /
  `validation_failed` instead of timing out opaquely.

## ADR-007 — API-key design: prefix + HMAC digest + pepper (accepted)

- **Context:** Keys authenticate machine clients; leaks must be containable;
  storage must survive DB-read attacks.
- **Decision:** Format `ppk_<random>`; persist only `keyPrefix` +
  `HMAC-SHA-256(key, serverPepper)`; constant-time comparison; raw key shown
  once at issuance; revocation + expiry first-class; provisioning via local
  CLI/script only — no public admin endpoint.
- **Consequences:** Steps 20/27/28 implement; pepper is required config in
  production (Step 04).

## ADR-008 — Optimistic concurrency on versions (accepted)

- **Context:** Concurrent model edits must not silently overwrite each other.
- **Decision:** New snapshots require `expectedVersion` or
  `If-Match: "<etag>"`; mismatch → `conflict_version` (409). Snapshots
  immutable; history preserved.
- **Consequences:** Step 33 implements; regression tests cover stale-write
  races (Step 55).

## ADR-009 — Idempotency keys on mutating POSTs (accepted)

- **Context:** Clients retry; duplicate simulations/versions must not fork state.
- **Decision:** `POST …/versions` and `POST /api/v1/simulations` honour
  `Idempotency-Key` scoped to (tenant, endpoint). Same key + same payload →
  original response replayed; same key + different payload →
  `idempotency_conflict` (409).
- **Consequences:** Key store with TTL/retention (Step 23).

## ADR-010 — Quality stack: Jest + supertest + Newman (accepted)

- **Context:** Jest unit/integration/e2e, Postman collections, Newman, CI
  config — all free/local — are required deliverables.
- **Decision:** Jest (unit + e2e via supertest harness), Postman collections +
  local environment in `postman/`, Newman for scenario runs, GitHub Actions
  YAML as config-only deliverable.
- **Consequences:** Steps 53–56, 59, 61 execute; no paid test services.

## ADR-011 — No outbound requests by design (accepted)

- **Context:** Every outbound call is SSRF surface and a reliability dependency.
- **Decision:** v1 makes zero outbound HTTP calls (no webhooks, no remote
  fetching). A future outbound need must add SSRF controls and document proxy
  trust (Step 29) — the default stays "none".
- **Consequences:** Threat model marks SSRF not-applicable-by-construction.

## ADR-012 — JSON-first reports, CSV best-effort (accepted)

- **Context:** CI/tooling consumers need machine-readable output without heavy deps.
- **Decision:** JSON export is normative with stable field order; CSV for
  subject-permission impact added only if dependency-free and correctly
  escaped (Step 36 decides; the contract already fixes the CSV columns).
- **Consequences:** Export tests assert schema, escaping, limits, ordering,
  tenant isolation.

## Deferred (explicitly not decided here)

| Item | Owner step |
| --- | --- |
| MCP transport + SDK version pin | Step 40 |
| Local stdio entrypoint + trust assumptions | Step 48 |
| Final error taxonomy wording | Step 05 |
| Final pagination envelope + max page size | Step 30 |
| Coverage gate percentages | Step 53 |
| Monitoring stack contents | Step 52 |
| Docker base image + compose services | Steps 57–58 |

