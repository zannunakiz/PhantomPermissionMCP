/**
 * Step 12 resolution coverage (part 1 of 2).
 */
import type { AccessModelSnapshot } from './access-model';
import { DomainError } from './errors';
import { resolveSubjectPermissions } from './resolve-permissions';

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
      { subjectId: 'subj_bob' as never, roleId: 'role_viewer' as never },
      { subjectId: 'subj_norole' as never, roleId: 'role_viewer' as never },
    ],
    subjects: [
      { id: 'subj_ana' as never },
      { id: 'subj_bob' as never },
      { id: 'subj_norole' as never },
      { id: 'subj_empty' as never },
    ],
  };
}

describe('permission resolution (Step 12) — basics', () => {
  it('resolves direct permissions without inheritance', () => {
    expect(resolveSubjectPermissions(baseSnapshot(), 'subj_ana')).toEqual([
      'invoice:read',
    ]);
  });

  it('unions multiple assignments and dedupes shared grants', () => {
    const snapshot: AccessModelSnapshot = {
      ...baseSnapshot(),
      bindings: [
        { roleId: 'role_admin' as never, permissionId: 'perm_read' as never },
        { roleId: 'role_admin' as never, permissionId: 'perm_write' as never },
        { roleId: 'role_viewer' as never, permissionId: 'perm_read' as never },
      ],
    };
    expect(resolveSubjectPermissions(snapshot, 'subj_bob')).toEqual([
      'invoice:read',
      'invoice:write',
    ]);
  });

  it('returns empty for a subject with no assignments', () => {
    expect(resolveSubjectPermissions(baseSnapshot(), 'subj_empty')).toEqual([]);
  });

  it('rejects unknown subjects explicitly', () => {
    let thrown: unknown;
    try {
      resolveSubjectPermissions(baseSnapshot(), 'subj_ghost');
    } catch (error: unknown) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(DomainError);
    expect((thrown as DomainError).code).toBe('invalid_reference');
  });
});
