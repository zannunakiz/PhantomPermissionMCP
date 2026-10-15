import type { TenantRecord } from './records';

/**
 * Tenant persistence port. Tenant ids are app-assigned opaque strings;
 * adapters never generate them.
 */
export interface TenantRepository {
  findById(id: string): Promise<TenantRecord | null>;
  findByName(name: string): Promise<TenantRecord | null>;
  create(input: { id: string; name: string }): Promise<TenantRecord>;
}
