import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { AppModule } from '../app.module';
import { digestKey } from '../auth/api-key';
import {
  ACCESS_MODEL_REPOSITORY,
  API_KEY_REPOSITORY,
  IDEMPOTENCY_REPOSITORY,
  MODEL_VERSION_REPOSITORY,
  SIMULATION_REPOSITORY,
} from '../repositories/tokens';
import { McpService } from './mcp.service';

/**
 * Step 40 validation gate: MCP initialize + tools/list smoke test works
 * against the real NestJS module; no domain logic in transport handlers.
 *
 * Step 41 gate: `validate_access_model` covers valid models, structural
 * failures, malformed arguments, and stable output.
 */
describe('mcp transport (step 40)', () => {
  it('initializes and lists tools over an in-memory transport', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider('APP_CONFIG')
      .useValue({ databaseUrl: 'postgresql://localhost:5432/test' })
      .compile();
    const app = moduleRef.createNestApplication({ logger: false });
    await app.init();
    const mcp = app.get(McpService);
    const server = mcp.createServer();

    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'smoke', version: '0.0.0' });
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);
    const tools = await client.listTools();
    expect(Array.isArray(tools.tools)).toBe(true);
    await client.close();
    await app.close();
  });
});

const VALID_SNAPSHOT = {
  roles: [{ id: 'viewer', name: 'viewer' }],
  permissions: [{ id: 'invoice:read', value: 'invoice:read' }],
  bindings: [{ roleId: 'viewer', permissionId: 'invoice:read' }],
  inheritance: [],
  assignments: [],
  subjects: [],
};

describe('validate_access_model (step 41)', () => {
  let client: Client;
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider('APP_CONFIG')
      .useValue({ databaseUrl: 'postgresql://localhost:5432/test' })
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
    const server = app.get(McpService).createServer();
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'step41', version: '0.0.0' });
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);
  });

  afterAll(async () => {
    await client.close();
    await app.close();
  });

  const callTool = async (args: unknown) =>
    (await client.callTool({
      name: 'validate_access_model',
      arguments: args as Record<string, unknown>,
    })) as {
      structuredContent: { valid: boolean; findings: unknown[] };
      content: { type: string; text: string }[];
    };

  it('lists validate_access_model in tools', async () => {
    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name)).toContain('validate_access_model');
  });

  it('accepts a valid model', async () => {
    const res = await callTool({ snapshot: VALID_SNAPSHOT });
    expect(res.structuredContent).toEqual({ valid: true, findings: [] });
  });

  it('reports structural failures as findings', async () => {
    const res = await callTool({
      snapshot: {
        ...VALID_SNAPSHOT,
        bindings: [{ roleId: 'ghost', permissionId: 'invoice:read' }],
      },
    });
    expect(res.structuredContent.valid).toBe(false);
    expect(res.structuredContent.findings.length).toBeGreaterThan(0);
    // Safe: findings carry path+reason only, never input values.
    expect(JSON.stringify(res.structuredContent)).not.toContain('ghost');
  });

  it('rejects malformed arguments (strict schema)', async () => {
    // SDK v2 surfaces schema violations as isError results, not throws.
    for (const bad of [{ nope: 1 }, { snapshot: 'not-an-object' }]) {
      const res = await callTool(bad);
      expect((res as unknown as { isError?: boolean }).isError).toBe(true);
    }
  });

  it('returns stable output for the same input', async () => {
    const a = await callTool({ snapshot: VALID_SNAPSHOT });
    const b = await callTool({ snapshot: VALID_SNAPSHOT });
    expect(a.structuredContent).toEqual(b.structuredContent);
    expect(a.content[0].text).toBe(b.content[0].text);
  });
});

