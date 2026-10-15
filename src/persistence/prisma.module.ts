import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/**
 * Global persistence wiring (Step 19).
 *
 * Exports a single shared {@link PrismaService} so later feature
 * modules (tenancy, models, simulations, audit — Steps 20-25) can
 * inject the client without re-creating connections. Global to
 * avoid importing a persistence module from every feature module.
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
