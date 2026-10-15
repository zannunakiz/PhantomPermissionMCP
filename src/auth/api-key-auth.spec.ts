import { AppError } from '../common/errors/app-error';
import type { ApiKeyRecord } from '../repositories/records';
import type { ApiKeyRepository } from '../repositories/api-key.repository';
import { digestKey } from './api-key';
import { AuthService } from './auth.service';

const PEPPER = 'test-pepper-27';

function fakeRepo(initial: ApiKeyRecord[] = []): ApiKeyRepository {
  const rows = new Map<string, ApiKeyRecord>();
  for (const r of initial) rows.set(r.keyDigest, r);
  return {
    findByDigest: (d: string) => Promise.resolve(rows.get(d) ?? null),
    listByTenant: (t: string) =>
      Promise.resolve([...rows.values()].filter((r) => r.tenantId === t)),
    create: (input) => {
      const rec: ApiKeyRecord = {
        ...input,
        scopes: [...input.scopes],
        status: 'ACTIVE',
        revokedAt: null,
        lastUsedAt: null,
        createdAt: new Date(0),
        updatedAt: new Date(0),
        expiresAt: input.expiresAt ?? null,
      };
      rows.set(rec.keyDigest, rec);
      return Promise.resolve(rec);
    },
    updateStatus: (tenantId, id, status) => {
      const found = [...rows.values()].find(
        (r) => r.id === id && r.tenantId === tenantId,
      );
      if (!found) return Promise.resolve(null);
      const next = { ...found, status };
      rows.set(next.keyDigest, next);
      return Promise.resolve(next);
    },
    touchLastUsed: () => Promise.resolve(),
  };
}

const svc = (repo: ApiKeyRepository) =>
  new AuthService(repo, { apiKeyPepper: PEPPER });
const now = Date.now();

async function expectUnauthorized(p: Promise<unknown>): Promise<void> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(AppError);
    expect((e as AppError).code).toBe('unauthorized');
    expect((e as AppError).status).toBe(401);
    return;
  }
  throw new Error('expected unauthorized');
}

describe('api-key auth (step 27)', () => {
  it('issues once: raw never stored, prefix safe', async () => {
    const service = svc(fakeRepo());
    const { record, rawKey } = await service.issue({
      tenantId: 'tnt_a',
      scopes: ['models:read'],
    });
    expect(rawKey.startsWith('ppk_')).toBe(true);
    expect(record.keyDigest).not.toContain(rawKey);
    expect(record.keyDigest).toBe(digestKey(rawKey, PEPPER));
    expect(record.keyPrefix).toBe(rawKey.slice(0, 12));
    expect(JSON.stringify(record)).not.toContain(rawKey);
  });

  it('verifies valid key and binds tenant', async () => {
    const service = svc(fakeRepo());
    const { rawKey } = await service.issue({
      tenantId: 'tnt_a',
      scopes: ['models:read'],
    });
    const ctx = await service.verify(`Bearer ${rawKey}`);
    expect(ctx.tenantId).toBe('tnt_a');
    expect(ctx.scopes).toEqual(['models:read']);
  });

  it('rejects invalid, malformed, revoked, expired without oracle', async () => {
    const service = svc(fakeRepo());
    await expectUnauthorized(service.verify(undefined));
    await expectUnauthorized(service.verify('Bearer not-a-key'));
    await expectUnauthorized(service.verify('ppk_no_bearer_prefix'));
    await expectUnauthorized(service.verify('Bearer ppk_short'));
    const { record, rawKey } = await service.issue({
      tenantId: 'tnt_a',
      scopes: ['models:read'],
    });
    await service.revoke('tnt_a', record.id);
    await expectUnauthorized(service.verify(`Bearer ${rawKey}`));
    const expired = svc(fakeRepo());
    const issued = await expired.issue({
      tenantId: 'tnt_a',
      scopes: ['models:read'],
      expiresAt: new Date(now - 1000),
    });
    await expectUnauthorized(expired.verify(`Bearer ${issued.rawKey}`));
  });

  it('enforces scopes and isolates tenants', async () => {
    const service = svc(fakeRepo());
    const { rawKey } = await service.issue({
      tenantId: 'tnt_a',
      scopes: ['models:read'],
    });
    const ctx = await service.verify(`Bearer ${rawKey}`);
    try {
      service.requireScope(ctx, 'models:write');
      throw new Error('expected forbidden_scope');
    } catch (e) {
      expect(e).toBeInstanceOf(AppError);
      expect((e as AppError).code).toBe('forbidden_scope');
    }
    expect(() => service.requireScope(ctx, 'models:read')).not.toThrow();
    expect(ctx.tenantId).not.toBe('tnt_b');
    const { record } = await service.rotate({
      tenantId: 'tnt_a',
      oldKeyId: ctx.keyId as string,
      scopes: ['models:read'],
    });
    expect(record.id).not.toBe(ctx.keyId);
    await expectUnauthorized(service.verify(`Bearer ${rawKey}`));
  });
});
