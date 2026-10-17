/**
 * Step 56 — reusable, deterministic, synthetic test fixtures.
 *
 * Factories/builders shared by unit and e2e specs:
 * - tenants, API keys, access-model/version/simulation/audit records
 * - access-model snapshots: basic, deep inheritance, cycles, overlapping
 *   roles, large impact sets, high-risk permissions
 * - change-operation builders and adversarial/malicious input bodies
 *
 * Rules:
 * - Deterministic: no `Date.now()`, no randomness. Every builder either
 *   takes explicit values or uses fixed epoch dates and stable counters
 *   seeded per call site.
 * - Synthetic: all ids/keys are obviously fake (`ppk_` + repeated chars,
 *   `tnt_…`, `evt_…`); no real user data or secrets.
 * - Plain data only: fixtures are literal objects cast to the domain
 *   record types so they stay transport/ORM agnostic.
 */
import { digestKey } from '../../src/auth/api-key';
import type {
  AccessModelRecord,
  ApiKeyRecord,
  ApiKeyStatus,
  AuditEventRecord,
  ModelVersionRecord,
  SimulationRecord,
  TenantRecord,
} from '../../src/repositories/records';

/** Fixed pepper for deterministic key digests in tests. Never a real secret. */
export const TEST_PEPPER = 'e2e-pepper-fixtures';

const EPOCH = new Date(0);

/* ------------------------------------------------------------------ */
/* Tenants, keys, audit events                                         */
/* ------------------------------------------------------------------ */

export function makeTenant(
  suffix = '1',
  overrides: Partial<TenantRecord> = {},
): TenantRecord {
  return {
    id: `tnt_${suffix}`,
    name: `Tenant ${suffix}`,
    createdAt: EPOCH,
    updatedAt: EPOCH,
    ...overrides,
  };
}

export type ApiKeyFixtureInput = {
  readonly raw?: string;
  readonly tenantId?: string;
  readonly scopes?: readonly string[];
  readonly status?: ApiKeyStatus;
  readonly expiresAt?: Date | null;
  readonly pepper?: string;
};

export type ApiKeyFixture = {
  readonly raw: string;
  readonly record: ApiKeyRecord;
};

/**
 * Builds a matching raw key + stored record (digest only, never the raw
 * key in the record). Default raw key is a synthetic `ppk_` + 40 `a`s.
 */
export function makeApiKey(input: ApiKeyFixtureInput = {}): ApiKeyFixture {
  const raw = input.raw ?? `ppk_${'a'.repeat(40)}`;
  const tenantId = input.tenantId ?? 'tnt_a';
  const status = input.status ?? 'ACTIVE';
  return {
    raw,
    record: {
      id: `key_${tenantId}_${status.toLowerCase()}`,
      tenantId,
      keyPrefix: raw.slice(0, 12),
      keyDigest: digestKey(raw, input.pepper ?? TEST_PEPPER),
      scopes: [...(input.scopes ?? ['models:read', 'models:write'])],
      status,
      expiresAt: input.expiresAt ?? null,
      revokedAt: status === 'REVOKED' ? EPOCH : null,
      lastUsedAt: null,
      createdAt: EPOCH,
      updatedAt: EPOCH,
    },
  };
}

/** Raw key that is expired relative to `now` (deterministic given `now`). */
export function makeExpiredKey(
  now: number,
  tenantId = 'tnt_a',
  scopes: readonly string[] = ['models:read'],
): ApiKeyFixture {
  return makeApiKey({
    raw: `ppk_${'x'.repeat(40)}`,
    tenantId,
    scopes,
    expiresAt: new Date(now - 1000),
  });
}

export function makeAuditEvent(
  overrides: Partial<AuditEventRecord> = {},
): AuditEventRecord {
  return {
    id: 'evt_0000000000000000000000000001',
    tenantId: 'tnt_a',
    type: 'MODEL_CREATED',
    actorKeyPrefix: `ppk_${'a'.repeat(8)}`,
    resourceType: 'access_model',
    resourceId: 'mdl_1',
    metadata: {},
    createdAt: EPOCH,
    ...overrides,
  };
}

/* ------------------------------------------------------------------ */
/* Model / version / simulation records                                */
/* ------------------------------------------------------------------ */

export function makeModelRecord(
  overrides: Partial<AccessModelRecord> = {},
): AccessModelRecord {
  return {
    id: 'mdl_1',
    tenantId: 'tnt_a',
    name: 'model-1',
    currentVersion: 1,
    createdAt: EPOCH,
    updatedAt: EPOCH,
    ...overrides,
  };
}

