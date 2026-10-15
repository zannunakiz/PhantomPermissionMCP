# Error Contract — PhantomPermissionMCP (v1, Step 05)

> Normative wording for the stable REST error envelope. Field names and
> `code` values are frozen for v1: Step 05 may extend (never rename) the
> code list (`docs/api/v1-contract.md` §6). MCP tool errors reuse the same
> snake_case codes.

## 1. Envelope

Every 4xx/5xx REST response has exactly this shape (no extra top-level keys):

```json
{
  "error": {
    "code": "validation_failed",
    "message": "Snapshot is invalid",
    "status": 400,
    "details": [{ "path": "roles[3].name", "reason": "duplicate" }],
    "requestId": "req_9f2c…"
  }
}
```

| Field | Type | Notes |
| --- | --- | --- |
| `code` | snake_case string | One of §2. Shared by REST and MCP. |
| `message` | string | Human-readable, safe to show. Generic for 5xx in production. |
| `status` | number | Mirrors the HTTP status. |
| `details` | array | Zero+ `{ path, reason }` field failures; `[]` when none or in production 5xx. |
| `requestId` | string | `req_…`; echoes a safe caller `x-request-id`, else generated. Also returned as the `x-request-id` response header. |

## 2. Codes and default statuses

| Code | HTTP | Meaning |
| --- | --- | --- |
| `validation_failed` | 400 | Malformed body, schema violation, bad operation input. |
| `unauthorized` | 401 | Missing/invalid/expired/revoked API key. |
| `forbidden_scope` | 403 | Authenticated but key scope is insufficient. |
| `tenant_forbidden` | 403 | Resource belongs to another tenant (no existence oracle). |
| `not_found` | 404 | Route or tenant-scoped resource not found. |
| `conflict_version` | 409 | Stale `expectedVersion` / `If-Match` precondition. |
| `idempotency_conflict` | 409 | Same `Idempotency-Key`, different payload. |
| `payload_too_large` | 413 | Body/graph/export exceeds documented limits. |
| `rate_limited` | 429 | Rate budget exhausted (retry per headers). |
| `internal_error` | 500 | Unexpected failure; production message is always `Internal server error`. |

## 3. Mapping rules (implemented by `HttpExceptionFilter`)

1. `AppError(code, message, { details })` → its code/status verbatim.
2. Nest `HttpException` → status-mapped code (§2 defaults; 5xx → `internal_error`).
3. Any other throwable → `internal_error` 500.
4. `requestId`: reuse an incoming `x-request-id` matching
   `/^[A-Za-z0-9_-]{1,64}$/`; otherwise generate `req_<24 hex>`.
5. Every error response sets the `x-request-id` header to the same value
   present in the body.

## 4. Production safety

- 5xx bodies carry `message: "Internal server error"` and `details: []`.
- No stack traces, SQL/driver text, file paths, config values, or raw
  `ppk_…` key material ever appear in bodies, messages, or details.
- Non-production may include the original message (still scrubbed of
  `ppk_…`) to aid local debugging; transports (Step 06+ logging) must still
  redact secrets.

## 5. Usage

```ts
import { AppError } from '../common/errors';

throw new AppError('tenant_forbidden', 'Model belongs to another tenant');
throw new AppError('conflict_version', 'expectedVersion is stale', {
  details: [{ path: 'expectedVersion', reason: 'stale' }],
});
```

## 6. Logging (Step 06)

The global filter also emits a structured `http_error` log line for 5xx
responses via the shared `JsonLoggerService`: `{ requestId, code, status,
method, url }` with a redacted URL. Bodies, headers, cookies, query
secrets, and key material are never logged.

The middleware (`RequestIdMiddleware`) sets the request id before this
filter runs, so error bodies and the `x-request-id` header agree with the
access/error logs on every response, including errors.
