import { Injectable, Optional } from '@nestjs/common';
import { MetricsService } from '../metrics/metrics.service';
import { PrismaService } from '../persistence';
import type { TracingService } from '../tracing/tracing.service';

/**
 * Database readiness probe.
 *
 * Liveness is a pure in-process answer (the process is running).
 * Readiness performs one minimal `SELECT 1` round-trip through the
 * shared Prisma client. Responses carry status strings only — never
 * connection strings, driver messages, or error internals.
 */
@Injectable()
export class HealthService {
  constructor(
    private readonly db: PrismaService,
    @Optional() private readonly metrics?: MetricsService,
    @Optional() private readonly tracing?: TracingService,
  ) {}

  live(): { status: string } {
    return { status: 'ok' };
  }

  async ready(): Promise<{ status: string; database: string }> {
    try {
      // Step 51 — db-call tracing hook (no-op when tracing is off).
      const probe = (): Promise<unknown> => this.db.$queryRaw`SELECT 1`;
      await (this.tracing
        ? this.tracing.span('db.query', { operation: 'readiness_probe' }, () =>
            probe(),
          )
        : probe());
      this.metrics?.setDbUp(true);
      return { status: 'ok', database: 'up' };
    } catch {
      this.metrics?.setDbUp(false);
      return { status: 'degraded', database: 'down' };
    }
  }
}
