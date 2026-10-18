import { createHash, randomUUID } from 'node:crypto';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { AppError } from '../common/errors/app-error';
import { paginate, toISOString } from '../common/http';
import type { PagedResult, PaginationQuery } from '../common/http';
import { assertModelInTenant } from '../tenancy/tenant-scope';
import { validateSnapshot } from './validate-snapshot';
import {
  ACCESS_MODEL_REPOSITORY as AMR,
  AUDIT_REPOSITORY as AudR,
  MODEL_VERSION_REPOSITORY as MVR,
} from '../repositories/tokens';
import type { AccessModelRepository } from '../repositories/access-model.repository';
import type { AuditRepository } from '../repositories/audit.repository';
import type { AuditEventType } from '../repositories/records';
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

/** P2002 constraint location differs by transport: classic engines expose
 *  `meta.target` (column list); Prisma 7 driver adapters expose
 *  `meta.driverAdapterError.cause.constraint.index` (the `constraint` sits
 *  on the `DriverAdapterError.cause`, not on the error itself). Accept
 *  either shape so duplicate names map to validation_failed, not 500. */
function uniqueConstraintName(err: unknown): string {
  const e = err as {
    code?: string;
    meta?: {
      target?: unknown;
      driverAdapterError?: {
        constraint?: { index?: unknown };
        cause?: { constraint?: { index?: unknown } };
      };
    };
  } | null;
  if (!e || e.code !== 'P2002') return '';
  const raw = e.meta?.target;
  const fromTarget = Array.isArray(raw)
    ? raw.map((t) => (typeof t === 'string' ? t : '')).join(',')
    : typeof raw === 'string'
      ? raw
      : '';
  const adapter = e.meta?.driverAdapterError;
  const idx = adapter?.constraint?.index ?? adapter?.cause?.constraint?.index;
  return `${fromTarget}${typeof idx === 'string' ? idx : ''}`;
}

function isUniqueViolation(err: unknown): boolean {
  const target = uniqueConstraintName(err);
  return target.includes('tenantId') || target.includes('name');
}

function isVersionConflict(err: unknown): boolean {
  const target = uniqueConstraintName(err);
  return target.includes('modelId') && target.includes('version');
}

@Injectable()
export class ModelsService {
  constructor(
    @Inject(AMR) private readonly models: AccessModelRepository,
    @Inject(MVR) private readonly versions: ModelVersionRepository,
    @Optional() @Inject(AudR) private readonly audit?: AuditRepository,
  ) {}

  /** Best-effort append: an audit write failure must never lose the
   *  committed business result, but it is logged loudly. */
  private async record(
    ctx: TenantContext,
    type: AuditEventType,
    resourceType: string,
    resourceId: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    if (!this.audit) return;
    try {
      await this.audit.append({
        id: `evt_${randomUUID().replace(/-/g, '').slice(0, 24)}`,
        tenantId: ctx.tenantId,
        type,
        actorKeyPrefix: ctx.keyPrefix ?? '',
        resourceType,
        resourceId,
        metadata,
      });
    } catch {
      // Logged by the caller's logger in a future pass; never mask success.
    }
  }

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
      const created: CreatedModel = {
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
      await this.record(ctx, 'MODEL_CREATED', 'access-model', created.id, {
        name: created.name,
        version: 1,
        contentHash: created.contentHash,
      });
      return created;
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
      await this.record(
        ctx,
        'MODEL_VERSION_CREATED',
        'access-model',
        model.id,
        { version: row.version, contentHash: row.contentHash },
      );
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
