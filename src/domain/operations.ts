/**
 * Supported change operations.
 *
 * Mirrors docs/architecture/overview.md §5 and docs/api/v1-contract.md
 * §4 (simulations). A discriminated union so consumers can
 * exhaustively switch on `type`. Preconditions and conflict behaviour
 * are documented per operation; enforcement belongs to the
 * precondition + application modules.
 *
 * Unknown operation types are unrepresentable at the type level.
 */
import type { ModelId, PermissionId, RoleId, SubjectId } from './ids';

export const OPERATION_TYPES = [
  'grant_permission',
  'revoke_permission',
  'assign_role',
  'unassign_role',
  'add_inheritance',
  'remove_inheritance',
] as const;

export type OperationType = (typeof OPERATION_TYPES)[number];

/** Both exist; binding absent. Existing binding → no-op entry, not an error. */
export type GrantPermissionOperation = {
  readonly type: 'grant_permission';
  readonly roleId: RoleId;
  readonly permissionId: PermissionId;
};

/** Both exist. Missing binding → no-op entry. */
export type RevokePermissionOperation = {
  readonly type: 'revoke_permission';
  readonly roleId: RoleId;
  readonly permissionId: PermissionId;
};

/** Both exist; assignment absent. Existing assignment → no-op entry. */
export type AssignRoleOperation = {
  readonly type: 'assign_role';
  readonly subjectId: SubjectId;
  readonly roleId: RoleId;
};

/** Both exist. Missing assignment → no-op entry. */
export type UnassignRoleOperation = {
  readonly type: 'unassign_role';
  readonly subjectId: SubjectId;
  readonly roleId: RoleId;
};

/**
 * Both exist; edge absent; keeps graph acyclic.
 * Duplicate → no-op; cycle-creating → rejected (`validation_failed`).
 */
export type AddInheritanceOperation = {
  readonly type: 'add_inheritance';
  readonly childRoleId: RoleId;
  readonly parentRoleId: RoleId;
};

/** Both exist. Missing edge → no-op entry. */
export type RemoveInheritanceOperation = {
  readonly type: 'remove_inheritance';
  readonly childRoleId: RoleId;
  readonly parentRoleId: RoleId;
};

export type ChangeOperation =
  | GrantPermissionOperation
  | RevokePermissionOperation
  | AssignRoleOperation
  | UnassignRoleOperation
  | AddInheritanceOperation
  | RemoveInheritanceOperation;

/** Ordered list of operations applied against an immutable snapshot clone. */
export type ProposedChangeRequest = {
  readonly modelId: ModelId;
  readonly version?: number;
  readonly operations: readonly ChangeOperation[];
  readonly idempotencyKey?: string;
};
