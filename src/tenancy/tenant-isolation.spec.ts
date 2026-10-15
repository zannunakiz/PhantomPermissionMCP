import { AppError } from '../common/errors/app-error';
import type {
  AccessModelRecord,
  ModelVersionRecord,
  SimulationRecord,
} from '../repositories/records';
import {
  assertModelInTenant,
  assertOwned,
  assertSimulationChain,
  assertVersionChain,
} from './tenant-scope';
import { requireTenantId, resolveTenantId } from './tenant-context';

const A = 'tnt_a';
const B = 'tnt_b';
const modelA: AccessModelRecord = {
  id: 'mdl_a',
  tenantId: A,
  name: 'a',
  currentVersion: 1,
  createdAt: new Date(0),
  updatedAt: new Date(0),
};
const versionA: ModelVersionRecord = {
  id: 'ver_a1',
  modelId: 'mdl_a',
  tenantId: A,
  version: 1,
  contentHash: 'sha256:x',
  snapshot: {},
  operationCount: 0,
  createdAt: new Date(0),
};
const simA: SimulationRecord = {
  id: 'sim_a',
  tenantId: A,
  modelId: 'mdl_a',
  version: 1,
  versionRowId: 'ver_a1',
  contentHash: 'sha256:x',
  operations: [],
  status: 'COMPLETED',
  summary: {},
  impacts: [],
  findings: [],
  disclaimer: 'advisory',
  createdAt: new Date(0),
};

function expectNotFound(fn: () => void): void {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe('not_found');
    expect((err as AppError).status).toBe(404);
    return;
  }
  throw new Error('expected not_found');
}

describe('tenant isolation', () => {
  it('requires an authenticated tenant and ignores body spoofing', () => {
    expect(() => requireTenantId(null)).toThrow(AppError);
    expect(resolveTenantId({ tenantId: A }, A)).toBe(A);
    try {
      resolveTenantId({ tenantId: A }, B);
      throw new Error('expected tenant_forbidden');
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe('tenant_forbidden');
    }
    expect(() => resolveTenantId({ tenantId: A }, undefined)).not.toThrow();
  });

  it('denies cross-tenant reads without existence oracle', () => {
    expectNotFound(() => assertOwned(B, A));
    expectNotFound(() => assertOwned(null, A));
    expectNotFound(() => assertModelInTenant({ ...modelA, tenantId: B }, A));
    expectNotFound(() => assertModelInTenant(null, A));
    expectNotFound(() =>
      assertVersionChain(modelA, { ...versionA, tenantId: B }, A),
    );
    expectNotFound(() =>
      assertVersionChain({ ...modelA, tenantId: B }, versionA, A),
    );
    expectNotFound(() =>
      assertVersionChain(modelA, { ...versionA, modelId: 'mdl_other' }, A),
    );
    expectNotFound(() =>
      assertSimulationChain(modelA, versionA, { ...simA, tenantId: B }, A),
    );
    expectNotFound(() =>
      assertSimulationChain(
        modelA,
        versionA,
        { ...simA, versionRowId: 'ver_other' },
        A,
      ),
    );
  });

  it('allows same-tenant chains', () => {
    expect(() => assertModelInTenant(modelA, A)).not.toThrow();
    expect(() => assertVersionChain(modelA, versionA, A)).not.toThrow();
    expect(() =>
      assertSimulationChain(modelA, versionA, simA, A),
    ).not.toThrow();
  });
});
