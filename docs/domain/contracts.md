# Domain Contracts — PhantomPermissionMCP (Step 08)

> Normative type reference for the permission engine. Later steps
> (09–14) implement runtime validation and analysis against these
> shapes. Field names here must match `docs/architecture/overview.md`
> and `docs/api/v1-contract.md`; any rename updates those files first.

## 1. Entities (`src/domain/access-model.ts`)

| Type | Shape | Notes |
| --- | --- | --- |
| `Role` | `{ id: RoleId, name: string, description? }` | Names unique per snapshot (enforced Step 10) |
| `Permission` | `{ id: PermissionId, value: string }` | `value` e.g. `invoice:refund`, unique per snapshot |
| `Binding` | `{ roleId, permissionId }` | One grant; duplicates rejected Step 10 |
| `InheritanceEdge` | `{ childRoleId, parentRoleId }` | Acyclic; cycle path reported Step 11 |
| `Assignment` | `{ subjectId, roleId }` | Duplicates rejected Step 10 |
| `Subject` | `{ id: SubjectId, displayName? }` | No user directory — caller-supplied |
| `AccessModelSnapshot` | `{ roles, permissions, bindings, inheritance, assignments, subjects }` | Immutable input to analysis |
| `AccessModel` | `{ id: ModelId, tenantId, name, currentVersion, createdAt, updatedAt, versions }` | Metadata; snapshots append-only |

## 2. Identifier rules (`src/domain/ids.ts`)

- Models `mdl_…`, simulations `sim_…`, audit events `evt_…`, tenants `tnt_…`.
- Role/permission/subject refs: opaque non-empty strings ≤ 128 chars
  (`[A-Za-z0-9_:-]`). Uniqueness enforced by runtime validation.
- `contentHash`: `sha256:<64 lowercase hex>`. Versions: integers ≥ 1.
- Time: RFC 3339 UTC strings. The engine holds no clock.

## 3. Operations (`src/domain/operations.ts`)

`OperationType`: `grant_permission` · `revoke_permission` ·
`assign_role` · `unassign_role` · `add_inheritance` ·
`remove_inheritance`. Discriminated union `ChangeOperation` carries
only the fields each op needs.

| Operation | Precondition | Conflict behaviour |
| --- | --- | --- |
| `grant_permission` | role + permission exist; binding absent | existing binding → no-op entry |
| `revoke_permission` | both exist | missing binding → no-op entry |
| `assign_role` | subject + role exist; assignment absent | existing assignment → no-op entry |
| `unassign_role` | both exist | missing assignment → no-op entry |
| `add_inheritance` | both exist; edge absent; stays acyclic | duplicate → no-op; cycle → `validation_failed` |
| `remove_inheritance` | both exist | missing edge → no-op entry |

Unknown operation types are unrepresentable. Operations apply in order
against an immutable clone; the source snapshot is never mutated.

## 4. Impact and findings (`src/domain/impact.ts`, `src/domain/findings.ts`)

- `SubjectImpact{ subjectId, added[], removed[] }` — sorted, deduplicated.
- `SimulationSummary{ addedCount, removedCount, affectedSubjectCount, findingCounts{critical,high,medium,low} }`.
- `RiskFinding{ ruleId, severity, subjects[], evidence, explanation }`.
- Rule IDs: `SENSITIVE_PERMISSION`, `BROAD_ACCESS_INCREASE`,
  `UNEXPECTED_SUBJECT_IMPACT`, `RISKY_INHERITANCE`,
  `PRIVILEGE_ESCALATION_PATTERN`. Severities: `low`/`medium`/`high`/`critical`.
- Findings are advisory only.

## 5. Errors (`src/domain/errors.ts`)

`DomainError{ code, message, details?: {path,reason}[] }` — plain
TypeScript, no Nest/HTTP imports. Adapters map these to REST/MCP codes
at the boundary.

