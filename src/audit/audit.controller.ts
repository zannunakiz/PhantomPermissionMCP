import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuthGuard, CurrentTenant, RequireScopes } from '../auth/auth.guard';
import { ZodValidationPipe } from '../common/http';
import type { TenantContext } from '../tenancy/tenant-context';
import { auditQuerySchema, type AuditQuery } from './audit.dto';
import { AuditService } from './audit.service';

@Controller('api/v1/audit-events')
@UseGuards(AuthGuard)
export class AuditController {
  constructor(private readonly service: AuditService) {}

  @Get()
  @RequireScopes('audit:read')
  list(
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(auditQuerySchema)) query: AuditQuery,
  ): unknown {
    return this.service.listEvents(tenant, query);
  }
}
