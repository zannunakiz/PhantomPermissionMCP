import { createHash, randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
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
  IDEMPOTENCY_REPOSITORY as IR,
  MODEL_VERSION_REPOSITORY as MVR,
  SIMULATION_REPOSITORY as SR,
} from '../repositories/tokens';
import type { AccessModelRepository } from '../repositories/access-model.repository';
import type { IdempotencyRepository } from '../repositories/idempotency.repository';
import type { ModelVersionRepository } from '../repositories/model-version.repository';
import type { SimulationRepository } from '../repositories/simulation.repository';
import { assertVersionChain } from '../tenancy/tenant-scope';
import type { TenantContext } from '../tenancy/tenant-context';
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
  ) {}

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
      result = simulateWithFindings(
        snapshot,
        body.operations as ChangeOperation[],
      );
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
}