| Code | Meaning |
| --- | --- |
| `invalid_identifier` | ID/prefix/hash/version shape violation |
| `invalid_reference` | Dangling role/permission/subject reference |
| `duplicate_entity` | Duplicate name/value/binding/assignment/edge |
| `inheritance_cycle` | Cycle-creating edge (path in details) |
| `unsupported_operation` | Unknown operation type |
| `limit_exceeded` | Collection/depth/operation bound crossed |
| `empty_model` | Snapshot with no usable content where required |

## 6. Limits (`src/domain/limits.ts`)

Roles ≤ 500 · permissions ≤ 2000 · bindings ≤ 10000 · edges ≤ 2000 ·
assignments ≤ 10000 · subjects ≤ 5000 · depth ≤ 25 · ops/simulation ≤ 200.
Enforcement in Steps 09–11; this file is the single numeric source.

## 7. Runtime schemas (Step 09, `src/domain/schemas.ts`)

- Envelopes: `{ schemaVersion: 1, snapshot }` and
  `{ schemaVersion: 1, modelId, version?, operations, idempotencyKey? }`.
  Wrong or missing `schemaVersion` is rejected explicitly.
- Syntactic only: required fields, primitive types, `.strict()` unknown
  keys, string lengths (ids/refs 1–128, role names 1–100, descriptions
  ≤ 500, permission values 1–200 matching `^[A-Za-z0-9:._/*-]+$`,
  display names 1–100, idempotency keys 1–128), collection caps from
  `DOMAIN_LIMITS`, operation `type` discriminators, duplicate `id`
  strings within one array.
- Cross-array semantics (dangling refs, duplicate names/values/
  bindings/edges, cycles) belong to Step 10+.
- Failures throw `DomainError` with safe `{ path, reason }` details —
  never echoed values.

## 8. Structural validation (Step 10)

`validateStructure(snapshot)` in `src/domain/validate-structure.ts`
checks duplicate ids/names/values/pairs, dangling role/permission/
subject references, malformed identifiers, self-inheritance, and empty
models. Returns every actionable `{ path, reason }` finding in index
order, capped at 100 with a trailing `too_many_findings` marker.
`assertValidStructure()` throws the aggregated `DomainError` and is the
required guard before Step 12 permission resolution. Multi-node cycle
paths belong to Step 11.

## 9. Cycle detection (Step 11)

`detectInheritanceCycle(snapshot)` in
`src/domain/inheritance-cycles.ts` runs iterative DFS over child →
parent links and returns the first cycle as an explicit node path
(first id repeats last), or `{ ok: true }`. Bounds from
`DOMAIN_LIMITS`: ≤ 2000 edges and traversal depth ≤ 25, else
`limit_exceeded`. Unknown role references are a Step 10 concern and are
skipped here. `assertAcyclicInheritance()` is the required guard before
Step 12 resolution.

## 10. Permission resolution (Step 12)

`resolveSubjectPermissions(snapshot, subjectId)` and
`resolveAllSubjects(snapshot)` in
`src/domain/resolve-permissions.ts` compute
`effective(subject) = union of directly bound + transitively inherited
permission values`, deduplicated and sorted lexicographically.
`assertValidStructure` + `assertAcyclicInheritance` run first, so no
invalid model reaches traversal. Unknown subjects throw
`invalid_reference`; subjects with no assignments resolve to `[]`.
Pure, non-mutating, no clock/randomness.

## 11. Operation preconditions (Step 13)

`checkOperation(snapshot, operation, index)` in
`src/domain/check-operations.ts` (helpers in
`operation-preconditions.ts` + `check-inheritance.ts`) classifies each
op as `apply`, `noop` (`already_granted`, `not_granted`,
`already_assigned`, `not_assigned`, `already_inherits`,
`not_inherited`), or `error` (`invalid_reference`,
`inheritance_cycle`, `unsupported_operation`). Guards
(`assertValidStructure` + `assertAcyclicInheritance`) run first.
`checkOperations` maps ordered lists. Details use
`operations[i].<field>` paths with no echoed values. Checking only —
application against a clone belongs to Step 14.

## 12. Non-goals

No validation logic beyond Steps 09–13, no persistence, no
Nest/MCP/HTTP imports in `src/domain/`. Immutable
application (Step 14) builds on — never inside —
these types.
