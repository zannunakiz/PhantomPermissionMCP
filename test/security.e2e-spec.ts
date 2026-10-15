import { Controller, Get, INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { setupHttpHandling } from '../src/common/http';

@Controller('__security')
class SecurityProbeController {
  @Get('ping')
  ping(): { ok: boolean } {
    return { ok: true };
  }
}

async function buildApp(
  overrides: Record<string, number | string | string[]> = {},
): Promise<INestApplication<App>> {
  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
    controllers: [SecurityProbeController],
  }).compile();
  const app = moduleFixture.createNestApplication({ bodyParser: false });
  setupHttpHandling(app, {
    requestBodyLimit: '1mb',
    nodeEnv: 'test',
    corsOrigins: ['https://app.example.com'],
    rateLimitWindowMs: 60000,
    rateLimitMax: 100,
    ...overrides,
  });
  await app.init();
  return app;
}

describe('HTTP security controls (e2e)', () => {
  it('sets hardening headers and hides x-powered-by', async () => {
    const app = await buildApp();
    try {
      const res = await request(app.getHttpServer())
        .get('/__security/ping')
        .expect(200);
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['x-frame-options']).toBe('DENY');
      expect(res.headers['referrer-policy']).toBe('no-referrer');
      expect(res.headers['x-powered-by']).toBeUndefined();
    } finally {
      await app.close();
    }
  });

  it('denies disallowed origins and allows listed ones', async () => {
    const app = await buildApp();
    try {
      const denied = await request(app.getHttpServer())
        .get('/__security/ping')
        .set('Origin', 'https://evil.example.com')
        .expect(200);
      expect(denied.headers['access-control-allow-origin']).toBeUndefined();
      const allowed = await request(app.getHttpServer())
        .get('/__security/ping')
        .set('Origin', 'https://app.example.com')
        .expect(200);
      expect(allowed.headers['access-control-allow-origin']).toBe(
        'https://app.example.com',
      );
    } finally {
      await app.close();
    }
  });

  it('rate-limits with rate_limited envelope and Retry-After', async () => {
    const app = await buildApp({ rateLimitMax: 2, rateLimitWindowMs: 60000 });
    try {
      const server = app.getHttpServer();
      await request(server).get('/__security/ping').expect(200);
      await request(server).get('/__security/ping').expect(200);
      const res = await request(server).get('/__security/ping').expect(429);
      const body = res.body as { error?: { code?: string; status?: number } };
      expect(body.error?.code).toBe('rate_limited');
      expect(body.error?.status).toBe(429);
      expect(res.headers['retry-after']).toBeDefined();
    } finally {
      await app.close();
    }
  });
});
