/**
 * Step 10 structural-validation coverage (part 1 of 2).
 */
import type { AccessModelSnapshot } from './access-model';
import { DomainError } from './errors';
import { assertValidStructure, validateStructure } from './validate-structure';

export function validSnapshot(): AccessModelSnapshot {
  return {
    roles: [{ id: 'role_admin' as never, name: 'admin' }],
    permissions: [{ id: 'perm_read' as never, value: 'invoice:read' }],
    bindings: [
      { roleId: 'role_admin' as never, permissionId: 'perm_read' as never },
    ],
    inheritance: [],
    assignments: [
      { subjectId: 'subj_ana' as never, roleId: 'role_admin' as never },
    ],
    subjects: [{ id: 'subj_ana' as never, displayName: 'Ana' }],
  };
}

export function errorOf(snapshot: AccessModelSnapshot): DomainError {
  const result = validateStructure(snapshot);
  expect(result.ok).toBe(false);
  if (result.ok) {
    throw new Error('Expected invalid snapshot');
  }
  return result.error;
}

describe('structural validation (Step 10) — core', () => {
  it('accepts a valid model', () => {
    expect(validateStructure(validSnapshot())).toEqual({ ok: true });
    expect(() => assertValidStructure(validSnapshot())).not.toThrow();
  });

  it('rejects duplicate role names and permission values', () => {
    const dupRoles: AccessModelSnapshot = {
      ...validSnapshot(),
      roles: [
        { id: 'role_a' as never, name: 'admin' },
        { id: 'role_b' as never, name: 'admin' },
      ],
    };
    const roleError = errorOf(dupRoles);
    expect(roleError.code).toBe('duplicate_entity');
    expect(roleError.details).toContainEqual({
      path: 'roles[1].name',
      reason: 'duplicate',
    });
    const dupPerms: AccessModelSnapshot = {
      ...validSnapshot(),
      permissions: [
        { id: 'perm_a' as never, value: 'invoice:read' },
        { id: 'perm_b' as never, value: 'invoice:read' },
      ],
    };
    expect(errorOf(dupPerms).details).toContainEqual({
      path: 'permissions[1].value',
      reason: 'duplicate',
    });
  });

  it('rejects invalid and duplicate bindings', () => {
    const ghost: AccessModelSnapshot = {
      ...validSnapshot(),
      bindings: [
        { roleId: 'role_ghost' as never, permissionId: 'perm_read' as never },
      ],
    };
    const ghostError = errorOf(ghost);
    expect(ghostError.code).toBe('invalid_reference');
    expect(ghostError.details).toContainEqual({
      path: 'bindings[0].roleId',
      reason: 'unknown_role',
    });
    const dup: AccessModelSnapshot = {
      ...validSnapshot(),
      bindings: [
        { roleId: 'role_admin' as never, permissionId: 'perm_read' as never },
        { roleId: 'role_admin' as never, permissionId: 'perm_read' as never },
      ],
    };
    expect(errorOf(dup).details).toContainEqual({
      path: 'bindings[1]',
      reason: 'duplicate',
    });
  });
});
