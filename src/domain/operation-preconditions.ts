/**
 * Change-operation preconditions, part 1: grant/revoke/assign.
 *
 * Semantic checks against a validated snapshot. Guards
 * (`assertValidStructure` + `assertAcyclicInheritance`) run first.
 * Pure, deterministic, non-mutating. Details carry `{ path, reason }`.
 */
import type { AccessModelSnapshot } from './access-model';
import { DomainError } from './errors';
import type { OperationOutcome } from './operation-preconditions-types';
import { assertAcyclicInheritance } from './inheritance-cycles';
import { assertValidStructure } from './validate-structure';

export function guardSnapshot(snapshot: AccessModelSnapshot): void {
  assertValidStructure(snapshot);
  assertAcyclicInheritance(snapshot);
}

export function pathFor(index: number, field: string): string {
  return `operations[${index}].${field}`;
}

export function refError(
  index: number,
  field: string,
  reason: string,
  message: string,
): OperationOutcome {
  return {
    kind: 'error',
    error: new DomainError('invalid_reference', message, {
      details: [{ path: pathFor(index, field), reason }],
    }),
  };
}

export function checkGrantRevoke(
  snapshot: AccessModelSnapshot,
  type: 'grant_permission' | 'revoke_permission',
  roleId: string,
  permissionId: string,
): OperationOutcome {
  const roles = new Set(snapshot.roles.map((r) => r.id as string));
  const permissions = new Set(snapshot.permissions.map((p) => p.id as string));
  if (!roles.has(roleId)) {
    return {
      kind: 'error',
      error: new DomainError('invalid_reference', 'Unknown role', {
        details: [{ path: 'roleId', reason: 'unknown_role' }],
      }),
    };
  }
  if (!permissions.has(permissionId)) {
    return {
      kind: 'error',
      error: new DomainError('invalid_reference', 'Unknown permission', {
        details: [{ path: 'permissionId', reason: 'unknown_permission' }],
      }),
    };
  }
  const exists = snapshot.bindings.some(
    (b) =>
      (b.roleId as string) === roleId &&
      (b.permissionId as string) === permissionId,
  );
  if (type === 'grant_permission') {
    return exists
      ? { kind: 'noop', reason: 'already_granted' }
      : { kind: 'apply' };
  }
  return exists ? { kind: 'apply' } : { kind: 'noop', reason: 'not_granted' };
}

export function checkAssignUnassign(
  snapshot: AccessModelSnapshot,
  type: 'assign_role' | 'unassign_role',
  subjectId: string,
  roleId: string,
): OperationOutcome {
  const subjects = new Set(snapshot.subjects.map((s) => s.id as string));
  const roles = new Set(snapshot.roles.map((r) => r.id as string));
  if (!subjects.has(subjectId)) {
    return {
      kind: 'error',
      error: new DomainError('invalid_reference', 'Unknown subject', {
        details: [{ path: 'subjectId', reason: 'unknown_subject' }],
      }),
    };
  }
  if (!roles.has(roleId)) {
    return {
      kind: 'error',
      error: new DomainError('invalid_reference', 'Unknown role', {
        details: [{ path: 'roleId', reason: 'unknown_role' }],
      }),
    };
  }
  const exists = snapshot.assignments.some(
    (a) =>
      (a.subjectId as string) === subjectId && (a.roleId as string) === roleId,
  );
  if (type === 'assign_role') {
    return exists
      ? { kind: 'noop', reason: 'already_assigned' }
      : { kind: 'apply' };
  }
  return exists ? { kind: 'apply' } : { kind: 'noop', reason: 'not_assigned' };
}