const PEPPER42 = 'e2e-pepper-42';
const SNAP42 = {
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
const VER42 = {
  id: 'ver_42',
  modelId: 'mdl_sim42',
  tenantId: 'tnt_a',
  version: 1,
  contentHash: 'sha256:abc',
  snapshot: SNAP42,
  operationCount: 0,
  createdAt: new Date(0),
};

function keyRow42(raw: string, tenantId: string, scopes: string[]) {
  return {
    id: `key_${tenantId}`,
    tenantId,
    keyPrefix: raw.slice(0, 12),
    keyDigest: digestKey(raw, PEPPER42),
    scopes,
    status: 'ACTIVE' as const,
    expiresAt: null,
    revokedAt: null,
    lastUsedAt: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
}

/**
 * Step 42 gate: success, rejected changes, missing permissions,
 * cross-tenant references, and consistency with REST.
 */
describe('simulate_permission_change (step 42)', () => {
  const RAW_A = `ppk_${'j'.repeat(40)}`;
  const RAW_B = `ppk_${'k'.repeat(40)}`;
  const RAW_NOSCOPE = `ppk_${'l'.repeat(40)}`;
  let client: Client;
  let app: INestApplication;
  const simRows: Record<string, unknown>[] = [];

  const buildModule = (scopesA: string[]) =>
    Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(API_KEY_REPOSITORY)
      .useValue({
        findByDigest: (d: string) =>
          Promise.resolve(
            [
              keyRow42(RAW_A, 'tnt_a', scopesA),
              keyRow42(RAW_B, 'tnt_b', ['simulations:run', 'simulations:read']),
              keyRow42(RAW_NOSCOPE, 'tnt_a', ['models:read']),
            ].find((k) => k.keyDigest === d) ?? null,
          ),
        listByTenant: () => Promise.resolve([]),
        create: () => Promise.reject(new Error('not used')),
        updateStatus: () => Promise.resolve(null),
        touchLastUsed: () => Promise.resolve(),
      })
      .overrideProvider(ACCESS_MODEL_REPOSITORY)
      .useValue({
        findById: (t: string, id: string) =>
          Promise.resolve(
            id === 'mdl_sim42' && t === 'tnt_a'
              ? {
                  id,
                  tenantId: t,
                  name: 'm',
                  currentVersion: 1,
                  createdAt: new Date(0),
                  updatedAt: new Date(0),
                }
              : null,
          ),
        listByTenant: () => Promise.resolve([]),
        create: () => Promise.reject(new Error('not used')),
      })
      .overrideProvider(MODEL_VERSION_REPOSITORY)
      .useValue({
        findByModelVersion: (t: string, m: string, v: number) =>
          Promise.resolve(
            t === 'tnt_a' && m === 'mdl_sim42' && v === 1 ? VER42 : null,
          ),
        listByModel: () => Promise.resolve([VER42]),
        create: () => Promise.reject(new Error('not used')),
      })
      .overrideProvider(SIMULATION_REPOSITORY)
      .useValue({
        findById: () => Promise.resolve(null),
        listByTenant: () => Promise.resolve([]),
        listByModel: () => Promise.resolve([]),
        create: (input: Record<string, unknown>) => {
          const row = { ...input, status: 'COMPLETED', createdAt: new Date(0) };
          simRows.push(row);
          return Promise.resolve(row);
        },
      })
      .overrideProvider(IDEMPOTENCY_REPOSITORY)
      .useValue({
        findByKey: () => Promise.resolve(null),
        create: (input: unknown) =>
          Promise.resolve({
            id: 'idem_1',
            ...(input as Record<string, unknown>),
          }),
        deleteExpired: () => Promise.resolve(0),
      })
      .overrideProvider('APP_CONFIG')
      .useValue({
        apiKeyPepper: PEPPER42,
        nodeEnv: 'test',
        databaseUrl: 'postgresql://localhost:5432/test',
      });

  const connect = async (scopesA: string[]) => {
    const moduleRef = await buildModule(scopesA).compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
    const server = app.get(McpService).createServer();
    const [ct, st] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'step42', version: '0.0.0' });
    await Promise.all([server.connect(st), client.connect(ct)]);
  };
  const close = async () => {
    await client.close();
    await app.close();
  };
  const callSim = (args: Record<string, unknown>) =>
    client.callTool({
      name: 'simulate_permission_change',
      arguments: args,
    }) as Promise<{
      structuredContent: Record<string, unknown>;
      isError?: boolean;
    }>;
  const GRANT = {
    modelId: 'mdl_sim42',
    operations: [
      {
        type: 'grant_permission',
        roleId: 'viewer',
        permissionId: 'invoice:refund',
      },
    ],
  };

  beforeEach(() => (simRows.length = 0));

  it('lists the tool', async () => {
    await connect(['simulations:run']);
    try {
      const tools = await client.listTools();
      expect(tools.tools.map((t) => t.name)).toContain(
        'simulate_permission_change',
      );
    } finally {
      await close();
    }
  });

  it('succeeds and persists like REST', async () => {
    await connect(['simulations:run']);
    try {
      const res = await callSim({ ...GRANT, apiKey: RAW_A });
      expect(res.isError).toBeFalsy();
      expect(res.structuredContent.status).toBe('completed');
      expect(typeof res.structuredContent.id).toBe('string');
      expect(res.structuredContent.summary).toBeDefined();
      expect(simRows.length).toBe(1);
      expect(simRows[0].tenantId).toBe('tnt_a');
    } finally {
      await close();
    }
  });

  it('rejects invalid changes with validation_failed', async () => {
    await connect(['simulations:run']);
    try {
      const res = await callSim({
        modelId: 'mdl_sim42',
        operations: [
          {
            type: 'grant_permission',
            roleId: 'nope',
            permissionId: 'invoice:read',
          },
        ],
        apiKey: RAW_A,
      });
      expect(res.isError).toBe(true);
      expect(res.structuredContent.code).toBe('validation_failed');
    } finally {
      await close();
    }
  });

  it('denies missing scope and bad keys', async () => {
    await connect(['simulations:run']);
    try {
      const noscope = await callSim({ ...GRANT, apiKey: RAW_NOSCOPE });
      expect(noscope.isError).toBe(true);
      expect(noscope.structuredContent.code).toBe('forbidden_scope');
      const bad = await callSim({ ...GRANT, apiKey: `ppk_${'z'.repeat(40)}` });
      expect(bad.isError).toBe(true);
      expect(bad.structuredContent.code).toBe('unauthorized');
    } finally {
      await close();
    }
  });

  it('denies cross-tenant model references', async () => {
    await connect(['simulations:run']);
    try {
      const res = await callSim({ ...GRANT, apiKey: RAW_B });
      expect(res.isError).toBe(true);
      expect(res.structuredContent.code).toBe('not_found');
    } finally {
      await close();
    }
  });
});