export function makeVersionRecord(
  overrides: Partial<ModelVersionRecord> = {},
): ModelVersionRecord {
  return {
    id: 'mdlver_1',
    modelId: 'mdl_1',
    tenantId: 'tnt_a',
    version: 1,
    contentHash: `sha256:${'0'.repeat(64)}`,
    snapshot: {},
    operationCount: 0,
    createdAt: EPOCH,
    ...overrides,
  };
}

export function makeSimulationRecord(
  overrides: Partial<SimulationRecord> = {},
): SimulationRecord {
  return {
    id: 'sim_1',
    tenantId: 'tnt_a',
    modelId: 'mdl_1',
    version: 1,
    versionRowId: 'mdlver_1',
    contentHash: `sha256:${'0'.repeat(64)}`,
    operations: [],
    status: 'COMPLETED',
    summary: {},
    impacts: [],
    findings: [],
    disclaimer: 'Findings are advisory only.',
    createdAt: EPOCH,
    ...overrides,
  };
}

/* ------------------------------------------------------------------ */
/* Access-model snapshots and role graphs                              */
/* ------------------------------------------------------------------ */

/** Minimal valid snapshot: viewer→invoice:read, admin→invoice:refund. */
export function makeSnapshot() {
  return {
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
    inheritance: [] as {
      childRoleId: string;
      parentRoleId: string;
    }[],
    assignments: [{ subjectId: 'alice', roleId: 'viewer' }],
    subjects: [{ id: 'alice' }],
  };
}

/**
 * Linear inheritance chain of `depth` edges: role_0 → role_1 → … → role_depth
 * (child inherits parent). Subject sits on the deepest child. `depth` must
 * be ≥ 1; the schema limit is 25 (`DOMAIN_LIMITS.maxInheritanceDepth`).
 */
export function makeDeepInheritanceSnapshot(depth: number) {
  const roles = Array.from({ length: depth + 1 }, (_, i) => ({
    id: `role_${i}`,
    name: `role_${i}`,
  }));
  const inheritance = Array.from({ length: depth }, (_, i) => ({
    childRoleId: `role_${i}`,
    parentRoleId: `role_${i + 1}`,
  }));
  return {
    roles,
    permissions: [{ id: 'perm:deep', value: 'perm:deep' }],
    bindings: [{ roleId: `role_${depth}`, permissionId: 'perm:deep' }],
    inheritance,
    assignments: [{ subjectId: 'alice', roleId: 'role_0' }],
    subjects: [{ id: 'alice' }],
  };
}

/**
 * Cyclic inheritance: a → b → c → a. Must always fail cycle detection —
 * used to prove structural safeguards, never accepted as a valid model.
 */
export function makeCyclicInheritanceSnapshot() {
  return {
    roles: [
      { id: 'a', name: 'a' },
      { id: 'b', name: 'b' },
      { id: 'c', name: 'c' },
    ],
    permissions: [{ id: 'perm:cycle', value: 'perm:cycle' }],
    bindings: [{ roleId: 'a', permissionId: 'perm:cycle' }],
    inheritance: [
      { childRoleId: 'a', parentRoleId: 'b' },
      { childRoleId: 'b', parentRoleId: 'c' },
      { childRoleId: 'c', parentRoleId: 'a' },
    ],
    assignments: [{ subjectId: 'alice', roleId: 'a' }],
    subjects: [{ id: 'alice' }],
  };
}

/**
 * Overlapping roles: one subject holds two roles that both grant the same
 * permission, plus a diamond inheritance (d → e, d → f, e → g, f → g)
 * so deduplication paths are exercised.
 */
export function makeOverlappingRolesSnapshot() {
  return {
    roles: [
      { id: 'billing', name: 'billing' },
      { id: 'support', name: 'support' },
      { id: 'd', name: 'd' },
      { id: 'e', name: 'e' },
      { id: 'f', name: 'f' },
      { id: 'g', name: 'g' },
    ],
    permissions: [{ id: 'invoice:read', value: 'invoice:read' }],
    bindings: [
      { roleId: 'billing', permissionId: 'invoice:read' },
      { roleId: 'support', permissionId: 'invoice:read' },
      { roleId: 'g', permissionId: 'invoice:read' },
    ],
    inheritance: [
      { childRoleId: 'd', parentRoleId: 'e' },
      { childRoleId: 'd', parentRoleId: 'f' },
      { childRoleId: 'e', parentRoleId: 'g' },
      { childRoleId: 'f', parentRoleId: 'g' },
    ],
    assignments: [
      { subjectId: 'alice', roleId: 'billing' },
      { subjectId: 'alice', roleId: 'support' },
      { subjectId: 'alice', roleId: 'd' },
    ],
    subjects: [{ id: 'alice' }],
  };
}

/**
 * Large impact set: `subjectCount` subjects (deterministic ids
 * `user_000…`) all assigned to `role_0`, which gains a sensitive
 * permission via the simulation operations. Keeps counts within
 * DOMAIN_LIMITS (subjects ≤ 5000, assignments ≤ 10000).
 */
