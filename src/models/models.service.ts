import { createHash, randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { AppError } from '../common/errors/app-error';
import { toISOString } from '../common/http';
import { DomainError } from '../domain/errors';
import { assertAcyclicInheritance } from '../domain/inheritance-cycles';
import { parseAccessModelDocument } from '../domain/schemas';
import { assertValidStructure } from '../domain/validate-structure';
import type { AccessModelSnapshot } from '../domain/access-model';
import {
  ACCESS_MODEL_REPOSITORY as AMR,
  MODEL_VERSION_REPOSITORY as MVR,
} from '../repositories/tokens';
import type { AccessModelRepository } from '../repositories/access-model.repository';
import type { ModelVersionRepository } from '../repositories/model-version.repository';
import type { TenantContext } from '../tenancy/tenant-context';
import type { CreateModelBody } from './models.dto';

export type CreatedModel = {
  id: string;
  tenantId: string;
  name: string;
  currentVersion: number;
  contentHash: string;
  createdAt: string;
};

function sha256Hex(canonical: string): string {
  return `sha256:${createHash('sha256').update(canonical).digest('hex')}`;
}

function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; meta?: { target?: unknown } } | null;
  if (!e || e.code !== 'P2002') return false;
  const raw = e.meta?.target;
  const target = Array.isArray(raw)
    ? raw.map((t) => (typeof t === 'string' ? t : '')).join(',')
    : typeof raw === 'string'
      ? raw
      : '';
  return target.includes('tenantId') || target.includes('name');
}

@Injectable()
export class ModelsService {
  constructor(
    @Inject(AMR) private readonly models: AccessModelRepository,
    @Inject(MVR) private readonly versions: ModelVersionRepository,
  ) {}

  async createModel(
    ctx: TenantContext,
    body: CreateModelBody,
  ): Promise<CreatedModel> {
    let snapshot: AccessModelSnapshot;
    try {
      const doc = parseAccessModelDocument({
        schemaVersion: 1,
        snapshot: body.snapshot,
      });
      snapshot = doc.snapshot as unknown as AccessModelSnapshot;
      assertValidStructure(snapshot);
      assertAcyclicInheritance(snapshot);
    } catch (err) {
      if (err instanceof DomainError) {
        throw new AppError('validation_failed', 'Access model is invalid.', {
          details: err.details.map((d) => ({ ...d })),
        });
      }
      throw err;
    }
    const canonical = JSON.stringify(snapshot);
    const contentHash = sha256Hex(canonical);
    const modelId = `mdl_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
    try {
      const model = await this.models.create({
        id: modelId,
        tenantId: ctx.tenantId,
        name: body.name,
      });
      const version = await this.versions.create({
        id: `mdlver_${randomUUID().replace(/-/g, '').slice(0, 24)}`,
        modelId: model.id,
        tenantId: ctx.tenantId,
        version: 1,
        contentHash,
        snapshot: snapshot,
        operationCount: 0,
      });
      return {
        id: model.id,
        tenantId: model.tenantId,
        name: model.name,
        currentVersion: 1,
        contentHash: version.contentHash,
        createdAt: toISOString(model.createdAt),
      };
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new AppError(
          'validation_failed',
          'Model name already exists in this tenant.',
          { details: [{ path: 'name', reason: 'duplicate' }] },
        );
      }
      throw err;
    }
  }
}
