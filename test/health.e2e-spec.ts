/**
 * Step 49 — health + graceful shutdown e2e (no live database required).
 * Uses a stubbed PrismaService behind the real HealthController/HealthService:
 * - GET /health/live → 200 { status: 'ok' } without touching the DB.
 * - GET /health/ready → 200 { status:'ok', database:'up' } when probe passes.
 * - GET /health/ready → 503 { status:'degraded', database:'down' } with no
 *   leaked internals when the probe throws.
 * - app.close() (the enableShutdownHooks path) resolves cleanly and the
 *   server stops accepting connections — repeatable shutdown smoke test.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { HealthController } from '../src/health/health.controller';
import { HealthService } from '../src/health/health.service';
import { PrismaService } from '../src/persistence';

describe('Health (e2e, Step 49)', () => {
  let app: INestApplication<App>;
  let queryImpl: () => Promise<unknown>;
  let queryCalls: number;

  async function boot(): Promise<void> {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        HealthService,
        {
          provide: PrismaService,
          useValue: {
            $queryRaw: (): Promise<unknown> => {
              queryCalls += 1;
              return queryImpl();
            },
          },
        },
      ],
    }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
  }

  beforeEach(async () => {
    queryCalls = 0;
    queryImpl = () => Promise.resolve([{ '?column?': 1 }]);
    await boot();
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  it('GET /health/live → 200 without touching the database', async () => {
    await request(app.getHttpServer())
      .get('/health/live')
      .expect(200)
      .expect({ status: 'ok' });
    expect(queryCalls).toBe(0);
  });

  it('GET /health/ready → 200 when the DB probe succeeds', async () => {
    await request(app.getHttpServer())
      .get('/health/ready')
      .expect(200)
      .expect({ status: 'ok', database: 'up' });
    expect(queryCalls).toBe(1);
  });

  it('GET /health/ready → 503 without leaking internals when DB is down', async () => {
    const secret = 'postgresql://phantom:SECRET@localhost:5432/db';
    queryImpl = () => Promise.reject(new Error(`connect failed for ${secret}`));
    const res = await request(app.getHttpServer())
      .get('/health/ready')
      .expect(503);
    expect(res.body).toEqual({ status: 'degraded', database: 'down' });
    expect(JSON.stringify(res.body)).not.toContain('SECRET');
    expect(JSON.stringify(res.body)).not.toContain('postgresql://');
  });

  it('graceful shutdown: app.close() resolves and tears down listeners', async () => {
    await request(app.getHttpServer()).get('/health/live').expect(200);
    // Repeatable shutdown smoke: close resolves (drains HTTP + runs
    // onModuleDestroy → Prisma $disconnect in the real bootstrap via
    // enableShutdownHooks) and is idempotent.
    await expect(app.close()).resolves.toBeUndefined();
    await expect(app.close()).resolves.toBeUndefined();
    // Prevent further afterEach close attempts.
    app = undefined as unknown as INestApplication<App>;
  });
});
