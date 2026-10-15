import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Optional,
  type LoggerService,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AppError } from './app-error';
import type { ErrorCode } from './error-codes';
import type { ErrorDetail, ErrorEnvelope } from './error-envelope';
import { REQUEST_ID_HEADER, resolveRequestId } from './request-id';
import { redactUrl } from '../logging/redact';

type AppConfigLike = { nodeEnv?: string };

/** Map a raw HTTP status to its default stable v1 error code. */
export function codeForStatus(status: HttpStatus): ErrorCode {
  if (status === HttpStatus.BAD_REQUEST) {
    return 'validation_failed';
  }
  if (status === HttpStatus.UNAUTHORIZED) {
    return 'unauthorized';
  }
  if (status === HttpStatus.FORBIDDEN) {
    return 'forbidden_scope';
  }
  if (status === HttpStatus.NOT_FOUND) {
    return 'not_found';
  }
  if (status === HttpStatus.CONFLICT) {
    return 'conflict_version';
  }
  if (status === HttpStatus.PAYLOAD_TOO_LARGE) {
    return 'payload_too_large';
  }
  if (status === HttpStatus.UNPROCESSABLE_ENTITY) {
    return 'validation_failed';
  }
  if (status === HttpStatus.TOO_MANY_REQUESTS) {
    return 'rate_limited';
  }
  return Number(status) >= 500 ? 'internal_error' : 'validation_failed';
}

const GENERIC_500_MESSAGE = 'Internal server error';

/** Never let raw key material or stack traces leave the process boundary. */
function scrubSecrets(value: string): string {
  return value.replace(/ppk_[A-Za-z0-9_-]+/g, '[redacted]');
}

function toDetailsList(message: unknown): ErrorDetail[] {
  if (Array.isArray(message)) {
    return message
      .filter((entry): entry is string => typeof entry === 'string')
      .map((reason) => ({ path: '(body)', reason: scrubSecrets(reason) }));
  }
  return [];
}

function firstString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * Global REST error filter.
 *
 * Guarantees every 4xx/5xx leaves the service as the stable v1 envelope
 * `{ error: { code, message, status, details, requestId } }`.
 * In production, 5xx responses carry a generic message with no stack,
 * SQL, driver, or internal-exception detail.
 * 5xx failures are also emitted as structured `http_error` log lines via
 * the shared logger (redacted URL only; bodies/secrets never logged).
 */
@Catch()
@Injectable()
export class HttpExceptionFilter implements ExceptionFilter {
  constructor(
    @Optional() @Inject('APP_CONFIG') private readonly config?: AppConfigLike,
    @Optional()
    @Inject('JsonLoggerService')
    private readonly logger?: LoggerService,
  ) {}

  private get isProduction(): boolean {
    return (
      (this.config?.nodeEnv ?? process.env.NODE_ENV ?? 'development') ===
      'production'
    );
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request>();
    const res = ctx.getResponse<Response>();

    const requestId = resolveRequestId(req?.headers?.[REQUEST_ID_HEADER]);
    const envelope = this.toEnvelope(exception, requestId);

    if (envelope.error.status >= 500) {
      // Structured diagnostics for operators; the logger redacts secrets
      // and the response body stays generic in production.
      this.logger?.error('http_error', {
        requestId,
        code: envelope.error.code,
        status: envelope.error.status,
        method: req?.method,
        url: redactUrl(req?.originalUrl ?? req?.url ?? ''),
      });
    }

    res.setHeader(REQUEST_ID_HEADER, requestId);
    res.status(envelope.error.status).json(envelope);
  }

  private toEnvelope(exception: unknown, requestId: string): ErrorEnvelope {
    if (exception instanceof AppError) {
      const production = this.isProduction;
      const message =
        production && exception.status >= 500
          ? GENERIC_500_MESSAGE
          : scrubSecrets(exception.message);
      return {
        error: {
          code: exception.code,
          message,
          status: exception.status,
          details:
            production && exception.status >= 500 ? [] : exception.details,
          requestId,
        },
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse() as
        string | { message?: unknown; error?: unknown };
      const rawMessage =
        typeof body === 'string'
          ? body
          : (firstString(
              Array.isArray(body?.message)
                ? body.message.join('; ')
                : body?.message,
            ) ?? exception.message);
      const details =
        typeof body === 'object' && body !== null
          ? toDetailsList(body.message)
          : [];
      const production = this.isProduction;
      const code = status >= 500 ? 'internal_error' : codeForStatus(status);
      const message =
        production && status >= 500
          ? GENERIC_500_MESSAGE
          : scrubSecrets(rawMessage);
      return {
        error: {
          code,
          message,
          status,
          details: production && status >= 500 ? [] : details,
          requestId,
        },
      };
    }

    // Non-HTTP throwables (TypeError, DB driver errors, …): never leak.
    const production = this.isProduction;
    const rawMessage =
      exception instanceof Error ? exception.message : 'Unknown error';
    return {
      error: {
        code: 'internal_error',
        message: production ? GENERIC_500_MESSAGE : scrubSecrets(rawMessage),
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        details: [],
        requestId,
      },
    };
  }
}
