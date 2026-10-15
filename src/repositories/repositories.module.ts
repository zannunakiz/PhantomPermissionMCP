import { Global, Module } from '@nestjs/common';
import { PrismaAccessModelRepository } from './prisma/prisma-access-model.repository';
import { PrismaApiKeyRepository } from './prisma/prisma-api-key.repository';
import { PrismaAuditRepository } from './prisma/prisma-audit.repository';
import { PrismaIdempotencyRepository } from './prisma/prisma-idempotency.repository';
import { PrismaModelVersionRepository } from './prisma/prisma-model-version.repository';
import { PrismaSimulationRepository } from './prisma/prisma-simulation.repository';
import { PrismaTenantRepository } from './prisma/prisma-tenant.repository';
import {
  ACCESS_MODEL_REPOSITORY,
  API_KEY_REPOSITORY,
  AUDIT_REPOSITORY,
  IDEMPOTENCY_REPOSITORY,
  MODEL_VERSION_REPOSITORY,
  SIMULATION_REPOSITORY,
  TENANT_REPOSITORY,
} from './tokens';

/**
 * Repository wiring. Binds each port token to its Prisma adapter and
 * exports the tokens globally: application services inject the port
 * (interface), never the adapter class or the Prisma client.
 */
@Global()
@Module({
  providers: [
    PrismaTenantRepository,
    PrismaApiKeyRepository,
    PrismaAccessModelRepository,
    PrismaModelVersionRepository,
    PrismaSimulationRepository,
    PrismaIdempotencyRepository,
    PrismaAuditRepository,
    { provide: TENANT_REPOSITORY, useExisting: PrismaTenantRepository },
    { provide: API_KEY_REPOSITORY, useExisting: PrismaApiKeyRepository },
    {
      provide: ACCESS_MODEL_REPOSITORY,
      useExisting: PrismaAccessModelRepository,
    },
    {
      provide: MODEL_VERSION_REPOSITORY,
      useExisting: PrismaModelVersionRepository,
    },
    { provide: SIMULATION_REPOSITORY, useExisting: PrismaSimulationRepository },
    {
      provide: IDEMPOTENCY_REPOSITORY,
      useExisting: PrismaIdempotencyRepository,
    },
    { provide: AUDIT_REPOSITORY, useExisting: PrismaAuditRepository },
  ],
  exports: [
    TENANT_REPOSITORY,
    API_KEY_REPOSITORY,
    ACCESS_MODEL_REPOSITORY,
    MODEL_VERSION_REPOSITORY,
    SIMULATION_REPOSITORY,
    IDEMPOTENCY_REPOSITORY,
    AUDIT_REPOSITORY,
  ],
})
export class RepositoriesModule {}
