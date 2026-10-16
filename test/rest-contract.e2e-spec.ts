/**
 * Step 39 - full REST e2e contract + security suite.
 * One reproducible app with in-memory repository fakes (no DB, no paid
 * services): tenant/key setup, model lifecycle, versioning + concurrency,
 * simulations + idempotency, reports, exports, audit, validation, auth,
 * rate limits, and the error envelope.
 */
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { digestKey } from '../src/auth/api-key';
import {
  ACCESS_MODEL_REPOSITORY,
  API_KEY_REPOSITORY,
  AUDIT_REPOSITORY,
  IDEMPOTENCY_REPOSITORY,
  MODEL_VERSION_REPOSITORY,
  SIMULATION_REPOSITORY,
} from '../src/repositories/tokens';
import { AppModule } from '../src/app.module';
import { setupHttpHandling } from '../src/common/http';

const PEPPER = 'e2e-pepper-39';
const RAW_FULL = `ppk_${'g'.repeat(40)}`;
const RAW_B = `ppk_${'h'.repeat(40)}`;
const RAW_READONLY = `ppk_${'i'.repeat(40)}`;
const FULL_SCOPES = [
  'models:write',
  'models:read',
  'simulations:run',
  'simulations:read',
  'exports:read',
  'audit:read',
];

