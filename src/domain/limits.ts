/**
 * Documented domain limits.
 *
 * Mirrors docs/api/v1-contract.md §2. Referenced by type documentation;
 * enforcement belongs to the runtime schemas, structural
 * validation, and cycle detection. Keeping the numbers in one place prevents
 * drift between docs, schemas, and the engine.
 */

export const DOMAIN_LIMITS = {
  maxRoles: 500,
  maxPermissions: 2000,
  maxBindings: 10000,
  maxInheritanceEdges: 2000,
  maxAssignments: 10000,
  maxSubjects: 5000,
  maxInheritanceDepth: 25,
  maxOperationsPerSimulation: 200,
  maxReportItemsPerPage: 200,
  maxExportRows: 50000,
} as const;

export type DomainLimits = typeof DOMAIN_LIMITS;
