import {
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { loadAppConfig } from '../config';
import { MetricsService } from './metrics.service';

/**
 * Step 50 — Prometheus scrape endpoint.
 * Unauthenticated like /health (infra-only, no tenant data) but can be
 * disabled via METRICS_ENABLED=false. Restrict network exposure via
 * firewall/security-group, not in code.
 */
@Controller()
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Get('metrics')
  @HttpCode(HttpStatus.OK)
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  scrape(@Res({ passthrough: true }) res: Response): string {
    let enabled = true;
    try {
      enabled = loadAppConfig().metricsEnabled;
    } catch {
      enabled = true;
    }
    if (!enabled) {
      res.status(HttpStatus.NOT_FOUND);
      return '# metrics disabled\n';
    }
    return this.metrics.render();
  }
}
