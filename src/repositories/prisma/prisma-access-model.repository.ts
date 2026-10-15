import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../persistence';
import type { AccessModelRepository } from '../access-model.repository';
import type { AccessModelRecord } from '../records';

/**
 * Prisma-backed model-metadata port. Reads always carry the tenant
 * filter; the `(tenantId, name)` unique constraint is the duplicate
 * backstop behind the use-case check.
 */
@Injectable()
export class PrismaAccessModelRepository implements AccessModelRepository {
  constructor(private readonly db: PrismaService) {}

  async findById(
    tenantId: string,
    id: string,
  ): Promise<AccessModelRecord | null> {
    const row = await this.db.accessModel.findFirst({
      where: { id, tenantId },
    });
    return row ? toRecord(row) : null;
  }

  async listByTenant(tenantId: string): Promise<readonly AccessModelRecord[]> {
    const rows = await this.db.accessModel.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toRecord);
  }

  async create(input: {
    id: string;
    tenantId: string;
    name: string;
  }): Promise<AccessModelRecord> {
    const row = await this.db.accessModel.create({ data: input });
    return toRecord(row);
  }
}

function toRecord(row: {
  id: string;
  tenantId: string;
  name: string;
  currentVersion: number;
  createdAt: Date;
  updatedAt: Date;
}): AccessModelRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    currentVersion: row.currentVersion,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
