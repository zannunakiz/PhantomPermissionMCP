/**
 * Step 17 engine gap-fill coverage (part 1 of 2).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { AccessModelSnapshot } from './access-model';
import { assertApplyOperations } from './apply-operations';
import { simulateChange } from './calculate-impact';
import { checkOperations } from './check-operations';
import { detectInheritanceCycle } from './inheritance-cycles';
import { resolveSubjectPermissions } from './resolve-permissions';
import { validateStructure } from './validate-structure';
import { expectNoMutation, smallShopSnapshot } from './fixtures';

describe('engine coverage (Step 17) — validation and cycles', () => {
  it('treats roles-without-permissions as valid but empty as invalid', () => {
    const noPerms: AccessModelSnapshot = {
      roles: [{ id: 'role_admin' as never, name: 'admin' }],
      permissions: [],
      bindings: [],
      inheritance: [],
      assignments: [],
      subjects: [],
    };
    expect(validateStructure(noPerms)).toEqual({ ok: true });
    const empty: AccessModelSnapshot = {
      roles: [],
      permissions: [],
      bindings: [],
      inheritance: [],
      assignments: [],
      subjects: [],
    };
    const result = validateStructure(empty);
    expect(result.ok).toBe(false);
  });

  it('caps findings with a trailing overflow marker', () => {
    const bindings = Array.from({ length: 150 }, () => ({
      roleId: 'role_ghost' as never,
      permissionId: 'perm_ghost' as never,
    }));
    const snapshot: AccessModelSnapshot = {
      ...smallShopSnapshot(),
      bindings,
    };
    const result = validateStructure(snapshot);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(
        result.error.details.some((d) => d.reason === 'too_many_findings'),
      ).toBe(true);
    }
  });

  it('accepts diamond inheritance without false-positive cycles', () => {
    const snapshot: AccessModelSnapshot = {
      roles: [
        { id: 'role_top' as never, name: 'top' },
        { id: 'role_left' as never, name: 'left' },
        { id: 'role_right' as never, name: 'right' },
        { id: 'role_bottom' as never, name: 'bottom' },
      ],
      permissions: [{ id: 'perm_p' as never, value: 'doc:read' }],
      bindings: [
        { roleId: 'role_top' as never, permissionId: 'perm_p' as never },
      ],
      inheritance: [
        {
          childRoleId: 'role_left' as never,
          parentRoleId: 'role_top' as never,
        },
        {
          childRoleId: 'role_right' as never,
          parentRoleId: 'role_top' as never,
        },
        {
          childRoleId: 'role_bottom' as never,
          parentRoleId: 'role_left' as never,
        },
        {
          childRoleId: 'role_bottom' as never,
          parentRoleId: 'role_right' as never,
        },
      ],
      assignments: [],
      subjects: [],
    };
    expect(detectInheritanceCycle(snapshot)).toEqual({ ok: true });
    expect(validateStructure(snapshot)).toEqual({ ok: true });
  });

  it('dedupes diamond resolution to a single permission', () => {
    const snapshot: AccessModelSnapshot = {
      roles: [
        { id: 'role_top' as never, name: 'top' },
        { id: 'role_left' as never, name: 'left' },
        { id: 'role_right' as never, name: 'right' },
      ],
      permissions: [{ id: 'perm_p' as never, value: 'doc:read' }],
      bindings: [
        { roleId: 'role_top' as never, permissionId: 'perm_p' as never },
      ],
      inheritance: [
        {
          childRoleId: 'role_left' as never,
          parentRoleId: 'role_top' as never,
        },
        {
          childRoleId: 'role_right' as never,
          parentRoleId: 'role_top' as never,
        },
      ],
      assignments: [
        { subjectId: 'subj_ana' as never, roleId: 'role_left' as never },
        { subjectId: 'subj_ana' as never, roleId: 'role_right' as never },
      ],
      subjects: [{ id: 'subj_ana' as never }],
    };
    expect(resolveSubjectPermissions(snapshot, 'subj_ana')).toEqual([
      'doc:read',
    ]);
  });

  it('runs without DB, network, or external APIs', () => {
    const dir = __dirname;
    const sources = readdirSync(dir).filter(
      (file) => file.endsWith('.ts') && !file.endsWith('.spec.ts'),
    );
    const banned =
      /process\.env|fetch\(|XMLHttpRequest|node:http|from\s+['"]fs['"]|from\s+['"]node:fs|@prisma|datasource\s+db|pg\.Client|ioredis/;
    for (const file of sources) {
      const content = readFileSync(join(dir, file), 'utf8');
      expect(`${file}: ${content}`).not.toMatch(banned);
    }
  });

  it('checks batches with mixed outcomes and applies removals', () => {
    const snapshot = smallShopSnapshot();
    const outcomes = checkOperations(snapshot, [
      {
        type: 'grant_permission',
        roleId: 'role_admin' as never,
        permissionId: 'perm_read' as never,
      },
      {
        type: 'grant_permission',
        roleId: 'role_admin' as never,
        permissionId: 'perm_refund' as never,
      },
    ]);
    expect(outcomes.map((o) => o.kind)).toEqual(['apply', 'noop']);
    const removed = assertApplyOperations(snapshot, [
      {
        type: 'remove_inheritance',
        childRoleId: 'role_viewer' as never,
        parentRoleId: 'role_admin' as never,
      },
    ]);
    expect(removed.inheritance).toEqual([]);
    expect(() =>
      assertApplyOperations(snapshot, [
        {
          type: 'grant_permission',
          roleId: 'role_ghost' as never,
          permissionId: 'perm_read' as never,
        },
      ]),
    ).toThrow();
  });

  it('returns zero impact for empty operation lists', () => {
    const snapshot = smallShopSnapshot();
    let result: ReturnType<typeof simulateChange> | undefined;
    expectNoMutation(snapshot, () => {
      result = simulateChange(snapshot, []);
    });
    expect(result?.impacts).toEqual([]);
    expect(result?.summary).toMatchObject({
      addedCount: 0,
      removedCount: 0,
      affectedSubjectCount: 0,
    });
  });
});
