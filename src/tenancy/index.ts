export type { TenantContext } from './tenant-context';
export { requireTenantId, resolveTenantId } from './tenant-context';
export {
  assertModelInTenant,
  assertOwned,
  assertSimulationChain,
  assertVersionChain,
} from './tenant-scope';
