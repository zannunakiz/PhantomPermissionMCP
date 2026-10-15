/**
 * Change-operation preconditions (Step 13), part 2b: entry points.
 *
 * `checkOperation` is exhaustive over the six supported types with a
 * defensive `unsupported_operation` fallback for runtime-unknown values.
 */
import type { AccessModelSnapshot } from './access-model';
import type { ChangeOperation } from './operations';
import { DomainError } from './errors';
import type { OperationOutcome } from './operation-preconditions-types';
import {
  checkAddInheritance,
  checkRemoveInheritance,
} from './check-inheritance';
import {
  checkAssignUnassign,
  checkGrantRevoke,
  guardSnapshot,
  pathFor,
} from './operation-preconditions';

function withOpPath(
  outcome: OperationOutcome,
  index: number,
): OperationOutcome {
  if (outcome.kind !== 'error') {
    return outcome;
  }
  const detail = outcome.error.details[0];
  const field = detail?.path ?? '(body)';
  const path = field.startsWith('operations[') ? field : pathFor(index, field);
  return {
    kind: 'error',
    error: new DomainError(outcome.error.code, outcome.error.message, {
      details: [{ path, reason: detail?.reason ?? 'unknown' }],
    }),
  };
}

/** Check one operation; exhaustive over the six supported types. */
export function checkOperation(
  snapshot: AccessModelSnapshot,
  operation: ChangeOperation,
  index: number,
): OperationOutcome {
  guardSnapshot(snapshot);
  switch (operation.type) {
    case 'grant_permission':
    case 'revoke_permission':
      return withOpPath(
        checkGrantRevoke(
          snapshot,
          operation.type,
          operation.roleId,
          operation.permissionId,
        ),
        index,
      );
    case 'assign_role':
    case 'unassign_role':
      return withOpPath(
        checkAssignUnassign(
          snapshot,
          operation.type,
          operation.subjectId,
          operation.roleId,
        ),
        index,
      );
    case 'add_inheritance':
      return checkAddInheritance(
        snapshot,
        operation.childRoleId,
        operation.parentRoleId,
        index,
      );
    case 'remove_inheritance':
      return withOpPath(
        checkRemoveInheritance(
          snapshot,
          operation.childRoleId,
          operation.parentRoleId,
          index,
        ),
        index,
      );
    default: {
      const exhaustive: never = operation;
      const rawType = (exhaustive as { type?: unknown }).type;
      return {
        kind: 'error',
        error: new DomainError(
          'unsupported_operation',
          `Unsupported operation type: ${String(rawType)}`,
          {
            details: [
              { path: pathFor(index, 'type'), reason: 'unsupported_operation' },
            ],
          },
        ),
      };
    }
  }
}

/** Check an ordered list; index-ordered outcomes, pure. */
export function checkOperations(
  snapshot: AccessModelSnapshot,
  operations: readonly ChangeOperation[],
): readonly OperationOutcome[] {
  return operations.map((operation, index) =>
    checkOperation(snapshot, operation, index),
  );
}
