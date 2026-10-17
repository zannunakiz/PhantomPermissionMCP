/**
 * Step 55 security and concurrency regression tests (e2e).
 *
 * Covers the prompt.md validation gate in one place:
 * - cross-tenant IDOR attempts
 * - revoked / expired API keys
 * - missing scopes
 * - idempotency conflicts
 * - simultaneous version creation
 * - concurrent duplicate simulations
 * - rate limiting
 * - oversized payloads
 * - secret redaction
 *
 * Repository fakes emulate the real database constraints (unique indexes,
 * atomic currentVersion bump) so concurrency races behave like production
 * Prisma repositories.
 */
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
import type { ApiKeyRecord } from '../src/repositories/records';
import { AppModule } from '../src/app.module';
import { setupHttpHandling } from '../src/common/http';
import {
  REDACTED,
  redactHeaders,
  redactValue,
  scrubSecretStrings,
} from '../src/common/logging/redact';

const PEPPER = 'e2e-pepper-55';
const ALL_SCOPES = [
  'models:read',
  'models:write',
  'simulations:run',
  'simulations:read',
  'exports:read',
  'audit:read',
];
const RAW_A = `ppk_${'a'.repeat(40)}`;
const RAW_B = `ppk_${'b'.repeat(40)}`;
const RAW_READONLY = `ppk_${'c'.repeat(40)}`;
const RAW_REVOKED = `ppk_${'r'.repeat(40)}`;
const RAW_EXPIRED = `ppk_${'e'.repeat(40)}`;

function keyRecord(
  raw: string,
  tenantId: string,
  scopes: string[],
  overrides: Partial<ApiKeyRecord> = {},
): ApiKeyRecord {
  return {
    id: `key_${raw.slice(4, 8)}_${tenantId}`,
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
    ...overrides,
  };
}

const KEYS: ApiKeyRecord[] = [
  keyRecord(RAW_A, 'tnt_a', ALL_SCOPES),
  keyRecord(RAW_B, 'tnt_b', ALL_SCOPES),
  keyRecord(RAW_READONLY, 'tnt_a', ['models:read']),
  keyRecord(RAW_REVOKED, 'tnt_a', ALL_SCOPES, {
    status: 'REVOKED',
    revokedAt: new Date(0),
  }),
  keyRecord(RAW_EXPIRED, 'tnt_a', ALL_SCOPES, {
    expiresAt: new Date(Date.now() - 1000),
  }),
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

type ModelRow = {
  id: string;
  tenantId: string;
  name: string;
  currentVersion: number;
  createdAt: Date;
  updatedAt: Date;
};
const modelRows: ModelRow[] = [];

function uniqueViolation(target: string[]): Error {
  return Object.assign(new Error('unique'), {
    code: 'P2002',
    meta: { target },
  });
}

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
      return Promise.reject(uniqueViolation(['tenantId', 'name']));
    }
    const row: ModelRow = {
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
  snapshot: unknown;
  createdAt: Date;
};
const versionRows: VersionRow[] = [];

// Emulates PrismaModelVersionRepository: insert + atomic currentVersion bump,
// colliding on the (modelId, version) unique index under concurrency.
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
    snapshot: unknown;
    operationCount?: number;
  }) => {
    if (
      versionRows.some(
        (v) => v.modelId === input.modelId && v.version === input.version,
      )
    ) {
      return Promise.reject(uniqueViolation(['modelId', 'version']));
    }
    const row: VersionRow = {
      id: input.id,
      modelId: input.modelId,
      tenantId: input.tenantId,
      version: input.version,
      contentHash: input.contentHash,
      snapshot: input.snapshot,
      createdAt: new Date(0),
    };
    versionRows.push(row);
    const model = modelRows.find((m) => m.id === input.modelId);
    if (model) model.currentVersion = input.version;
    return Promise.resolve({
      ...row,
      operationCount: input.operationCount ?? 0,
    });
  },
};

const simRows: Record<string, unknown>[] = [];
const fakeSimRepo = {
  findById: (tenantId: string, id: string) =>
    Promise.resolve(
      simRows.find((s) => s.id === id && s.tenantId === tenantId) ?? null,
    ),
  listByTenant: () => Promise.resolve([]),
  listByModel: () => Promise.resolve([]),
  create: (input: Record<string, unknown>) => {
    if (simRows.some((s) => s.id === input.id)) {
      return Promise.reject(uniqueViolation(['id']));
    }
    const row = {
      ...input,
      status: 'COMPLETED',
      createdAt: new Date(0),
    };
    simRows.push(row);
    return Promise.resolve(row);
  },
};

const idemRows = new Map<
  string,
  { requestHash: string; responseBody: unknown }
