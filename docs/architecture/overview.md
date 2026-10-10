# PhantomPermissionMCP — Architecture Overview (v1)

> Status: design baseline for Step 02. Normative for terminology and
> identifiers; later steps implement against it. Any deviation must update
> this document first.

## 1. Purpose

PhantomPermissionMCP is a **self-hostable, read-only RBAC change-impact
analysis backend** exposed through REST and MCP.

A tenant submits a versioned description of its access model (roles,
permissions, inheritance, assignments) plus a list of **proposed changes**.
The service validates the model, applies the proposal to an immutable copy,
resolves effective permissions before/after, and returns a deterministic
impact simulation with explainable risk findings.

**The service never applies changes to a customer's live authorization
system.** It analyses copies supplied by the caller. There is no live
enforcement path, no provisioning path, and no outbound connection to
customer infrastructure.

## 2. Canonical vocabulary

Every document, identifier, error, and test fixture must use these terms:

| Term | Meaning |
| --- | --- |
| `tenant` | Isolation boundary. Every persisted resource belongs to exactly one tenant. |
| `access model` | A named RBAC description owned by a tenant: roles, permissions, bindings, inheritance, assignments. |
| `model version` / `snapshot` | One immutable, numbered snapshot of an access model. Append-only; never updated in place. |
| `role` | Named collection of permissions, e.g. `billing-admin`. |
| `permission` | Atomic capability string, e.g. `invoice:refund`. |
| `binding` (`grant`) | Attachment of a permission to a role. |
| `inheritance` | Directed parent→child edge between roles; a child gains all effective permissions of its parents. Must be acyclic. |
| `subject` | Identity evaluated for access (user, service account). Lives inside the tenant's model; the service has no user directory. |
| `assignment` | Attachment of a role to a subject. |
| `operation` | One proposed change step (see §5). A simulation applies an ordered list of operations. |
| `simulation` | Deterministic before/after analysis of one operation list against one snapshot. Persisted with provenance. |
| `impact` | Per-subject added/removed effective permissions plus the affected-subject set. |
| `risk finding` | One explainable rule hit: rule id, severity, subjects, evidence, explanation. Advisory only. |
| `report` / `export` | Persisted simulation result (report) and its machine-readable rendering (export: JSON, optionally CSV). |
| `audit event` | Append-only record of a sensitive action. Never contains raw API keys. |
| `API key` | Bearer credential `ppk_<random>` bound to one tenant with a scope set. Only a digest is persisted; raw key shown once. |
| `scope` | Capability string limiting what a key may do (see §7). |
| `use case` | One application operation (e.g. `SimulatePermissionChange`) implemented once and reused by both REST and MCP adapters. |

## 3. Identifier and representation rules

- Resource IDs are opaque strings with stable prefixes: models `mdl_…`,
  simulations `sim_…`, audit events `evt_…`; API-key log prefix `ppk_…`.
- Model versions are integers starting at `1`, strictly increasing per model.
- Each snapshot carries a `contentHash` (SHA-256 over canonical JSON),
  exposed as the HTTP `ETag`.
- Concurrency precondition: `expectedVersion` (JSON) or
  `If-Match: "<etag>"` (HTTP). Stale writes fail with `conflict_version`
  (HTTP 409).
- Time is RFC 3339 UTC. Sorting is stable and documented per endpoint
  (see `docs/api/v1-contract.md`).
- Error `code` values are snake_case and shared by REST and MCP
  (`validation_failed`, `not_found`, `conflict_version`, `unauthorized`,
  `forbidden_scope`, `tenant_forbidden`, `rate_limited`,
  `payload_too_large`, `idempotency_conflict`, `internal_error`).
  Detailed in Step 05.

## 4. v1 domain model

```text
Tenant 1──* AccessModel 1──* ModelVersion (immutable snapshot)
AccessModel {
  roles:       Role[]            # { id, name, description? }
  permissions: Permission[]      # { id, value }  e.g. "invoice:refund"
  bindings:    Binding[]         # { roleId, permissionId }  ("grant")
  inheritance: InheritanceEdge[] # { childRoleId, parentRoleId }, acyclic
  assignments: Assignment[]      # { subjectId, roleId }
  subjects:    Subject[]         # { id, displayName? }
}
```

Invariants (enforced by validation, Steps 10–11):

1. All `roleId`/`permissionId`/`subjectId` references resolve inside the same snapshot.
2. No duplicate role names, permission values, bindings, assignments, or edges.
3. The inheritance graph is acyclic; cycle paths are reported, not just a boolean.
4. Bounded size/depth (limits in `docs/api/v1-contract.md`) to prevent resource exhaustion.

Effective permissions of a subject = union of permissions bound to directly
assigned roles plus all transitively inherited permissions, deduplicated and
deterministically ordered.

## 5. Supported change operations (v1)

