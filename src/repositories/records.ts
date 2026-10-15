/**
 * Shared repository record shapes.
 *
 * Plain TypeScript only — no NestJS, no Prisma, no domain-engine
 * imports. Ports (interfaces) depend on these shapes; adapters map
 * Prisma rows onto them at the boundary so application services never
 * touch ORM types. JSON payloads use `unknown` (narrowed by consumers):
 * repositories store and return them verbatim without interpretation.
 */

/** JSON-compatible value stored verbatim (snapshots, reports, payloads). */
export type JsonValue = unknown;

export type TenantRecord = {
  readonly id: string;
  readonly name: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};

export type ApiKeyStatus = 'ACTIVE' | 'REVOKED' | 'EXPIRED';

export type ApiKeyRecord = {
  readonly id: string;
  readonly tenantId: string;
  readonly keyPrefix: string;
  /** HMAC digest hex. The only stored credential — never the raw key. */
  readonly keyDigest: string;
  readonly scopes: readonly string[];
  readonly status: ApiKeyStatus;
  readonly expiresAt: Date | null;
  readonly revokedAt: Date | null;
  readonly lastUsedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};

export type AccessModelRecord = {
  readonly id: string;
  readonly tenantId: string;
  readonly name: string;
  readonly currentVersion: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};

export type ModelVersionRecord = {
  readonly id: string;
  readonly modelId: string;
  readonly tenantId: string;
  readonly version: number;
  readonly contentHash: string;
  readonly snapshot: JsonValue;
  readonly operationCount: number;
  readonly createdAt: Date;
};

export type SimulationStatus = 'COMPLETED' | 'FAILED';

export type SimulationRecord = {
  readonly id: string;
  readonly tenantId: string;
  readonly modelId: string;
  readonly version: number;
  readonly versionRowId: string;
  readonly contentHash: string;
  readonly operations: JsonValue;
  readonly status: SimulationStatus;
  readonly summary: JsonValue;
  readonly impacts: JsonValue;
  readonly findings: JsonValue;
  readonly disclaimer: string;
  readonly createdAt: Date;
};

export type AuditEventType =
  | 'MODEL_CREATED'
  | 'MODEL_VERSION_CREATED'
  | 'SIMULATION_CREATED'
  | 'SIMULATION_FAILED'
  | 'API_KEY_ISSUED'
  | 'API_KEY_REVOKED'
  | 'API_KEY_EXPIRED'
  | 'REPORT_EXPORTED';

export type AuditEventRecord = {
  readonly id: string;
  readonly tenantId: string;
  readonly type: AuditEventType;
  readonly actorKeyPrefix: string;
  readonly resourceType: string;
  readonly resourceId: string;
  /** Redacted context only — never key material or snapshots. */
  readonly metadata: JsonValue;
  readonly createdAt: Date;
};

export type IdempotencyRecordData = {
  readonly id: string;
  readonly tenantId: string;
  readonly endpoint: string;
  readonly idempotencyKey: string;
  readonly requestHash: string;
  readonly statusCode: number;
  readonly responseBody: JsonValue;
  readonly createdAt: Date;
  readonly expiresAt: Date;
};
