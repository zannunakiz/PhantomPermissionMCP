/**
 * Step 11 cycle-detection coverage (part 1 of 2).
 */
import type { AccessModelSnapshot } from './access-model';
import {
  assertAcyclicInheritance,
  detectInheritanceCycle,
} from './inheritance-cycles';
import { DomainError } from './errors';

export function snapshotWithRoles(
  roleIds: string[],
  edges: Array<[string, string]>,
): AccessModelSnapshot {
  return {
    roles: roleIds.map((id) => ({ id: id as never, name: id })),
    permissions: [],
    bindings: [],
    inheritance: edges.map(([childRoleId, parentRoleId]) => ({
      childRoleId: childRoleId as never,
      parentRoleId: parentRoleId as never,
    })),
    assignments: [],
    subjects: [],
  };
}

export function cycleErrorOf(snapshot: AccessModelSnapshot): DomainError {
  const result = detectInheritanceCycle(snapshot);
  expect(result.ok).toBe(false);
  if (result.ok) {
    throw new Error('Expected a cycle');
  }
  return result.error;
}

describe('inheritance cycles (Step 11) — cycles', () => {
  it('detects a direct self-loop with an explicit path', () => {
    const snapshot = snapshotWithRoles(['role_a'], [['role_a', 'role_a']]);
    const result = detectInheritanceCycle(snapshot);
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('Expected a cycle');
    }
    expect(result.cyclePath).toEqual(['role_a', 'role_a']);
    expect(result.error.code).toBe('inheritance_cycle');
    expect(result.error.details).toContainEqual({
      path: 'inheritance[0]',
      reason: 'inheritance_cycle',
    });
    expect(() => assertAcyclicInheritance(snapshot)).toThrow(DomainError);
  });

  it('detects an indirect cycle and reports the node path', () => {
    const snapshot = snapshotWithRoles(
      ['role_a', 'role_b', 'role_c'],
      [
        ['role_a', 'role_b'],
        ['role_b', 'role_c'],
        ['role_c', 'role_a'],
      ],
    );
    const result = detectInheritanceCycle(snapshot);
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('Expected a cycle');
    }
    expect(result.cyclePath[0]).toBe(
      result.cyclePath[result.cyclePath.length - 1],
    );
    expect([...result.cyclePath].sort()).toEqual(
      ['role_a', 'role_a', 'role_b', 'role_c'].sort(),
    );
    expect(result.error.message).toContain('role_a');
  });
});