/**
 * Step 43 gate: added + removed access, unchanged access, missing
 * records, and no invented causal evidence.
 */
describe('explain_access_change (step 43)', () => {
  const RAW = `ppk_${'m'.repeat(40)}`;
  const PEPPER = 'e2e-pepper-43';
  let client: Client;
  let app: INestApplication;
  const SIM_ID = `sim_${'a'.repeat(24)}`;
  const simRow = {
    id: SIM_ID,
    tenantId: 'tnt_a',
    modelId: 'mdl_x',
    version: 1,
    versionRowId: 'ver_1',
    contentHash: 'sha256:x',
    status: 'COMPLETED',
    summary: {},
    impacts: [
      { subjectId: 'alice', added: ['invoice:refund'], removed: [] },
      { subjectId: 'bob', added: [], removed: ['invoice:read'] },
    ],
    findings: [],
    operations: [
      {
        type: 'grant_permission',
        roleId: 'viewer',
        permissionId: 'invoice:refund',
      },
    ],
    disclaimer: 'Findings are advisory only.',
    createdAt: new Date(0),
  };

  const connect = async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(API_KEY_REPOSITORY)
      .useValue({
        findByDigest: (d: string) =>
          Promise.resolve(
            d === digestKey(RAW, PEPPER)
              ? {
                  id: 'key_a',
                  tenantId: 'tnt_a',
                  keyPrefix: RAW.slice(0, 12),
                  keyDigest: d,
                  scopes: ['simulations:read'],
                  status: 'ACTIVE',
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
      })
      .overrideProvider(SIMULATION_REPOSITORY)
      .useValue({
        findById: (t: string, id: string) =>
          Promise.resolve(id === SIM_ID && t === 'tnt_a' ? simRow : null),
        listByTenant: () => Promise.resolve([]),
        listByModel: () => Promise.resolve([]),
        create: () => Promise.reject(new Error('not used')),
      })
      .overrideProvider('APP_CONFIG')
      .useValue({
        apiKeyPepper: PEPPER,
        nodeEnv: 'test',
        databaseUrl: 'postgresql://localhost:5432/test',
      })
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
    const server = app.get(McpService).createServer();
    const [ct, st] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'step43', version: '0.0.0' });
    await Promise.all([server.connect(st), client.connect(ct)]);
  };

  beforeAll(async () => {
    await connect();
  });
  afterAll(async () => {
    await client.close();
    await app.close();
  });
  const callExplain = (args: Record<string, unknown>) =>
    client.callTool({
      name: 'explain_access_change',
      arguments: args,
    }) as Promise<{
      structuredContent: Record<string, unknown>;
      isError?: boolean;
    }>;

  it('lists the tool', async () => {
    expect((await client.listTools()).tools.map((t) => t.name)).toContain(
      'explain_access_change',
    );
  });

  it('explains added access with before/after facts', async () => {
    const res = await callExplain({
      apiKey: RAW,
      simulationId: SIM_ID,
      subjectId: 'alice',
      permissionId: 'invoice:refund',
    });
    expect(res.isError).toBeFalsy();
    expect(res.structuredContent.change).toBe('added');
    expect(JSON.stringify(res.structuredContent.facts)).toContain(
      'invoice:refund',
    );
    expect(res.structuredContent.inference).toBeDefined();
  });

  it('explains removed access', async () => {
    const res = await callExplain({
      apiKey: RAW,
      simulationId: SIM_ID,
      subjectId: 'bob',
      permissionId: 'invoice:read',
    });
    expect(res.structuredContent.change).toBe('removed');
  });

  it('reports unchanged access when nothing matches', async () => {
    const res = await callExplain({
      apiKey: RAW,
      simulationId: SIM_ID,
      subjectId: 'carol',
    });
    expect(res.structuredContent.change).toBe('unchanged');
  });

  it('returns not_found for missing records, never invents evidence', async () => {
    const missing = await callExplain({
      apiKey: RAW,
      simulationId: `sim_${'z'.repeat(24)}`,
    });
    expect(missing.isError).toBe(true);
    expect(missing.structuredContent.code).toBe('not_found');
    // Unmatched cause: bob/invoice:read has no recorded grant op -> low confidence + missing evidence.
    const noCause = await callExplain({
      apiKey: RAW,
      simulationId: SIM_ID,
      subjectId: 'bob',
      permissionId: 'invoice:read',
    });
    const inf = noCause.structuredContent.inference as Record<string, unknown>;
    expect(inf.confidence).toBe('low');
    expect(inf.evidence).toBe('missing');
  });
});

