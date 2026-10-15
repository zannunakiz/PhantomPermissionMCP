import { AppError } from '../common/errors/app-error';
import type {
  AccessModelRecord,
  ModelVersionRecord,
  SimulationRecord,
} from '../repositories/records';

export function assertOwned(
  recordTenantId: string | null | undefined,
  tenantId: string,
  resource = 'resource',
): void {
  if (!recordTenantId || recordTenantId !== tenantId) {
    throw new AppError('not_found', `${resource} not found.`, {
      status: 404,
    });
  }
}

export function assertModelInTenant(
  model: AccessModelRecord | null | undefined,
  tenantId: string,
): asserts model is AccessModelRecord {
  if (!model || model.tenantId !== tenantId) {
    throw new AppError('not_found', 'Access model not found.', {
      status: 404,
    });
  }
}

export function assertVersionChain(
  model: AccessModelRecord | null | undefined,
  version: ModelVersionRecord | null | undefined,
  tenantId: string,
): asserts version is ModelVersionRecord {
  assertModelInTenant(model, tenantId);
  if (
    !version ||
    version.tenantId !== tenantId ||
    version.modelId !== model.id
  ) {
    throw new AppError('not_found', 'Model version not found.', {
      status: 404,
    });
  }
}

export function assertSimulationChain(
  model: AccessModelRecord | null | undefined,
  version: ModelVersionRecord | null | undefined,
  simulation: SimulationRecord | null | undefined,
  tenantId: string,
): asserts simulation is SimulationRecord {
  assertModelInTenant(model, tenantId);
  const modelId: string = model.id;
  if (
    !version ||
    version.tenantId !== tenantId ||
    version.modelId !== modelId
  ) {
    throw new AppError('not_found', 'Model version not found.', {
      status: 404,
    });
  }
  if (
    !simulation ||
    simulation.tenantId !== tenantId ||
    simulation.modelId !== modelId ||
    simulation.versionRowId !== version.id
  ) {
    throw new AppError('not_found', 'Simulation not found.', {
      status: 404,
    });
  }
}
