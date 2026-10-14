import { Controller, Get, INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { AppError } from '../src/common/errors';
import type { ErrorEnvelope } from '../src/common/errors';
import { REQUEST_ID_HEADER } from '../src/common/errors';

type ErrorBody = { error: ErrorEnvelope['error'] };

function asErrorBody(value: unknown): ErrorBody {
  if (
    typeof value === 'object' &&
    value !== null &&
    'error' in value &&
    typeof value.error === 'object' &&
    value.error !== null
  ) {
    return value as ErrorBody;
  }
  throw new Error('Expected an error-envelope body');
}

@Controller('__errors')
class ErrorsProbeController {
  @Get('validation')
  validation() {
    throw new AppError('validation_failed', 'Snapshot is invalid', {
      details: [{ path: 'roles[3].name', reason: 'duplicate' }],
    });
  }

  @Get('auth')
  auth() {
    throw new AppError('unauthorized', 'Missing or invalid API key');
  }

  @Get('tenant')
  tenant() {
    throw new AppError('tenant_forbidden', 'Model belongs to another tenant');
  }

  @Get('conflict')
  conflict() {
    throw new AppError('conflict_version', 'expectedVersion is stale', {
      details: [{ path: 'expectedVersion', reason: 'stale' }],
    });
  }

  @Get('idempotency')
  idempotency() {
    throw new AppError(
      'idempotency_conflict',
      'Idempotency-Key replay mismatch',
    );
  }

  @Get('rate')
  rate() {
    throw new AppError('rate_limited', 'Too many requests');
  }

  @Get('boom')
  boom(): never {
    throw new Error('SELECT * FROM api_keys WHERE id=1');
  }
}

async function buildApp(nodeEnv: string): Promise<INestApplication<App>> {
  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
    controllers: [ErrorsProbeController],
  })
    .overrideProvider('APP_CONFIG')
    .useValue({
      nodeEnv,
      port: 3000,
      databaseUrl: 'postgresql://u:p@localhost:5432/t',
      apiKeyPepper: 'test-pepper',
      isPepperInsecure: false,
      corsOrigins: [],
      logLevel: 'error',
      requestBodyLimit: '1mb',
      rateLimitWindowMs: 60000,
      rateLimitMax: 100,
      metricsEnabled: false,
    })
    .compile();

  const app = moduleFixture.createNestApplication();
  await app.init();
  return app;
}

describe('Error envelope (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await buildApp('test');
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns the stable envelope for validation errors and echoes caller request id', async () => {
    const res = await request(app.getHttpServer())
      .get('/__errors/validation')
      .set(REQUEST_ID_HEADER, 'req_e2e-1')
      .expect(400);

    expect(res.headers[REQUEST_ID_HEADER]).toBe('req_e2e-1');
    expect(res.body).toEqual({
      error: {
        code: 'validation_failed',
        message: 'Snapshot is invalid',
        status: 400,
        details: [{ path: 'roles[3].name', reason: 'duplicate' }],
        requestId: 'req_e2e-1',
      },
    });
  });

  it('maps auth/tenant/conflict/idempotency/rate-limit codes consistently', async () => {
    const server = app.getHttpServer();
    const expectations: Array<[string, number, string]> = [
      ['auth', 401, 'unauthorized'],
      ['tenant', 403, 'tenant_forbidden'],
      ['conflict', 409, 'conflict_version'],
      ['idempotency', 409, 'idempotency_conflict'],
      ['rate', 429, 'rate_limited'],
    ];
    for (const [route, status, code] of expectations) {
      const res = await request(server)
        .get(`/__errors/${route}`)
        .expect(status);
      const body = asErrorBody(res.body);
      expect(body.error).toMatchObject({ code, status });
      expect(typeof body.error.requestId).toBe('string');
      expect(res.headers[REQUEST_ID_HEADER]).toBe(body.error.requestId);
    }
  });

  it('maps unknown routes to not_found with the envelope', async () => {
    const res = await request(app.getHttpServer())
      .get('/__errors/does-not-exist-at-all')
      .expect(404);
    const body = asErrorBody(res.body);
    expect(body.error.code).toBe('not_found');
    expect(body.error.status).toBe(404);
  });
});

describe('Error envelope in production (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await buildApp('production');
  });

  afterAll(async () => {
    await app.close();
  });

  it('does not leak SQL or stack traces on unexpected errors', async () => {
    const res = await request(app.getHttpServer())
      .get('/__errors/boom')
      .expect(500);
    expect(res.body).toEqual({
      error: {
        code: 'internal_error',
        message: 'Internal server error',
        status: 500,
        details: [],
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        requestId: expect.any(String),
      },
    });
    expect(JSON.stringify(res.body)).not.toContain('SELECT');
  });
});