/**
 * Step 44 gate: positive + negative fixtures, output limits, access
 * scopes, parity with REST risk findings.
 */
describe('find_privilege_escalation (step 44)', () => {
  const RAW = `ppk_${'n'.repeat(40)}`;
  const PEPPER = 'e2e-pepper-44';
  let client: Client;
  let app: INestApplication;
  const SIM_ID = `sim_${'b'.repeat(24)}`;
  const SNAP = {
    roles: [{ id: 'viewer', name: 'viewer' }],
    permissions: [
      { id: 'invoice:read', value: 'invoice:read' },
      { id: 'invoice:refund', value: 'invoice:refund' },
    ],
    bindings: [{ roleId: 'viewer', permissionId: 'invoice:read' }],
    inheritance: [],
    assignments: [{ subjectId: 'alice', roleId: 'viewer' }],
    subjects: [{ id: 'alice' }],
  };
  const storedFindings = [
    {
      ruleId: 'SENSITIVE_PERMISSION',
      severity: 'high',
      subjects: ['alice'],
      evidence: { permission: 'invoice:refund' },
      explanation: 'x',
    },
    {
      ruleId: 'UNEXPECTED_SUBJECT_IMPACT',
      severity: 'low',
      subjects: ['alice'],
      evidence: {},
      explanation: 'noise',
    },
  ];
  const simRow = {
    id: SIM_ID,
    tenantId: 'tnt_a',
    modelId: 'mdl_x',
    version: 1,
    versionRowId: 'ver_1',
    contentHash: 'sha256:x',
    status: 'COMPLETED',
    summary: {},
    impacts: [],
    findings: storedFindings,
    operations: [],
    disclaimer: 'advisory',
    createdAt: new Date(0),
  };

  const connect = async (scopes: string[]) => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(API_KEY_REPOSITORY)
      .useValue({
        findByDigest: (d: string) =>
          Promise.resolve(
            d === digestKey(RAW, PEPPER)
              ? {
                  id: 'key_a',
                  tenantId: 'tnt_a',
                  keyPrefix: RAW.slice(0, 12),
                  keyDigest: d,
                  scopes,
                  status: 'ACTIVE',
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
      })
      .overrideProvider(SIMULATION_REPOSITORY)
      .useValue({
        findById: (t: string, id: string) =>
          Promise.resolve(id === SIM_ID && t === 'tnt_a' ? simRow : null),
        listByTenant: () => Promise.resolve([]),
        listByModel: () => Promise.resolve([]),
        create: () => Promise.reject(new Error('not used')),
      })
      .overrideProvider('APP_CONFIG')
      .useValue({
        apiKeyPepper: PEPPER,
        nodeEnv: 'test',
        databaseUrl: 'postgresql://localhost:5432/test',
      })
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
    const server = app.get(McpService).createServer();
    const [ct, st] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'step44', version: '0.0.0' });
    await Promise.all([server.connect(st), client.connect(ct)]);
  };
  const close = async () => {
    await client.close();
    await app.close();
  };
  const callFind = (args: Record<string, unknown>) =>
    client.callTool({
      name: 'find_privilege_escalation',
      arguments: args,
    }) as Promise<{
      structuredContent: Record<string, unknown>;
      isError?: boolean;
    }>;
  const GRANT_REFUND = [
    {
      type: 'grant_permission',
      roleId: 'viewer',
      permissionId: 'invoice:refund',
    },
  ];

  it('lists the tool', async () => {
    await connect(['simulations:read']);
    try {
      expect((await client.listTools()).tools.map((t) => t.name)).toContain(
        'find_privilege_escalation',
      );
    } finally {
      await close();
    }
  });

  it('flags sensitive grants (positive) but not plain reads (negative)', async () => {
    await connect(['simulations:read']);
    try {
      const pos = await callFind({
        apiKey: RAW,
        snapshot: SNAP,
        operations: GRANT_REFUND,
      });
      expect(pos.isError).toBeFalsy();
      const hits = pos.structuredContent.findings as Record<string, unknown>[];
      expect(hits.length).toBeGreaterThan(0);
      expect(hits[0]).toHaveProperty('ruleId');
      expect(hits[0]).toHaveProperty('severity');
      expect(hits[0]).toHaveProperty('evidence');
      // Negative: granting a non-sensitive permission flags nothing sensitive.
      const neg = await callFind({
        apiKey: RAW,
        snapshot: SNAP,
        operations: [
          {
            type: 'grant_permission',
            roleId: 'viewer',
            permissionId: 'invoice:read',
          },
        ],
      });
      const negHits = neg.structuredContent.findings as Record<
        string,
        unknown
      >[];
      expect(
        negHits.filter((h) => h.ruleId === 'SENSITIVE_PERMISSION'),
      ).toEqual([]);
    } finally {
      await close();
    }
  });

  it('bounds output with limit', async () => {
    await connect(['simulations:read']);
    try {
      const res = await callFind({
        apiKey: RAW,
        snapshot: SNAP,
        operations: GRANT_REFUND,
        limit: 1,
      });
      expect(
        (res.structuredContent.findings as unknown[]).length,
      ).toBeLessThanOrEqual(1);
    } finally {
      await close();
    }
  });

  it('matches REST persisted findings (parity) and enforces scope', async () => {
    await connect(['simulations:read']);
    try {
      const res = await callFind({ apiKey: RAW, simulationId: SIM_ID });
      expect(res.isError).toBeFalsy();
      // Parity: stored SENSITIVE_PERMISSION kept, noise rule filtered out.
      expect(res.structuredContent.findings).toEqual([
        {
          ruleId: 'SENSITIVE_PERMISSION',
          severity: 'high',
          subjects: ['alice'],
          evidence: { permission: 'invoice:refund' },
        },
      ]);
    } finally {
      await close();
    }
    await connect(['models:read']);
    try {
      const denied = await callFind({ apiKey: RAW, simulationId: SIM_ID });
      expect(denied.isError).toBe(true);
      expect(denied.structuredContent.code).toBe('forbidden_scope');
    } finally {
      await close();
    }
  });
});

