/**
 * Step 15 impact coverage (part 1 of 2).
 */
import type { AccessModelSnapshot } from './access-model';
import type { ChangeOperation } from './operations';
import { simulateChange } from './calculate-impact';

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
      { roleId: 'role_viewer' as never, permissionId: 'perm_read' as never },
    ],
    inheritance: [],
    assignments: [
      { subjectId: 'subj_ana' as never, roleId: 'role_viewer' as never },
      { subjectId: 'subj_bob' as never, roleId: 'role_admin' as never },
    ],
    subjects: [{ id: 'subj_ana' as never }, { id: 'subj_bob' as never }],
  };
}

export function opOf(value: unknown): ChangeOperation {
  return value as ChangeOperation;
}

describe('permission impact (Step 15) — grants and revokes', () => {
  it('reports granted permissions as facts with reconciled counts', () => {
    const result = simulateChange(baseSnapshot(), [
      opOf({
        type: 'grant_permission',
        roleId: 'role_viewer',
        permissionId: 'perm_write',
      }),
    ]);
    expect(result.impacts).toEqual([
      { subjectId: 'subj_ana', added: ['invoice:write'], removed: [] },
    ]);
    expect(result.affectedSubjects).toEqual(['subj_ana']);
    expect(result.summary).toMatchObject({
      addedCount: 1,
      removedCount: 0,
      affectedSubjectCount: 1,
    });
  });

  it('reports revocations and assignment changes', () => {
    const revoked = simulateChange(baseSnapshot(), [
      opOf({
        type: 'revoke_permission',
        roleId: 'role_admin',
        permissionId: 'perm_write',
      }),
    ]);
    expect(revoked.impacts).toEqual([
      { subjectId: 'subj_bob', added: [], removed: ['invoice:write'] },
    ]);
    const assigned = simulateChange(baseSnapshot(), [
      opOf({
        type: 'assign_role',
        subjectId: 'subj_ana',
        roleId: 'role_admin',
      }),
    ]);
    expect(assigned.impacts).toEqual([
      { subjectId: 'subj_ana', added: ['invoice:write'], removed: [] },
    ]);
    const unassigned = simulateChange(baseSnapshot(), [
      opOf({
        type: 'unassign_role',
        subjectId: 'subj_bob',
        roleId: 'role_admin',
      }),
    ]);
    expect(unassigned.impacts).toEqual([
      { subjectId: 'subj_bob', added: [], removed: ['invoice:write'] },
    ]);
  });

  it('returns empty impact for no-op changes', () => {
    const result = simulateChange(baseSnapshot(), [
      opOf({
        type: 'grant_permission',
        roleId: 'role_admin',
        permissionId: 'perm_write',
      }),
    ]);
    expect(result.impacts).toEqual([]);
    expect(result.summary).toMatchObject({
      addedCount: 0,
      removedCount: 0,
      affectedSubjectCount: 0,
    });
  });
});
