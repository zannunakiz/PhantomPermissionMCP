/**
 * Step 13 precondition coverage (part 1 of 2).
 */
import type { AccessModelSnapshot } from './access-model';
import type { ChangeOperation } from './operations';
import { DomainError } from './errors';
import { checkOperation } from './check-operations';

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

describe('operation preconditions (Step 13) — grants and roles', () => {
  it('approves grant and revoke with correct no-op classification', () => {
    const snapshot = baseSnapshot();
    expect(
      checkOperation(
        snapshot,
        opOf({
          type: 'grant_permission',
          roleId: 'role_viewer',
          permissionId: 'perm_read',
        }),
        0,
      ),
    ).toEqual({ kind: 'apply' });
    expect(
      checkOperation(
        snapshot,
        opOf({
          type: 'grant_permission',
          roleId: 'role_admin',
          permissionId: 'perm_write',
        }),
        1,
      ),
    ).toEqual({ kind: 'noop', reason: 'already_granted' });
    expect(
      checkOperation(
        snapshot,
        opOf({
          type: 'revoke_permission',
          roleId: 'role_viewer',
          permissionId: 'perm_read',
        }),
        2,
      ),
    ).toEqual({ kind: 'noop', reason: 'not_granted' });
  });

  it('rejects unknown grant references without echoing values', () => {
    const secret = 'ppk_live-should-not-appear';
    const outcome = checkOperation(
      baseSnapshot(),
      opOf({ type: 'grant_permission', roleId: secret, permissionId: 'p' }),
      3,
    );
    expect(outcome.kind).toBe('error');
    if (outcome.kind !== 'error') {
      throw new Error('Expected error');
    }
    expect(outcome.error).toBeInstanceOf(DomainError);
    expect(outcome.error.code).toBe('invalid_reference');
    expect(JSON.stringify(outcome.error.details)).not.toContain(secret);
  });

  it('approves assign and unassign with correct no-ops', () => {
    const snapshot = baseSnapshot();
    expect(
      checkOperation(
        snapshot,
        opOf({
          type: 'assign_role',
          subjectId: 'subj_ana',
          roleId: 'role_admin',
        }),
        0,
      ),
    ).toEqual({ kind: 'apply' });
    expect(
      checkOperation(
        snapshot,
        opOf({
          type: 'unassign_role',
          subjectId: 'subj_ana',
          roleId: 'role_admin',
        }),
        1,
      ),
    ).toEqual({ kind: 'noop', reason: 'not_assigned' });
  });
});
