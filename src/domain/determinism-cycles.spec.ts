/**
 * Step 18 determinism properties (part 2): cycles + bounded perf.
 *
 * Random DAGs (edges only child-index > parent-index, provably acyclic)
 * must pass; adding one back-edge must always be rejected. The perf
 * case uses a documented synthetic size within DOMAIN_LIMITS with a
 * generous wall-clock bound — never tight timing.
 */
import type { AccessModelSnapshot } from './access-model';
import { assertApplyOperations } from './apply-operations';
import { detectInheritanceCycle } from './inheritance-cycles';
import { simulateWithFindings } from './risk-rules';
import { DETERMINISM_SEEDS, mulberry32 } from './determinism-helpers';

/** 6 roles with a guaranteed spine 0→1→…→5 plus optional extra edges. */
function randomDag(rand: () => number): AccessModelSnapshot {
  const roles = Array.from({ length: 6 }, (_, i) => ({
    id: `role_${i}`,
    name: `role-${i}`,
  }));
  const inheritance: { childRoleId: string; parentRoleId: string }[] = [];
  for (let child = 1; child < 6; child += 1) {
    const childRole = roles[child];
    const spineParent = roles[child - 1];
    if (childRole === undefined || spineParent === undefined) {
      throw new Error('dag spine missing');
    }
    inheritance.push({
      childRoleId: childRole.id,
      parentRoleId: spineParent.id,
    });
    if (child >= 2 && rand() < 0.4) {
      const parent = Math.floor(rand() * (child - 1));
      const childRole = roles[child];
      const parentRole = roles[parent];
      if (childRole === undefined || parentRole === undefined) {
        throw new Error('dag edge missing');
      }
      inheritance.push({
        childRoleId: childRole.id,
        parentRoleId: parentRole.id,
      });
    }
  }
  return {
    roles,
    permissions: [{ id: 'perm_p', value: 'doc:read' }],
    bindings: [{ roleId: 'role_0', permissionId: 'perm_p' }],
    inheritance,
    assignments: [],
    subjects: [],
  };
}

describe('determinism properties (Step 18) — cycles and perf', () => {
  for (const seed of DETERMINISM_SEEDS) {
    it(`generated DAGs pass, back-edges fail (seed ${seed})`, () => {
      const rand = mulberry32(seed * 77 + 1);
      for (let n = 0; n < 10; n += 1) {
        const dag = randomDag(rand);
        const acyclic = detectInheritanceCycle(dag);
        expect({ seed, case: n, acyclic }).toEqual({
          seed,
          case: n,
          acyclic: { ok: true },
        });
        const withBackEdge: AccessModelSnapshot = {
          ...dag,
          inheritance: [
            ...dag.inheritance,
            // Spine guarantees role_5 reaches role_0, so this closes a loop.
            { childRoleId: 'role_0', parentRoleId: 'role_5' },
          ],
        };
        const cycled = detectInheritanceCycle(withBackEdge);
        expect(cycled.ok).toBe(false);
        if (!cycled.ok) {
          expect(cycled.error.code).toBe('inheritance_cycle');
        }
      }
    });
  }

  it('completes a bounded synthetic model within limits', () => {
    // Wide fan-out (depth 2), all counts within DOMAIN_LIMITS:
    // 200 roles / 800 perms / 800 bindings / 199 edges / 200 subjects.
    const roleCount = 200;
    const permCount = 800;
    const roles = Array.from({ length: roleCount }, (_, i) => ({
      id: `role_${i}`,
      name: `role-${i}`,
    }));
    const permissions = Array.from({ length: permCount }, (_, i) => ({
      id: `perm_${i}`,
      value: `doc:read-${i}`,
    }));
    const bindings = permissions.map((p, i) => ({
      roleId: roles[i % roleCount]?.id as never,
      permissionId: p.id,
    }));
    const inheritance = roles.slice(1).map((r) => ({
      childRoleId: r.id,
      parentRoleId: roles[0]?.id as never,
    }));
    const subjects = Array.from({ length: 200 }, (_, i) => ({
      id: `subj_${i}`,
    }));
    const snapshot: AccessModelSnapshot = {
      roles,
      permissions,
      bindings,
      inheritance,
      assignments: subjects.map((s, i) => ({
        subjectId: s.id,
        roleId: roles[i % roleCount]?.id as never,
      })),
      subjects,
    };
    const operations = permissions.slice(0, 50).map((p) => ({
      type: 'grant_permission' as const,
      roleId: roles[0]?.id as never,
      permissionId: p.id,
    }));
    const startedAt = Date.now();
    const result = simulateWithFindings(snapshot, operations);
    const durationMs = Date.now() - startedAt;
    expect(result.impacts.length).toBeGreaterThan(0);
    expect(result.summary.addedCount).toBeGreaterThan(0);
    expect(durationMs).toBeLessThan(30000);
    expect(() => assertApplyOperations(snapshot, operations)).not.toThrow();
  });
});
