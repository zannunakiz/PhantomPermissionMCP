import {
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
  createParamDecorator,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { TenantContext } from '../tenancy/tenant-context';
import { AuthService } from './auth.service';
import type { Scope } from './scopes';

export const SCOPES_KEY = 'auth:scopes';
export const RequireScopes = (...scopes: Scope[]) =>
  SetMetadata(SCOPES_KEY, scopes);
type TenantRequest = {
  headers?: { authorization?: string };
  tenant?: TenantContext;
};
export const CurrentTenant = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): TenantContext =>
    ctx.switchToHttp().getRequest<TenantRequest>().tenant as TenantContext,
);

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly auth: AuthService,
    private readonly reflector: Reflector,
  ) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<TenantRequest>();
    const tenant = await this.auth.verify(req.headers?.authorization);
    req.tenant = tenant;
    const scopes =
      this.reflector.getAllAndOverride<Scope[]>(SCOPES_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? [];
    for (const s of scopes) this.auth.requireScope(tenant, s);
    return true;
  }
}
