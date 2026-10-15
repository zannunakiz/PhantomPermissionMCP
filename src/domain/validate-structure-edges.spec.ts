/**
 * Step 10 structural-validation coverage (part 2 of 2).
 */
import { DomainError } from './errors';
import { assertValidStructure } from './validate-structure';
import { errorOf, validSnapshot } from './validate-structure.spec';

describe('structural validation (Step 10) — assignments and edges', () => {
  it('rejects invalid assignments and unknown inherited roles', () => {
    const badAssign = {
      ...validSnapshot(),
      assignments: [
        { subjectId: 'subj_ghost' as never, roleId: 'role_ghost' as never },
      ],
    };
    const assignError = errorOf(badAssign);
    expect(assignError.details).toContainEqual({
      path: 'assignments[0].subjectId',
      reason: 'unknown_subject',
    });
    expect(assignError.details).toContainEqual({
      path: 'assignments[0].roleId',
      reason: 'unknown_role',
    });
    const badEdge = {
      ...validSnapshot(),
      inheritance: [
        { childRoleId: 'role_c' as never, parentRoleId: 'role_ghost' as never },
      ],
    };
    expect(errorOf(badEdge).details).toContainEqual({
      path: 'inheritance[0].childRoleId',
      reason: 'unknown_role',
    });
  });

  it('rejects bad identifiers, self-loops, and empty models', () => {
    const secret = 'ppk_live-should-not-appear!!!';
    const badId = {
      ...validSnapshot(),
      roles: [{ id: secret as never, name: 'admin' }],
    };
    const idError = errorOf(badId);
    expect(idError.details).toContainEqual({
      path: 'roles[0].id',
      reason: 'invalid_format',
    });
    expect(JSON.stringify(idError.details)).not.toContain(secret);
    const loop = {
      ...validSnapshot(),
      inheritance: [
        {
          childRoleId: 'role_admin' as never,
          parentRoleId: 'role_admin' as never,
        },
      ],
    };
    const loopError = errorOf(loop);
    expect(loopError.code).toBe('inheritance_cycle');
    expect(loopError.details).toContainEqual({
      path: 'inheritance[0]',
      reason: 'self_cycle',
    });
    const empty = {
      roles: [],
      permissions: [],
      bindings: [],
      inheritance: [],
      assignments: [],
      subjects: [],
    };
    expect(errorOf(empty).details).toContainEqual({
      path: '(body)',
      reason: 'empty_snapshot',
    });
  });

  it('aggregates findings and guards resolution entry', () => {
    const multi = {
      ...validSnapshot(),
      bindings: [
        { roleId: 'role_ghost' as never, permissionId: 'perm_read' as never },
      ],
      assignments: [
        { subjectId: 'subj_ghost' as never, roleId: 'role_admin' as never },
      ],
    };
    const error = errorOf(multi);
    expect(error.details.length).toBeGreaterThanOrEqual(2);
    expect(error.details).toContainEqual({
      path: 'bindings[0].roleId',
      reason: 'unknown_role',
    });
    expect(error.details).toContainEqual({
      path: 'assignments[0].subjectId',
      reason: 'unknown_subject',
    });
    expect(() =>
      assertValidStructure(Object.freeze(validSnapshot())),
    ).not.toThrow();
    expect(() => assertValidStructure(Object.freeze(multi))).toThrow(
      DomainError,
    );
  });
});
