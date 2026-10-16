import { Injectable, Optional } from '@nestjs/common';
import { MetricsService } from '../metrics/metrics.service';
import { PrismaService } from '../persistence';

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
  ) {}

  live(): { status: string } {
    return { status: 'ok' };
  }

  async ready(): Promise<{ status: string; database: string }> {
    try {
      await this.db.$queryRaw`SELECT 1`;
      this.metrics?.setDbUp(true);
      return { status: 'ok', database: 'up' };
    } catch {
      this.metrics?.setDbUp(false);
      return { status: 'degraded', database: 'down' };
    }
  }
}
