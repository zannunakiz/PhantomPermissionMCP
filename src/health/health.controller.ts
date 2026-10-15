import { Controller, Get } from '@nestjs/common';
import { HealthService } from './health.service';

/**
 * Unauthenticated liveness + readiness endpoints (see the v1 contract
 * Ops section). No tenant or scope checks here by design — these
 * endpoints expose availability only, never data.
 */
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get('live')
  live(): { status: string } {
    return this.health.live();
  }

  @Get('ready')
  ready(): Promise<{ status: string; database: string }> {
    return this.health.ready();
  }
}
