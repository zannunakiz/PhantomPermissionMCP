/**
 * Access-model entities.
 *
 * Mirrors docs/architecture/overview.md §4. Plain data types only —
 * no behaviour, no validation, no framework imports. Runtime checks
 * (required fields, duplicates, reference resolution) belong to
 * the validation layer operating on these shapes.
 */
import type { PermissionId, RoleId, SubjectId, TenantId, ModelId } from './ids';

/** Named collection of permissions, e.g. `billing-admin`. */
export type Role = {
  readonly id: RoleId;
  readonly name: string;
  readonly description?: string;
};

/** Atomic capability string, e.g. `invoice:refund`. */
export type Permission = {
  readonly id: PermissionId;
  readonly value: string;
};

/** Attachment of a permission to a role ("grant"). */
export type Binding = {
  readonly roleId: RoleId;
  readonly permissionId: PermissionId;
};

/** Directed child → parent edge; the child gains all effective permissions of its parents. Must be acyclic. */
export type InheritanceEdge = {
  readonly childRoleId: RoleId;
  readonly parentRoleId: RoleId;
};

/** Attachment of a role to a subject. */
export type Assignment = {
  readonly subjectId: SubjectId;
  readonly roleId: RoleId;
};

/** Identity evaluated for access (user, service account). */
export type Subject = {
  readonly id: SubjectId;
  readonly displayName?: string;
};

/** One immutable, numbered snapshot of an access model. */
export type AccessModelSnapshot = {
  readonly roles: readonly Role[];
  readonly permissions: readonly Permission[];
  readonly bindings: readonly Binding[];
  readonly inheritance: readonly InheritanceEdge[];
  readonly assignments: readonly Assignment[];
  readonly subjects: readonly Subject[];
};

/** Version metadata paired with its snapshot content. */
export type ModelVersion = {
  readonly version: number;
  readonly contentHash: string;
  readonly createdAt: string;
  readonly operationCount: number;
};

/** Persisted access model: tenant-scoped metadata plus snapshot history. */
export type AccessModel = {
  readonly id: ModelId;
  readonly tenantId: TenantId;
  readonly name: string;
  readonly currentVersion: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly versions: readonly ModelVersion[];
};
