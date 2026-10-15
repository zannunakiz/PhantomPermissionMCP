/**
 * Immutable change application.
 *
 * Pure ordered application of validated operations against a working
 * clone: the input snapshot is never altered on success or failure.
 * Each operation is checked against the evolving draft
 * (`checkOperation`), so later operations observe earlier effects.
 * Benign conflicts are recorded as no-ops; violations abort with the
 * failing index. A final structural + acyclicity revalidation guards
 * the result before it is returned.
 *
 * Only domain imports. No Nest/ORM/HTTP/MCP/Zod.
 */
import type { AccessModelSnapshot } from './access-model';
import type { ChangeOperation } from './operations';
import { DomainError } from './errors';
import { assertAcyclicInheritance } from './inheritance-cycles';
import { assertValidStructure } from './validate-structure';
import { checkOperation } from './check-operations';

export type ApplyOperationsResult =
  | {
      readonly ok: true;
      readonly snapshot: AccessModelSnapshot;
      readonly applied: readonly number[];
      readonly noop: readonly number[];
    }
  | {
      readonly ok: false;
      readonly error: DomainError;
      readonly failedIndex: number;
    };

function cloneSnapshot(snapshot: AccessModelSnapshot): {
  roles: { id: string; name: string; description?: string }[];
  permissions: { id: string; value: string }[];
  bindings: { roleId: string; permissionId: string }[];
  inheritance: { childRoleId: string; parentRoleId: string }[];
  assignments: { subjectId: string; roleId: string }[];
  subjects: { id: string; displayName?: string }[];
} {
  return {
    roles: snapshot.roles.map((r) => ({ ...r })),
    permissions: snapshot.permissions.map((p) => ({ ...p })),
    bindings: snapshot.bindings.map((b) => ({ ...b })),
    inheritance: snapshot.inheritance.map((e) => ({ ...e })),
    assignments: snapshot.assignments.map((a) => ({ ...a })),
    subjects: snapshot.subjects.map((s) => ({ ...s })),
  };
}

type MutableDraft = ReturnType<typeof cloneSnapshot>;

function mutateDraft(draft: MutableDraft, operation: ChangeOperation): void {
  switch (operation.type) {
    case 'grant_permission':
      draft.bindings.push({
        roleId: operation.roleId,
        permissionId: operation.permissionId,
      });
      break;
    case 'revoke_permission': {
      const index = draft.bindings.findIndex(
        (b) =>
          b.roleId === operation.roleId &&
          b.permissionId === operation.permissionId,
      );
      if (index !== -1) {
        draft.bindings.splice(index, 1);
      }
      break;
    }
    case 'assign_role':
      draft.assignments.push({
        subjectId: operation.subjectId,
        roleId: operation.roleId,
      });
      break;
    case 'unassign_role': {
      const index = draft.assignments.findIndex(
        (a) =>
          a.subjectId === operation.subjectId && a.roleId === operation.roleId,
      );
      if (index !== -1) {
        draft.assignments.splice(index, 1);
      }
      break;
    }
    case 'add_inheritance':
      draft.inheritance.push({
        childRoleId: operation.childRoleId,
        parentRoleId: operation.parentRoleId,
      });
      break;
    case 'remove_inheritance': {
      const index = draft.inheritance.findIndex(
        (e) =>
          e.childRoleId === operation.childRoleId &&
          e.parentRoleId === operation.parentRoleId,
      );
      if (index !== -1) {
        draft.inheritance.splice(index, 1);
      }
      break;
    }
    default: {
      const exhaustive: never = operation;
      throw new DomainError(
        'unsupported_operation',
        `Unsupported operation type: ${String((exhaustive as { type?: unknown }).type)}`,
      );
    }
  }
}

/** Apply operations in order against a clone; input never mutated. */
export function applyOperations(
  snapshot: AccessModelSnapshot,
  operations: readonly ChangeOperation[],
): ApplyOperationsResult {
  const draft = cloneSnapshot(snapshot);
  const applied: number[] = [];
  const noop: number[] = [];
  const view = (): AccessModelSnapshot =>
    draft as unknown as AccessModelSnapshot;
  for (let index = 0; index < operations.length; index += 1) {
    const operation = operations[index];
    if (operation === undefined) {
      continue;
    }
    const outcome = checkOperation(view(), operation, index);
    if (outcome.kind === 'error') {
      return { ok: false, error: outcome.error, failedIndex: index };
    }
    if (outcome.kind === 'noop') {
      noop.push(index);
      continue;
    }
    mutateDraft(draft, operation);
    applied.push(index);
  }
  try {
    assertValidStructure(view());
    assertAcyclicInheritance(view());
  } catch (error: unknown) {
    const domainError =
      error instanceof DomainError
        ? error
        : new DomainError('invalid_reference', 'Resulting model invalid');
    return { ok: false, error: domainError, failedIndex: operations.length };
  }
  return { ok: true, snapshot: view(), applied, noop };
}

/** Throwing convenience for impact pipelines. */
export function assertApplyOperations(
  snapshot: AccessModelSnapshot,
  operations: readonly ChangeOperation[],
): AccessModelSnapshot {
  const result = applyOperations(snapshot, operations);
  if (!result.ok) {
    throw result.error;
  }
  return result.snapshot;
}
