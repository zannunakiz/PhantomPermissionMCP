import { Controller, Get, INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { JsonLoggerService } from '../src/common/logging';
import { REQUEST_ID_HEADER } from '../src/common/errors';

@Controller('__logging')
class LoggingProbeController {
  @Get('ok')
  ok(): string {
    return 'ok';
  }
}

async function buildApp(captured: string[]): Promise<INestApplication<App>> {
  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
    controllers: [LoggingProbeController],
  })
    .overrideProvider('APP_CONFIG')
    .useValue({
      nodeEnv: 'test',
      port: 3000,
      databaseUrl: 'postgresql://u:p@localhost:5432/t',
      apiKeyPepper: 'test-pepper',
      isPepperInsecure: false,
      corsOrigins: [],
      logLevel: 'info',
      requestBodyLimit: '1mb',
      rateLimitWindowMs: 60000,
      rateLimitMax: 100,
      metricsEnabled: false,
    })
    .overrideProvider(JsonLoggerService)
    .useValue(
      new (class extends JsonLoggerService {
        override write(
          level: 'debug' | 'info' | 'warn' | 'error',
          message: string,
          fields: Record<string, unknown> = {},
        ): void {
          captured.push(JSON.stringify({ level, msg: message, ...fields }));
          super.write(level, message, fields);
        }
      })({ logLevel: 'info' }),
    )
    .compile();

  const app = moduleFixture.createNestApplication({ logger: false });
  await app.init();
  return app;
}

function accessLines(captured: string[]): Array<Record<string, unknown>> {
  return captured
    .map((line) => JSON.parse(line) as unknown as Record<string, unknown>)
    .filter((record) => record.msg === 'http_request');
}

describe('Request IDs and structured access logs (e2e)', () => {
  let app: INestApplication<App>;
  let captured: string[];
  let stdout: string[];

  function stdoutWriter(): typeof process.stdout.write {
    // `Function.prototype.bind` is typed as `any` under this repo's
    // relaxed tsconfig; isolate the unsafe boundary in one helper.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    return process.stdout.write.bind(process.stdout);
  }

  const originalWrite = stdoutWriter();

  beforeAll(async () => {
    captured = [];
    stdout = [];
    const patched = (chunk: string | Uint8Array): boolean => {
      stdout.push(typeof chunk === 'string' ? chunk : String(chunk));
      return true;
    };
    (process.stdout as unknown as { write: typeof patched }).write = patched;
    app = await buildApp(captured);
  });

  afterAll(async () => {
    process.stdout.write = originalWrite;
    await app.close();
  });

  it('echoes a caller request id on success and logs one structured line', async () => {
    const res = await request(app.getHttpServer())
      .get('/__logging/ok')
      .set(REQUEST_ID_HEADER, 'req_e2e-log-1')
      .set('Authorization', 'Bearer ppk_live-should-not-appear')
      .expect(200);

    expect(res.headers[REQUEST_ID_HEADER]).toBe('req_e2e-log-1');

    const lines = accessLines(captured);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      level: 'info',
      requestId: 'req_e2e-log-1',
      method: 'GET',
      url: '/__logging/ok',
      statusCode: 200,
    });
    expect(typeof lines[0]?.durationMs).toBe('number');
  });

  it('generates a req_ id when none is supplied', async () => {
    const res = await request(app.getHttpServer())
      .get('/__logging/ok?api_key=ppk_live-should-not-appear&page=2')
      .expect(200);
    const header = res.headers[REQUEST_ID_HEADER];
    expect(typeof header).toBe('string');
    expect(header).toMatch(/^req_[0-9a-f]{24}$/);
    const lines = accessLines(captured);
    const last = lines[lines.length - 1];
    expect(last?.requestId).toBe(header);
    // Query secrets are redacted in the structured log; bodies/headers
    // are never logged at all.
    expect(last?.url).toBe('/__logging/ok?api_key=[redacted]&page=2');
  });

  it('never emits raw keys, tokens, or connection strings to stdout', async () => {
    await request(app.getHttpServer())
      .get('/__logging/ok')
      .set('Authorization', 'Bearer ppk_live-should-not-appear')
      .set('Cookie', 'session=abc')
      .expect(200);
    const joined = stdout.join('');
    expect(joined).not.toContain('ppk_live-should-not-appear');
  });
});
