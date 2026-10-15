/**
 * Step 08 compile-level and independence coverage.
 *
 * - Builds a valid snapshot/operation/result fixture from the domain
 *   types (proves the contracts compose).
 * - Asserts the operation union is exhaustive over OPERATION_TYPES.
 * - Asserts ID guards accept/reject per the documented rules.
 * - Asserts the domain boundary is framework-free: no `@nestjs/*`,
 *   ORM, HTTP, or MCP imports in `src/domain` sources.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type {
  AccessModelSnapshot,
  ChangeOperation,
  RiskFinding,
  SimulationResult,
} from './index';
import {
  DOMAIN_LIMITS,
  DomainError,
  isContentHash,
  isModelId,
  isModelVersion,
  isOpaqueId,
  isTenantId,
  OPERATION_TYPES,
  RISK_RULE_IDS,
} from './index';

function validSnapshot(): AccessModelSnapshot {
  return {
    roles: [{ id: 'role_billing-admin' as never, name: 'billing-admin' }],
    permissions: [{ id: 'perm_refund' as never, value: 'invoice:refund' }],
    bindings: [
      {
        roleId: 'role_billing-admin' as never,
        permissionId: 'perm_refund' as never,
      },
    ],
    inheritance: [],
    assignments: [
      {
        subjectId: 'subj_ana' as never,
        roleId: 'role_billing-admin' as never,
      },
    ],
    subjects: [{ id: 'subj_ana' as never, displayName: 'Ana' }],
  };
}

describe('domain contracts (Step 08)', () => {
  it('composes a valid snapshot, operation, impact, and finding fixture', () => {
    const snapshot = validSnapshot();
    expect(snapshot.roles).toHaveLength(1);
    expect(snapshot.bindings[0]?.roleId).toBe('role_billing-admin');

    const operation: ChangeOperation = {
      type: 'grant_permission',
      roleId: 'role_billing-admin' as never,
      permissionId: 'perm_refund' as never,
    };
    expect(OPERATION_TYPES).toContain(operation.type);

    const result: SimulationResult = {
      impacts: [
        {
          subjectId: 'subj_ana' as never,
          added: ['invoice:refund'],
          removed: [],
        },
      ],
      affectedSubjects: ['subj_ana' as never],
      summary: {
        addedCount: 1,
        removedCount: 0,
        affectedSubjectCount: 1,
        findingCounts: { critical: 0, high: 1, medium: 0, low: 0 },
      },
    };
    expect(result.summary.affectedSubjectCount).toBe(1);

    const finding: RiskFinding = {
      ruleId: RISK_RULE_IDS[0] ?? 'SENSITIVE_PERMISSION',
      severity: 'high',
      subjects: ['subj_ana' as never],
      evidence: { permission: 'invoice:refund' },
      explanation: 'Newly granted permission is on the sensitive list.',
    };
    expect(finding.ruleId).toBe('SENSITIVE_PERMISSION');
  });

  it('covers every operation type in the discriminated union', () => {
    const seen = new Set<ChangeOperation['type']>([
      'grant_permission',
      'revoke_permission',
      'assign_role',
      'unassign_role',
      'add_inheritance',
      'remove_inheritance',
    ]);
    expect([...seen].sort()).toEqual([...OPERATION_TYPES].sort());
  });

  it('validates identifiers per the documented rules', () => {
    expect(isTenantId('tnt_acme')).toBe(true);
    expect(isTenantId('mdl_01')).toBe(false);
    expect(isModelId('mdl_01JABC')).toBe(true);
    expect(isModelId('bad')).toBe(false);
    expect(isOpaqueId('role_billing-admin')).toBe(true);
    expect(isOpaqueId('')).toBe(false);
    expect(isContentHash(`sha256:${'a'.repeat(64)}`)).toBe(true);
    expect(isContentHash('sha256:xyz')).toBe(false);
    expect(isModelVersion(1)).toBe(true);
    expect(isModelVersion(0)).toBe(false);
    expect(
      new DomainError('invalid_reference', 'Role r1 does not exist', {
        details: [{ path: 'bindings[0].roleId', reason: 'unknown_role' }],
      }).code,
    ).toBe('invalid_reference');
  });

  it('mirrors the documented v1 limits', () => {
    expect(DOMAIN_LIMITS).toMatchObject({
      maxRoles: 500,
      maxPermissions: 2000,
      maxBindings: 10000,
      maxInheritanceEdges: 2000,
      maxAssignments: 10000,
      maxSubjects: 5000,
      maxInheritanceDepth: 25,
      maxOperationsPerSimulation: 200,
    });
  });

  it('keeps the domain free of framework and persistence imports', () => {
    const dir = __dirname;
    const sources = readdirSync(dir).filter(
      (file) => file.endsWith('.ts') && !file.endsWith('.spec.ts'),
    );
    const banned =
      /from\s+['"]@nestjs|require\(['"]@nestjs|from\s+['"]@prisma|from\s+['"]express|from\s+['"]@modelcontextprotocol|from\s+['"]\.\.\/common\/http|from\s+['"]\.\.\/common\/errors/;
    for (const file of sources) {
      const content = readFileSync(join(dir, file), 'utf8');
      expect(`${file}: ${content}`).not.toMatch(banned);
    }
  });
});
