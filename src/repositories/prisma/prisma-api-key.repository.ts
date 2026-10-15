import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../persistence';
import type { ApiKeyRepository } from '../api-key.repository';
import type { ApiKeyRecord, ApiKeyStatus } from '../records';

/**
 * Prisma-backed API-key port. Digest computation lives in the
 * authentication layer — this adapter stores and matches the digest
 * strings it is given, nothing more.
 */
@Injectable()
export class PrismaApiKeyRepository implements ApiKeyRepository {
  constructor(private readonly db: PrismaService) {}

  async findByDigest(keyDigest: string): Promise<ApiKeyRecord | null> {
    const row = await this.db.apiKey.findUnique({
      where: { keyDigest },
    });
    return row ? toRecord(row) : null;
  }

  async listByTenant(tenantId: string): Promise<readonly ApiKeyRecord[]> {
    const rows = await this.db.apiKey.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toRecord);
  }

  async create(input: {
    id: string;
    tenantId: string;
    keyPrefix: string;
    keyDigest: string;
    scopes: readonly string[];
    expiresAt?: Date | null;
  }): Promise<ApiKeyRecord> {
    const row = await this.db.apiKey.create({
      data: {
        id: input.id,
        tenantId: input.tenantId,
        keyPrefix: input.keyPrefix,
        keyDigest: input.keyDigest,
        scopes: [...input.scopes],
        expiresAt: input.expiresAt ?? null,
      },
    });
    return toRecord(row);
  }

  async updateStatus(
    tenantId: string,
    id: string,
    status: ApiKeyStatus,
  ): Promise<ApiKeyRecord | null> {
    const existing = await this.db.apiKey.findFirst({
      where: { id, tenantId },
    });
    if (!existing) {
      return null;
    }
    const row = await this.db.apiKey.update({
      where: { id },
      data: {
        status,
        revokedAt: status === 'REVOKED' ? new Date() : existing.revokedAt,
      },
    });
    return toRecord(row);
  }

  async touchLastUsed(tenantId: string, id: string): Promise<void> {
    await this.db.apiKey.updateMany({
      where: { id, tenantId },
      data: { lastUsedAt: new Date() },
    });
  }
}

type ApiKeyRow = {
  id: string;
  tenantId: string;
  keyPrefix: string;
  keyDigest: string;
  scopes: string[];
  status: ApiKeyStatus;
  expiresAt: Date | null;
  revokedAt: Date | null;
  lastUsedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

function toRecord(row: ApiKeyRow): ApiKeyRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    keyPrefix: row.keyPrefix,
    keyDigest: row.keyDigest,
    scopes: [...row.scopes],
    status: row.status,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    lastUsedAt: row.lastUsedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
