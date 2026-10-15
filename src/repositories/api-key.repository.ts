import type { ApiKeyRecord, ApiKeyStatus } from './records';

/**
 * API-key persistence port. Stores and looks up digests only — digest
 * computation (HMAC) lives in the authentication layer, never here.
 * Every read is tenant-scoped except `findByDigest`, which resolves the
 * tenant from the row itself during authentication.
 */
export interface ApiKeyRepository {
  findByDigest(keyDigest: string): Promise<ApiKeyRecord | null>;
  listByTenant(tenantId: string): Promise<readonly ApiKeyRecord[]>;
  create(input: {
    id: string;
    tenantId: string;
    keyPrefix: string;
    keyDigest: string;
    scopes: readonly string[];
    expiresAt?: Date | null;
  }): Promise<ApiKeyRecord>;
  updateStatus(
    tenantId: string,
    id: string,
    status: ApiKeyStatus,
  ): Promise<ApiKeyRecord | null>;
  touchLastUsed(tenantId: string, id: string): Promise<void>;
}
