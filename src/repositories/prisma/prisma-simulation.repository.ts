import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../persistence';
import type { SimulationRepository } from '../simulation.repository';
import type { JsonValue, SimulationRecord, SimulationStatus } from '../records';

/**
 * Prisma-backed simulation port. Write-once: create + scoped reads
 * only. Report pagination over the embedded arrays belongs to the
 * read use case.
 */
@Injectable()
export class PrismaSimulationRepository implements SimulationRepository {
  constructor(private readonly db: PrismaService) {}

  async findById(
    tenantId: string,
    id: string,
  ): Promise<SimulationRecord | null> {
    const row = await this.db.simulation.findFirst({
      where: { id, tenantId },
    });
    return row ? toRecord(row) : null;
  }

  async listByTenant(
    tenantId: string,
    options?: { limit?: number },
  ): Promise<readonly SimulationRecord[]> {
    const rows = await this.db.simulation.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: options?.limit ?? 20,
    });
    return rows.map(toRecord);
  }

  async listByModel(
    tenantId: string,
    modelId: string,
  ): Promise<readonly SimulationRecord[]> {
    const rows = await this.db.simulation.findMany({
      where: { tenantId, modelId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toRecord);
  }

  async create(input: {
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
  }): Promise<SimulationRecord> {
    const row = await this.db.simulation.create({
      data: {
        id: input.id,
        tenantId: input.tenantId,
        modelId: input.modelId,
        version: input.version,
        versionRowId: input.versionRowId,
        contentHash: input.contentHash,
        operations: input.operations as never,
        status: input.status ?? 'COMPLETED',
        summary: input.summary as never,
        impacts: input.impacts as never,
        findings: input.findings as never,
        disclaimer: input.disclaimer,
      },
    });
    return toRecord(row);
  }
}

type SimulationRow = {
  id: string;
  tenantId: string;
  modelId: string;
  version: number;
  versionRowId: string;
  contentHash: string;
  operations: unknown;
  status: SimulationStatus;
  summary: unknown;
  impacts: unknown;
  findings: unknown;
  disclaimer: string;
  createdAt: Date;
};

function toRecord(row: SimulationRow): SimulationRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    modelId: row.modelId,
    version: row.version,
    versionRowId: row.versionRowId,
    contentHash: row.contentHash,
    operations: row.operations,
    status: row.status,
    summary: row.summary,
    impacts: row.impacts,
    findings: row.findings,
    disclaimer: row.disclaimer,
    createdAt: row.createdAt,
  };
}
