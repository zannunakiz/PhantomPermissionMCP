import type { JsonValue, SimulationRecord, SimulationStatus } from './records';

/**
 * Simulation + co-located report port. Rows are write-once: no update
 * or delete methods exist. Report pagination over the embedded
 * `impacts`/`findings` arrays belongs to the read use case, not here.
 */
export interface SimulationRepository {
  findById(tenantId: string, id: string): Promise<SimulationRecord | null>;
  listByTenant(
    tenantId: string,
    options?: { limit?: number },
  ): Promise<readonly SimulationRecord[]>;
  listByModel(
    tenantId: string,
    modelId: string,
  ): Promise<readonly SimulationRecord[]>;
  create(input: {
    id: string;
    tenantId: string;
    modelId: string;
    version: number;
    versionRowId: string;
    contentHash: string;
    operations: JsonValue;
    status?: SimulationStatus;
    summary: JsonValue;
    impacts: JsonValue;
    findings: JsonValue;
    disclaimer: string;
  }): Promise<SimulationRecord>;
}
