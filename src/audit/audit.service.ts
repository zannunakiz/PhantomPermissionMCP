import { Inject, Injectable } from '@nestjs/common';
import { paginate, toISOString } from '../common/http';
import { AUDIT_REPOSITORY as AR } from '../repositories/tokens';
import type { AuditRepository } from '../repositories/audit.repository';
import type { TenantContext } from '../tenancy/tenant-context';
import type { AuditQuery } from './audit.dto';

@Injectable()
export class AuditService {
  constructor(@Inject(AR) private readonly audit: AuditRepository) {}

  async listEvents(ctx: TenantContext, query: AuditQuery): Promise<unknown> {
    const rows = await this.audit.listByTenant(ctx.tenantId, {
      type: query.type,
      limit: 1000,
    });
    const data = rows.map((e) => ({
      id: e.id,
      tenantId: e.tenantId,
      type: e.type,
      actorKeyPrefix: e.actorKeyPrefix,
      resourceType: e.resourceType,
      resourceId: e.resourceId,
      metadata: e.metadata,
      createdAt: toISOString(e.createdAt),
    }));
    return paginate(data, { page: query.page, pageSize: query.pageSize });
  }
}
