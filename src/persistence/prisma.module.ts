import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/**
 * Global persistence wiring.
 *
 * Exports a single shared {@link PrismaService} so later feature
 * modules (tenancy, models, simulations, audit) can
 * inject the client without re-creating connections. Global to
 * avoid importing a persistence module from every feature module.
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
