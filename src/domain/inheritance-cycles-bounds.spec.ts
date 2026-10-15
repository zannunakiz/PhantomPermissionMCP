/**
 * Step 11 cycle-detection coverage (part 2 of 2).
 */
import { DomainError } from './errors';
import {
  assertAcyclicInheritance,
  detectInheritanceCycle,
} from './inheritance-cycles';
import { snapshotWithRoles } from './inheritance-cycles.spec';

describe('inheritance cycles (Step 11) — valid and bounded', () => {
  it('accepts disconnected graphs without cycles', () => {
    const snapshot = snapshotWithRoles(
      ['role_a', 'role_b', 'role_c', 'role_d'],
      [
        ['role_a', 'role_b'],
        ['role_c', 'role_d'],
      ],
    );
    expect(detectInheritanceCycle(snapshot)).toEqual({ ok: true });
    expect(() => assertAcyclicInheritance(snapshot)).not.toThrow();
  });

  it('accepts a deep valid chain within the depth limit', () => {
    const roleIds = Array.from({ length: 20 }, (_, i) => `role_${i}`);
    const edges: Array<[string, string]> = roleIds
      .slice(0, -1)
      .map((id, i) => [id, roleIds[i + 1]] as [string, string]);
    const snapshot = snapshotWithRoles(roleIds, edges);
    expect(detectInheritanceCycle(snapshot)).toEqual({ ok: true });
  });

  it('rejects chains deeper than the traversal bound', () => {
    const roleIds = Array.from({ length: 30 }, (_, i) => `role_${i}`);
    const edges: Array<[string, string]> = roleIds
      .slice(0, -1)
      .map((id, i) => [id, roleIds[i + 1]] as [string, string]);
    const snapshot = snapshotWithRoles(roleIds, edges);
    const result = detectInheritanceCycle(snapshot);
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('Expected a depth rejection');
    }
    expect(result.error.code).toBe('limit_exceeded');
    expect(result.error.details).toContainEqual({
      path: 'inheritance',
      reason: 'depth_exceeded',
    });
  });

  it('rejects edge counts beyond the resource bound', () => {
    const snapshot = snapshotWithRoles(['role_a', 'role_b'], []);
    const edges = Array.from({ length: 2001 }, () => ({
      childRoleId: 'role_a' as never,
      parentRoleId: 'role_b' as never,
    }));
    const oversized = { ...snapshot, inheritance: edges };
    const result = detectInheritanceCycle(oversized);
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('Expected an edge-limit rejection');
    }
    expect(result.error).toBeInstanceOf(DomainError);
    expect(result.error.code).toBe('limit_exceeded');
    expect(result.error.details).toContainEqual({
      path: 'inheritance',
      reason: 'too_many_edges',
    });
  });

  it('never mutates frozen input', () => {
    const snapshot = snapshotWithRoles(
      ['role_a', 'role_b'],
      [['role_a', 'role_b']],
    );
    expect(() =>
      assertAcyclicInheritance(Object.freeze(snapshot)),
    ).not.toThrow();
  });
});