const SNAPSHOT_V1 = {
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

const SNAPSHOT_V2 = {
  ...SNAPSHOT_V1,
  bindings: [
    ...SNAPSHOT_V1.bindings,
    { roleId: 'viewer', permissionId: 'invoice:refund' },
  ],
};

const keyRow = (raw: string, tenantId: string, scopes: string[]) => ({
  id: `key_${tenantId}_${raw.slice(4, 6)}`,
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
});
const KEYS = [
  keyRow(RAW_FULL, 'tnt_a', FULL_SCOPES),
  keyRow(RAW_B, 'tnt_b', FULL_SCOPES),
  keyRow(RAW_READONLY, 'tnt_a', ['models:read']),
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
type VersionRow = {
  id: string;
  modelId: string;
  tenantId: string;
  version: number;
  contentHash: string;
  snapshot: unknown;
  operationCount: number;
  createdAt: Date;
};
const modelRows: ModelRow[] = [];
const versionRows: VersionRow[] = [];
type SimRow = {
  id: string;
  tenantId: string;
  modelId: string;
  version: number;
  versionRowId: string;
  contentHash: string;
  operations: unknown;
  summary: unknown;
  impacts: unknown;
  findings: unknown;
  disclaimer: string;
  status: string;
  createdAt: Date;
};
const simRows: SimRow[] = [];
type IdemEntry = {
  requestHash: string;
  responseBody: { id: string; status: string; summary: unknown };
};
const idemRows = new Map<string, IdemEntry>();
let auditCalls = 0;

const fakeModelRepo = {
  findById: (t: string, id: string) =>
    Promise.resolve(
      modelRows.find((m) => m.id === id && m.tenantId === t) ?? null,
    ),
  listByTenant: (t: string) =>
    Promise.resolve(modelRows.filter((m) => m.tenantId === t)),
  create: (input: { id: string; tenantId: string; name: string }) => {
    if (
      modelRows.some(
        (m) => m.tenantId === input.tenantId && m.name === input.name,
      )
    ) {
      return Promise.reject(
        Object.assign(new Error('unique'), {
          code: 'P2002',
          meta: { target: ['tenantId', 'name'] },
        }),
      );
    }
    const row = {
      ...input,
      currentVersion: 1,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    };
    modelRows.push(row);
    return Promise.resolve(row);
  },
};

const fakeVersionRepo = {
  findByModelVersion: (t: string, m: string, v: number) =>
    Promise.resolve(
      versionRows.find(
        (r) => r.tenantId === t && r.modelId === m && r.version === v,
      ) ?? null,
    ),
  listByModel: (t: string, m: string) =>
    Promise.resolve(
      versionRows.filter((r) => r.tenantId === t && r.modelId === m),
    ),
  create: (input: unknown) => {
    const v = input as VersionRow;
    if (
      versionRows.some(
        (r) =>
          r.tenantId === v.tenantId &&
          r.modelId === v.modelId &&
          r.version === v.version,
      )
    ) {
      return Promise.reject(
        Object.assign(new Error('unique'), {
          code: 'P2002',
          meta: { target: ['modelId', 'version'] },
        }),
      );
    }
    const row: VersionRow = { ...v, createdAt: new Date(0) };
    versionRows.push(row);
    const model = modelRows.find(
      (mm) => mm.id === v.modelId && mm.tenantId === v.tenantId,
    );
    if (model) model.currentVersion = Math.max(model.currentVersion, v.version);
    return Promise.resolve(row);
  },
};

const fakeSimRepo = {
  findById: (t: string, id: string) =>
    Promise.resolve(
      simRows.find((s) => s.id === id && s.tenantId === t) ?? null,
    ),
  listByTenant: (t: string) =>
    Promise.resolve(simRows.filter((s) => s.tenantId === t)),
  listByModel: (t: string, m: string) =>
    Promise.resolve(simRows.filter((s) => s.tenantId === t && s.modelId === m)),
  create: (input: unknown) => {
    const sr = input as Omit<SimRow, 'status' | 'createdAt'>;
    const row: SimRow = {
      ...sr,
      status: 'COMPLETED',
      createdAt: new Date(0),
    };
    simRows.push(row);
    return Promise.resolve(row);
  },
};

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
  create: (input: unknown) => {
    const ie = input as IdemEntry & {
      tenantId: string;
      endpoint: string;
      idempotencyKey: string;
    } & Record<string, unknown>;
    const key = `${ie.tenantId}|${ie.endpoint}|${ie.idempotencyKey}`;
    if (idemRows.has(key))
      return Promise.reject(
        Object.assign(new Error('unique'), { code: 'P2002' }),
      );
    idemRows.set(key, {
      requestHash: ie.requestHash,
      responseBody: ie.responseBody,
    });
    return Promise.resolve({
      id: 'idem_1',
      createdAt: new Date(0),
      expiresAt: new Date(Date.now() + 3600000),
      ...ie,
    });
  },
  deleteExpired: () => Promise.resolve(0),
};

const fakeAuditRepo = {
  append: () => Promise.resolve({} as never),
  listByTenant: (t: string, opts?: { type?: string }) => {
    auditCalls += 1;
    const rows = [
      {
        id: 'evt_1',
        tenantId: 'tnt_a',
        type: 'SIMULATION_CREATED',
        actorKeyPrefix: 'ppk_gggggg',
        resourceType: 'simulation',
        resourceId: 'sim_1',
        metadata: {},
        createdAt: new Date(1),
      },
      {
        id: 'evt_2',
        tenantId: 'tnt_a',
        type: 'MODEL_CREATED',
        actorKeyPrefix: 'ppk_gggggg',
        resourceType: 'model',
        resourceId: 'm_1',
        metadata: {},
        createdAt: new Date(0),
      },
    ].filter((e) => e.tenantId === t && (!opts?.type || e.type === opts.type));
    return Promise.resolve(rows as never[]);
  },
  listByResource: () => Promise.resolve([]),
};
async function buildApp(
  overrides: Record<string, number | string | string[]> = {},
) {
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
    .overrideProvider(AUDIT_REPOSITORY)
    .useValue(fakeAuditRepo)
    .overrideProvider('APP_CONFIG')
    .useValue({ apiKeyPepper: PEPPER, nodeEnv: 'test' })
    .compile();
  const app = fixture.createNestApplication({ bodyParser: false });
  setupHttpHandling(app, { requestBodyLimit: '1mb', ...overrides });
  await app.init();
  return app;
}

const auth = (raw: string) => ({ Authorization: `Bearer ${raw}` });
const errCode = (res: request.Response): string | null =>
  (res.body as { error?: { code?: string } }).error?.code ?? null;

describe('REST contract + security (step 39)', () => {
  let app: INestApplication;
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
  const srv = () => request(app.getHttpServer());
  it('runs the full lifecycle: model, retrieve, version, simulate, report, export, audit', async () => {
    const created = await srv()
      .post('/api/v1/models')
      .set(auth(RAW_FULL))
      .send({ name: 'contract', snapshot: SNAPSHOT_V1 })
      .expect(201);
    const modelId = (created.body as { id: string }).id;
    expect(modelId).toMatch(/^mdl_/);
    expect((created.body as { currentVersion: number }).currentVersion).toBe(1);
    const detail = await srv()
      .get(`/api/v1/models/${modelId}`)
      .set(auth(RAW_FULL))
      .expect(200);
    expect((detail.body as { id: string }).id).toBe(modelId);
    await srv()
      .post(`/api/v1/models/${modelId}/versions`)
      .set(auth(RAW_FULL))
      .send({ snapshot: SNAPSHOT_V2, expectedVersion: 1 })
      .expect(201);
    const v2 = await srv()
      .get(`/api/v1/models/${modelId}`)
      .set(auth(RAW_FULL))
      .expect(200);
    expect((v2.body as { currentVersion: number }).currentVersion).toBe(2);
    const sim = await srv()
      .post('/api/v1/simulations')
      .set(auth(RAW_FULL))
      .set('Idempotency-Key', 'contract-key-1')
      .send({
        modelId,
        operations: [
          {
            type: 'grant_permission',
            roleId: 'viewer',
            permissionId: 'invoice:refund',
          },
        ],
      })
      .expect(201);
    const simId = (sim.body as { id: string }).id;
    expect((sim.body as { status: string }).status).toBe('completed');
    expect((sim.body as { summary: unknown }).summary).toBeDefined();
    const report = await srv()
      .get(`/api/v1/simulations/${simId}/report`)
      .set(auth(RAW_FULL))
      .expect(200);
    expect((report.body as { id: string }).id).toBe(simId);
    expect(Array.isArray((report.body as { impacts: unknown }).impacts)).toBe(
      true,
    );
    expect((report.body as { findings: unknown }).findings).toBeDefined();
    expect(
      (report.body as { provenance: { modelId: string } }).provenance.modelId,
    ).toBe(modelId);
    const json = await srv()
      .get(`/api/v1/simulations/${simId}/export?format=json`)
      .set(auth(RAW_FULL))
      .expect(200);
    expect(json.headers['content-type']).toMatch(/json/);
    const csv = await srv()
      .get(`/api/v1/simulations/${simId}/export?format=csv`)
      .set(auth(RAW_FULL))
      .expect(200);
    expect(csv.headers['content-type']).toMatch(/csv/);
    expect(csv.text).toMatch(/subject_id/);
    const audit = await srv()
      .get('/api/v1/audit-events')
      .set(auth(RAW_FULL))
      .expect(200);
    expect(Array.isArray((audit.body as { data: unknown }).data)).toBe(true);
    expect(auditCalls).toBeGreaterThan(0);
    expect(JSON.stringify(audit.body)).not.toContain(RAW_FULL);
  });
  it('enforces auth: missing key, bad key, insufficient scope', async () => {
    await srv()
      .get('/api/v1/models')
      .expect(401)
      .expect((r) => expect(errCode(r)).toBe('unauthorized'));
    await srv()
      .get('/api/v1/models')
      .set(auth(`ppk_${'z'.repeat(40)}`))
      .expect(401);
    await srv()
      .post('/api/v1/models')
      .set(auth(RAW_READONLY))
      .send({ name: 'x', snapshot: SNAPSHOT_V1 })
      .expect(403)
      .expect((r) => expect(errCode(r)).toBe('forbidden_scope'));
  });

  it('isolates tenants across models, simulations, and audit', async () => {
    const created = await srv()
      .post('/api/v1/models')
      .set(auth(RAW_FULL))
      .send({ name: 'iso', snapshot: SNAPSHOT_V1 })
      .expect(201);
    const id = (created.body as { id: string }).id;
    await srv()
      .get(`/api/v1/models/${id}`)
      .set(auth(RAW_B))
      .expect(404)
      .expect((r) => expect(errCode(r)).toBe('not_found'));
    const list = await srv().get('/api/v1/models').set(auth(RAW_B)).expect(200);
    expect((list.body as { data: unknown }).data).toEqual([]);
    await srv()
      .post('/api/v1/simulations')
      .set(auth(RAW_B))
      .send({
        modelId: id,
        operations: [
          {
            type: 'grant_permission',
            roleId: 'viewer',
            permissionId: 'invoice:read',
          },
        ],
      })
      .expect(404);
    const auditB = await srv()
      .get('/api/v1/audit-events')
      .set(auth(RAW_B))
      .expect(200);
    expect((auditB.body as { data: unknown }).data).toEqual([]);
  });

  it('rejects invalid input with validation_failed and the stable envelope', async () => {
    await srv()
      .post('/api/v1/models')
      .set(auth(RAW_FULL))
      .send({ name: '', snapshot: {} })
      .expect(400)
      .expect((r) => {
        expect(errCode(r)).toBe('validation_failed');
        expect(
          (r.body as { error: { requestId: string } }).error.requestId,
        ).toBeDefined();
      });
    const created = await srv()
      .post('/api/v1/models')
      .set(auth(RAW_FULL))
      .send({ name: 'val', snapshot: SNAPSHOT_V1 })
      .expect(201);
    await srv()
      .post('/api/v1/simulations')
      .set(auth(RAW_FULL))
      .send({
        modelId: (created.body as { id: string }).id,
        operations: [{ type: 'nope' }],
      })
      .expect(400)
      .expect((r) => expect(errCode(r)).toBe('validation_failed'));
    await srv()
      .get('/api/v1/models?page=1&pageSize=999')
      .set(auth(RAW_FULL))
      .expect(400);
  });

  it('rejects stale version writes and preserves earlier versions', async () => {
    const created = await srv()
      .post('/api/v1/models')
      .set(auth(RAW_FULL))
      .send({ name: 'conc', snapshot: SNAPSHOT_V1 })
      .expect(201);
    const id = (created.body as { id: string }).id;
    await srv()
      .post(`/api/v1/models/${id}/versions`)
      .set(auth(RAW_FULL))
      .send({ snapshot: SNAPSHOT_V2, expectedVersion: 1 })
      .expect(201);
    await srv()
      .post(`/api/v1/models/${id}/versions`)
      .set(auth(RAW_FULL))
      .send({ snapshot: SNAPSHOT_V2, expectedVersion: 1 })
      .expect(409)
      .expect((r) => expect(errCode(r)).toBe('conflict_version'));
    await srv()
      .post(`/api/v1/models/${id}/versions`)
      .set(auth(RAW_FULL))
      .set('If-Match', '"stale"')
      .send({ snapshot: SNAPSHOT_V2 })
      .expect(409);
    await srv()
      .get(`/api/v1/models/${id}?version=1`)
      .set(auth(RAW_FULL))
      .expect(200);
  });

  it('replays idempotent creates and conflicts on mismatched payloads', async () => {
    const created = await srv()
      .post('/api/v1/models')
      .set(auth(RAW_FULL))
      .send({ name: 'idem', snapshot: SNAPSHOT_V1 })
      .expect(201);
    const mid = (created.body as { id: string }).id;
    const body = {
      modelId: mid,
      operations: [
        {
          type: 'grant_permission',
          roleId: 'viewer',
          permissionId: 'invoice:refund',
        },
      ],
    };
    const first = await srv()
      .post('/api/v1/simulations')
      .set(auth(RAW_FULL))
      .set('Idempotency-Key', 'k-1')
      .send(body)
      .expect(201);
    const replay = await srv()
      .post('/api/v1/simulations')
      .set(auth(RAW_FULL))
      .set('Idempotency-Key', 'k-1')
      .send(body)
      .expect(201);
    expect((replay.body as { id: string }).id).toBe(
      (first.body as { id: string }).id,
    );
    const other = {
      modelId: mid,
      operations: [
        {
          type: 'revoke_permission',
          roleId: 'admin',
          permissionId: 'invoice:refund',
        },
      ],
    };
    await srv()
      .post('/api/v1/simulations')
      .set(auth(RAW_FULL))
      .set('Idempotency-Key', 'k-1')
      .send(other)
      .expect(409)
      .expect((r) => expect(errCode(r)).toBe('idempotency_conflict'));
  });

  it('paginates deterministically and checks error contracts', async () => {
    for (const n of ['p-b', 'p-a', 'p-c']) {
      await srv()
        .post('/api/v1/models')
        .set(auth(RAW_FULL))
        .send({ name: n, snapshot: SNAPSHOT_V1 })
        .expect(201);
    }
    const ordered = await srv()
      .get('/api/v1/models?orderBy=name&page=1&pageSize=2')
      .set(auth(RAW_FULL))
      .expect(200);
    expect(
      (
        (ordered.body as { data: { name: string }[] }).data as {
          name: string;
        }[]
      ).map((m) => m.name),
    ).toEqual(['p-a', 'p-b']);
    const p2 = await srv()
      .get('/api/v1/models?orderBy=name&page=2&pageSize=2')
      .set(auth(RAW_FULL))
      .expect(200);
    expect(
      (p2.body as { data: { name: string }[] }).data.map((m) => m.name),
    ).toEqual(['p-c']);
    const res = await srv().get('/api/v1/nope').set(auth(RAW_FULL)).expect(404);
    expect(errCode(res)).toBe('not_found');
    expect(
      (res.body as { error: { requestId: string } }).error.requestId,
    ).toBeDefined();
  });

  it('enforces rate limits with the standard envelope', async () => {
    const limited = await buildApp({
      rateLimitMax: 2,
      rateLimitWindowMs: 60000,
    });
    try {
      const s = () =>
        request(limited.getHttpServer())
          .get('/api/v1/models')
          .set(auth(RAW_FULL));
      await s().expect(200);
      await s().expect(200);
      await s()
        .expect(429)
        .expect((r) => expect(errCode(r)).toBe('rate_limited'));
    } finally {
      await limited.close();
    }
  });
});
