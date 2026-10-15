/**
 * Step 16 risk-rule coverage (part 1 of 2).
 */
import type { AccessModelSnapshot } from './access-model';
import type { ChangeOperation } from './operations';
import { simulateWithFindings } from './risk-rules';

export function baseSnapshot(): AccessModelSnapshot {
  return {
    roles: [
      { id: 'role_admin' as never, name: 'admin' },
      { id: 'role_viewer' as never, name: 'viewer' },
    ],
    permissions: [
      { id: 'perm_read' as never, value: 'invoice:read' },
      { id: 'perm_refund' as never, value: 'invoice:refund' },
    ],
    bindings: [
      { roleId: 'role_admin' as never, permissionId: 'perm_refund' as never },
      { roleId: 'role_viewer' as never, permissionId: 'perm_read' as never },
    ],
    inheritance: [],
    assignments: [
      { subjectId: 'subj_ana' as never, roleId: 'role_viewer' as never },
    ],
    subjects: [{ id: 'subj_ana' as never }],
  };
}

export function opOf(value: unknown): ChangeOperation {
  return value as ChangeOperation;
}

describe('risk rules (Step 16) — sensitive and broad', () => {
  it('flags sensitive permissions with evidence', () => {
    const result = simulateWithFindings(baseSnapshot(), [
      opOf({
        type: 'grant_permission',
        roleId: 'role_viewer',
        permissionId: 'perm_refund',
      }),
    ]);
    const sensitive = result.findings.filter(
      (f) => f.ruleId === 'SENSITIVE_PERMISSION',
    );
    expect(sensitive).toHaveLength(1);
    expect(sensitive[0]).toMatchObject({
      severity: 'high',
      subjects: ['subj_ana'],
    });
    expect(sensitive[0]?.evidence).toMatchObject({
      permission: 'invoice:refund',
    });
    expect(sensitive[0]?.explanation).toContain('Candidate review');
    expect(result.summary.findingCounts.high).toBeGreaterThanOrEqual(1);
  });

  it('stays quiet when no sensitive permission is gained', () => {
    const snapshot: AccessModelSnapshot = {
      ...baseSnapshot(),
      permissions: [{ id: 'perm_read' as never, value: 'invoice:read' }],
      bindings: [
        { roleId: 'role_viewer' as never, permissionId: 'perm_read' as never },
      ],
    };
    const result = simulateWithFindings(
      snapshot,
      [
        opOf({
          type: 'assign_role',
          subjectId: 'subj_ana',
          roleId: 'role_viewer',
        }),
      ],
      {
        sensitivePermissions: [],
        broadAccessThreshold: 99,
        escalationPatterns: [],
      },
    );
    expect(
      result.findings.filter((f) => f.ruleId === 'SENSITIVE_PERMISSION'),
    ).toEqual([]);
  });

  it('flags broad access increase at an explicit threshold', () => {
    const perms = Array.from({ length: 6 }, (_, i) => ({
      id: `perm_${i}` as never,
      value: `doc:read-${i}`,
    }));
    const snapshot: AccessModelSnapshot = {
      roles: [{ id: 'role_wide' as never, name: 'wide' }],
      permissions: perms,
      bindings: perms.map((p) => ({
        roleId: 'role_wide' as never,
        permissionId: p.id,
      })),
      inheritance: [],
      assignments: [
        { subjectId: 'subj_ana' as never, roleId: 'role_wide' as never },
      ],
      subjects: [{ id: 'subj_ana' as never }],
    };
    void snapshot;
    const impacted = simulateWithFindings(
      {
        roles: [{ id: 'role_wide' as never, name: 'wide' }],
        permissions: perms,
        bindings: [],
        inheritance: [],
        assignments: [
          { subjectId: 'subj_ana' as never, roleId: 'role_wide' as never },
        ],
        subjects: [{ id: 'subj_ana' as never }],
      },
      perms
        .map((p) =>
          opOf({
            type: 'grant_permission',
            roleId: 'role_wide',
            permissionId: (p.id as string).replace('perm_', 'perm_'),
          }),
        )
        .slice(0, 5),
      {
        sensitivePermissions: [],
        broadAccessThreshold: 5,
        escalationPatterns: [],
      },
    );
    expect(
      impacted.findings.some((f) => f.ruleId === 'BROAD_ACCESS_INCREASE'),
    ).toBe(true);
  });
});
