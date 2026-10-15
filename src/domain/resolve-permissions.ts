/**
 * Effective permission resolution.
 *
 * Read-only analysis over a validated snapshot:
 * `effective(subject) = union of permissions bound to directly assigned
 * roles + all transitively inherited permissions`, deduplicated and
 * sorted lexicographically for determinism.
 *
 * Guards run first: `assertValidStructure` then
 * `assertAcyclicInheritance`, so no invalid model reaches the
 * traversal. Unknown subjects throw `invalid_reference` rather than
 * returning `[]`, so typos never masquerade as "no access".
 *
 * Pure, non-mutating, no clock/randomness. Only domain imports.
 */
import type { AccessModelSnapshot } from './access-model';
import { DomainError } from './errors';
import { DOMAIN_LIMITS } from './limits';
import { assertAcyclicInheritance } from './inheritance-cycles';
import { assertValidStructure } from './validate-structure';

function buildPermissionValues(
  snapshot: AccessModelSnapshot,
): Map<string, string> {
  const values = new Map<string, string>();
  for (const permission of snapshot.permissions) {
    if (!values.has(permission.id)) {
      values.set(permission.id, permission.value);
    }
  }
  return values;
}

function buildDirectGrants(
  snapshot: AccessModelSnapshot,
): Map<string, string[]> {
  const grants = new Map<string, string[]>();
  for (const binding of snapshot.bindings) {
    const list = grants.get(binding.roleId);
    if (list === undefined) {
      grants.set(binding.roleId, [binding.permissionId]);
    } else if (!list.includes(binding.permissionId)) {
      list.push(binding.permissionId);
    }
  }
  return grants;
}

function buildParentLinks(
  snapshot: AccessModelSnapshot,
): Map<string, string[]> {
  const links = new Map<string, string[]>();
  for (const edge of snapshot.inheritance) {
    const list = links.get(edge.childRoleId);
    if (list === undefined) {
      links.set(edge.childRoleId, [edge.parentRoleId]);
    } else if (!list.includes(edge.parentRoleId)) {
      list.push(edge.parentRoleId);
    }
  }
  for (const list of links.values()) {
    list.sort();
  }
  return links;
}

function collectRoleClosure(
  assigned: readonly string[],
  parents: Map<string, string[]>,
): Set<string> {
  const closure = new Set<string>();
  const stack = [...assigned].sort();
  let depth = 0;
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined || closure.has(current)) {
      continue;
    }
    closure.add(current);
    depth += 1;
    if (depth > DOMAIN_LIMITS.maxInheritanceDepth * 10) {
      throw new DomainError('limit_exceeded', 'Resolution exceeded bounds', {
        details: [{ path: 'inheritance', reason: 'depth_exceeded' }],
      });
    }
    const directParents = parents.get(current) ?? [];
    for (const parent of directParents) {
      if (!closure.has(parent)) {
        stack.push(parent);
      }
    }
  }
  return closure;
}

function guardSnapshot(snapshot: AccessModelSnapshot): void {
  assertValidStructure(snapshot);
  assertAcyclicInheritance(snapshot);
}

/** Resolve one subject's effective permission values, sorted. */
export function resolveSubjectPermissions(
  snapshot: AccessModelSnapshot,
  subjectId: string,
): readonly string[] {
  guardSnapshot(snapshot);
  const knownSubjects = new Set<string>(
    snapshot.subjects.map((s) => s.id as string),
  );
  if (!knownSubjects.has(subjectId)) {
    throw new DomainError('invalid_reference', 'Unknown subject', {
      details: [{ path: 'subjectId', reason: 'unknown_subject' }],
    });
  }
  const permissionValues = buildPermissionValues(snapshot);
  const grants = buildDirectGrants(snapshot);
  const parents = buildParentLinks(snapshot);
  const assigned = snapshot.assignments
    .filter((a) => a.subjectId === subjectId)
    .map((a) => a.roleId);
  const roles = collectRoleClosure(assigned, parents);
  const values = new Set<string>();
  for (const roleId of roles) {
    const granted = grants.get(roleId) ?? [];
    for (const permissionId of granted) {
      const value = permissionValues.get(permissionId);
      if (value !== undefined) {
        values.add(value);
      }
    }
  }
  return [...values].sort();
}

/** Resolve every known subject; delegates to the single-subject path. */
export function resolveAllSubjects(
  snapshot: AccessModelSnapshot,
): ReadonlyMap<string, readonly string[]> {
  guardSnapshot(snapshot);
  const out = new Map<string, readonly string[]>();
  const ids = snapshot.subjects.map((s) => s.id).sort();
  for (const id of ids) {
    out.set(id, resolveSubjectPermissions(snapshot, id));
  }
  return out;
}