>();
// Emulates the (tenantId, endpoint, idempotencyKey) unique index.
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
    if (idemRows.has(key)) {
      return Promise.reject(uniqueViolation(['idempotencyKey']));
    }
    idemRows.set(key, {
      requestHash: input.requestHash,
      responseBody: input.responseBody,
    });
    return Promise.resolve({
      id: 'idem_1',
      ...input,
      statusCode: 201,
      createdAt: new Date(0),
      expiresAt: new Date(Date.now() + 3600000),
    });
  },
};

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

async function buildApp(
  overrides: Record<string, number | string | string[]> = {},
): Promise<INestApplication<App>> {
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
  setupHttpHandling(app, {
    requestBodyLimit: '1mb',
    nodeEnv: 'test',
    corsOrigins: [],
    rateLimitWindowMs: 60000,
    rateLimitMax: 1000,
    ...overrides,
  });
  await app.init();
  return app;
}

function seedSimulationModel(): void {
  modelRows.push({
    id: 'mdl_sim_1',
    tenantId: 'tnt_a',
    name: 'sim-model',
    currentVersion: 1,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  });
  versionRows.push({
    id: 'ver_sim_1',
    modelId: 'mdl_sim_1',
    tenantId: 'tnt_a',
    version: 1,
    contentHash: 'sha256:abc',
    snapshot: SNAPSHOT,
    createdAt: new Date(0),
  });
}

