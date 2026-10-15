import type { ErrorCode } from './error-codes';
import { ERROR_CODE_STATUS } from './error-codes';
import type { ErrorDetail } from './error-envelope';

/**
 * Application error with a stable v1 `code`.
 * Throw this from use cases / controllers instead of raw Nest
 * `HttpException`s when the contract code differs from the default
 * status mapping (e.g. `tenant_forbidden` vs `forbidden_scope`,
 * `idempotency_conflict` vs `conflict_version`).
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details: ErrorDetail[];

  constructor(
    code: ErrorCode,
    message: string,
    options: {
      status?: number;
      details?: ErrorDetail[];
      cause?: unknown;
    } = {},
  ) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = options.status ?? ERROR_CODE_STATUS[code];
    this.details = options.details ?? [];
    if (options.cause !== undefined) {
      (this as { cause?: unknown }).cause = options.cause;
    }
  }
}
