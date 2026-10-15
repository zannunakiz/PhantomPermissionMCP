/**
 * Local development seed.
 *
 * Every value here is clearly fictional (`demo` prefix) and safe to
 * commit: no real tenants, no real credentials. The demo API-key row
 * carries a `DUMMY-DO-NOT-USE` digest that can never authenticate —
 * real keys are issued by the provisioning flow with HMAC digests.
 *
 * Idempotent: every write is an upsert by primary key (or unique
 * constraint), so re-running the script never duplicates rows.
 *
 * Usage:
 *   npm run db:seed            # seed the DATABASE_URL database
 *   npm run db:reset           # migrate reset + reseed (destructive)
 */
import { createHash } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';

const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://phantom:phantom@localhost:5432/phantom_permission_dev';

function sha256Hex(canonicalJson: string): string {
  return `sha256:${createHash('sha256').update(canonicalJson).digest('hex')}`;
}

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: DATABASE_URL });
  const db = new PrismaClient({ adapter: new PrismaPg(pool) });
  try {
    await db.tenant.upsert({
      where: { name: 'Acme Demo' },
      update: { id: 'tnt_demo_acme' },
      create: {
        id: 'tnt_demo_acme',
        name: 'Acme Demo',
      },
    });

    // Demo key: placeholder digest only — never usable for auth.
    await db.apiKey.upsert({
      where: { keyDigest: 'DUMMY-DO-NOT-USE' },
      update: { status: 'ACTIVE' },
      create: {
        id: 'key_demo_row',
        tenantId: 'tnt_demo_acme',
        keyPrefix: 'ppk_demo0000',
        keyDigest: 'DUMMY-DO-NOT-USE',
        scopes: ['models:read', 'simulations:read'],
        status: 'ACTIVE',
      },
    });

    await db.accessModel.upsert({
      where: {
        tenantId_name: { tenantId: 'tnt_demo_acme', name: 'billing-demo' },
      },
      update: { id: 'mdl_demo_billing', currentVersion: 1 },
      create: {
        id: 'mdl_demo_billing',
        tenantId: 'tnt_demo_acme',
        name: 'billing-demo',
        currentVersion: 1,
      },
    });

    const snapshot = {
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
      inheritance: [{ childRoleId: 'admin', parentRoleId: 'viewer' }],
      assignments: [
        { subjectId: 'demo-alice', roleId: 'viewer' },
        { subjectId: 'demo-bob', roleId: 'admin' },
      ],
      subjects: [{ id: 'demo-alice' }, { id: 'demo-bob' }],
    };
    const canonical = JSON.stringify(snapshot);
    await db.modelVersion.upsert({
      where: {
        modelId_version: { modelId: 'mdl_demo_billing', version: 1 },
      },
      update: {
        contentHash: sha256Hex(canonical),
        snapshot: snapshot as never,
        operationCount: 0,
      },
      create: {
        id: 'mdlver_demo_billing_v1',
        modelId: 'mdl_demo_billing',
        tenantId: 'tnt_demo_acme',
        version: 1,
        contentHash: sha256Hex(canonical),
        snapshot: snapshot as never,
        operationCount: 0,
      },
    });

    await db.simulation.upsert({
      where: { id: 'sim_demo_grant' },
      update: {},
      create: {
        id: 'sim_demo_grant',
        tenantId: 'tnt_demo_acme',
        modelId: 'mdl_demo_billing',
        version: 1,
        versionRowId: 'mdlver_demo_billing_v1',
        contentHash: sha256Hex(canonical),
        operations: [
          {
            type: 'grant_permission',
            roleId: 'viewer',
            permissionId: 'invoice:refund',
          },
        ] as never,
        status: 'COMPLETED',
        summary: {
          addedCount: 1,
          removedCount: 0,
          affectedSubjectCount: 1,
          findingCounts: { critical: 0, high: 1, medium: 0, low: 0 },
        } as never,
        impacts: [
          {
            subjectId: 'demo-alice',
            added: ['invoice:refund'],
            removed: [],
          },
        ] as never,
        findings: [
          {
            ruleId: 'SENSITIVE_PERMISSION',
            severity: 'high',
            subjects: ['demo-alice'],
            evidence: { permission: 'invoice:refund' },
            explanation: 'Candidate review: sensitive permission granted.',
          },
        ] as never,
        disclaimer: 'Findings are advisory only.',
      },
    });

    await db.auditEvent.upsert({
      where: { id: 'evt_demo_model_created' },
      update: {},
      create: {
        id: 'evt_demo_model_created',
        tenantId: 'tnt_demo_acme',
        type: 'MODEL_CREATED',
        actorKeyPrefix: 'ppk_demo0000',
        resourceType: 'access-model',
        resourceId: 'mdl_demo_billing',
        metadata: { name: 'billing-demo', version: 1 } as never,
      },
    });

    console.log('seed: ok (tnt_demo_acme, billing-demo v1, sim_demo_grant)');
  } finally {
    await db.$disconnect();
    await pool.end();
  }
}

void main().catch((error: unknown) => {
  console.error(`seed: failed (${(error as Error).message})`);
  process.exit(1);
});
