/**
 * Step 13 precondition coverage (part 2 of 2).
 */
import { DomainError } from './errors';
import { checkOperation, checkOperations } from './check-operations';
import { baseSnapshot, opOf } from './operation-preconditions.spec';

describe('operation preconditions (Step 13) — inheritance and batch', () => {
  it('handles add/remove inheritance including cycles', () => {
    const snapshot = baseSnapshot();
    expect(
      checkOperation(
        snapshot,
        opOf({
          type: 'add_inheritance',
          childRoleId: 'role_viewer',
          parentRoleId: 'role_admin',
        }),
        0,
      ),
    ).toEqual({ kind: 'apply' });
    expect(
      checkOperation(
        snapshot,
        opOf({
          type: 'remove_inheritance',
          childRoleId: 'role_viewer',
          parentRoleId: 'role_admin',
        }),
        1,
      ),
    ).toEqual({ kind: 'noop', reason: 'not_inherited' });
    const selfLoop = checkOperation(
      snapshot,
      opOf({
        type: 'add_inheritance',
        childRoleId: 'role_admin',
        parentRoleId: 'role_admin',
      }),
      2,
    );
    expect(selfLoop.kind).toBe('error');
    const chained = {
      ...snapshot,
      inheritance: [
        {
          childRoleId: 'role_viewer' as never,
          parentRoleId: 'role_admin' as never,
        },
      ],
    };
    const cycle = checkOperation(
      chained,
      opOf({
        type: 'add_inheritance',
        childRoleId: 'role_admin',
        parentRoleId: 'role_viewer',
      }),
      0,
    );
    expect(cycle.kind).toBe('error');
    if (cycle.kind === 'error') {
      expect(cycle.error.code).toBe('inheritance_cycle');
    }
  });

  it('rejects unsupported types and checks batches in order', () => {
    const snapshot = baseSnapshot();
    const bad = checkOperation(
      snapshot,
      opOf({ type: 'explode_everything' }),
      5,
    );
    expect(bad.kind).toBe('error');
    if (bad.kind === 'error') {
      expect(bad.error.code).toBe('unsupported_operation');
      expect(bad.error.details).toContainEqual({
        path: 'operations[5].type',
        reason: 'unsupported_operation',
      });
    }
    const batch = checkOperations(snapshot, [
      opOf({
        type: 'grant_permission',
        roleId: 'role_viewer',
        permissionId: 'perm_read',
      }),
      opOf({
        type: 'grant_permission',
        roleId: 'role_ghost',
        permissionId: 'perm_read',
      }),
    ]);
    expect(batch.map((o) => o.kind)).toEqual(['apply', 'error']);
    expect(() =>
      checkOperation(
        { ...snapshot, roles: [] },
        opOf({
          type: 'grant_permission',
          roleId: 'role_admin',
          permissionId: 'perm_write',
        }),
        0,
      ),
    ).toThrow(DomainError);
    expect(
      JSON.stringify(
        checkOperation(
          snapshot,
          opOf({
            type: 'assign_role',
            subjectId: 'subj_ana',
            roleId: 'role_viewer',
          }),
          0,
        ),
      ),
    ).not.toContain('ppk_');
  });
});
