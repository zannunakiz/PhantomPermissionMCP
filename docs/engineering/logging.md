# Logging & Request IDs — PhantomPermissionMCP (Step 06)

> Normative for Step 06. All REST traffic is diagnosable through one
> structured JSON stream with zero secret leakage.

## 1. Request IDs

- Every request resolves one request id via `resolveRequestId`
  (`src/common/errors/request-id.ts`): a caller `x-request-id` matching
  `/^[A-Za-z0-9_-]{1,64}$/` is reused, otherwise `req_<24 hex>` is
  generated.
- `RequestIdMiddleware` (applied to `*` in `AppModule`) sets the
  `x-request-id` **response header on every response** — success and
  error alike — and runs the handler inside the id's async context.
- The Step 05 error filter resolves the same header value, so the
  envelope's `requestId`, the response header, and all log lines agree.

## 2. Structured access logs

On response finish the middleware emits exactly one JSON line:

```json
{ "ts": "…", "level": "info", "msg": "http_request",
  "requestId": "req_…", "method": "GET", "url": "/__logging/ok?page=2",
  "statusCode": 200, "durationMs": 3.42 }
```

- One line per line-delimited JSON on stdout; `ts` is RFC 3339 UTC.
- `url` is passed through `redactUrl` (path + query params with sensitive
  values masked). **Bodies are never logged.**
- `JsonLoggerService` extends the existing Nest `LoggerService` — no new
  dependency — and honours the validated `LOG_LEVEL` (`debug|info|warn|error`).

## 3. 5xx error logs

`HttpExceptionFilter` emits one `http_error` line for 5xx only:

```json
{ "ts": "…", "level": "error", "msg": "http_error",
  "requestId": "req_…", "code": "internal_error", "status": 500,
  "method": "GET", "url": "/__errors/boom" }
```

4xx responses are not logged as errors (they appear in the access line).

## 4. Redaction guarantees (`src/common/logging/redact.ts`)

- Sensitive **names** (case-insensitive `_`/`-` variants): `authorization`,
  `api-key`, `secret`, `pepper`, `password/passwd/pwd`, `token`, `cookie`,
  `set-cookie`, `session`, `csrf`, `private-key`, `client-secret`,
  `database-url`, `connection-string` — whole value → `[redacted]`.
- Sensitive **substrings**: `ppk_…` keys, `Bearer …` tokens,
  credential-bearing `postgres(ql)://user:pass@` userinfo — scrubbed from
  every message, URL, and field.
- Deep objects/arrays redacted recursively; circular refs capped as
  `[circular]`, depth > 12 as `[truncated]`; binary/functions omitted.
- Startup log (`main.ts`) emits one structured `starting` line through the
  same logger with `redactConfigForLogging` output — no raw `DATABASE_URL`
  or `API_KEY_PEPPER` values.

## 5. Usage

```ts
import { JsonLoggerService } from './common/logging';

constructor(private readonly logger: JsonLoggerService) {}
this.logger.write('info', 'models_created', { modelId, tenantId });
```

Inside a request the active `requestId` attaches automatically. Keep
payloads to identifiers/counts — never bodies, headers, cookies, or key
material.
