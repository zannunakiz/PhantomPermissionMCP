import type { ErrorCode } from './error-codes';

/**
 * One safe field-level failure inside an error response.
 * `path` uses DTO/property notation (e.g. `roles[3].name`);
 * `reason` is a short machine-stable hint (e.g. `duplicate`).
 */
export type ErrorDetail = {
  path: string;
  reason: string;
};

/**
 * Stable v1 error envelope returned for every 4xx/5xx REST response.
 * Mirrors `docs/api/v1-contract.md` §1 — field names frozen for v1.
 */
export type ErrorEnvelope = {
  error: {
    code: ErrorCode;
    message: string;
    status: number;
    details: ErrorDetail[];
    requestId: string;
  };
};
