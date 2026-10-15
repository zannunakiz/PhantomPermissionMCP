/**
 * Structural validation for access-model snapshots (Step 10).
 *
 * Cross-array semantics over an already-parsed `AccessModelSnapshot`
 * (Step 09 output): duplicate names/values/pairs, dangling role /
 * permission / subject references, malformed identifiers, self-loops,
 * and empty models. Collects ALL actionable findings (index order,
 * capped) instead of stopping at the first failure.
 *
 * Step 10 / Step 11 boundary: only self-inheritance (`child === parent`)
 * is flagged here as `inheritance_cycle`. Multi-node cycle-path
 * detection belongs to Step 11.
 *
 * Pure, deterministic, non-mutating. Details carry `{ path, reason }`
 * only — never echoed input values.
 */
import type { AccessModelSnapshot } from './access-model';
import { DomainError } from './errors';
import type { DomainErrorCode, DomainErrorDetail } from './errors';
import { isOpaqueId } from './ids';

export type StructuralValidationResult =
  { readonly ok: true } | { readonly ok: false; readonly error: DomainError };

/** Bound on collected findings; overflow is reported, not dropped silently. */
export const MAX_STRUCTURAL_FINDINGS = 100;

function push(
  details: DomainErrorDetail[],
  path: string,
  reason: string,
): void {
  if (details.length >= MAX_STRUCTURAL_FINDINGS) {
    return;
  }
  details.push({ path, reason });
}

function checkIdentifiers(
  snapshot: AccessModelSnapshot,
  details: DomainErrorDetail[],
): void {
  snapshot.roles.forEach((role, index) => {
    if (!isOpaqueId(role.id)) {
      push(details, `roles[${index}].id`, 'invalid_format');
    }
  });
  snapshot.permissions.forEach((permission, index) => {
    if (!isOpaqueId(permission.id)) {
      push(details, `permissions[${index}].id`, 'invalid_format');
    }
  });
  snapshot.subjects.forEach((subject, index) => {
    if (!isOpaqueId(subject.id)) {
      push(details, `subjects[${index}].id`, 'invalid_format');
    }
  });
  snapshot.bindings.forEach((binding, index) => {
    if (!isOpaqueId(binding.roleId)) {
      push(details, `bindings[${index}].roleId`, 'invalid_format');
    }
    if (!isOpaqueId(binding.permissionId)) {
      push(details, `bindings[${index}].permissionId`, 'invalid_format');
    }
  });
  snapshot.assignments.forEach((assignment, index) => {
    if (!isOpaqueId(assignment.subjectId)) {
      push(details, `assignments[${index}].subjectId`, 'invalid_format');
    }
    if (!isOpaqueId(assignment.roleId)) {
      push(details, `assignments[${index}].roleId`, 'invalid_format');
    }
  });
  snapshot.inheritance.forEach((edge, index) => {
    if (!isOpaqueId(edge.childRoleId)) {
      push(details, `inheritance[${index}].childRoleId`, 'invalid_format');
    }
    if (!isOpaqueId(edge.parentRoleId)) {
      push(details, `inheritance[${index}].parentRoleId`, 'invalid_format');
    }
  });
}

