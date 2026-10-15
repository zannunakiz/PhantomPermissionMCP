import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { digestKey } from '../src/auth/api-key';
import {
  API_KEY_REPOSITORY,
  AUDIT_REPOSITORY,
} from '../src/repositories/tokens';
import type { AuditEventRecord } from '../src/repositories/records';
import { AppModule } from '../src/app.module';
import { setupHttpHandling } from '../src/common/http';

const PEPPER = 'e2e-pepper-37';
const RAW_A = `ppk_${'e'.repeat(40)}`;
const RAW_B = `ppk_${'f'.repeat(40)}`;

function keyRow(raw: string, tenantId: string, scopes: string[]) {
  return {
    id: `key_${tenantId}`,
    tenantId,
    keyPrefix: raw.slice(0, 12),
    keyDigest: digestKey(raw, PEPPER),
    scopes,
    status: 'ACTIVE' as const,
    expiresAt: null,
    revokedAt: null,
    lastUsedAt: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
}

const fakeKeyRepo = {
  findByDigest: (d: string) => {
    for (const [raw, tenant] of [
      [RAW_A, 'tnt_a'],
      [RAW_B, 'tnt_b'],
    ] as const) {
      if (d === digestKey(raw, PEPPER)) {
        return Promise.resolve(
          keyRow(
            raw,
            tenant,
            tenant === 'tnt_a' ? ['audit:read'] : ['audit:read'],
          ),
        );
      }
    }
    return Promise.resolve(null);
  },
  listByTenant: () => Promise.resolve([]),
  create: () => Promise.reject(new Error('not used')),
  updateStatus: () => Promise.resolve(null),
  touchLastUsed: () => Promise.resolve(),
};

function evt(
  id: string,
  tenantId: string,
  type: AuditEventRecord['type'],
  createdAt: Date,
): AuditEventRecord {
  return {
    id,
    tenantId,
    type,
    actorKeyPrefix: 'ppk_test0000',
    resourceType: 'access-model',
    resourceId: 'mdl_x',
    metadata: { name: 'm' },
    createdAt,
  };
}

const events: AuditEventRecord[] = [
  evt('evt_3', 'tnt_a', 'MODEL_CREATED', new Date(3000)),
  evt('evt_2', 'tnt_a', 'SIMULATION_CREATED', new Date(2000)),
  evt('evt_1', 'tnt_a', 'MODEL_CREATED', new Date(1000)),
  evt('evt_b1', 'tnt_b', 'MODEL_CREATED', new Date(4000)),
];

const fakeAuditRepo = {
  append: () => Promise.reject(new Error('not used')),
  listByTenant: (
    tenantId: string,
    options?: { type?: string; limit?: number },
  ) => {
    let rows = events.filter((e) => e.tenantId === tenantId);
    if (options?.type) rows = rows.filter((e) => e.type === options.type);
    rows = [...rows].sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    );
    return Promise.resolve(rows.slice(0, options?.limit ?? 20));
  },
  listByResource: () => Promise.resolve([]),
};

async function buildApp(): Promise<INestApplication<App>> {
  const fixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(API_KEY_REPOSITORY)
    .useValue(fakeKeyRepo)
    .overrideProvider(AUDIT_REPOSITORY)
    .useValue(fakeAuditRepo)
    .overrideProvider('APP_CONFIG')
    .useValue({ apiKeyPepper: PEPPER, nodeEnv: 'test' })
    .compile();
  const app = fixture.createNestApplication({ bodyParser: false });
  setupHttpHandling(app, { requestBodyLimit: '1mb' });
  await app.init();
  return app;
}

describe('GET /api/v1/audit-events (e2e)', () => {
  let app: INestApplication<App>;
  beforeAll(async () => {
    app = await buildApp();
  });
  afterAll(async () => {
    await app.close();
  });

  it('lists newest-first with safe fields only', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/audit-events')
      .set('Authorization', `Bearer ${RAW_A}`)
      .expect(200);
    const body = res.body as {
      data: { id: string; actorKeyPrefix: string }[];
      page: { total: number };
    };
    expect(body.page.total).toBe(3);
    expect(body.data.map((e) => e.id)).toEqual(['evt_3', 'evt_2', 'evt_1']);
    expect(JSON.stringify(body)).not.toContain('ppk_eeee');
  });

  it('filters by type and paginates', async () => {
    const filtered = await request(app.getHttpServer())
      .get('/api/v1/audit-events?type=MODEL_CREATED')
      .set('Authorization', `Bearer ${RAW_A}`)
      .expect(200);
    expect(
      (filtered.body as { data: { id: string }[] }).data.map((e) => e.id),
    ).toEqual(['evt_3', 'evt_1']);
    const page = await request(app.getHttpServer())
      .get('/api/v1/audit-events?page=2&pageSize=2')
      .set('Authorization', `Bearer ${RAW_A}`)
      .expect(200);
    expect(
      (page.body as { data: { id: string }[] }).data.map((e) => e.id),
    ).toEqual(['evt_1']);
  });

  it('isolates tenants and requires auth', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/audit-events')
      .set('Authorization', `Bearer ${RAW_B}`)
      .expect(200);
    expect(
      (res.body as { data: { id: string }[] }).data.map((e) => e.id),
    ).toEqual(['evt_b1']);
    await request(app.getHttpServer()).get('/api/v1/audit-events').expect(401);
  });
});
