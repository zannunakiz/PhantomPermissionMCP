import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../persistence';
import type { ModelVersionRepository } from '../model-version.repository';
import type { JsonValue, ModelVersionRecord } from '../records';

/**
 * Prisma-backed version-history port. `create` inserts the version row
 * and advances the parent `currentVersion` atomically: concurrent
 * writers racing the same version number collide on the
 * `(modelId, version)` unique constraint instead of forking history.
 */
@Injectable()
export class PrismaModelVersionRepository implements ModelVersionRepository {
  constructor(private readonly db: PrismaService) {}

  async findByModelVersion(
    tenantId: string,
    modelId: string,
    version: number,
  ): Promise<ModelVersionRecord | null> {
    const row = await this.db.modelVersion.findFirst({
      where: { modelId, tenantId, version },
    });
    return row ? toRecord(row) : null;
  }

  async listByModel(
    tenantId: string,
    modelId: string,
  ): Promise<readonly ModelVersionRecord[]> {
    const rows = await this.db.modelVersion.findMany({
      where: { modelId, tenantId },
      orderBy: { version: 'asc' },
    });
    return rows.map(toRecord);
  }

  async create(input: {
    id: string;
    modelId: string;
    tenantId: string;
    version: number;
    contentHash: string;
    snapshot: JsonValue;
    operationCount?: number;
  }): Promise<ModelVersionRecord> {
    const created = await this.db.$transaction(async (tx) => {
      const row = await tx.modelVersion.create({
        data: {
          id: input.id,
          modelId: input.modelId,
          tenantId: input.tenantId,
          version: input.version,
          contentHash: input.contentHash,
          snapshot: input.snapshot as never,
          operationCount: input.operationCount ?? 0,
        },
      });
      await tx.accessModel.updateMany({
        where: { id: input.modelId, tenantId: input.tenantId },
        data: { currentVersion: input.version },
      });
      return row;
    });
    return toRecord(created);
  }
}

function toRecord(row: {
  id: string;
  modelId: string;
  tenantId: string;
  version: number;
  contentHash: string;
  snapshot: unknown;
  operationCount: number;
  createdAt: Date;
}): ModelVersionRecord {
  return {
    id: row.id,
    modelId: row.modelId,
    tenantId: row.tenantId,
    version: row.version,
    contentHash: row.contentHash,
    snapshot: row.snapshot,
    operationCount: row.operationCount,
    createdAt: row.createdAt,
  };
}
