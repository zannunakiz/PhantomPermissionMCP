import type { AuditEventRecord, AuditEventType, JsonValue } from './records';

/**
 * Append-only audit port. No update or delete methods exist by design;
 * retention is operator-owned. Reads are newest-first to serve the
 * paged audit listing directly.
 */
export interface AuditRepository {
  append(input: {
    id: string;
    tenantId: string;
    type: AuditEventType;
    actorKeyPrefix: string;
    resourceType: string;
    resourceId: string;
    metadata: JsonValue;
  }): Promise<AuditEventRecord>;
  listByTenant(
    tenantId: string,
    options?: { type?: AuditEventType; limit?: number },
  ): Promise<readonly AuditEventRecord[]>;
  listByResource(
    tenantId: string,
    resourceType: string,
    resourceId: string,
  ): Promise<readonly AuditEventRecord[]>;
}
