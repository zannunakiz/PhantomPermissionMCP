/**
 * Step 15 impact coverage (part 2 of 2).
 */
import { DomainError } from './errors';
import { simulateChange } from './calculate-impact';
import { baseSnapshot, opOf } from './calculate-impact.spec';

describe('permission impact (Step 15) — inheritance and integrity', () => {
  it('propagates inheritance changes to descendants', () => {
    const result = simulateChange(baseSnapshot(), [
      opOf({
        type: 'add_inheritance',
        childRoleId: 'role_viewer',
        parentRoleId: 'role_admin',
      }),
    ]);
    expect(result.impacts).toEqual([
      { subjectId: 'subj_ana', added: ['invoice:write'], removed: [] },
    ]);
  });

  it('handles multiple roles and keeps input immutable', () => {
    const snapshot = {
      ...baseSnapshot(),
      assignments: [
        { subjectId: 'subj_ana' as never, roleId: 'role_viewer' as never },
        { subjectId: 'subj_ana' as never, roleId: 'role_admin' as never },
      ],
    };
    const before = JSON.stringify(snapshot);
    const result = simulateChange(Object.freeze(snapshot), [
      opOf({
        type: 'revoke_permission',
        roleId: 'role_viewer',
        permissionId: 'perm_read',
      }),
    ]);
    expect(result.impacts).toEqual([
      { subjectId: 'subj_ana', added: [], removed: ['invoice:read'] },
    ]);
    expect(JSON.stringify(snapshot)).toBe(before);
    expect(
      JSON.stringify(
        simulateChange(baseSnapshot(), [
          opOf({
            type: 'grant_permission',
            roleId: 'role_viewer',
            permissionId: 'perm_write',
          }),
        ]),
      ),
    ).toBe(
      JSON.stringify(
        simulateChange(baseSnapshot(), [
          opOf({
            type: 'grant_permission',
            roleId: 'role_viewer',
            permissionId: 'perm_write',
          }),
        ]),
      ),
    );
  });

  it('rejects invalid operations without mutating input', () => {
    const snapshot = baseSnapshot();
    const before = JSON.stringify(snapshot);
    expect(() =>
      simulateChange(snapshot, [
        opOf({
          type: 'grant_permission',
          roleId: 'role_ghost',
          permissionId: 'perm_read',
        }),
      ]),
    ).toThrow(DomainError);
    expect(JSON.stringify(snapshot)).toBe(before);
  });
});