export function makeLargeImpactSnapshot(subjectCount: number) {
  const subjects = Array.from({ length: subjectCount }, (_, i) => ({
    id: `user_${String(i).padStart(4, '0')}`,
  }));
  return {
    roles: [{ id: 'role_0', name: 'role_0' }],
    permissions: [
      { id: 'invoice:read', value: 'invoice:read' },
      { id: 'invoice:refund', value: 'invoice:refund' },
    ],
    bindings: [{ roleId: 'role_0', permissionId: 'invoice:read' }],
    inheritance: [],
    assignments: subjects.map((s) => ({
      subjectId: s.id,
      roleId: 'role_0',
    })),
    subjects,
  };
}

/**
 * High-risk permission surface: a role that ends up with several of the
 * engine's sensitive permissions (`invoice:refund`, `user:delete`,
 * `role:assign`) so risk findings (broad access / sensitive grants)
 * trigger deterministically.
 */
export function makeHighRiskSnapshot() {
  return {
    roles: [
      { id: 'ops', name: 'ops' },
      { id: 'auditor', name: 'auditor' },
    ],
    permissions: [
      { id: 'invoice:read', value: 'invoice:read' },
      { id: 'invoice:refund', value: 'invoice:refund' },
      { id: 'user:delete', value: 'user:delete' },
      { id: 'role:assign', value: 'role:assign' },
    ],
    bindings: [
      { roleId: 'ops', permissionId: 'invoice:read' },
      { roleId: 'auditor', permissionId: 'invoice:read' },
    ],
    inheritance: [],
    assignments: [
      { subjectId: 'alice', roleId: 'ops' },
      { subjectId: 'bob', roleId: 'auditor' },
    ],
    subjects: [{ id: 'alice' }, { id: 'bob' }],
  };
}

/* ------------------------------------------------------------------ */
/* Change operations                                                   */
/* ------------------------------------------------------------------ */

export const grantOp = (roleId: string, permissionId: string) =>
  ({ type: 'grant_permission', roleId, permissionId }) as const;

export const revokeOp = (roleId: string, permissionId: string) =>
  ({ type: 'revoke_permission', roleId, permissionId }) as const;

export const assignRoleOp = (subjectId: string, roleId: string) =>
  ({ type: 'assign_role', subjectId, roleId }) as const;

export const unassignRoleOp = (subjectId: string, roleId: string) =>
  ({ type: 'unassign_role', subjectId, roleId }) as const;

/** Sensitive grant used by risk-rule fixtures (triggers findings). */
export const highRiskGrantOps = () =>
  [
    grantOp('ops', 'invoice:refund'),
    grantOp('ops', 'user:delete'),
    grantOp('ops', 'role:assign'),
  ] as const;

/* ------------------------------------------------------------------ */
/* Adversarial / malicious input fixtures                              */
/* ------------------------------------------------------------------ */

/**
 * Malicious strings that must never be echoed back in error envelopes
 * and must never break parsing. Deterministic and synthetic.
 */
export const MALICIOUS_STRINGS = {
  protoPollution: '__proto__',
  constructorProbe: 'constructor',
  xss: '<script>alert("xss")</script>',
  sqlInjection: "'; DROP TABLE tenants; --",
  pathTraversal: '../../../etc/passwd',
  crlf: 'line1\r\nSet-Cookie: admin=1',
  nullByte: 'value\u0000trailing',
  unicodeExploit: '\u202e\u202e',
} as const;

/** Body that attempts prototype pollution via JSON keys. */
export function protoPollutionBody() {
  return JSON.parse(
    '{"name":"evil","snapshot":{"__proto__":{"polluted":true}}}',
  ) as Record<string, unknown>;
}

/** Snapshot roles oversized beyond schema limits (must fail validation). */
export function oversizedRolesSnapshot(count: number) {
  return {
    roles: Array.from({ length: count }, (_, i) => ({
      id: `r${i}`,
      name: `role-${i}`,
    })),
    permissions: [],
    bindings: [],
    inheritance: [],
    assignments: [],
    subjects: [],
  };
}

/** Unknown-key body: strict schemas must reject with validation_failed. */
export function unknownKeyBody() {
  return { name: 'm', snapshot: makeSnapshot(), isAdmin: true };
}

/** Simulation body granting sensitive ops to every role (large blast). */
export function broadBlastSimulationBody(
  modelId: string,
  subjectCount: number,
) {
  return {
    modelId,
    operations: [
      ...highRiskGrantOps(),
      ...Array.from({ length: subjectCount }, (_, i) =>
        assignRoleOp(`user_${String(i).padStart(4, '0')}`, 'ops'),
      ),
    ],
  };
}