function checkDuplicateEntities(
  snapshot: AccessModelSnapshot,
  details: DomainErrorDetail[],
): void {
  const roleIds = new Set<string>();
  snapshot.roles.forEach((role, index) => {
    if (roleIds.has(role.id)) {
      push(details, `roles[${index}].id`, 'duplicate');
    } else {
      roleIds.add(role.id);
    }
  });
  const roleNames = new Set<string>();
  snapshot.roles.forEach((role, index) => {
    if (roleNames.has(role.name)) {
      push(details, `roles[${index}].name`, 'duplicate');
    } else {
      roleNames.add(role.name);
    }
  });
  const permissionIds = new Set<string>();
  snapshot.permissions.forEach((permission, index) => {
    if (permissionIds.has(permission.id)) {
      push(details, `permissions[${index}].id`, 'duplicate');
    } else {
      permissionIds.add(permission.id);
    }
  });
  const permissionValues = new Set<string>();
  snapshot.permissions.forEach((permission, index) => {
    if (permissionValues.has(permission.value)) {
      push(details, `permissions[${index}].value`, 'duplicate');
    } else {
      permissionValues.add(permission.value);
    }
  });
  const bindings = new Set<string>();
  snapshot.bindings.forEach((binding, index) => {
    const key = `${binding.roleId}::${binding.permissionId}`;
    if (bindings.has(key)) {
      push(details, `bindings[${index}]`, 'duplicate');
    } else {
      bindings.add(key);
    }
  });
  const assignments = new Set<string>();
  snapshot.assignments.forEach((assignment, index) => {
    const key = `${assignment.subjectId}::${assignment.roleId}`;
    if (assignments.has(key)) {
      push(details, `assignments[${index}]`, 'duplicate');
    } else {
      assignments.add(key);
    }
  });
  const edges = new Set<string>();
  snapshot.inheritance.forEach((edge, index) => {
    const key = `${edge.childRoleId}::${edge.parentRoleId}`;
    if (edges.has(key)) {
      push(details, `inheritance[${index}]`, 'duplicate');
    } else {
      edges.add(key);
    }
  });
}
function checkReferences(
  snapshot: AccessModelSnapshot,
  details: DomainErrorDetail[],
): void {
  const roleIds = new Set(snapshot.roles.map((role) => role.id));
  const permissionIds = new Set(
    snapshot.permissions.map((permission) => permission.id),
  );
  const subjectIds = new Set(snapshot.subjects.map((subject) => subject.id));
  snapshot.bindings.forEach((binding, index) => {
    if (!roleIds.has(binding.roleId)) {
      push(details, `bindings[${index}].roleId`, 'unknown_role');
    }
    if (!permissionIds.has(binding.permissionId)) {
      push(details, `bindings[${index}].permissionId`, 'unknown_permission');
    }
  });
  snapshot.assignments.forEach((assignment, index) => {
    if (!subjectIds.has(assignment.subjectId)) {
      push(details, `assignments[${index}].subjectId`, 'unknown_subject');
    }
    if (!roleIds.has(assignment.roleId)) {
      push(details, `assignments[${index}].roleId`, 'unknown_role');
    }
  });
  snapshot.inheritance.forEach((edge, index) => {
    if (!roleIds.has(edge.childRoleId)) {
      push(details, `inheritance[${index}].childRoleId`, 'unknown_role');
    }
    if (!roleIds.has(edge.parentRoleId)) {
      push(details, `inheritance[${index}].parentRoleId`, 'unknown_role');
    }
    if (
      edge.childRoleId === edge.parentRoleId &&
      isOpaqueId(edge.childRoleId)
    ) {
      push(details, `inheritance[${index}]`, 'self_cycle');
    }
  });
}

function errorCodeFor(details: DomainErrorDetail[]): DomainErrorCode {
  if (details.some((detail) => detail.reason === 'self_cycle')) {
    return 'inheritance_cycle';
  }
  if (details.some((detail) => detail.reason === 'duplicate')) {
    return 'duplicate_entity';
  }
  if (
    details.some(
      (detail) =>
        detail.reason === 'unknown_role' ||
        detail.reason === 'unknown_permission' ||
        detail.reason === 'unknown_subject',
    )
  ) {
    return 'invalid_reference';
  }
  if (details.some((detail) => detail.reason === 'invalid_format')) {
    return 'invalid_identifier';
  }
  if (
    details.length === 1 &&
    details[0]?.reason === 'empty_snapshot' &&
    details[0]?.path === '(body)'
  ) {
    return 'empty_model';
  }
  return 'invalid_identifier';
}

/**
 * Validate snapshot structure, collecting every actionable finding.
 * Never mutates the input; findings are index-ordered and capped at
 * {@link MAX_STRUCTURAL_FINDINGS} with a trailing overflow marker.
 */
export function validateStructure(
  snapshot: AccessModelSnapshot,
): StructuralValidationResult {
  const details: DomainErrorDetail[] = [];
  checkIdentifiers(snapshot, details);
  checkDuplicateEntities(snapshot, details);
  checkReferences(snapshot, details);
  if (snapshot.roles.length === 0 && snapshot.permissions.length === 0) {
    push(details, '(body)', 'empty_snapshot');
  }
  if (details.length === 0) {
    return { ok: true };
  }
  const capped = details.slice(0, MAX_STRUCTURAL_FINDINGS);
  if (details.length >= MAX_STRUCTURAL_FINDINGS) {
    capped.push({ path: '(body)', reason: 'too_many_findings' });
  }
  const unique = capped.slice(0, MAX_STRUCTURAL_FINDINGS + 1);
  return {
    ok: false,
    error: new DomainError(
      errorCodeFor(unique),
      'Access model structure is invalid',
      { details: unique },
    ),
  };
}

/**
 * Throwing guard for Step 12+: call before permission resolution so no
 * invalid model reaches the analysis paths.
 */
export function assertValidStructure(snapshot: AccessModelSnapshot): void {
  const result = validateStructure(snapshot);
  if (!result.ok) {
    throw result.error;
  }
}
