import {
  Inject,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';

/**
 * Application-wide PostgreSQL client.
 *
 * Owns connection lifecycle only — `$connect` on bootstrap,
 * `$disconnect` on shutdown. No domain logic, no queries, no
 * repositories here: tables and adapters live on top
 * of this service. `src/domain/` must never import this file
 * (ADR-002: framework-free deterministic engine).
 *
 * Prisma 7 requires an explicit driver adapter: the pg pool is
 * built from the validated `DATABASE_URL` (see `AppConfigModule`)
 * instead of reading `process.env` directly.
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor(@Inject('APP_CONFIG') config: { databaseUrl: string }) {
    const pool = new Pool({ connectionString: config.databaseUrl });
    super({ adapter: new PrismaPg(pool) });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
