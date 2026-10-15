/**
 * Step 14 apply coverage (part 2 of 2).
 */
import { DomainError } from './errors';
import { applyOperations, assertApplyOperations } from './apply-operations';
import { baseSnapshot, opOf } from './apply-operations.spec';

describe('immutable apply (Step 14) — order and failure', () => {
  it('is order-dependent and deterministic', () => {
    const grantThenRevoke = applyOperations(baseSnapshot(), [
      opOf({
        type: 'grant_permission',
        roleId: 'role_viewer',
        permissionId: 'perm_read',
      }),
      opOf({
        type: 'revoke_permission',
        roleId: 'role_viewer',
        permissionId: 'perm_read',
      }),
    ]);
    const revokeThenGrant = applyOperations(baseSnapshot(), [
      opOf({
        type: 'revoke_permission',
        roleId: 'role_viewer',
        permissionId: 'perm_read',
      }),
      opOf({
        type: 'grant_permission',
        roleId: 'role_viewer',
        permissionId: 'perm_read',
      }),
    ]);
    if (!grantThenRevoke.ok || !revokeThenGrant.ok) {
      throw new Error('Expected success');
    }
    expect(grantThenRevoke.applied).toEqual([0, 1]);
    expect(revokeThenGrant.noop).toEqual([0]);
    expect(revokeThenGrant.applied).toEqual([1]);
    expect(grantThenRevoke.snapshot.bindings).toHaveLength(1);
    expect(revokeThenGrant.snapshot.bindings).toHaveLength(2);
    const repeat = applyOperations(baseSnapshot(), [
      opOf({
        type: 'grant_permission',
        roleId: 'role_viewer',
        permissionId: 'perm_read',
      }),
    ]);
    expect(JSON.stringify(repeat)).toBe(
      JSON.stringify(
        applyOperations(baseSnapshot(), [
          opOf({
            type: 'grant_permission',
            roleId: 'role_viewer',
            permissionId: 'perm_read',
          }),
        ]),
      ),
    );
  });

  it('rejects invalid results with index and keeps input intact', () => {
    const snapshot = baseSnapshot();
    const before = JSON.stringify(snapshot);
    const badRef = applyOperations(snapshot, [
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
    expect(badRef.ok).toBe(false);
    if (badRef.ok) {
      throw new Error('Expected failure');
    }
    expect(badRef.failedIndex).toBe(1);
    expect(badRef.error.code).toBe('invalid_reference');
    expect(JSON.stringify(snapshot)).toBe(before);
    const cycle = applyOperations(snapshot, [
      opOf({
        type: 'add_inheritance',
        childRoleId: 'role_viewer',
        parentRoleId: 'role_admin',
      }),
      opOf({
        type: 'add_inheritance',
        childRoleId: 'role_admin',
        parentRoleId: 'role_viewer',
      }),
    ]);
    expect(cycle.ok).toBe(false);
    if (!cycle.ok) {
      expect(cycle.failedIndex).toBe(1);
      expect(cycle.error.code).toBe('inheritance_cycle');
    }
    expect(() =>
      assertApplyOperations(snapshot, [
        opOf({ type: 'grant_permission', roleId: 'x', permissionId: 'y' }),
      ]),
    ).toThrow(DomainError);
    const empty = applyOperations(snapshot, []);
    expect(empty.ok).toBe(true);
    if (empty.ok) {
      expect(empty.applied).toEqual([]);
      expect(empty.snapshot).not.toBe(snapshot);
      expect(empty.snapshot).toEqual(snapshot);
    }
  });
});
