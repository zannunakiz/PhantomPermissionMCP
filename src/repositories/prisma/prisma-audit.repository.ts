import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../persistence';
import type { AuditRepository } from '../audit.repository';
import type { AuditEventRecord, AuditEventType, JsonValue } from '../records';

/**
 * Prisma-backed audit port. Append + scoped newest-first reads only;
 * there is deliberately no update or delete path.
 */
@Injectable()
export class PrismaAuditRepository implements AuditRepository {
  constructor(private readonly db: PrismaService) {}

  async append(input: {
    id: string;
    tenantId: string;
    type: AuditEventType;
    actorKeyPrefix: string;
    resourceType: string;
    resourceId: string;
    metadata: JsonValue;
  }): Promise<AuditEventRecord> {
    const row = await this.db.auditEvent.create({
      data: {
        id: input.id,
        tenantId: input.tenantId,
        type: input.type,
        actorKeyPrefix: input.actorKeyPrefix,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        metadata: input.metadata as never,
      },
    });
    return toRecord(row);
  }

  async listByTenant(
    tenantId: string,
    options?: { type?: AuditEventType; limit?: number },
  ): Promise<readonly AuditEventRecord[]> {
    const rows = await this.db.auditEvent.findMany({
      where: {
        tenantId,
        ...(options?.type ? { type: options.type } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: options?.limit ?? 20,
    });
    return rows.map(toRecord);
  }

  async listByResource(
    tenantId: string,
    resourceType: string,
    resourceId: string,
  ): Promise<readonly AuditEventRecord[]> {
    const rows = await this.db.auditEvent.findMany({
      where: { tenantId, resourceType, resourceId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toRecord);
  }
}

type AuditRow = {
  id: string;
  tenantId: string;
  type: AuditEventType;
  actorKeyPrefix: string;
  resourceType: string;
  resourceId: string;
  metadata: unknown;
  createdAt: Date;
};

function toRecord(row: AuditRow): AuditEventRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    type: row.type,
    actorKeyPrefix: row.actorKeyPrefix,
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    metadata: row.metadata,
    createdAt: row.createdAt,
  };
}