/**
 * Step 45 gate: model differences, effective access changes, identical
 * models, invalid versions, cross-tenant denial.
 */
describe('compare_access_models (step 45)', () => {
  const RAW = `ppk_${'o'.repeat(40)}`;
  const PEPPER = 'e2e-pepper-45';
  let client: Client;
  let app: INestApplication;
  const V1 = {
    roles: [{ id: 'viewer', name: 'viewer' }],
    permissions: [{ id: 'invoice:read', value: 'invoice:read' }],
    bindings: [{ roleId: 'viewer', permissionId: 'invoice:read' }],
    inheritance: [],
    assignments: [{ subjectId: 'alice', roleId: 'viewer' }],
    subjects: [{ id: 'alice' }],
  };
  const V2 = {
    ...V1,
    permissions: [
      ...V1.permissions,
      { id: 'invoice:refund', value: 'invoice:refund' },
    ],
    bindings: [
      ...V1.bindings,
      { roleId: 'viewer', permissionId: 'invoice:refund' },
    ],
  };
  const rows: Record<string, Record<string, unknown>> = {
    'tnt_a|mdl_cmp|1': {
      id: 'ver_1',
      modelId: 'mdl_cmp',
      tenantId: 'tnt_a',
      version: 1,
      contentHash: 'h1',
      snapshot: V1,
      operationCount: 0,
      createdAt: new Date(0),
    },
    'tnt_a|mdl_cmp|2': {
      id: 'ver_2',
      modelId: 'mdl_cmp',
      tenantId: 'tnt_a',
      version: 2,
      contentHash: 'h2',
      snapshot: V2,
      operationCount: 0,
      createdAt: new Date(0),
    },
  };

  const connect = async (tenant: string, scopes: string[]) => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(API_KEY_REPOSITORY)
      .useValue({
        findByDigest: (d: string) =>
          Promise.resolve(
            d === digestKey(RAW, PEPPER)
              ? {
                  id: 'key_x',
                  tenantId: tenant,
                  keyPrefix: RAW.slice(0, 12),
                  keyDigest: d,
                  scopes,
                  status: 'ACTIVE',
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
      })
      .overrideProvider(ACCESS_MODEL_REPOSITORY)
      .useValue({
        findById: (t: string, id: string) =>
          Promise.resolve(
            id === 'mdl_cmp' && t === 'tnt_a'
              ? {
                  id,
                  tenantId: t,
                  name: 'm',
                  currentVersion: 2,
                  createdAt: new Date(0),
                  updatedAt: new Date(0),
                }
              : null,
          ),
        listByTenant: () => Promise.resolve([]),
        create: () => Promise.reject(new Error('not used')),
      })
      .overrideProvider(MODEL_VERSION_REPOSITORY)
      .useValue({
        findByModelVersion: (t: string, m: string, v: number) =>
          Promise.resolve(rows[`${t}|${m}|${v}`] ?? null),
        listByModel: () => Promise.resolve([]),
        create: () => Promise.reject(new Error('not used')),
      })
      .overrideProvider('APP_CONFIG')
      .useValue({
        apiKeyPepper: PEPPER,
        nodeEnv: 'test',
        databaseUrl: 'postgresql://localhost:5432/test',
      })
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
    const server = app.get(McpService).createServer();
    const [ct, st] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'step45', version: '0.0.0' });
    await Promise.all([server.connect(st), client.connect(ct)]);
  };
  const close = async () => {
    await client.close();
    await app.close();
  };
  const callCmp = (args: Record<string, unknown>) =>
    client.callTool({
      name: 'compare_access_models',
      arguments: args,
    }) as Promise<{
      structuredContent: Record<string, unknown>;
      isError?: boolean;
    }>;
  const BASE = {
    apiKey: RAW,
    modelId: 'mdl_cmp',
    fromVersion: 1,
    toVersion: 2,
  };

  it('lists the tool', async () => {
    await connect('tnt_a', ['models:read']);
    try {
      expect((await client.listTools()).tools.map((t) => t.name)).toContain(
        'compare_access_models',
      );
    } finally {
      await close();
    }
  });

  it('reports model differences + effective access changes', async () => {
    await connect('tnt_a', ['models:read']);
    try {
      const res = await callCmp({ ...BASE, includeEffectiveAccess: true });
      expect(res.isError).toBeFalsy();
      const d = res.structuredContent.differences as Record<string, string[]>;
      expect(d.addedPermissions).toContain('invoice:refund');
      expect(d.addedBindings).toContain('viewer|invoice:refund');
      const eff = res.structuredContent.effectiveAccess as {
        subjectId: string;
        added: string[];
      }[];
      expect(eff.find((e) => e.subjectId === 'alice')?.added).toContain(
        'invoice:refund',
      );
    } finally {
      await close();
    }
  });

  it('returns empty diffs for identical models', async () => {
    await connect('tnt_a', ['models:read']);
    try {
      const res = await callCmp({
        ...BASE,
        fromVersion: 1,
        toVersion: 1,
        includeEffectiveAccess: true,
      });
      expect(res.isError).toBeFalsy();
      expect(
        Object.values(
          res.structuredContent.differences as Record<string, string[]>,
        ).every((v) => v.length === 0),
      ).toBe(true);
      expect(res.structuredContent.effectiveAccess).toEqual([]);
    } finally {
      await close();
    }
  });

  it('rejects invalid versions and denies cross-tenant access', async () => {
    await connect('tnt_a', ['models:read']);
    try {
      const bad = await callCmp({ ...BASE, toVersion: 99 });
      expect(bad.isError).toBe(true);
      expect(bad.structuredContent.code).toBe('not_found');
    } finally {
      await close();
    }
    await connect('tnt_b', ['models:read']);
    try {
      const denied = await callCmp(BASE);
      expect(denied.isError).toBe(true);
      expect(denied.structuredContent.code).toBe('not_found');
    } finally {
      await close();
    }
  });
});
