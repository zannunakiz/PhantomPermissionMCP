/**
 * Step 16 risk-rule coverage (part 2 of 2).
 */
import { simulateWithFindings } from './risk-rules';
import { baseSnapshot, opOf } from './risk-rules.spec';

describe('risk rules (Step 16) — inheritance, escalation, integrity', () => {
  it('flags risky inheritance with newly reachable evidence', () => {
    const result = simulateWithFindings(baseSnapshot(), [
      opOf({
        type: 'add_inheritance',
        childRoleId: 'role_viewer',
        parentRoleId: 'role_admin',
      }),
    ]);
    const risky = result.findings.filter(
      (f) => f.ruleId === 'RISKY_INHERITANCE',
    );
    expect(risky).toHaveLength(1);
    expect(risky[0]?.evidence).toMatchObject({
      childRoleId: 'role_viewer',
      parentRoleId: 'role_admin',
    });
  });

  it('matches configured escalation patterns deterministically', () => {
    const config = {
      sensitivePermissions: [] as string[],
      broadAccessThreshold: 99,
      escalationPatterns: [
        {
          roleId: 'role_admin',
          permissionValue: 'invoice:refund',
          severity: 'critical' as const,
        },
      ],
    };
    const first = simulateWithFindings(
      baseSnapshot(),
      [
        opOf({
          type: 'assign_role',
          subjectId: 'subj_ana',
          roleId: 'role_admin',
        }),
      ],
      config,
    );
    const escalations = first.findings.filter(
      (f) => f.ruleId === 'PRIVILEGE_ESCALATION_PATTERN',
    );
    expect(escalations).toHaveLength(1);
    expect(escalations[0]?.severity).toBe('critical');
    const second = simulateWithFindings(
      baseSnapshot(),
      [
        opOf({
          type: 'assign_role',
          subjectId: 'subj_ana',
          roleId: 'role_admin',
        }),
      ],
      config,
    );
    expect(JSON.stringify(second.findings)).toBe(
      JSON.stringify(first.findings),
    );
    const quiet = simulateWithFindings(baseSnapshot(), [], {
      sensitivePermissions: [],
      broadAccessThreshold: 99,
      escalationPatterns: [],
    });
    expect(quiet.findings).toEqual([]);
    expect(quiet.summary.findingCounts).toEqual({
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
    });
  });

  it('flags unexpected subject impact outside the blast radius', () => {
    const base2 = {
      roles: [
        { id: 'role_parent' as never, name: 'parent' },
        { id: 'role_child' as never, name: 'child' },
      ],
      permissions: [{ id: 'perm_new' as never, value: 'doc:write' }],
      bindings: [],
      inheritance: [
        {
          childRoleId: 'role_child' as never,
          parentRoleId: 'role_parent' as never,
        },
      ],
      assignments: [
        { subjectId: 'subj_child' as never, roleId: 'role_child' as never },
      ],
      subjects: [{ id: 'subj_child' as never }],
    };
    const result = simulateWithFindings(
      base2,
      [
        opOf({
          type: 'grant_permission',
          roleId: 'role_parent',
          permissionId: 'perm_new',
        }),
      ],
      {
        sensitivePermissions: [],
        broadAccessThreshold: 99,
        escalationPatterns: [],
      },
    );
    expect(result.impacts).toEqual([
      { subjectId: 'subj_child', added: ['doc:write'], removed: [] },
    ]);
    expect(
      result.findings.some((f) => f.ruleId === 'UNEXPECTED_SUBJECT_IMPACT'),
    ).toBe(true);
    const expected = simulateWithFindings(
      baseSnapshot(),
      [
        opOf({
          type: 'grant_permission',
          roleId: 'role_viewer',
          permissionId: 'perm_refund',
        }),
      ],
      {
        sensitivePermissions: [],
        broadAccessThreshold: 99,
        escalationPatterns: [],
      },
    );
    expect(
      expected.findings.some((f) => f.ruleId === 'UNEXPECTED_SUBJECT_IMPACT'),
    ).toBe(false);
  });
});
