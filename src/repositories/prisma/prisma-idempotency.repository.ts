import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../persistence';
import type { IdempotencyRepository } from '../idempotency.repository';
import type { IdempotencyRecordData, JsonValue } from '../records';

/**
 * Prisma-backed retry-safety port. Duplicate `(tenant, endpoint, key)`
 * inserts raise the driver's unique-constraint error for the caller to
 * translate; hash comparison (replay vs conflict) belongs to the use
 * case, which has both hashes in hand.
 */
@Injectable()
export class PrismaIdempotencyRepository implements IdempotencyRepository {
  constructor(private readonly db: PrismaService) {}

  async findByKey(
    tenantId: string,
    endpoint: string,
    idempotencyKey: string,
  ): Promise<IdempotencyRecordData | null> {
    const row = await this.db.idempotencyRecord.findUnique({
      where: {
        tenantId_endpoint_idempotencyKey: {
          tenantId,
          endpoint,
          idempotencyKey,
        },
      },
    });
    return row ? toRecord(row) : null;
  }

  async create(input: {
    id: string;
    tenantId: string;
    endpoint: string;
    idempotencyKey: string;
    requestHash: string;
    statusCode: number;
    responseBody: JsonValue;
    expiresAt: Date;
  }): Promise<IdempotencyRecordData> {
    const row = await this.db.idempotencyRecord.create({
      data: {
        id: input.id,
        tenantId: input.tenantId,
        endpoint: input.endpoint,
        idempotencyKey: input.idempotencyKey,
        requestHash: input.requestHash,
        statusCode: input.statusCode,
        responseBody: input.responseBody as never,
        expiresAt: input.expiresAt,
      },
    });
    return toRecord(row);
  }

  async deleteExpired(now: Date = new Date()): Promise<number> {
    const result = await this.db.idempotencyRecord.deleteMany({
      where: { expiresAt: { lt: now } },
    });
    return result.count;
  }
}

function toRecord(row: {
  id: string;
  tenantId: string;
  endpoint: string;
  idempotencyKey: string;
  requestHash: string;
  statusCode: number;
  responseBody: unknown;
  createdAt: Date;
  expiresAt: Date;
}): IdempotencyRecordData {
  return {
    id: row.id,
    tenantId: row.tenantId,
    endpoint: row.endpoint,
    idempotencyKey: row.idempotencyKey,
    requestHash: row.requestHash,
    statusCode: row.statusCode,
    responseBody: row.responseBody,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
  };
}
