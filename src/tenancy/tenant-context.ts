import { AppError } from '../common/errors/app-error';

export type TenantContext = {
  readonly tenantId: string;
  readonly keyPrefix?: string;
  readonly keyId?: string;
  readonly scopes?: readonly string[];
};

export function requireTenantId(ctx: TenantContext | null | undefined): string {
  const id = typeof ctx?.tenantId === 'string' ? ctx.tenantId.trim() : '';
  if (!id || id.length > 128) {
    throw new AppError('tenant_forbidden', 'Missing tenant identity.');
  }
  return id;
}

export function resolveTenantId(
  ctx: TenantContext | null | undefined,
  bodyTenantId?: unknown,
): string {
  const authenticated = requireTenantId(ctx);
  if (typeof bodyTenantId === 'string' && bodyTenantId !== authenticated) {
    throw new AppError(
      'tenant_forbidden',
      'Request tenant does not match authenticated tenant.',
    );
  }
  return authenticated;
}
