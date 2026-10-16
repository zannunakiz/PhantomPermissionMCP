import { createHash, randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { AppError } from '../common/errors/app-error';
import { paginate, toISOString } from '../common/http';
import type { PagedResult, PaginationQuery } from '../common/http';
import { assertModelInTenant } from '../tenancy/tenant-scope';
import { validateSnapshot } from './validate-snapshot';
import {
  ACCESS_MODEL_REPOSITORY as AMR,
  MODEL_VERSION_REPOSITORY as MVR,
} from '../repositories/tokens';
import type { AccessModelRepository } from '../repositories/access-model.repository';
import type { ModelVersionRepository } from '../repositories/model-version.repository';
import type { TenantContext } from '../tenancy/tenant-context';
import type { CreateModelBody, CreateVersionBody } from './models.dto';

export type ModelSummary = {
  id: string;
  tenantId: string;
  name: string;
  currentVersion: number;
  createdAt: string;
  updatedAt: string;
  versions: { version: number; contentHash: string; createdAt: string }[];
};

export type CreatedModel = ModelSummary & { contentHash: string };

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

function isVersionConflict(err: unknown): boolean {
  const e = err as { code?: string; meta?: { target?: unknown } } | null;
  if (!e || e.code !== 'P2002') return false;
  const raw = e.meta?.target;
  const target = Array.isArray(raw)
    ? raw.map((t) => (typeof t === 'string' ? t : '')).join(',')
    : typeof raw === 'string'
      ? raw
      : '';
  return target.includes('modelId') && target.includes('version');
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
    const snapshot = validateSnapshot(body.snapshot);
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
        updatedAt: toISOString(model.updatedAt),
        versions: [
          {
            version: 1,
            contentHash: version.contentHash,
            createdAt: toISOString(version.createdAt),
          },
        ],
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

  async listModels(
    ctx: TenantContext,
    query: PaginationQuery & { orderBy?: 'name' | 'createdAt' },
  ): Promise<PagedResult<ModelSummary>> {
    const rows = await this.models.listByTenant(ctx.tenantId);
    const sorted = [...rows].sort((a, b) =>
      query.orderBy === 'name'
        ? a.name.localeCompare(b.name) || a.id.localeCompare(b.id)
        : a.createdAt.getTime() - b.createdAt.getTime() ||
          a.id.localeCompare(b.id),
    );
    const summaries: ModelSummary[] = await Promise.all(
      sorted.map(async (m) => {
        const vers = await this.versions.listByModel(ctx.tenantId, m.id);
        return {
          id: m.id,
          tenantId: m.tenantId,
          name: m.name,
          currentVersion: m.currentVersion,
          createdAt: toISOString(m.createdAt),
          updatedAt: toISOString(m.updatedAt),
          versions: vers.map((v) => ({
            version: v.version,
            contentHash: v.contentHash,
            createdAt: toISOString(v.createdAt),
          })),
        };
      }),
    );
    return paginate(summaries, query);
  }

  async getModel(
    ctx: TenantContext,
    id: string,
    version?: number,
  ): Promise<ModelSummary & { version: number; contentHash: string }> {
    if (!/^mdl_[A-Za-z0-9_-]{1,120}$/.test(id)) {
      throw new AppError('validation_failed', 'Invalid model id.', {
        details: [{ path: 'id', reason: 'invalid_format' }],
      });
    }
    const model = await this.models.findById(ctx.tenantId, id);
    assertModelInTenant(model, ctx.tenantId);
    const target = version ?? model.currentVersion;
    if (!Number.isInteger(target) || target < 1) {
      throw new AppError('validation_failed', 'Invalid version.', {
        details: [{ path: 'version', reason: 'invalid_value' }],
      });
    }
    const ver = await this.versions.findByModelVersion(
      ctx.tenantId,
      model.id,
      target,
    );
    if (!ver || ver.modelId !== model.id) {
      throw new AppError('not_found', 'Model version not found.');
    }
    const vers = await this.versions.listByModel(ctx.tenantId, model.id);
    return {
      id: model.id,
      tenantId: model.tenantId,
      name: model.name,
      currentVersion: model.currentVersion,
      createdAt: toISOString(model.createdAt),
      updatedAt: toISOString(model.updatedAt),
      versions: vers.map((v) => ({
        version: v.version,
        contentHash: v.contentHash,
        createdAt: toISOString(v.createdAt),
      })),
      version: ver.version,
      contentHash: ver.contentHash,
    };
  }

  async createVersion(
    ctx: TenantContext,
    id: string,
    body: CreateVersionBody,
    ifMatch?: string,
  ): Promise<{ version: number; contentHash: string }> {
    if (!/^mdl_[A-Za-z0-9_-]{1,120}$/.test(id)) {
      throw new AppError('validation_failed', 'Invalid model id.', {
        details: [{ path: 'id', reason: 'invalid_format' }],
      });
    }
    const snapshot = validateSnapshot(body.snapshot);
    const model = await this.models.findById(ctx.tenantId, id);
    assertModelInTenant(model, ctx.tenantId);
    if (ifMatch !== undefined) {
      const current = await this.versions.findByModelVersion(
        ctx.tenantId,
        model.id,
        model.currentVersion,
      );
      const etag = current ? `"${current.contentHash}"` : undefined;
      const want = ifMatch.trim();
      if (etag === undefined || (want !== '*' && want !== etag)) {
        throw new AppError('conflict_version', 'Model version is stale.', {
          details: [{ path: 'expectedVersion', reason: 'stale' }],
        });
      }
    }
    if (
      body.expectedVersion !== undefined &&
      body.expectedVersion !== model.currentVersion
    ) {
      throw new AppError('conflict_version', 'Model version is stale.', {
        details: [{ path: 'expectedVersion', reason: 'stale' }],
      });
    }
    const next = model.currentVersion + 1;
    const contentHash = sha256Hex(JSON.stringify(snapshot));
    try {
      const row = await this.versions.create({
        id: `mdlver_${randomUUID().replace(/-/g, '').slice(0, 24)}`,
        modelId: model.id,
        tenantId: ctx.tenantId,
        version: next,
        contentHash,
        snapshot: snapshot,
        operationCount: 0,
      });
      return { version: row.version, contentHash: row.contentHash };
    } catch (err) {
      if (isVersionConflict(err)) {
        throw new AppError(
          'conflict_version',
          'Model version already exists.',
          {
            details: [{ path: 'version', reason: 'duplicate' }],
          },
        );
      }
      throw err;
    }
  }
}
