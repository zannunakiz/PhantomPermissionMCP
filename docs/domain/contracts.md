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

## 7. Non-goals

No validation logic, no Zod schemas, no persistence, no Nest/MCP/HTTP
imports in `src/domain/`. Runtime schemas (Step 09), structural checks
(Step 10), and cycle detection (Step 11) build on — never inside —
these types.
