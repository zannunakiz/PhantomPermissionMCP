import { Global, Module } from '@nestjs/common';
import { AuthGuard, CurrentTenant, RequireScopes } from './auth.guard';
import { AuthService } from './auth.service';
export { AuthGuard, AuthService, CurrentTenant, RequireScopes };
export { SCOPES, isScope, type Scope } from './scopes';
export { digestKey, generateRawKey, keyPrefixOf, parseBearer } from './api-key';

@Global()
@Module({
  providers: [AuthService, AuthGuard],
  exports: [AuthService, AuthGuard],
})
export class AuthModule {}
