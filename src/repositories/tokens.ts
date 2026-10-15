/**
 * Dependency-injection tokens for the repository ports.
 *
 * Symbol-keyed so interface-only ports (erased at runtime) have a
 * stable runtime identity for NestJS providers and test overrides.
 */
export const TENANT_REPOSITORY = Symbol('TenantRepository');
export const API_KEY_REPOSITORY = Symbol('ApiKeyRepository');
export const ACCESS_MODEL_REPOSITORY = Symbol('AccessModelRepository');
export const MODEL_VERSION_REPOSITORY = Symbol('ModelVersionRepository');
export const SIMULATION_REPOSITORY = Symbol('SimulationRepository');
export const IDEMPOTENCY_REPOSITORY = Symbol('IdempotencyRepository');
export const AUDIT_REPOSITORY = Symbol('AuditRepository');
