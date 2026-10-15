import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../persistence';
import type { TenantRepository } from '../tenant.repository';
import type { TenantRecord } from '../records';

/**
 * Prisma-backed tenant port. Maps rows 1:1 onto {@link TenantRecord};
 * no behaviour beyond persistence mapping.
 */
@Injectable()
export class PrismaTenantRepository implements TenantRepository {
  constructor(private readonly db: PrismaService) {}

  async findById(id: string): Promise<TenantRecord | null> {
    const row = await this.db.tenant.findUnique({ where: { id } });
    return row ? toRecord(row) : null;
  }

  async findByName(name: string): Promise<TenantRecord | null> {
    const row = await this.db.tenant.findUnique({ where: { name } });
    return row ? toRecord(row) : null;
  }

  async create(input: { id: string; name: string }): Promise<TenantRecord> {
    const row = await this.db.tenant.create({ data: input });
    return toRecord(row);
  }
}

function toRecord(row: {
  id: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}): TenantRecord {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
