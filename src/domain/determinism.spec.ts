/**
 * Step 18 determinism properties (part 1): invariance + diffs.
 */
import { simulateChange } from './calculate-impact';
import { resolveSubjectPermissions } from './resolve-permissions';
import { simulateWithFindings } from './risk-rules';
import {
  DETERMINISM_SEEDS,
  deepFreeze,
  mulberry32,
  pick,
  randomSnapshot,
  shuffled,
} from './determinism-helpers';

describe('determinism properties (Step 18) — invariance', () => {
  for (const seed of DETERMINISM_SEEDS) {
    it(`ordering invariance holds (seed ${seed})`, () => {
      const rand = mulberry32(seed);
      for (let n = 0; n < 10; n += 1) {
        const base = randomSnapshot(rand);
        const variant = {
          ...base,
          roles: shuffled(rand, base.roles),
          bindings: shuffled(rand, base.bindings),
          inheritance: shuffled(rand, base.inheritance),
        };
        const expected = resolveSubjectPermissions(base, 'subj_ana');
        const actual = resolveSubjectPermissions(variant, 'subj_ana');
        expect({ seed, case: n, actual }).toEqual({
          seed,
          case: n,
          actual: expected,
        });
        const perm = pick(rand, base.permissions);
        const role = pick(rand, base.roles);
        const ops = [
          {
            type: 'grant_permission' as const,
            roleId: role.id,
            permissionId: perm.id,
          },
        ];
        expect({
          seed,
          case: n,
          actual: JSON.stringify(simulateChange(variant, ops)),
        }).toEqual({
          seed,
          case: n,
          actual: JSON.stringify(simulateChange(base, ops)),
        });
      }
    });

    it(`pipeline never mutates frozen input (seed ${seed})`, () => {
      const rand = mulberry32(seed + 999);
      for (let n = 0; n < 10; n += 1) {
        const snapshot = deepFreeze(randomSnapshot(rand));
        const before = JSON.stringify(snapshot);
        simulateWithFindings(snapshot, []);
        expect({ seed, case: n, after: JSON.stringify(snapshot) }).toEqual({
          seed,
          case: n,
          after: before,
        });
      }
    });
  }

  it('dedupes values and reconciles diff counts deterministically', () => {
    const base = randomSnapshot(mulberry32(5));
    const extraRole = { id: 'role_extra', name: 'role-extra' };
    const sharedPerm = base.permissions[0];
    if (sharedPerm === undefined) {
      throw new Error('generator must yield a permission');
    }
    const converged = {
      ...base,
      roles: [...base.roles, extraRole],
      bindings: [
        ...base.bindings,
        { roleId: extraRole.id, permissionId: sharedPerm.id },
      ],
      assignments: [
        ...base.assignments,
        { subjectId: 'subj_ana', roleId: extraRole.id },
      ],
    };
    const resolved = resolveSubjectPermissions(converged, 'subj_ana');
    expect(resolved).toEqual([...new Set(resolved)].sort());
    expect(resolved.filter((v) => v === sharedPerm.value)).toHaveLength(1);
    for (const seed of DETERMINISM_SEEDS) {
      const rand = mulberry32(seed * 31 + 3);
      for (let n = 0; n < 10; n += 1) {
        const snap = randomSnapshot(rand);
        const perm = pick(rand, snap.permissions);
        const role = pick(rand, snap.roles);
        const result = simulateChange(snap, [
          { type: 'grant_permission', roleId: role.id, permissionId: perm.id },
        ]);
        const added = result.impacts.reduce((k, r) => k + r.added.length, 0);
        const removed = result.impacts.reduce(
          (k, r) => k + r.removed.length,
          0,
        );
        expect(result.summary.addedCount).toBe(added);
        expect(result.summary.removedCount).toBe(removed);
        expect(result.summary.affectedSubjectCount).toBe(result.impacts.length);
        const ids = result.impacts.map((r) => r.subjectId as string);
        expect(ids).toEqual([...ids].sort());
      }
    }
  });
});
