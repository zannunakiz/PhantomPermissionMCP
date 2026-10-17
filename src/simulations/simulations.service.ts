import { createHash, randomUUID } from 'node:crypto';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { AppError } from '../common/errors/app-error';
import { paginate, toISOString } from '../common/http';
import type { PagedResult, PaginationQuery } from '../common/http';
import { DomainError } from '../domain/errors';
import type { AccessModelSnapshot } from '../domain/access-model';
import type { ChangeOperation } from '../domain/operations';
import type { SimulationWithFindings } from '../domain/risk-rules';
import { simulateWithFindings } from '../domain/risk-rules';
import {
  ACCESS_MODEL_REPOSITORY as AMR,
  AUDIT_REPOSITORY as AudR,
  IDEMPOTENCY_REPOSITORY as IR,
  MODEL_VERSION_REPOSITORY as MVR,
  SIMULATION_REPOSITORY as SR,
} from '../repositories/tokens';
import type { AccessModelRepository } from '../repositories/access-model.repository';
import type { AuditRepository } from '../repositories/audit.repository';
import type { IdempotencyRepository } from '../repositories/idempotency.repository';
import type { ModelVersionRepository } from '../repositories/model-version.repository';
import type { SimulationRepository } from '../repositories/simulation.repository';
import { assertVersionChain } from '../tenancy/tenant-scope';
import type { TenantContext } from '../tenancy/tenant-context';
import type { TracingService } from '../tracing/tracing.service';
import type { CreateSimulationBody } from './simulations.dto';

const ENDPOINT = 'POST /api/v1/simulations';
const DISCLAIMER = 'Findings are advisory only.';

function requestHash(body: CreateSimulationBody): string {
  return `sha256:${createHash('sha256').update(JSON.stringify(body)).digest('hex')}`;
}

function assertSimId(id: string): void {
  if (!/^sim_[A-Za-z0-9_-]{1,120}$/.test(id)) {
    throw new AppError('validation_failed', 'Invalid simulation id.', {
      details: [{ path: 'id', reason: 'invalid_format' }],
    });
  }
}

function asArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
}

function toDomainError(err: DomainError): AppError {
  return new AppError('validation_failed', 'Proposed change is invalid.', {
    details: err.details.map((d) => ({ ...d })),
  });
}

@Injectable()
export class SimulationsService {
  constructor(
    @Inject(AMR) private readonly models: AccessModelRepository,
    @Inject(MVR) private readonly versions: ModelVersionRepository,
    @Inject(SR) private readonly simulations: SimulationRepository,
    @Inject(IR) private readonly idempotency: IdempotencyRepository,
    @Optional() @Inject(AudR) private readonly audit?: AuditRepository,
    @Optional() private readonly tracing?: TracingService,
  ) {}

