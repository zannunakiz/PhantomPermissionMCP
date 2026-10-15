/**
 * Step 12 resolution coverage (part 2 of 2).
 */
import { DomainError } from './errors';
import {
  resolveAllSubjects,
  resolveSubjectPermissions,
} from './resolve-permissions';
import { baseSnapshot } from './resolve-permissions.spec';

describe('permission resolution (Step 12) — inheritance and guards', () => {
  it('inherits transitively through multi-level chains', () => {
    const snapshot = {
      ...baseSnapshot(),
      roles: [
        { id: 'role_a' as never, name: 'a' },
        { id: 'role_b' as never, name: 'b' },
        { id: 'role_c' as never, name: 'c' },
      ],
      inheritance: [
        { childRoleId: 'role_a' as never, parentRoleId: 'role_b' as never },
        { childRoleId: 'role_b' as never, parentRoleId: 'role_c' as never },
      ],
      bindings: [
        { roleId: 'role_c' as never, permissionId: 'perm_read' as never },
      ],
      assignments: [
        { subjectId: 'subj_ana' as never, roleId: 'role_a' as never },
      ],
    };
    expect(resolveSubjectPermissions(snapshot, 'subj_ana')).toEqual([
      'invoice:read',
    ]);
  });

  it('orders stably regardless of input order', () => {
    const snapshot = baseSnapshot();
    const shuffled = {
      ...snapshot,
      permissions: [...snapshot.permissions].reverse(),
      bindings: [...snapshot.bindings].reverse(),
    };
    expect(resolveSubjectPermissions(shuffled, 'subj_bob')).toEqual(
      resolveSubjectPermissions(snapshot, 'subj_bob'),
    );
    expect(resolveSubjectPermissions(snapshot, 'subj_bob')).toEqual([
      'invoice:read',
      'invoice:write',
    ]);
  });

  it('resolves all subjects consistently and freezes safely', () => {
    const snapshot = baseSnapshot();
    const before = JSON.stringify(snapshot);
    const all = resolveAllSubjects(Object.freeze(snapshot));
    expect(all.get('subj_ana')).toEqual(['invoice:read']);
    expect(all.get('subj_bob')).toEqual(['invoice:read', 'invoice:write']);
    expect(JSON.stringify(snapshot)).toBe(before);
  });

  it('refuses invalid and cyclic models before resolving', () => {
    const dangling = {
      ...baseSnapshot(),
      bindings: [
        { roleId: 'role_ghost' as never, permissionId: 'perm_read' as never },
      ],
    };
    expect(() => resolveSubjectPermissions(dangling, 'subj_ana')).toThrow(
      DomainError,
    );
    const cyclic = {
      ...baseSnapshot(),
      inheritance: [
        {
          childRoleId: 'role_admin' as never,
          parentRoleId: 'role_viewer' as never,
        },
        {
          childRoleId: 'role_viewer' as never,
          parentRoleId: 'role_admin' as never,
        },
      ],
    };
    expect(() => resolveSubjectPermissions(cyclic, 'subj_ana')).toThrow(
      DomainError,
    );
  });
});
