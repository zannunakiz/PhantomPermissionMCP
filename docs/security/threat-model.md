# Threat Model — PhantomPermissionMCP (v1)

> Scope: the v1 design in `docs/architecture/overview.md`. Trust boundary =
> the service process + its PostgreSQL. Customers' live authorization
> systems are **out of scope by design** (the service never talks to them).

## 1. Assets

1. Tenant access-model snapshots (sensitive: mirror of customer RBAC).
2. Simulation reports/exports (reveal who-can-do-what deltas).
3. API keys (bearer access to 1 + 2) and their digests.
4. Audit log (who did what; needed for incident response).
5. Service availability for local/CI analysis workloads.

## 2. Actors

| Actor | Capability |
| --- | --- |
| Legitimate tenant client (CI job, developer) | holds `ppk_…` + scopes for its own tenant |
| Curious/malicious tenant | valid key for tenant A, probes tenant B resources |
| Key thief | stolen `ppk_…` (log leak, shoulder-surf, pasted into ticket) |
| Network attacker | can send unauthenticated HTTP, replay requests, flood endpoints |
| Malicious MCP caller | invokes tools with hostile arguments / oversized payloads |
| Operator (local dev) | runs provisioning CLI, sees issued raw keys once |

Non-actor by design: the service initiates no connections, so there is no
"compromised upstream server" or webhook-receiver threat in v1.

## 3. Threats and mitigations

| # | Threat | Mitigation (design → implementing step) |
| --- | --- | --- |
| T1 | Cross-tenant read/write (IDOR): key for A fetches B's model/simulation/report/export | tenant filter in every use case, never trusting caller-supplied tenant ids; uniform `tenant_forbidden` (overview §8 → Steps 26, 39, 55) |
| T2 | Scope escalation: `simulations:read` key creates models or runs simulations | per-use-case scope check; least-privilege default sets (overview §8 → Steps 27, 39) |
| T3 | Key compromise at rest: DB dump yields usable credentials | store only HMAC digest + prefix with server-side pepper; constant-time compare; revocation + expiry (ADR-007 → Steps 20, 27) |
| T4 | Key leak via logs/errors/exports/audit | raw key rendered once to interactive CLI caller only; never persisted, logged, or returned; audit events exclude key material (→ Steps 05, 23, 28, 37) |
| T5 | Stale-write / lost-update on model versions | optimistic concurrency: `expectedVersion`/`If-Match`, `conflict_version` 409, immutable snapshots (ADR-008 → Steps 33, 55) |
| T6 | Duplicate side effects on retry (double simulation/version) | `Idempotency-Key` scoped to (tenant, endpoint); payload-mismatch → `idempotency_conflict` (ADR-009 → Steps 23, 34) |
| T7 | DoS via huge graphs / deep inheritance / giant reports | documented size/depth/operation caps; bounded pagination and export sizes; sync execution fails fast (ADR-006, overview §4 → Steps 07, 30, 35, 36, 55) |
| T8 | ReDoS / parser abuse on hostile strings | strict schemas, length limits, no regex-based permission matching in v1 (exact strings only) (→ Steps 07, 09) |
| T9 | Auth bypass on MCP: tool called without identity or with forged tenant argument | transport auth required; tenant derived from caller, never from tool args; same scope checks as REST (overview §7 → Steps 46, 47) |
| T10 | MCP oversized-tool-argument DoS / error leakage | input-size limits, timeouts, safe tool errors, no stack traces to callers (→ Steps 40, 46) |
| T11 | Cycle-induced hang in inheritance resolution | cycle detection with reported path + depth cap before resolution (→ Step 11) |
| T12 | Misleading "secure" verdict from risk findings | findings carry rule id, severity, evidence, explanation; docs state they are advisory (overview §6 → Steps 16, 44) |
| T13 | Secrets in config errors / startup logs | centralised config validation; placeholders only in `.env.example`; secrets redacted (→ Step 04) |
| T14 | Rate/abuse on auth + simulation endpoints | rate limiting + request limits; production-safe error responses (→ Step 29) |

Explicitly not applicable in v1 (with reason):

- **SSRF** — the service makes zero outbound requests (ADR-011).
- **Session fixation / CSRF / XSS** — no browser sessions, cookies, or HTML UI; machine API + MCP only.
- **SQL injection** — all DB access via Prisma parameterised queries (to be asserted in Step 19+ tests, not by string building).

## 4. Residual risks (accepted, documented)

1. **Pepper compromise** weakens stored-digest protection → pepper rotation
   procedure required (Steps 04, 28); compromise response = rotate pepper +
   reissue keys.
2. **Operator shoulder-surfing** at issuance (raw key shown once) → issuance
   is an interactive local-CLI action; keys must be placed in a secret store
   immediately (Step 28 documents this).
3. **Sensitive snapshots in backups/logs** → retention/deletion policy for
   audit + report data owned by Steps 23/37; operators must back up the DB
   with encryption at rest.
4. **Risk-rule false negatives** → catalogue is heuristic; high-stakes
   decisions require human review (stated in every report's `disclaimer`).

## 5. Security testing obligations (traceability)

Every mitigation above maps to tests: cross-tenant IDOR, revoked/expired
keys, wrong scopes, malformed auth, key redaction in all surfaces,
idempotency conflicts, concurrent version races, rate limits, oversized
payloads, MCP unauthenticated/tenant-forged calls (Steps 39, 47, 55).
Findings that fail → fix the defect, never weaken the assertion.

