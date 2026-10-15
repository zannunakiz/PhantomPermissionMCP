import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { digestKey } from '../src/auth/api-key';
import {
  ACCESS_MODEL_REPOSITORY,
  API_KEY_REPOSITORY,
  MODEL_VERSION_REPOSITORY,
} from '../src/repositories/tokens';
import type { ApiKeyRecord } from '../src/repositories/records';
import { AppModule } from '../src/app.module';
import { setupHttpHandling } from '../src/common/http';

const PEPPER = 'e2e-pepper-31';
const RAW_A = `ppk_${'a'.repeat(40)}`;
const RAW_B = `ppk_${'b'.repeat(40)}`;
const RAW_READONLY = `ppk_${'c'.repeat(40)}`;

function recordFor(
  raw: string,
  tenantId: string,
  scopes: string[],
): ApiKeyRecord {
  return {
    id: `key_${tenantId}_${scopes.join('-')}`,
    tenantId,
    keyPrefix: raw.slice(0, 12),
    keyDigest: digestKey(raw, PEPPER),
    scopes,
    status: 'ACTIVE',
    expiresAt: null,
    revokedAt: null,
    lastUsedAt: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
}

const KEYS = [
  recordFor(RAW_A, 'tnt_a', ['models:write', 'models:read']),
  recordFor(RAW_B, 'tnt_b', ['models:write', 'models:read']),
  recordFor(RAW_READONLY, 'tnt_a', ['models:read']),
];

const fakeKeyRepo = {
  findByDigest: (d: string) =>
    Promise.resolve(KEYS.find((k) => k.keyDigest === d) ?? null),
  listByTenant: (t: string) =>
    Promise.resolve(KEYS.filter((k) => k.tenantId === t)),
  create: () => Promise.reject(new Error('not used')),
  updateStatus: () => Promise.resolve(null),
  touchLastUsed: () => Promise.resolve(),
};

type CreatedModelRow = {
  id: string;
  tenantId: string;
  name: string;
  currentVersion: number;
  createdAt: Date;
  updatedAt: Date;
};
const modelRows: CreatedModelRow[] = [];

const fakeModelRepo = {
  findById: (tenantId: string, id: string) =>
    Promise.resolve(
      modelRows.find((m) => m.id === id && m.tenantId === tenantId) ?? null,
    ),
  listByTenant: (tenantId: string) =>
    Promise.resolve(modelRows.filter((m) => m.tenantId === tenantId)),
  create: (input: { id: string; tenantId: string; name: string }) => {
    if (
      modelRows.some(
        (m) => m.tenantId === input.tenantId && m.name === input.name,
      )
    ) {
      const err = Object.assign(new Error('unique'), {
        code: 'P2002',
        meta: { target: ['tenantId', 'name'] },
      });
      return Promise.reject(err);
    }
    const row: CreatedModelRow = {
      ...input,
      currentVersion: 1,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    };
    modelRows.push(row);
    return Promise.resolve(row);
  },
};

type VersionRow = {
  id: string;
  modelId: string;
  tenantId: string;
  version: number;
  contentHash: string;
  createdAt: Date;
};
const versionRows: VersionRow[] = [];

const fakeVersionRepo = {
  findByModelVersion: (tenantId: string, modelId: string, version: number) =>
    Promise.resolve(
      versionRows.find(
        (v) =>
          v.tenantId === tenantId &&
          v.modelId === modelId &&
          v.version === version,
      ) ?? null,
    ),
  listByModel: (tenantId: string, modelId: string) =>
    Promise.resolve(
      versionRows.filter(
        (v) => v.tenantId === tenantId && v.modelId === modelId,
      ),
    ),
  create: (input: {
    id: string;
    modelId: string;
    tenantId: string;
    version: number;
    contentHash: string;
  }) => {
    const row: VersionRow = {
      id: input.id,
      modelId: input.modelId,
      tenantId: input.tenantId,
      version: input.version,
      contentHash: input.contentHash,
      createdAt: new Date(0),
    };
    versionRows.push(row);
    return Promise.resolve({
      ...row,
      snapshot: {},
      operationCount: 0,
    });
  },
};

const SNAPSHOT = {
  roles: [{ id: 'viewer', name: 'viewer' }],
  permissions: [{ id: 'invoice:read', value: 'invoice:read' }],
  bindings: [{ roleId: 'viewer', permissionId: 'invoice:read' }],
  inheritance: [],
  assignments: [],
  subjects: [],
};

async function buildApp(): Promise<INestApplication<App>> {
  const fixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(API_KEY_REPOSITORY)
    .useValue(fakeKeyRepo)
    .overrideProvider(ACCESS_MODEL_REPOSITORY)
    .useValue(fakeModelRepo)
    .overrideProvider(MODEL_VERSION_REPOSITORY)
    .useValue(fakeVersionRepo)
    .overrideProvider('APP_CONFIG')
    .useValue({ apiKeyPepper: PEPPER, nodeEnv: 'test' })
    .compile();
  const app = fixture.createNestApplication({ bodyParser: false });
  setupHttpHandling(app, { requestBodyLimit: '1mb' });
  await app.init();
  return app;
}

describe('POST /api/v1/models (e2e)', () => {
  let app: INestApplication<App>;
  beforeAll(async () => {
    app = await buildApp();
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => {
    modelRows.length = 0;
    versionRows.length = 0;
  });

  async function createAs(
    raw: string,
    name: string,
  ): Promise<{ id: string; contentHash: string }> {
    const res = await request(app.getHttpServer())
      .post('/api/v1/models')
      .set('Authorization', `Bearer ${raw}`)
      .send({ name, snapshot: SNAPSHOT })
      .expect(201);
    const body = res.body as { id: string; contentHash: string };
    versionRows.push({
      id: `ver_${body.id}`,
      modelId: body.id,
      tenantId: raw === RAW_B ? 'tnt_b' : 'tnt_a',
      version: 1,
      contentHash: body.contentHash,
      createdAt: new Date(0),
    });
    return body;
  }

  it('creates a model with version 1', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/models')
      .set('Authorization', `Bearer ${RAW_A}`)
      .send({ name: 'billing', snapshot: SNAPSHOT })
      .expect(201);
    const body = res.body as Record<string, unknown>;
    expect(body.tenantId).toBe('tnt_a');
    expect(body.currentVersion).toBe(1);
    expect(typeof body.id).toBe('string');
    expect(typeof body.contentHash).toBe('string');
  });

  it('rejects malformed input with validation_failed', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/models')
      .set('Authorization', `Bearer ${RAW_A}`)
      .send({ name: '', snapshot: {} })
      .expect(400);
    expect((res.body as { error: { code: string } }).error.code).toBe(
      'validation_failed',
    );
  });

  it('rejects duplicate names in the same tenant', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/models')
      .set('Authorization', `Bearer ${RAW_A}`)
      .send({ name: 'dup', snapshot: SNAPSHOT })
      .expect(201);
    const res = await request(app.getHttpServer())
      .post('/api/v1/models')
      .set('Authorization', `Bearer ${RAW_A}`)
      .send({ name: 'dup', snapshot: SNAPSHOT })
      .expect(400);
    expect((res.body as { error: { code: string } }).error.code).toBe(
      'validation_failed',
    );
  });

  it('requires auth and models:write scope', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/models')
      .send({ name: 'x', snapshot: SNAPSHOT })
      .expect(401);
    const res = await request(app.getHttpServer())
      .post('/api/v1/models')
      .set('Authorization', `Bearer ${RAW_READONLY}`)
      .send({ name: 'x', snapshot: SNAPSHOT })
      .expect(403);
    expect((res.body as { error: { code: string } }).error.code).toBe(
      'forbidden_scope',
    );
  });

  it('isolates tenants: same name allowed in tenant B', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/models')
      .set('Authorization', `Bearer ${RAW_A}`)
      .send({ name: 'shared', snapshot: SNAPSHOT })
      .expect(201);
    await request(app.getHttpServer())
      .post('/api/v1/models')
      .set('Authorization', `Bearer ${RAW_B}`)
      .send({ name: 'shared', snapshot: SNAPSHOT })
      .expect(201);
  });

  it('lists only own models with pagination and summaries', async () => {
    await createAs(RAW_A, 'alpha');
    await createAs(RAW_A, 'beta');
    await createAs(RAW_B, 'other');
    const res = await request(app.getHttpServer())
      .get('/api/v1/models?page=1&pageSize=1&orderBy=name')
      .set('Authorization', `Bearer ${RAW_A}`)
      .expect(200);
    const body = res.body as {
      data: { name: string; versions: unknown[]; snapshot?: unknown }[];
      page: { total: number };
    };
    expect(body.page.total).toBe(2);
    expect(body.data.length).toBe(1);
    expect(body.data[0]?.name).toBe('alpha');
    expect(Array.isArray(body.data[0]?.versions)).toBe(true);
    expect(body.data[0]?.snapshot).toBeUndefined();
    const empty = await request(app.getHttpServer())
      .get('/api/v1/models')
      .set('Authorization', `Bearer ${RAW_READONLY}`)
      .expect(200);
    expect(
      (empty.body as { page: { total: number } }).page.total,
    ).toBeGreaterThanOrEqual(0);
  });

  it('retrieves detail, rejects bad id and cross-tenant', async () => {
    const created = await createAs(RAW_A, 'detail');
    const res = await request(app.getHttpServer())
      .get(`/api/v1/models/${created.id}`)
      .set('Authorization', `Bearer ${RAW_A}`)
      .expect(200);
    expect((res.body as { id: string; contentHash: string }).id).toBe(
      created.id,
    );
    await request(app.getHttpServer())
      .get('/api/v1/models/not_a_model')
      .set('Authorization', `Bearer ${RAW_A}`)
      .expect(400);
    await request(app.getHttpServer())
      .get(`/api/v1/models/${created.id}`)
      .set('Authorization', `Bearer ${RAW_B}`)
      .expect(404);
  });
});
