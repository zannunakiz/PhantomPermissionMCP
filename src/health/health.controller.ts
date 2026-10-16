import { Controller, Get, HttpCode, Res } from '@nestjs/common';
import type { Response } from 'express';
import { HealthService } from './health.service';

/**
 * Step 49 — unauthenticated liveness + readiness endpoints (see the v1
 * contract Ops section). No tenant or scope checks here by design — these
 * endpoints expose availability only, never data.
 *
 * Status mapping: liveness is always 200 while the process runs.
 * Readiness returns 200 when the DB probe succeeds, 503 when degraded
 * so orchestrators stop routing traffic without exposing internals.
 */
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get('live')
  @HttpCode(200)
  live(): { status: string } {
    return this.health.live();
  }

  @Get('ready')
  async ready(
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ status: string; database: string }> {
    const result = await this.health.ready();
    // Orchestrator signal: 503 removes the pod from rotation on DB outage.
    res.status(result.status === 'ok' ? 200 : 503);
    return result;
  }
}