  /** Best-effort append — mirrors ModelsService.record. */
  private async record(
    ctx: TenantContext,
    type: 'SIMULATION_CREATED' | 'REPORT_EXPORTED',
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
        resourceType: 'simulation',
        resourceId,
        metadata,
      });
    } catch {
      // Never mask the committed result; Step 23 storage stays authoritative.
    }
  }

  async createSimulation(
    ctx: TenantContext,
    body: CreateSimulationBody,
    headerKey?: string,
  ): Promise<{ id: string; status: string; summary: unknown }> {
    const key = (body.idempotencyKey ?? headerKey)?.trim() || undefined;
    const hash = requestHash(body);
    if (key) {
      const existing = await this.idempotency.findByKey(
        ctx.tenantId,
        ENDPOINT,
        key,
      );
      if (existing) {
        if (existing.requestHash !== hash) {
          throw new AppError(
            'idempotency_conflict',
            'Idempotency key already used.',
            {
              details: [{ path: 'idempotencyKey', reason: 'conflict' }],
            },
          );
        }
        return existing.responseBody as {
          id: string;
          status: string;
          summary: unknown;
        };
      }
    }
    const model = await this.models.findById(ctx.tenantId, body.modelId);
    if (!model) {
      throw new AppError('not_found', 'Model version not found.');
    }
    const target = body.version ?? model.currentVersion;
    const version =
      model && Number.isInteger(target) && target >= 1
        ? await this.versions.findByModelVersion(ctx.tenantId, model.id, target)
        : null;
    try {
      assertVersionChain(model, version, ctx.tenantId);
    } catch {
      throw new AppError('not_found', 'Model version not found.');
    }
    const snapshot = version.snapshot as AccessModelSnapshot;
    let result: SimulationWithFindings;
    try {
      const run = (): SimulationWithFindings =>
        simulateWithFindings(snapshot, body.operations as ChangeOperation[]);
      result = this.tracing
        ? await this.tracing.span(
            'simulation.run',
            { operationCount: (body.operations as unknown[]).length },
            () => run(),
          )
        : run();
    } catch (err) {
      if (err instanceof DomainError) throw toDomainError(err);
      throw err;
    }
    const id = `sim_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
    const summaryJson = JSON.parse(JSON.stringify(result.summary)) as unknown;
    const impactsJson = JSON.parse(JSON.stringify(result.impacts)) as unknown;
    const findingsJson = JSON.parse(JSON.stringify(result.findings)) as unknown;
    await this.simulations.create({
      id,
      tenantId: ctx.tenantId,
      modelId: model.id,
      version: version.version,
      versionRowId: version.id,
      contentHash: version.contentHash,
      operations: body.operations,
      summary: summaryJson,
      impacts: impactsJson,
      findings: findingsJson,
      disclaimer: DISCLAIMER,
    });
    const response = { id, status: 'completed', summary: summaryJson };
    await this.record(ctx, 'SIMULATION_CREATED', id, {
      modelId: model.id,
      version: version.version,
      operationCount: (body.operations as unknown[]).length,
    });
    if (key) {
      try {
        await this.idempotency.create({
          id: `idem_${randomUUID().replace(/-/g, '').slice(0, 24)}`,
          tenantId: ctx.tenantId,
          endpoint: ENDPOINT,
          idempotencyKey: key,
          requestHash: hash,
          statusCode: 201,
          responseBody: response,
          expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
        });
      } catch {
        const raced = await this.idempotency.findByKey(
          ctx.tenantId,
          ENDPOINT,
          key,
        );
        if (raced) {
          if (raced.requestHash !== hash) {
            throw new AppError(
              'idempotency_conflict',
              'Idempotency key already used.',
              {
                details: [{ path: 'idempotencyKey', reason: 'conflict' }],
              },
            );
          }
          return raced.responseBody as {
            id: string;
            status: string;
            summary: unknown;
          };
        }
      }
    }
    return response;
  }

  private async loadSimulation(ctx: TenantContext, id: string) {
    assertSimId(id);
    const sim = await this.simulations.findById(ctx.tenantId, id);
    if (!sim || sim.tenantId !== ctx.tenantId) {
      throw new AppError('not_found', 'Simulation not found.');
    }
    return sim;
  }

  async getSimulation(
    ctx: TenantContext,
    id: string,
  ): Promise<Record<string, unknown>> {
    const sim = await this.loadSimulation(ctx, id);
    return {
      id: sim.id,
      tenantId: sim.tenantId,
      status: sim.status === 'COMPLETED' ? 'completed' : 'failed',
      summary: sim.summary,
      provenance: {
        modelId: sim.modelId,
        version: sim.version,
        contentHash: sim.contentHash,
        operations: sim.operations,
        createdAt: toISOString(sim.createdAt),
      },
    };
  }

  async getReport(
    ctx: TenantContext,
    id: string,
    query: PaginationQuery,
  ): Promise<Record<string, unknown>> {
    const sim = await this.loadSimulation(ctx, id);
    const subjectOf = (row: Record<string, unknown>): string =>
      typeof row.subjectId === 'string' ? row.subjectId : '';
    const impacts = asArray(sim.impacts).sort((a, b) =>
      subjectOf(a).localeCompare(subjectOf(b)),
    );
    const findings = asArray(sim.findings);
    const pagedImpacts: PagedResult<Record<string, unknown>> = paginate(
      impacts,
      query,
    );
    return {
      id: sim.id,
      tenantId: sim.tenantId,
      status: sim.status === 'COMPLETED' ? 'completed' : 'failed',
      summary: sim.summary,
      impacts: pagedImpacts.data,
      page: pagedImpacts.page,
      findings,
      disclaimer: sim.disclaimer,
      provenance: {
        modelId: sim.modelId,
        version: sim.version,
        contentHash: sim.contentHash,
        operations: sim.operations,
        createdAt: toISOString(sim.createdAt),
      },
    };
  }

  async exportReport(
    ctx: TenantContext,
    id: string,
    format: string,
  ): Promise<{ contentType: string; body: string }> {
    if (format !== 'json' && format !== 'csv') {
      throw new AppError('validation_failed', 'Unsupported export format.', {
        details: [{ path: 'format', reason: 'invalid_value' }],
      });
    }
    const sim = await this.loadSimulation(ctx, id);
    const subjectOf = (row: Record<string, unknown>): string =>
      typeof row.subjectId === 'string' ? row.subjectId : '';
    const strList = (value: unknown): string[] =>
      Array.isArray(value)
        ? value.filter((v): v is string => typeof v === 'string').sort()
        : [];
    const impacts = asArray(sim.impacts)
      .map((row) => ({
        subjectId: subjectOf(row),
        added: strList(row.added),
        removed: strList(row.removed),
      }))
      .sort((a, b) => a.subjectId.localeCompare(b.subjectId));
    const findings = asArray(sim.findings);
    const rows: { subjectId: string; change: string; permission: string }[] =
      [];
    for (const impact of impacts) {
      for (const permission of impact.added) {
        rows.push({ subjectId: impact.subjectId, change: 'added', permission });
      }
      for (const permission of impact.removed) {
        rows.push({
          subjectId: impact.subjectId,
          change: 'removed',
          permission,
        });
      }
    }
    if (rows.length > 50000) {
      throw new AppError('payload_too_large', 'Export exceeds row limit.', {
        details: [{ path: 'format', reason: 'too_large' }],
      });
    }
    if (format === 'json') {
      const payload = {
        id: sim.id,
        tenantId: sim.tenantId,
        status: sim.status === 'COMPLETED' ? 'completed' : 'failed',
        summary: sim.summary,
        impacts,
        findings,
        disclaimer: sim.disclaimer,
        provenance: {
          modelId: sim.modelId,
          version: sim.version,
          contentHash: sim.contentHash,
          operations: sim.operations,
          createdAt: toISOString(sim.createdAt),
        },
      };
      await this.record(ctx, 'REPORT_EXPORTED', sim.id, {
        format,
        rowCount: rows.length,
      });
      return {
        contentType: 'application/json',
        body: JSON.stringify(payload),
      };
    }
    const cell = (value: string): string =>
      /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
    const lines = ['subject_id,change,permission'];
    for (const row of rows) {
      lines.push(
        [cell(row.subjectId), cell(row.change), cell(row.permission)].join(','),
      );
    }
    await this.record(ctx, 'REPORT_EXPORTED', sim.id, {
      format,
      rowCount: rows.length,
    });
    return { contentType: 'text/csv', body: lines.join('\n') + '\n' };
  }
}
