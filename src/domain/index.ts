export type {
  AccessModel,
  AccessModelSnapshot,
  Assignment,
  Binding,
  InheritanceEdge,
  ModelVersion,
  Permission,
  Role,
  Subject,
} from './access-model';
export { DomainError } from './errors';
export { DOMAIN_ERROR_CODES } from './errors';
export type { DomainErrorCode, DomainErrorDetail } from './errors';
export { RISK_RULE_IDS, SEVERITIES } from './findings';
export type { RiskFinding, RiskRuleId, Severity } from './findings';
export type {
  AuditEventId,
  ModelId,
  PermissionId,
  RoleId,
  SimulationId,
  SubjectId,
  TenantId,
} from './ids';
export {
  CONTENT_HASH_PATTERN,
  isAuditEventId,
  isContentHash,
  isModelId,
  isModelVersion,
  isOpaqueId,
  isPermissionId,
  isRoleId,
  isSimulationId,
  isSubjectId,
  isTenantId,
} from './ids';
export type {
  FindingCounts,
  SimulationResult,
  SimulationSummary,
  SubjectImpact,
} from './impact';
export { DOMAIN_LIMITS } from './limits';
export type { DomainLimits } from './limits';
export { OPERATION_TYPES } from './operations';
export type {
  AddInheritanceOperation,
  AssignRoleOperation,
  ChangeOperation,
  GrantPermissionOperation,
  OperationType,
  ProposedChangeRequest,
  RemoveInheritanceOperation,
  RevokePermissionOperation,
  UnassignRoleOperation,
} from './operations';
export {
  SCHEMA_VERSION,
  accessModelDocumentSchema,
  parseAccessModelDocument,
  parseProposedChangeDocument,
  proposedChangeDocumentSchema,
} from './schemas';
export type { AccessModelDocument, ProposedChangeDocument } from './schemas';
export {
  MAX_STRUCTURAL_FINDINGS,
  assertValidStructure,
  validateStructure,
} from './validate-structure';
export type { StructuralValidationResult } from './validate-structure';
