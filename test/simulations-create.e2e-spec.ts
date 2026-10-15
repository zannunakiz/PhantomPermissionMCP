import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { digestKey } from '../src/auth/api-key';
import {
  ACCESS_MODEL_REPOSITORY,
  API_KEY_REPOSITORY,
  IDEMPOTENCY_REPOSITORY,
  MODEL_VERSION_REPOSITORY,
  SIMULATION_REPOSITORY,
} from '../src/repositories/tokens';
import { AppModule } from '../src/app.module';
import { setupHttpHandling } from '../src/common/http';

const PEPPER = 'e2e-pepper-34';
const RAW_A = `ppk_${'d'.repeat(40)}`;

const SNAPSHOT = {
  roles: [
    { id: 'viewer', name: 'viewer' },
    { id: 'admin', name: 'admin' },
  ],
  permissions: [
    { id: 'invoice:read', value: 'invoice:read' },
    { id: 'invoice:refund', value: 'invoice:refund' },
  ],
  bindings: [
    { roleId: 'viewer', permissionId: 'invoice:read' },
    { roleId: 'admin', permissionId: 'invoice:refund' },
  ],
  inheritance: [],
  assignments: [{ subjectId: 'alice', roleId: 'viewer' }],
  subjects: [{ id: 'alice' }],
};

const fakeKeyRepo = {
  findByDigest: (d: string) =>
    Promise.resolve(
      d === digestKey(RAW_A, PEPPER)
        ? {
            id: 'key_a',
            tenantId: 'tnt_a',
            keyPrefix: RAW_A.slice(0, 12),
            keyDigest: d,
            scopes: ['simulations:run', 'models:write', 'models:read'],
            status: 'ACTIVE' as const,
            expiresAt: null,
            revokedAt: null,
            lastUsedAt: null,
            createdAt: new Date(0),
            updatedAt: new Date(0),
          }
        : null,
    ),
  listByTenant: () => Promise.resolve([]),
  create: () => Promise.reject(new Error('not used')),
  updateStatus: () => Promise.resolve(null),
  touchLastUsed: () => Promise.resolve(),
};

const fakeModelRepo = {
  findById: (tenantId: string, id: string) =>
    Promise.resolve(
      id === 'mdl_sim_1' && tenantId === 'tnt_a'
        ? {
            id,
            tenantId,
            name: 'm',
            currentVersion: 1,
            createdAt: new Date(0),
            updatedAt: new Date(0),
          }
        : null,
    ),
  listByTenant: () => Promise.resolve([]),
  create: () => Promise.reject(new Error('not used')),
};
const versionRow = {
  id: 'ver_sim_1',
  modelId: 'mdl_sim_1',
  tenantId: 'tnt_a',
  version: 1,
  contentHash: 'sha256:abc',
  snapshot: SNAPSHOT,
  operationCount: 0,
  createdAt: new Date(0),
};

const fakeVersionRepo = {
  findByModelVersion: (t: string, m: string, v: number) =>
    Promise.resolve(
      t === 'tnt_a' && m === 'mdl_sim_1' && v === 1 ? versionRow : null,
    ),
  listByModel: () => Promise.resolve([versionRow]),
  create: () => Promise.reject(new Error('not used')),
};

const simRows: { id: string }[] = [];
const fakeSimRepo = {
  findById: () => Promise.resolve(null),
  listByTenant: () => Promise.resolve([]),
  listByModel: () => Promise.resolve([]),
  create: (input: { id: string }) => {
    simRows.push({ id: input.id });
    return Promise.resolve({
      ...input,
      status: 'COMPLETED' as const,
      createdAt: new Date(0),
    });
  },
};

const idemRows = new Map<
  string,
  { requestHash: string; responseBody: unknown }
