import { randomBytes } from 'node:crypto';

/** Header accepted on requests and always echoed on error responses. */
export const REQUEST_ID_HEADER = 'x-request-id';

/** Prefix for generated request identifiers (`req_…`, see contract §1). */
export const REQUEST_ID_PREFIX = 'req_';

const INCOMING_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Resolve the request id for an error response.
 * Reuses a caller-supplied `x-request-id` when it looks safe;
 * otherwise generates `req_<24 hex chars>`.
 * Full propagation/logging middleware lives alongside this helper —
 * this keeps
 * error responses stable and correlatable on its own.
 */
export function resolveRequestId(
  incoming: string | string[] | undefined,
): string {
  const candidate = Array.isArray(incoming) ? incoming[0] : incoming;
  if (
    typeof candidate === 'string' &&
    INCOMING_ID_PATTERN.test(candidate.trim()) &&
    candidate.trim().length > 0
  ) {
    return candidate.trim();
  }
  return `${REQUEST_ID_PREFIX}${randomBytes(12).toString('hex')}`;
}
