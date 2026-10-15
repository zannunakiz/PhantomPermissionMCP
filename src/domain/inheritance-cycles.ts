/**
 * Inheritance cycle detection (Step 11).
 *
 * Iterative depth-first search over the role inheritance graph, where an
 * edge `{ childRoleId, parentRoleId }` means the child gains the parent's
 * permissions. Traversal follows child → parent links. Returns the first
 * cycle found as an explicit node path (closed loop: first id repeats as
 * the last entry) or reports that the graph is acyclic.
 *
 * Resource bounds (from `DOMAIN_LIMITS`): at most 2000 edges and a
 * traversal depth of 25. Oversized graphs fail fast with
 * `limit_exceeded` instead of risking resource exhaustion. Unknown role
 * references are a Step 10 concern and are ignored here (edges pointing
 * outside the known role set are skipped, never treated as cycles).
 *
 * Pure, deterministic, non-mutating. Details carry `{ path, reason }`
 * only — never echoed input values.
 */
import type { AccessModelSnapshot } from './access-model';
import { DomainError } from './errors';
import { DOMAIN_LIMITS } from './limits';

export type InheritanceCycleResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly error: DomainError;
      readonly cyclePath: readonly string[];
    };

/** Longest chain of child → parent links the engine will traverse. */
export const MAX_INHERITANCE_TRAVERSAL_DEPTH =
  DOMAIN_LIMITS.maxInheritanceDepth;

/** Upper bound on edges examined before failing fast. */
export const MAX_INHERITANCE_EDGES = DOMAIN_LIMITS.maxInheritanceEdges;

function buildParentMap(snapshot: AccessModelSnapshot): Map<string, string[]> {
  const roleIds = new Set(snapshot.roles.map((role) => role.id));
  const parents = new Map<string, string[]>();
  for (const edge of snapshot.inheritance) {
    if (!roleIds.has(edge.childRoleId) || !roleIds.has(edge.parentRoleId)) {
      continue;
    }
    const list = parents.get(edge.childRoleId);
    if (list === undefined) {
      parents.set(edge.childRoleId, [edge.parentRoleId]);
    } else if (!list.includes(edge.parentRoleId)) {
      list.push(edge.parentRoleId);
    }
  }
  for (const list of parents.values()) {
    list.sort();
  }
  return parents;
}

function orderRoleIds(snapshot: AccessModelSnapshot): string[] {
  return snapshot.roles.map((role) => role.id).sort();
}

function cycleDetailPath(
  snapshot: AccessModelSnapshot,
  cyclePath: readonly string[],
): string {
  if (cyclePath.length === 0) {
    return 'inheritance[0]';
  }
  const firstEdge = snapshot.inheritance.findIndex(
    (edge) =>
      edge.childRoleId === cyclePath[0] &&
      cyclePath.includes(edge.parentRoleId),
  );
  return firstEdge === -1 ? 'inheritance[0]' : `inheritance[${firstEdge}]`;
}

/**
 * Detect the first inheritance cycle, if any.
 * Iterative DFS with explicit stack: WHITE (unvisited) → GRAY (on stack)
 * → BLACK (done). A back edge to a GRAY node closes the reported path.
 */
export function detectInheritanceCycle(
  snapshot: AccessModelSnapshot,
): InheritanceCycleResult {
  if (snapshot.inheritance.length > MAX_INHERITANCE_EDGES) {
    return {
      ok: false,
      error: new DomainError(
        'limit_exceeded',
        'Inheritance graph exceeds the edge limit',
        {
          details: [{ path: 'inheritance', reason: 'too_many_edges' }],
        },
      ),
      cyclePath: [],
    };
  }
  const parents = buildParentMap(snapshot);
  const visited = new Set<string>();
  for (const start of orderRoleIds(snapshot)) {
    if (visited.has(start)) {
      continue;
    }
    const stack: string[] = [start];
    const onStack = new Set<string>([start]);
    const childIndex = new Map<string, number>([[start, 0]]);
    let depth = 1;
    while (stack.length > 0) {
      if (depth > MAX_INHERITANCE_TRAVERSAL_DEPTH + 1) {
        return {
          ok: false,
          error: new DomainError(
            'limit_exceeded',
            'Inheritance chain exceeds the depth limit',
            { details: [{ path: 'inheritance', reason: 'depth_exceeded' }] },
          ),
          cyclePath: [],
        };
      }
      const current = stack[stack.length - 1];
      if (current === undefined) {
        break;
      }
      const neighbors = parents.get(current) ?? [];
      const nextIdx = childIndex.get(current) ?? 0;
      if (nextIdx >= neighbors.length) {
        stack.pop();
        onStack.delete(current);
        childIndex.delete(current);
        visited.add(current);
        depth -= 1;
        continue;
      }
      childIndex.set(current, nextIdx + 1);
      const next = neighbors[nextIdx];
      if (next === undefined) {
        continue;
      }
      if (onStack.has(next)) {
        const loopStart = stack.indexOf(next);
        const cyclePath = [...stack.slice(loopStart), next];
        return {
          ok: false,
          error: new DomainError(
            'inheritance_cycle',
            `Inheritance cycle detected: ${cyclePath.join(' -> ')}`,
            {
              details: [
                {
                  path: cycleDetailPath(snapshot, cyclePath),
                  reason: 'inheritance_cycle',
                },
              ],
            },
          ),
          cyclePath,
        };
      }
      if (!visited.has(next)) {
        stack.push(next);
        onStack.add(next);
        childIndex.set(next, 0);
        depth += 1;
      }
    }
  }
  return { ok: true };
}

/**
 * Throwing guard: call after `assertValidStructure` and before Step 12
 * permission resolution so no cyclic model reaches the analysis paths.
 */
export function assertAcyclicInheritance(snapshot: AccessModelSnapshot): void {
  const result = detectInheritanceCycle(snapshot);
  if (!result.ok) {
    throw result.error;
  }
}
