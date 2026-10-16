import { Injectable } from '@nestjs/common';
import type { NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { formatTraceparent, parseTraceparent } from './trace-context';
import { TracingService } from './tracing.service';

/**
 * Step 51 — trace propagation middleware.
 * Accepts incoming W3C `traceparent`, starts (or continues) the trace for
 * the request scope, and echoes `traceparent` on the response. Runs before
 * RequestIdMiddleware's context or after — both use AsyncLocalStorage.
 */
@Injectable()
export class TracingMiddleware implements NestMiddleware {
  constructor(private readonly tracing: TracingService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    if (!this.tracing.enabled) {
      next();
      return;
    }
    const incoming = parseTraceparent(req.headers['traceparent']);
    const trace = this.tracing.rootTrace(incoming);
    res.setHeader('traceparent', formatTraceparent(trace));
    this.tracing.runWithTrace(trace, () => next());
  }
}
