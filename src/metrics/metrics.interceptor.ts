import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { MetricsService, normaliseRoute } from './metrics.service';

/** Step 50 — records request count/duration + errors with safe labels. */
@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  constructor(private readonly metrics: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const started = Date.now();
    return next.handle().pipe(
      tap({
        next: () => this.record(context, started, false),
        error: (err: unknown) => this.record(context, started, true, err),
      }),
    );
  }

  private record(
    ctx: ExecutionContext,
    started: number,
    failed: boolean,
    err?: unknown,
  ): void {
    const http = ctx.switchToHttp();
    const req = http.getRequest<{
      method?: string;
      route?: { path?: string };
      url?: string;
    }>();
    const res = http.getResponse<{ statusCode?: number }>();
    const template = req.route?.path
      ? `/api${req.route.path}`.replace('/api/api', '/api')
      : undefined;
    const route = normaliseRoute(req.route?.path ?? req.url ?? 'unknown');
    const routeLabel = template ?? route;
    let status = res?.statusCode ?? (failed ? 500 : 200);
    if (failed && (status < 500 || !res?.statusCode)) {
      const code = (err as { status?: number })?.status;
      status = typeof code === 'number' ? code : 500;
    }
    this.metrics.observeHttp(
      req.method ?? 'UNKNOWN',
      routeLabel,
      status,
      Date.now() - started,
    );
  }
}
