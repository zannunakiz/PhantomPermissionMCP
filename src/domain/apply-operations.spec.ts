/**
 * Step 14 apply coverage (part 1 of 2).
 */
import type { AccessModelSnapshot } from './access-model';
import type { ChangeOperation } from './operations';
import { applyOperations } from './apply-operations';

export function baseSnapshot(): AccessModelSnapshot {
  return {
    roles: [
      { id: 'role_admin' as never, name: 'admin' },
      { id: 'role_viewer' as never, name: 'viewer' },
    ],
    permissions: [
      { id: 'perm_read' as never, value: 'invoice:read' },
      { id: 'perm_write' as never, value: 'invoice:write' },
    ],
    bindings: [
      { roleId: 'role_admin' as never, permissionId: 'perm_write' as never },
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

describe('immutable apply (Step 14) — basics', () => {
  it('applies every operation type and leaves input unchanged', () => {
    const snapshot = Object.freeze(baseSnapshot());
    const before = JSON.stringify(snapshot);
    const result = applyOperations(snapshot, [
      opOf({
        type: 'grant_permission',
        roleId: 'role_viewer',
        permissionId: 'perm_read',
      }),
      opOf({
        type: 'assign_role',
        subjectId: 'subj_ana',
        roleId: 'role_admin',
      }),
      opOf({
        type: 'add_inheritance',
        childRoleId: 'role_viewer',
        parentRoleId: 'role_admin',
      }),
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error('Expected success');
    }
    expect(result.applied).toEqual([0, 1, 2]);
    expect(result.noop).toEqual([]);
    expect(result.snapshot.bindings).toHaveLength(2);
    expect(result.snapshot.assignments).toHaveLength(2);
    expect(result.snapshot.inheritance).toHaveLength(1);
    expect(JSON.stringify(snapshot)).toBe(before);
  });

  it('records no-ops without changing state', () => {
    const result = applyOperations(baseSnapshot(), [
      opOf({
        type: 'grant_permission',
        roleId: 'role_admin',
        permissionId: 'perm_write',
      }),
      opOf({
        type: 'revoke_permission',
        roleId: 'role_viewer',
        permissionId: 'perm_read',
      }),
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error('Expected success');
    }
    expect(result.applied).toEqual([]);
    expect(result.noop).toEqual([0, 1]);
    expect(result.snapshot.bindings).toHaveLength(1);
  });
});