describe('Security and concurrency regressions (e2e)', () => {
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
    simRows.length = 0;
    idemRows.clear();
  });

  async function createModelAs(raw: string, name: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/api/v1/models')
      .set('Authorization', `Bearer ${raw}`)
      .send({ name, snapshot: SNAPSHOT })
      .expect(201);
    return (res.body as { id: string }).id;
  }

  it('blocks cross-tenant IDOR on models, versions, and simulations', async () => {
    const modelId = await createModelAs(RAW_A, 'idor-target');
    // Tenant B must not read, mutate, or version tenant A's model.
    await request(app.getHttpServer())
      .get(`/api/v1/models/${modelId}`)
      .set('Authorization', `Bearer ${RAW_B}`)
      .expect(404);
    await request(app.getHttpServer())
      .post(`/api/v1/models/${modelId}/versions`)
      .set('Authorization', `Bearer ${RAW_B}`)
      .send({ snapshot: SNAPSHOT, expectedVersion: 1 })
      .expect(404);
    seedSimulationModel();
    const created = await request(app.getHttpServer())
      .post('/api/v1/simulations')
      .set('Authorization', `Bearer ${RAW_A}`)
      .send(GRANT)
      .expect(201);
    const simId = (created.body as { id: string }).id;
    await request(app.getHttpServer())
      .get(`/api/v1/simulations/${simId}/report`)
      .set('Authorization', `Bearer ${RAW_B}`)
      .expect(404);
    await request(app.getHttpServer())
      .get(`/api/v1/simulations/${simId}/export?format=json`)
      .set('Authorization', `Bearer ${RAW_B}`)
      .expect(404);
  });

  it('rejects revoked and expired API keys with 401', async () => {
    for (const raw of [RAW_REVOKED, RAW_EXPIRED, `ppk_${'z'.repeat(40)}`]) {
      const res = await request(app.getHttpServer())
        .get('/api/v1/models')
        .set('Authorization', `Bearer ${raw}`)
        .expect(401);
      expect((res.body as { error: { code: string } }).error.code).toBe(
        'unauthorized',
      );
    }
    await request(app.getHttpServer()).get('/api/v1/models').expect(401);
    await request(app.getHttpServer())
      .get('/api/v1/models')
      .set('Authorization', 'Bearer not-a-key')
      .expect(401);
  });

  it('rejects requests missing required scopes with 403 forbidden_scope', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/models')
      .set('Authorization', `Bearer ${RAW_READONLY}`)
      .send({ name: 'nope', snapshot: SNAPSHOT })
      .expect(403);
    const body = res.body as { error: { code: string; message: string } };
    expect(body.error.code).toBe('forbidden_scope');
    expect(body.error.message).toContain('models:write');
    // Read scope still works for the same key.
    await request(app.getHttpServer())
      .get('/api/v1/models')
      .set('Authorization', `Bearer ${RAW_READONLY}`)
      .expect(200);
  });

  it('enforces idempotency keys: replay returns same result, changed body conflicts', async () => {
    seedSimulationModel();
    const first = await request(app.getHttpServer())
      .post('/api/v1/simulations')
      .set('Authorization', `Bearer ${RAW_A}`)
      .set('Idempotency-Key', 'reg-idem-1')
      .send(GRANT)
      .expect(201);
    const replay = await request(app.getHttpServer())
      .post('/api/v1/simulations')
      .set('Authorization', `Bearer ${RAW_A}`)
      .set('Idempotency-Key', 'reg-idem-1')
      .send(GRANT)
      .expect(201);
    expect((replay.body as { id: string }).id).toBe(
      (first.body as { id: string }).id,
    );
    const conflict = await request(app.getHttpServer())
      .post('/api/v1/simulations')
      .set('Authorization', `Bearer ${RAW_A}`)
      .set('Idempotency-Key', 'reg-idem-1')
      .send({
        ...GRANT,
        operations: [
          {
            type: 'grant_permission',
            roleId: 'admin',
            permissionId: 'invoice:read',
          },
        ],
      })
      .expect(409);
    expect((conflict.body as { error: { code: string } }).error.code).toBe(
      'idempotency_conflict',
    );
  });

  it('allows exactly one winner for simultaneous version creation', async () => {
    const modelId = await createModelAs(RAW_A, 'race-model');
    const sendVersion = () =>
      request(app.getHttpServer())
        .post(`/api/v1/models/${modelId}/versions`)
        .set('Authorization', `Bearer ${RAW_A}`)
        .send({ snapshot: SNAPSHOT, expectedVersion: 1 });
    const results = await Promise.all([sendVersion(), sendVersion()]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([201, 409]);
    const loser = results.find((r) => r.status === 409);
    expect((loser?.body as { error: { code: string } }).error.code).toBe(
      'conflict_version',
    );
    // History is not forked: exactly one version 2 exists.
    expect(
      versionRows.filter((v) => v.modelId === modelId && v.version === 2),
    ).toHaveLength(1);
    expect(modelRows.find((m) => m.id === modelId)?.currentVersion).toBe(2);
  });

  it('returns one shared result for concurrent duplicate simulations', async () => {
    seedSimulationModel();
    const send = () =>
      request(app.getHttpServer())
        .post('/api/v1/simulations')
        .set('Authorization', `Bearer ${RAW_A}`)
        .set('Idempotency-Key', 'reg-race-1')
        .send(GRANT);
    const results = await Promise.all([send(), send()]);
    expect(results.map((r) => r.status)).toEqual([201, 201]);
    const ids = results.map((r) => (r.body as { id: string }).id);
    expect(ids[0]).toBe(ids[1]);
  });

  it('secret redaction masks keys, headers, and free-text secrets', () => {
    const headers = redactHeaders({
      authorization: `Bearer ${RAW_A}`,
      'x-api-key': RAW_A,
      'content-type': 'application/json',
      cookie: 'session=abc',
    });
    expect(headers.authorization).toBe(REDACTED);
    expect(headers['x-api-key']).toBe(REDACTED);
    expect(headers.cookie).toBe(REDACTED);
    expect(headers['content-type']).toBe('application/json');
    const value = redactValue({
      apiKeyPepper: PEPPER,
      note: `issued ${RAW_A} to tenant`,
      nested: { databaseUrl: 'postgresql://user:pass@host/db' },
    }) as Record<string, unknown>;
    expect(value.apiKeyPepper).toBe(REDACTED);
    expect(String(value.note)).not.toContain(RAW_A);
    expect(String(value.note)).toContain(REDACTED);
    expect((value.nested as Record<string, unknown>).databaseUrl).toBe(
      REDACTED,
    );
    expect(scrubSecretStrings(`pre ${RAW_A} post`)).not.toContain(RAW_A);
  });
});

describe('Rate limiting and payload limits (regressions)', () => {
  it('rate limits per client with 429 rate_limited envelope', async () => {
    const app = await buildApp({ rateLimitMax: 2, rateLimitWindowMs: 60000 });
    try {
      const server = app.getHttpServer();
      await request(server).get('/api/v1/models').expect(401);
      await request(server).get('/api/v1/models').expect(401);
      const res = await request(server).get('/api/v1/models').expect(429);
      const body = res.body as { error: { code: string; status: number } };
      expect(body.error.code).toBe('rate_limited');
      expect(body.error.status).toBe(429);
      expect(res.headers['retry-after']).toBeDefined();
    } finally {
      await app.close();
    }
  });

  it('rejects oversized payloads with 413 payload_too_large', async () => {
    const app = await buildApp({ requestBodyLimit: '2kb' });
    try {
      const res = await request(app.getHttpServer())
        .post('/api/v1/models')
        .set('Authorization', `Bearer ${RAW_A}`)
        .send({
          name: 'big',
          snapshot: { ...SNAPSHOT, padding: 'x'.repeat(8192) },
        })
        .expect(413);
      expect((res.body as { error: { code: string } }).error.code).toBe(
        'payload_too_large',
      );
    } finally {
      await app.close();
    }
  });
});
