import { Injectable } from '@nestjs/common';
import type { NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { REQUEST_ID_HEADER, resolveRequestId } from '../errors/request-id';
import { JsonLoggerService } from './json-logger.service';
import { redactUrl } from './redact';
import { runWithRequestId } from './request-context';

/**
 * Request-id + access-log middleware.
 *
 * For every request: resolve (or generate) the `req_…` request id, expose it
 * as the `x-request-id` response header, and run the handler inside the
 * request-id async context so all `JsonLoggerService` lines for the request
 * carry the same id. On response finish, emit one structured `http_request`
 * access line with method, redacted URL, status, and duration. Request
 * bodies, authorization headers, cookies, and query secrets are never
 * logged — only the redacted URL (path + safe query params) is recorded.
 */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  constructor(private readonly logger: JsonLoggerService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const requestId = resolveRequestId(req.headers[REQUEST_ID_HEADER]);
    res.setHeader(REQUEST_ID_HEADER, requestId);
    const startedAt = process.hrtime.bigint();
    // The finish handler fires outside the async context, so the id is
    // captured in the closure and passed explicitly.
    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      this.logger.write('info', 'http_request', {
        requestId,
        method: req.method,
        url: redactUrl(req.originalUrl ?? req.url ?? ''),
        statusCode: res.statusCode,
        durationMs: Math.round(durationMs * 100) / 100,
      });
    });
    runWithRequestId({ requestId }, () => {
      next();
    });
  }
}
