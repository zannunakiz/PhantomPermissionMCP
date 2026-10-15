/**
 * Stable identifier rules for the domain engine (Step 08).
 *
 * IDs are opaque strings with documented prefixes. The engine never
 * generates randomness or clock values — ID creation lives outside the
 * analysis paths (persistence adapters). These helpers only validate and
 * narrow already-supplied strings so later steps can fail fast on
 * malformed identifiers without leaking transport concerns into the core.
 *
 * Rules (mirror docs/architecture/overview.md §3 and
 * docs/api/v1-contract.md §1):
 * - Resource IDs carry stable prefixes: models `mdl_…`, simulations
 *   `sim_…`, audit events `evt_…`, tenants `tnt_…`.
 * - Entity references (roles, permissions, subjects) are opaque non-empty
 *   strings (≤128 chars). Uniqueness is enforced by runtime validation
 *   (Steps 09–10), not here.
 * - `contentHash` is `sha256:<64 lowercase hex chars>`.
 * - Model versions are integers ≥ 1.
 */

export type TenantId = string & { readonly __brand: 'TenantId' };
export type ModelId = string & { readonly __brand: 'ModelId' };
export type SimulationId = string & { readonly __brand: 'SimulationId' };
export type AuditEventId = string & { readonly __brand: 'AuditEventId' };
export type RoleId = string & { readonly __brand: 'RoleId' };
export type PermissionId = string & { readonly __brand: 'PermissionId' };
export type SubjectId = string & { readonly __brand: 'SubjectId' };

const PREFIX_PATTERNS = {
  tenant: /^tnt_[A-Za-z0-9_-]{1,120}$/,
  model: /^mdl_[A-Za-z0-9_-]{1,120}$/,
  simulation: /^sim_[A-Za-z0-9_-]{1,120}$/,
  auditEvent: /^evt_[A-Za-z0-9_-]{1,120}$/,
} as const;

const OPAQUE_ID_MAX_LENGTH = 128;
const OPAQUE_ID_PATTERN = /^[A-Za-z0-9_:-]{1,128}$/;

export const CONTENT_HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;

/** Opaque entity reference rule shared by roles, permissions, subjects. */
export function isOpaqueId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 1 &&
    value.length <= OPAQUE_ID_MAX_LENGTH &&
    OPAQUE_ID_PATTERN.test(value)
  );
}

export function isTenantId(value: unknown): value is TenantId {
  return typeof value === 'string' && PREFIX_PATTERNS.tenant.test(value);
}

export function isModelId(value: unknown): value is ModelId {
  return typeof value === 'string' && PREFIX_PATTERNS.model.test(value);
}

export function isSimulationId(value: unknown): value is SimulationId {
  return typeof value === 'string' && PREFIX_PATTERNS.simulation.test(value);
}

export function isAuditEventId(value: unknown): value is AuditEventId {
  return typeof value === 'string' && PREFIX_PATTERNS.auditEvent.test(value);
}

export function isRoleId(value: unknown): value is RoleId {
  return isOpaqueId(value);
}

export function isPermissionId(value: unknown): value is PermissionId {
  return isOpaqueId(value);
}

export function isSubjectId(value: unknown): value is SubjectId {
  return isOpaqueId(value);
}

export function isContentHash(value: unknown): value is string {
  return typeof value === 'string' && CONTENT_HASH_PATTERN.test(value);
}

export function isModelVersion(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1;
}
