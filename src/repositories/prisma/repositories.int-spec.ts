/**
 * Adapter integration tests: ports against the real PostgreSQL.
 *
 * Run explicitly — never part of the default hermetic unit suite:
 *   DATABASE_URL=postgresql://phantom:phantom@localhost:5432/phantom_permission_test \
 *     npm run test:integration
 *
 * The Jest global setup (`scripts/integration-test-db.js`) refuses any
 * non-local / non-test / production configuration, applies migrations, then
 * truncates all tables — so runs always start clean and are repeatable.
 *
 * Every case uses `repo-int-*` ids and deletes its rows afterwards, so
 * the suite is safe to re-run against a dev database. Requires the
 * Docker database from the local-database guide.
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaAccessModelRepository } from './prisma-access-model.repository';
import { PrismaApiKeyRepository } from './prisma-api-key.repository';
import { PrismaAuditRepository } from './prisma-audit.repository';
import { PrismaIdempotencyRepository } from './prisma-idempotency.repository';
import { PrismaModelVersionRepository } from './prisma-model-version.repository';
import { PrismaSimulationRepository } from './prisma-simulation.repository';
import { PrismaTenantRepository } from './prisma-tenant.repository';
import type { PrismaService } from '../../persistence';

const TENANT = 'tnt_repo_int_a';
const OTHER_TENANT = 'tnt_repo_int_b';

describe('Prisma repository adapters (integration)', () => {
  let pool: Pool;
  let client: PrismaClient;
  let db: PrismaService;
  let tenants: PrismaTenantRepository;
  let keys: PrismaApiKeyRepository;
  let models: PrismaAccessModelRepository;
  let versions: PrismaModelVersionRepository;
  let simulations: PrismaSimulationRepository;
  let idempotency: PrismaIdempotencyRepository;
  let audit: PrismaAuditRepository;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    client = new PrismaClient({ adapter: new PrismaPg(pool) });
    await client.$connect();
    db = client as unknown as PrismaService;
    tenants = new PrismaTenantRepository(db);
    keys = new PrismaApiKeyRepository(db);
    models = new PrismaAccessModelRepository(db);
    versions = new PrismaModelVersionRepository(db);
    simulations = new PrismaSimulationRepository(db);
    idempotency = new PrismaIdempotencyRepository(db);
    audit = new PrismaAuditRepository(db);
    await db.tenant.upsert({
      where: { name: 'Repo Int A' },
      update: { id: TENANT },
      create: { id: TENANT, name: 'Repo Int A' },
    });
    await db.tenant.upsert({
      where: { name: 'Repo Int B' },
      update: { id: OTHER_TENANT },
      create: { id: OTHER_TENANT, name: 'Repo Int B' },
    });
  });

  afterAll(async () => {
    await client.simulation.deleteMany({
      where: { tenantId: { in: [TENANT, OTHER_TENANT] } },
    });
    await client.modelVersion.deleteMany({
      where: { tenantId: { in: [TENANT, OTHER_TENANT] } },
    });
    await client.accessModel.deleteMany({
      where: { tenantId: { in: [TENANT, OTHER_TENANT] } },
    });
    await client.apiKey.deleteMany({
      where: { tenantId: { in: [TENANT, OTHER_TENANT] } },
    });
    await client.idempotencyRecord.deleteMany({
      where: { tenantId: { in: [TENANT, OTHER_TENANT] } },
    });
    await client.auditEvent.deleteMany({
      where: { tenantId: { in: [TENANT, OTHER_TENANT] } },
    });
    await client.tenant.deleteMany({
      where: { id: { in: [TENANT, OTHER_TENANT] } },
    });
    await client.$disconnect();
    await pool.end();
  });

  it('round-trips a tenant by id and name', async () => {
    const byId = await tenants.findById(TENANT);
    const byName = await tenants.findByName('Repo Int A');
    expect(byId?.id).toBe(TENANT);
    expect(byName?.id).toBe(TENANT);
  });

  it('stores and resolves an API-key digest, then revokes it', async () => {
    await keys.create({
      id: 'key_repo_int_1',
      tenantId: TENANT,
      keyPrefix: 'ppk_repo0001',
      keyDigest: 'DIGEST-repo-int-1',
      scopes: ['models:read'],
    });
    const found = await keys.findByDigest('DIGEST-repo-int-1');
    expect(found?.tenantId).toBe(TENANT);
    expect(found?.scopes).toEqual(['models:read']);
    const revoked = await keys.updateStatus(
      TENANT,
      'key_repo_int_1',
      'REVOKED',
    );
    expect(revoked?.status).toBe('REVOKED');
    expect(revoked?.revokedAt).toBeInstanceOf(Date);
    await keys.touchLastUsed(TENANT, 'key_repo_int_1');
    const listed = await keys.listByTenant(TENANT);
    expect(listed.map((k) => k.id)).toContain('key_repo_int_1');
    // Cross-tenant revoke is a no-op (returns null), never touches the row.
    await expect(
      keys.updateStatus(OTHER_TENANT, 'key_repo_int_1', 'ACTIVE'),
    ).resolves.toBeNull();
  });

  it('creates a model and rejects duplicate names in the tenant', async () => {
    await models.create({
      id: 'mdl_repo_int_1',
      tenantId: TENANT,
      name: 'repo-int-model',
    });
    const found = await models.findById(TENANT, 'mdl_repo_int_1');
    expect(found?.currentVersion).toBe(1);
    expect(await models.findById(OTHER_TENANT, 'mdl_repo_int_1')).toBeNull();
    await expect(
      models.create({
        id: 'mdl_repo_int_dup',
        tenantId: TENANT,
        name: 'repo-int-model',
      }),
    ).rejects.toThrow();
  });

  it('appends versions transactionally and advances the model', async () => {
    const snapshot = { roles: [], permissions: [] };
    await versions.create({
      id: 'mdlver_repo_int_1',
      modelId: 'mdl_repo_int_1',
      tenantId: TENANT,
      version: 1,
      contentHash: `sha256:${'e'.repeat(64)}`,
      snapshot,
    });
    const read = await versions.findByModelVersion(TENANT, 'mdl_repo_int_1', 1);
    expect(read?.contentHash).toBe(`sha256:${'e'.repeat(64)}`);
    const parent = await models.findById(TENANT, 'mdl_repo_int_1');
    expect(parent?.currentVersion).toBe(1);
    // Racing the same version number collides on the unique backstop.
    await expect(
      versions.create({
        id: 'mdlver_repo_int_dup',
        modelId: 'mdl_repo_int_1',
        tenantId: TENANT,
        version: 1,
        contentHash: `sha256:${'f'.repeat(64)}`,
        snapshot,
      }),
    ).rejects.toThrow();
  });

  it('persists a simulation with its report payloads', async () => {
    const created = await simulations.create({
      id: 'sim_repo_int_1',
      tenantId: TENANT,
      modelId: 'mdl_repo_int_1',
      version: 1,
      versionRowId: 'mdlver_repo_int_1',
      contentHash: `sha256:${'e'.repeat(64)}`,
      operations: [{ type: 'grant_permission' }],
      summary: { addedCount: 1 },
      impacts: [{ subjectId: 'u1', added: ['p'], removed: [] }],
      findings: [],
      disclaimer: 'Findings are advisory only.',
    });
    expect(created.status).toBe('COMPLETED');
    const read = await simulations.findById(TENANT, 'sim_repo_int_1');
    expect((read?.impacts as Array<{ subjectId: string }>)[0].subjectId).toBe(
      'u1',
    );
    expect(
      await simulations.findById(OTHER_TENANT, 'sim_repo_int_1'),
    ).toBeNull();
  });

  it('replays and conflicts on idempotency keys', async () => {
    const endpoint = 'POST /api/v1/simulations';
    await idempotency.create({
      id: 'idem_repo_int_1',
      tenantId: TENANT,
      endpoint,
      idempotencyKey: 'repo-int-key',
      requestHash: `sha256:${'a'.repeat(64)}`,
      statusCode: 201,
      responseBody: { id: 'sim_repo_int_1' },
      expiresAt: new Date(Date.now() + 3_600_000),
    });
    const replay = await idempotency.findByKey(
      TENANT,
      endpoint,
      'repo-int-key',
    );
    expect(replay?.statusCode).toBe(201);
    // Same key, second insert → unique violation for the use case to
    // translate into replay-or-conflict via requestHash comparison.
    await expect(
      idempotency.create({
        id: 'idem_repo_int_2',
        tenantId: TENANT,
        endpoint,
        idempotencyKey: 'repo-int-key',
        requestHash: `sha256:${'b'.repeat(64)}`,
        statusCode: 201,
        responseBody: {},
        expiresAt: new Date(Date.now() + 3_600_000),
      }),
    ).rejects.toThrow();
    await idempotency.create({
      id: 'idem_repo_int_expired',
      tenantId: TENANT,
      endpoint,
      idempotencyKey: 'repo-int-old',
      requestHash: 'x',
      statusCode: 201,
      responseBody: {},
      expiresAt: new Date(Date.now() - 1_000),
    });
    await expect(idempotency.deleteExpired()).resolves.toBeGreaterThanOrEqual(
      1,
    );
  });

  it('appends audit events newest-first', async () => {
    await audit.append({
      id: 'evt_repo_int_1',
      tenantId: TENANT,
      type: 'MODEL_CREATED',
      actorKeyPrefix: 'ppk_repo0001',
      resourceType: 'access-model',
      resourceId: 'mdl_repo_int_1',
      metadata: { name: 'repo-int-model' },
    });
    await audit.append({
      id: 'evt_repo_int_2',
      tenantId: TENANT,
      type: 'SIMULATION_CREATED',
      actorKeyPrefix: 'ppk_repo0001',
      resourceType: 'simulation',
      resourceId: 'sim_repo_int_1',
      metadata: { status: 'COMPLETED' },
    });
    const listed = await audit.listByTenant(TENANT);
    expect(listed.map((e) => e.id)).toEqual([
      'evt_repo_int_2',
      'evt_repo_int_1',
    ]);
    const filtered = await audit.listByTenant(TENANT, {
      type: 'MODEL_CREATED',
    });
    expect(filtered.map((e) => e.id)).toEqual(['evt_repo_int_1']);
    const trail = await audit.listByResource(
      TENANT,
      'simulation',
      'sim_repo_int_1',
    );
    expect(trail.map((e) => e.id)).toEqual(['evt_repo_int_2']);
  });
});
