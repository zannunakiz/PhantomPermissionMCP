/**
 * Typed domain errors (Step 08).
 *
 * Plain TypeScript — no NestJS `HttpException`, no transport `AppError`.
 * Adapters (REST/MCP) map these codes to the shared snake_case contract
 * codes at the boundary. `details` reuse the v1 `{ path, reason }`
 * shape so mappings stay mechanical.
 */

export const DOMAIN_ERROR_CODES = [
  'invalid_identifier',
  'invalid_reference',
  'duplicate_entity',
  'inheritance_cycle',
  'unsupported_operation',
  'limit_exceeded',
  'empty_model',
] as const;

export type DomainErrorCode = (typeof DOMAIN_ERROR_CODES)[number];

export type DomainErrorDetail = {
  readonly path: string;
  readonly reason: string;
};

export class DomainError extends Error {
  readonly code: DomainErrorCode;
  readonly details: readonly DomainErrorDetail[];

  constructor(
    code: DomainErrorCode,
    message: string,
    options: { details?: readonly DomainErrorDetail[]; cause?: unknown } = {},
  ) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.details = options.details ?? [];
    if (options.cause !== undefined) {
      (this as { cause?: unknown }).cause = options.cause;
    }
  }
}
