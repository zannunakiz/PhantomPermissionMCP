import type { AccessModelRecord } from './records';

/**
 * Access-model metadata port. Duplicate names within a tenant surface
 * as a conflict error carrying the unique-constraint cause; the
 * human-facing `validation_failed` mapping belongs to the use case.
 */
export interface AccessModelRepository {
  findById(tenantId: string, id: string): Promise<AccessModelRecord | null>;
  listByTenant(tenantId: string): Promise<readonly AccessModelRecord[]>;
  create(input: {
    id: string;
    tenantId: string;
    name: string;
  }): Promise<AccessModelRecord>;
}
