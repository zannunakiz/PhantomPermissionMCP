/**
 * Determinism helpers: seeded PRNG + generators.
 *
 * No new dependencies: mulberry32 drives generated cases from fixed
 * seeds. Any failure prints its seed for exact reproduction.
 */
import type { AccessModelSnapshot } from './access-model';

export const DETERMINISM_SEEDS = [1, 7, 42, 1337, 20261015] as const;

export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

export function pick<T>(rand: () => number, items: readonly T[]): T {
  const item = items[Math.floor(rand() * items.length)];
  if (item === undefined) {
    throw new Error('pick from empty list');
  }
  return item;
}

export function shuffled<T>(rand: () => number, items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    const current = out[i];
    const other = out[j];
    if (current === undefined || other === undefined) {
      continue;
    }
    out[i] = other;
    out[j] = current;
  }
  return out;
}

export function deepFreeze<T>(value: T): T {
  if (Array.isArray(value)) {
    value.forEach(deepFreeze);
    return Object.freeze(value);
  }
  if (typeof value === 'object' && value !== null) {
    Object.values(value).forEach(deepFreeze);
    return Object.freeze(value);
  }
  return value;
}

/** Random valid snapshot: 2-5 roles in a chain, 1-4 permissions. */
export function randomSnapshot(rand: () => number): AccessModelSnapshot {
  const roleCount = 2 + Math.floor(rand() * 4);
  const permCount = 1 + Math.floor(rand() * 4);
  const roles = Array.from({ length: roleCount }, (_, i) => ({
    id: `role_${i}` as never,
    name: `role-${i}`,
  }));
  const permissions = Array.from({ length: permCount }, (_, i) => ({
    id: `perm_${i}` as never,
    value: `doc:read-${i}`,
  }));
  const bindings = permissions.map((p, i) => {
    const role = roles[i % roles.length];
    if (role === undefined) {
      throw new Error('generator role missing');
    }
    return { roleId: role.id, permissionId: p.id };
  });
  const inheritance = roles.slice(1).map((r, i) => {
    const parent = roles[i];
    if (parent === undefined) {
      throw new Error('generator parent missing');
    }
    return { childRoleId: r.id, parentRoleId: parent.id };
  });
  const firstRole = roles[0];
  if (firstRole === undefined) {
    throw new Error('generator first role missing');
  }
  return {
    roles,
    permissions,
    bindings,
    inheritance,
    assignments: [{ subjectId: 'subj_ana' as never, roleId: firstRole.id }],
    subjects: [{ id: 'subj_ana' as never }],
  };
}
