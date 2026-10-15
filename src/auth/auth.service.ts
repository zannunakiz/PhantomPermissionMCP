import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AppError } from '../common/errors/app-error';
import type { ApiKeyRecord } from '../repositories/records';
import { API_KEY_REPOSITORY } from '../repositories/tokens';
import type { ApiKeyRepository } from '../repositories/api-key.repository';
import type { TenantContext } from '../tenancy/tenant-context';
import { digestKey, generateRawKey, keyPrefixOf, parseBearer } from './api-key';
import { assertScopes, type Scope } from './scopes';

const unauthorized = () =>
  new AppError('unauthorized', 'Invalid or missing API key.');

export type IssuedKey = { record: ApiKeyRecord; rawKey: string };

@Injectable()
export class AuthService {
  constructor(
    @Inject(API_KEY_REPOSITORY) private readonly keys: ApiKeyRepository,
    @Inject('APP_CONFIG')
    private readonly config: { apiKeyPepper: string },
  ) {}

  async issue(input: {
    tenantId: string;
    scopes: readonly Scope[];
    expiresAt?: Date | null;
    id?: string;
  }): Promise<IssuedKey> {
    assertScopes(input.scopes);
    const rawKey = generateRawKey();
    const record = await this.keys.create({
      id: input.id ?? `key_${randomUUID().replace(/-/g, '')}`,
      tenantId: input.tenantId,
      keyPrefix: keyPrefixOf(rawKey),
      keyDigest: digestKey(rawKey, this.config.apiKeyPepper),
      scopes: [...input.scopes],
      expiresAt: input.expiresAt ?? null,
    });
    return { record, rawKey };
  }

  async verify(authorization: string | undefined): Promise<TenantContext> {
    const raw = parseBearer(authorization);
    if (!raw) throw unauthorized();
    const digest = digestKey(raw, this.config.apiKeyPepper);
    const record = await this.keys.findByDigest(digest);
    if (!record || record.status !== 'ACTIVE') throw unauthorized();
    if (record.expiresAt && record.expiresAt.getTime() <= Date.now()) {
      throw unauthorized();
    }
    void this.keys.touchLastUsed(record.tenantId, record.id).catch(() => {});
    return {
      tenantId: record.tenantId,
      keyPrefix: record.keyPrefix,
      keyId: record.id,
      scopes: [...record.scopes],
    };
  }

  requireScope(ctx: TenantContext, scope: Scope): void {
    if (!ctx.scopes?.includes(scope)) {
      throw new AppError(
        'forbidden_scope',
        `Missing required scope: ${scope}.`,
      );
    }
  }

  async revoke(tenantId: string, id: string): Promise<boolean> {
    return (await this.keys.updateStatus(tenantId, id, 'REVOKED')) !== null;
  }

  async rotate(input: {
    tenantId: string;
    oldKeyId: string;
    scopes: readonly Scope[];
    expiresAt?: Date | null;
  }): Promise<IssuedKey> {
    const issued = await this.issue(input);
    await this.keys.updateStatus(input.tenantId, input.oldKeyId, 'REVOKED');
    return issued;
  }
}
