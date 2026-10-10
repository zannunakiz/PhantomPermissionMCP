# REST API v1 Contract — PhantomPermissionMCP

> Normative route/shape reference for v1. Field names, error codes, and
> identifier formats here must match `docs/architecture/overview.md` and all
> later DTOs, OpenAPI, Postman collections, and MCP tool schemas. Base path:
> `/api/v1`. Auth (unless noted): `Authorization: Bearer ppk_…`.

## 1. Conventions

- **Versioning:** URL prefix `/api/v1` (ADR-005).
- **Time:** RFC 3339 UTC strings. **IDs:** `mdl_…` / `sim_…` / `evt_…`
  prefixed opaque strings. **Versions:** integers ≥ 1.
- **Error envelope** (all 4xx/5xx, wording finalised in Step 05):

```json
{ "error": { "code": "validation_failed", "message": "…human readable…",
  "details": [ { "path": "roles[3].name", "reason": "duplicate" } ],
  "requestId": "req_…" } }
```

Codes: `validation_failed` 400, `unauthorized` 401, `forbidden_scope` 403,
`tenant_forbidden` 403, `not_found` 404, `conflict_version` 409,
`idempotency_conflict` 409, `rate_limited` 429, `payload_too_large` 413,
`internal_error` 500.
- **Pagination:** `?page=` (1-based, default 1) + `?pageSize=` (default 20,
  max 100); stable `orderBy` per endpoint; response:

```json
{ "data": [ … ], "page": { "page": 1, "pageSize": 20, "total": 57 } }
```

- **ETag / concurrency:** version reads return `ETag: "<contentHash>"`;
  writes accept `If-Match: "<etag>"` or body `expectedVersion`.
- **Idempotency:** mutating POSTs accept `Idempotency-Key` (see overview §8).
- **Scopes:** `models:read models:write simulations:run simulations:read
  exports:read audit:read`.

## 2. Limits (v1 defaults; enforced, documented in errors)

Roles ≤ 500, permissions ≤ 2000, bindings ≤ 10000, edges ≤ 2000,
assignments ≤ 10000, subjects ≤ 5000, inheritance depth ≤ 25, operations per
simulation ≤ 200, JSON body ≤ 1 MiB, report items per page ≤ 200, export rows
≤ 50000 (CSV), simulation summary `added+removed` subjects inline ≤ 500
(remainder via paged report).

## 3. Access-model object (shared shapes)

```json
{
  "id": "mdl_01J…", "tenantId": "tnt_01J…", "name": "billing-rbac",
  "currentVersion": 3, "createdAt": "…", "updatedAt": "…",
  "versions": [ { "version": 3, "contentHash": "sha256:…",
    "createdAt": "…", "operationCount": 0 } ]
}
```

Snapshot content (`snapshot`): `{ roles[], permissions[], bindings[],
inheritance[], assignments[], subjects[] }` per overview §4. Detail reads
embed the requested version's `snapshot` + `contentHash`.

## 4. Endpoints

### Models

- `POST /api/v1/models` — scope `models:write`. Body: `{ name,
  snapshot }`. Validates fully, creates version 1.
  `201 → { id, tenantId, name, currentVersion: 1, contentHash }`.
  Duplicate name in tenant → `validation_failed` 400.
- `GET /api/v1/models` — scope `models:read`. Paged, `orderBy=name|createdAt`
  (default `createdAt`), each item = metadata + version summaries (no full
  snapshots).
- `GET /api/v1/models/{id}` — scope `models:read`. `?version=` selects
  snapshot (default current). Other-tenant id → `tenant_forbidden`.
- `POST /api/v1/models/{id}/versions` — scope `models:write`. Body:
  `{ snapshot, expectedVersion }` (+ optional `If-Match` alternative,
  `Idempotency-Key` supported). `201 → { version, contentHash }`; stale →
  `conflict_version` 409.
- `GET /api/v1/models/{id}/compare?from=2&to=3` — scope `models:read`.
  Returns role/permission/assignment diffs + optional
  `?effective=true` subject-level impact. Same use case as MCP
  `compare_access_models`.

### Simulations & reports

- `POST /api/v1/simulations` — scope `simulations:run`. Body:
  `{ modelId, version?, operations[], idempotencyKey? }`
  (`Idempotency-Key` header also accepted).
  Operation object: `{ type, roleId?, permissionId?, subjectId?,
  childRoleId?, parentRoleId? }` with `type` ∈ { `grant_permission`,
  `revoke_permission`, `assign_role`, `unassign_role`, `add_inheritance`,
  `remove_inheritance` }.
  `201 → { id, status: "completed", summary: { addedCount, removedCount,
  affectedSubjectCount, findingCounts: { critical, high, medium, low } } }`.
- `GET /api/v1/simulations/{id}` — scope `simulations:read`. Metadata +
  provenance `{ modelId, version, contentHash, operations, createdAt }`.
- `GET /api/v1/simulations/{id}/report` — scope `simulations:read`. Paged
  impact rows `{ subjectId, added[], removed[] }` sorted by `subjectId`,
  plus `findings[]` `{ ruleId, severity, subjects[], evidence,
  explanation }` and top-level `disclaimer` (findings are advisory).
- `GET /api/v1/simulations/{id}/export?format=json|csv` — scope
  `exports:read`. JSON: full report, stable key order. CSV columns:
  `subject_id,change,permission,role,rule_id,severity` (one row per
  subject×permission change; findings joined where applicable).
  `Content-Type: application/json | text/csv`; oversized → 413 with
  `Retry-After` guidance via paged report instead.

### Audit

- `GET /api/v1/audit-events?type=&from=&to=` — scope `audit:read`. Paged,
  newest-first. Event: `{ id: evt_…, tenantId, type, actorKeyPrefix,
  resourceType, resourceId, createdAt, metadata }`. Never includes raw keys
  or full snapshots.

### Ops

- `GET /health/live`, `GET /health/ready` (Steps 49–50 own details; listed
  here so the contract enumerates every public route). No auth.

## 5. MCP surface (same use cases, tool-shaped)

Tools (Step 40+ implement; argument names mirror REST fields):

| Tool | Mirrors use case | Key inputs |
| --- | --- | --- |
| `validate_access_model` | `ValidateAccessModel` | `snapshot` |
| `simulate_permission_change` | `SimulatePermissionChange` | `modelId`, `version?`, `operations[]` |
| `explain_access_change` | `GetSimulationReport` | `simulationId` \| (`modelId`, `version`, `subjectId`, `permission`) |
| `find_privilege_escalation` | `FindPrivilegeEscalation` | `modelId`/`simulationId`, `severityThreshold?` |
| `compare_access_models` | `CompareAccessModels` | `modelId`, `from`, `to`, `effective?` |

Tool errors use the same snake_case `code` values as REST. No tool accepts a
tenant id argument (identity from transport auth).

## 6. Contract stability promise

Field names and codes in §§1–5 are frozen for v1 once Step 38 generates
OpenAPI from the DTOs; any later rename requires a documented migration note
in this file. Step 30 may tighten (never loosen) pagination defaults; Step 05
may extend (never rename) the error code list.

