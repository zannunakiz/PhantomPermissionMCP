/**
 * Shared engine fixtures (Step 17).
 *
 * One documented shop model reused by gap-fill specs: two roles with
 * viewer → admin inheritance, two permissions, two subjects.
 * `expectNoMutation` snapshots JSON before an action and asserts the
 * input is byte-identical afterwards.
 */
import type { AccessModelSnapshot } from './access-model';

export function smallShopSnapshot(): AccessModelSnapshot {
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
    inheritance: [
      {
        childRoleId: 'role_viewer' as never,
        parentRoleId: 'role_admin' as never,
      },
    ],
    assignments: [
      { subjectId: 'subj_ana' as never, roleId: 'role_viewer' as never },
      { subjectId: 'subj_bob' as never, roleId: 'role_admin' as never },
    ],
    subjects: [{ id: 'subj_ana' as never }, { id: 'subj_bob' as never }],
  };
}

/** Run `action`, then assert `target` serializes identically to before. */
export function expectNoMutation(target: unknown, action: () => void): void {
  const before = JSON.stringify(target);
  action();
  expect(JSON.stringify(target)).toBe(before);
}