| Operation | Parameters | Precondition | Conflict behaviour |
| --- | --- | --- | --- |
| `grant_permission` | `roleId`, `permissionId` | both exist; binding absent | existing binding → no-op entry, not an error |
| `revoke_permission` | `roleId`, `permissionId` | both exist | missing binding → no-op entry |
| `assign_role` | `subjectId`, `roleId` | both exist; assignment absent | existing assignment → no-op entry |
| `unassign_role` | `subjectId`, `roleId` | both exist | missing assignment → no-op entry |
| `add_inheritance` | `childRoleId`, `parentRoleId` | both exist; edge absent; keeps graph acyclic | duplicate → no-op; cycle-creating → rejected (`validation_failed`) |
| `remove_inheritance` | `childRoleId`, `parentRoleId` | both exist | missing edge → no-op entry |

Unknown operation types are rejected. Operations apply in order against an
immutable clone; the source snapshot is never mutated.

## 6. Simulation pipeline (deterministic)

1. Load tenant snapshot by (model, version); verify hash.
2. Validate snapshot structurally (Steps 10–11 rules).
3. Clone; apply operations in order → candidate model; re-validate.
4. Resolve effective permissions per subject **before** and **after**.
5. Diff → impact: `added[]`, `removed[]` per subject; `affectedSubjects[]`.
6. Evaluate risk rules → findings (`ruleId`, `severity`, `subjects`,
   `evidence`, `explanation`).
7. Persist simulation + report with full provenance; return ID + summary.

Same input bytes → same output bytes. No clock, randomness, or map-iteration
order may leak into results.

Risk rule catalogue (thresholds configurable, explicit in output):

| Rule ID | Severity band | Trigger |
| --- | --- | --- |
| `SENSITIVE_PERMISSION` | high/critical | newly granted permission is on the configured sensitive list |
| `BROAD_ACCESS_INCREASE` | medium/high | subject net permission gain crosses a configured threshold |
| `UNEXPECTED_SUBJECT_IMPACT` | medium | subjects outside the operation's declared blast radius gain/lose access |
| `RISKY_INHERITANCE` | medium/high | new edge materially widens inheritance reach |
| `PRIVILEGE_ESCALATION_PATTERN` | high/critical | configured escalation pattern matches |

Severities: `low`, `medium`, `high`, `critical`.

## 7. Layering: adapters over shared use cases

```text
REST controllers (/api/v1) ─┐
                             ├─► Application use cases ─► Domain engine (pure)
MCP tools (5 tools) ────────┘     │                        + Persistence adapters
                                  └─► Audit log (append-only)
```

REST and MCP are **thin adapters**. All policy, validation, and tenant checks
live in the use cases; the deterministic engine has no NestJS, HTTP, MCP, or
DB dependencies. Adding a transport must not duplicate logic.

Shared use cases and their adapters:

| Use case | REST | MCP tool |
| --- | --- | --- |
| `ValidateAccessModel` | `POST /api/v1/models`, `POST /api/v1/models/{id}/versions` | `validate_access_model` |
| `CreateAccessModel` / `ListAccessModels` / `GetAccessModel` | `POST/GET /api/v1/models…` | — (model authoring stays REST-only in v1) |
| `VersionAccessModel` | `POST /api/v1/models/{id}/versions` | — |
| `SimulatePermissionChange` | `POST /api/v1/simulations` | `simulate_permission_change` |
| `GetSimulationReport` | `GET /api/v1/simulations/{id}[ /report]` | `explain_access_change` (diff explanation view) |
| `ExportReport` | `GET /api/v1/simulations/{id}/export` | — |
| `CompareAccessModels` | `GET /api/v1/models/{id}/compare?from=&to=` | `compare_access_models` |
| `FindPrivilegeEscalation` | report findings filter | `find_privilege_escalation` |
| `ListAuditEvents` | `GET /api/v1/audit-events` | — (auditing stays REST-only in v1) |

MCP tools never accept a caller-supplied tenant id; identity is derived from
the authenticated transport caller (Step 46 design point).

## 8. Tenant boundaries and API-key scopes

- All reads/writes are filtered by the caller's tenant; cross-tenant access
  returns `tenant_forbidden`.
- Scopes (least privilege, checked per use case):
  `models:read  models:write  simulations:run  simulations:read`
  `exports:read  audit:read`
- Keys: `Authorization: Bearer ppk_…`; digest = HMAC-SHA-256(key, pepper);
  raw key shown once, never logged/persisted; revocation + expiry supported.
- Mutating POSTs (`…/versions`, `/api/v1/simulations`) accept
  `Idempotency-Key` scoped to (tenant, endpoint). Same key + same payload →
  original result replayed; same key + different payload →
  `idempotency_conflict` (HTTP 409).

## 9. Non-goals (v1 explicitly will not)

1. Not an identity provider, not a login system, not a session manager.
2. No live authorization enforcement or policy decision point.
3. No provisioning/synchronisation back into customer systems.
4. No policy language beyond RBAC + inheritance (no ABAC/ReBAC).
5. No background workers, queues, Redis, or external services.
6. No multi-region, no hosted SaaS control plane, no web UI.
7. No outbound HTTP calls from the service (SSRF surface: none by design).
8. Findings are advisory; the product never claims a score proves security.

## 10. Deferred decisions (owned by later steps)

MCP transport + SDK pin (Step 40), stdio trust (Step 48), error taxonomy
wording (Step 05), pagination envelope (Step 30), schema/migrations
(Steps 19–24), coverage gates (Step 53), Docker/CI (Steps 57–59). This
overview constrains them; it does not replace them.


