/**
 * Stable v1 error codes shared by REST and MCP (Step 05).
 * Snake-case, frozen wording — Step 05 may extend, never rename
 * (see `docs/api/v1-contract.md` §1 and §6).
 */
export const ERROR_CODES = [
  'validation_failed',
  'unauthorized',
  'forbidden_scope',
  'tenant_forbidden',
  'not_found',
  'conflict_version',
  'idempotency_conflict',
  'payload_too_large',
  'rate_limited',
  'internal_error',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/** Default HTTP status for each stable error code. */
export const ERROR_CODE_STATUS: Record<ErrorCode, number> = {
  validation_failed: 400,
  unauthorized: 401,
  forbidden_scope: 403,
  tenant_forbidden: 403,
  not_found: 404,
  conflict_version: 409,
  idempotency_conflict: 409,
  payload_too_large: 413,
  rate_limited: 429,
  internal_error: 500,
};
