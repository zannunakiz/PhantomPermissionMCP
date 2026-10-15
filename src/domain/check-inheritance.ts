/**
 * Change-operation preconditions, part 2a: inheritance checks.
 */
import type { AccessModelSnapshot } from './access-model';
import { DomainError } from './errors';
import type { OperationOutcome } from './operation-preconditions-types';
import { detectInheritanceCycle } from './inheritance-cycles';
import { pathFor, refError } from './operation-preconditions';

export function remapPath(
  outcome: OperationOutcome,
  index: number,
  field: string,
): OperationOutcome {
  if (outcome.kind !== 'error') {
    return outcome;
  }
  return {
    kind: 'error',
    error: new DomainError(outcome.error.code, outcome.error.message, {
      details: [
        {
          path: pathFor(index, field),
          reason: outcome.error.details[0]?.reason ?? 'unknown',
        },
      ],
    }),
  };
}

export function checkAddInheritance(
  snapshot: AccessModelSnapshot,
  childRoleId: string,
  parentRoleId: string,
  index: number,
): OperationOutcome {
  const roles = new Set(snapshot.roles.map((r) => r.id as string));
  if (!roles.has(childRoleId)) {
    return remapPath(
      refError(index, 'childRoleId', 'unknown_role', 'Unknown role'),
      index,
      'childRoleId',
    );
  }
  if (!roles.has(parentRoleId)) {
    return remapPath(
      refError(index, 'parentRoleId', 'unknown_role', 'Unknown role'),
      index,
      'parentRoleId',
    );
  }
  if (childRoleId === parentRoleId) {
    return {
      kind: 'error',
      error: new DomainError('inheritance_cycle', 'Self-inheritance', {
        details: [{ path: `operations[${index}]`, reason: 'self_cycle' }],
      }),
    };
  }
  const exists = snapshot.inheritance.some(
    (e) =>
      (e.childRoleId as string) === childRoleId &&
      (e.parentRoleId as string) === parentRoleId,
  );
  if (exists) {
    return { kind: 'noop', reason: 'already_inherits' };
  }
  const simulated: AccessModelSnapshot = {
    ...snapshot,
    inheritance: [
      ...snapshot.inheritance,
      {
        childRoleId: childRoleId as never,
        parentRoleId: parentRoleId as never,
      },
    ],
  };
  const cycle = detectInheritanceCycle(simulated);
  if (!cycle.ok) {
    return {
      kind: 'error',
      error: new DomainError('inheritance_cycle', 'Cycle-creating edge', {
        details: [
          { path: `operations[${index}]`, reason: 'inheritance_cycle' },
        ],
      }),
    };
  }
  return { kind: 'apply' };
}

export function checkRemoveInheritance(
  snapshot: AccessModelSnapshot,
  childRoleId: string,
  parentRoleId: string,
  index: number,
): OperationOutcome {
  const roles = new Set(snapshot.roles.map((r) => r.id as string));
  if (!roles.has(childRoleId)) {
    return remapPath(
      refError(index, 'childRoleId', 'unknown_role', 'Unknown role'),
      index,
      'childRoleId',
    );
  }
  if (!roles.has(parentRoleId)) {
    return remapPath(
      refError(index, 'parentRoleId', 'unknown_role', 'Unknown role'),
      index,
      'parentRoleId',
    );
  }
  const exists = snapshot.inheritance.some(
    (e) =>
      (e.childRoleId as string) === childRoleId &&
      (e.parentRoleId as string) === parentRoleId,
  );
  if (exists) {
    return { kind: 'apply' };
  }
  void index;
  return { kind: 'noop', reason: 'not_inherited' };
}
