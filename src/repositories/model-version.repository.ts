import type { JsonValue, ModelVersionRecord } from './records';

/**
 * Immutable version-history port. `create` inserts the version row and
 * advances the parent model's `currentVersion` in one transaction, so
 * concurrent writers cannot fork the version sequence: the loser gets
 * a conflict error from the `(modelId, version)` unique constraint.
 */
export interface ModelVersionRepository {
  findByModelVersion(
    tenantId: string,
    modelId: string,
    version: number,
  ): Promise<ModelVersionRecord | null>;
  listByModel(
    tenantId: string,
    modelId: string,
  ): Promise<readonly ModelVersionRecord[]>;
  create(input: {
    id: string;
    modelId: string;
    tenantId: string;
    version: number;
    contentHash: string;
    snapshot: JsonValue;
    operationCount?: number;
  }): Promise<ModelVersionRecord>;
}