>();
const fakeIdemRepo = {
  findByKey: (t: string, e: string, k: string) => {
    const row = idemRows.get(`${t}|${e}|${k}`);
    return Promise.resolve(
      row
        ? {
            id: 'idem_1',
            tenantId: t,
            endpoint: e,
            idempotencyKey: k,
            requestHash: row.requestHash,
            statusCode: 201,
            responseBody: row.responseBody,
            createdAt: new Date(0),
            expiresAt: new Date(Date.now() + 3600000),
          }
        : null,
    );
  },
  create: (input: {
    tenantId: string;
    endpoint: string;
    idempotencyKey: string;
    requestHash: string;
    responseBody: unknown;
  }) => {
    const key = `${input.tenantId}|${input.endpoint}|${input.idempotencyKey}`;
    if (idemRows.has(key))
      return Promise.reject(
        Object.assign(new Error('unique'), { code: 'P2002' }),
      );
    idemRows.set(key, {
      requestHash: input.requestHash,
      responseBody: input.responseBody,
    });
    return Promise.resolve({
      id: 'idem_1',
      statusCode: 201,
      createdAt: new Date(0),
      expiresAt: new Date(Date.now() + 3600000),
      ...input,
    });
  },
  deleteExpired: () => Promise.resolve(0),
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
    .overrideProvider(SIMULATION_REPOSITORY)
    .useValue(fakeSimRepo)
    .overrideProvider(IDEMPOTENCY_REPOSITORY)
    .useValue(fakeIdemRepo)
    .overrideProvider('APP_CONFIG')
    .useValue({ apiKeyPepper: PEPPER, nodeEnv: 'test' })
    .compile();
  const app = fixture.createNestApplication({ bodyParser: false });
  setupHttpHandling(app, { requestBodyLimit: '1mb' });
  await app.init();
  return app;
}

const GRANT = {
  modelId: 'mdl_sim_1',
  operations: [
    {
      type: 'grant_permission',
      roleId: 'viewer',
      permissionId: 'invoice:refund',
    },
  ],
};

describe('POST /api/v1/simulations (e2e)', () => {
  let app: INestApplication<App>;
  beforeAll(async () => {
    app = await buildApp();
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => {
    idemRows.clear();
    simRows.length = 0;
  });

  it('runs a valid simulation and persists it', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/simulations')
      .set('Authorization', `Bearer ${RAW_A}`)
      .send(GRANT)
      .expect(201);
    const body = res.body as {
      id: string;
      status: string;
      summary: { addedCount: number; affectedSubjectCount: number };
    };
    expect(typeof body.id).toBe('string');
    expect(body.status).toBe('completed');
    expect(body.summary.addedCount).toBe(1);
    expect(simRows.length).toBe(1);
  });

  it('supports no-op and rejects invalid changes', async () => {
    const noop = await request(app.getHttpServer())
      .post('/api/v1/simulations')
      .set('Authorization', `Bearer ${RAW_A}`)
      .send({
        modelId: 'mdl_sim_1',
        operations: [
          {
            type: 'revoke_permission',
            roleId: 'viewer',
            permissionId: 'invoice:refund',
          },
        ],
      })
      .expect(201);
    expect(
      (noop.body as { summary: { addedCount: number } }).summary.addedCount,
    ).toBe(0);
    const bad = await request(app.getHttpServer())
      .post('/api/v1/simulations')
      .set('Authorization', `Bearer ${RAW_A}`)
      .send({
        modelId: 'mdl_sim_1',
        operations: [
          { type: 'grant_permission', roleId: 'ghost', permissionId: 'x' },
        ],
      })
      .expect(400);
    expect((bad.body as { error: { code: string } }).error.code).toBe(
      'validation_failed',
    );
    await request(app.getHttpServer())
      .post('/api/v1/simulations')
      .set('Authorization', `Bearer ${RAW_A}`)
      .send({ modelId: 'mdl_nope', operations: GRANT.operations })
      .expect(404);
  });

  it('replays idempotent retries and conflicts on mismatch', async () => {
    const first = await request(app.getHttpServer())
      .post('/api/v1/simulations')
      .set('Authorization', `Bearer ${RAW_A}`)
      .set('Idempotency-Key', 'k-1')
      .send(GRANT)
      .expect(201);
    const second = await request(app.getHttpServer())
      .post('/api/v1/simulations')
      .set('Authorization', `Bearer ${RAW_A}`)
      .set('Idempotency-Key', 'k-1')
      .send(GRANT)
      .expect(201);
    expect((second.body as { id: string }).id).toBe(
      (first.body as { id: string }).id,
    );
    expect(simRows.length).toBe(1);
    const conflict = await request(app.getHttpServer())
      .post('/api/v1/simulations')
      .set('Authorization', `Bearer ${RAW_A}`)
      .set('Idempotency-Key', 'k-1')
      .send({
        modelId: 'mdl_sim_1',
        operations: [
          {
            type: 'revoke_permission',
            roleId: 'viewer',
            permissionId: 'invoice:read',
          },
        ],
      })
      .expect(409);
    expect((conflict.body as { error: { code: string } }).error.code).toBe(
      'idempotency_conflict',
    );
  });
});
