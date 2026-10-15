/**
 * Step 07 transport hardening (e2e).
 *
 * Covers the prompt.MD validation gate: malformed JSON, unknown
 * properties, incorrect primitive types, oversized payloads, valid
 * payloads, and supported content types. Asserts invalid input never
 * reaches the handler and every rejection uses the stable v1 envelope
 * with an echoed `x-request-id`.
 */
import { Body, Controller, INestApplication, Post } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { setupHttpHandling, ZodValidationPipe } from '../src/common/http';
import { REQUEST_ID_HEADER } from '../src/common/errors';
import type { ErrorEnvelope } from '../src/common/errors';
import { z } from 'zod';

const echoSchema = z
  .object({
    name: z.string().min(1).max(50),
    age: z.number().int().min(0),
  })
  .strict();

type EchoBody = z.infer<typeof echoSchema>;

let handlerCalls = 0;

@Controller('__http-input')
class HttpInputProbeController {
  @Post('echo')
  echo(@Body(new ZodValidationPipe(echoSchema)) body: EchoBody): EchoBody {
    handlerCalls += 1;
    return body;
  }
}

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

async function buildApp(): Promise<INestApplication<App>> {
  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
    controllers: [HttpInputProbeController],
  }).compile();

  // Mirror production bootstrap: default parser off, Step 07 handling on.
  // Tiny 1kb limit keeps the oversized-payload case fast and deterministic.
  const app = moduleFixture.createNestApplication({ bodyParser: false });
  setupHttpHandling(app, { requestBodyLimit: '1kb' });
  await app.init();
  return app;
}

describe('HTTP input handling (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    handlerCalls = 0;
  });

  it('accepts a valid JSON payload', async () => {
    const res = await request(app.getHttpServer())
      .post('/__http-input/echo')
      .set('Content-Type', 'application/json')
      .send({ name: 'billing', age: 3 })
      .expect(201);
    expect(res.body).toEqual({ name: 'billing', age: 3 });
    expect(handlerCalls).toBe(1);
  });

  it('rejects unknown properties without reaching the handler', async () => {
    const before = handlerCalls;
    const res = await request(app.getHttpServer())
      .post('/__http-input/echo')
      .set('Content-Type', 'application/json')
      .set(REQUEST_ID_HEADER, 'req_http-unknown')
      .send({ name: 'billing', age: 3, extra: true })
      .expect(400);
    const body = asErrorBody(res.body);
    expect(body.error.code).toBe('validation_failed');
    expect(body.error.details).toContainEqual({
      path: 'extra',
      reason: 'unknown_property',
    });
    expect(body.error.requestId).toBe('req_http-unknown');
    expect(res.headers[REQUEST_ID_HEADER]).toBe('req_http-unknown');
    expect(handlerCalls).toBe(before);
  });

  it('rejects incorrect primitive types without coercion', async () => {
    const before = handlerCalls;
    const res = await request(app.getHttpServer())
      .post('/__http-input/echo')
      .set('Content-Type', 'application/json')
      .send({ name: 'billing', age: '3' })
      .expect(400);
    const body = asErrorBody(res.body);
    expect(body.error.code).toBe('validation_failed');
    expect(body.error.details).toContainEqual({
      path: 'age',
      reason: 'expected_number',
    });
    expect(typeof body.error.requestId).toBe('string');
    expect(res.headers[REQUEST_ID_HEADER]).toBe(body.error.requestId);
    expect(handlerCalls).toBe(before);
  });

  it('rejects malformed JSON with the v1 envelope', async () => {
    const before = handlerCalls;
    const res = await request(app.getHttpServer())
      .post('/__http-input/echo')
      .set('Content-Type', 'application/json')
      .send('{"name": "billing", "age": }')
      .expect(400);
    const body = asErrorBody(res.body);
    expect(body.error).toMatchObject({
      code: 'validation_failed',
      status: 400,
    });
    expect(body.error.details).toContainEqual({
      path: '(body)',
      reason: 'malformed_json',
    });
    expect(typeof body.error.requestId).toBe('string');
    expect(res.headers[REQUEST_ID_HEADER]).toBe(body.error.requestId);
    expect(handlerCalls).toBe(before);
  });

  it('rejects oversized payloads with 413 payload_too_large', async () => {
    const before = handlerCalls;
    const res = await request(app.getHttpServer())
      .post('/__http-input/echo')
      .set('Content-Type', 'application/json')
      .set(REQUEST_ID_HEADER, 'req_http-large')
      .send({ name: 'x'.repeat(2048), age: 1 })
      .expect(413);
    const body = asErrorBody(res.body);
    expect(body.error).toMatchObject({
      code: 'payload_too_large',
      status: 413,
    });
    expect(res.headers[REQUEST_ID_HEADER]).toBe('req_http-large');
    expect(handlerCalls).toBe(before);
  });

  it('rejects unsupported content types', async () => {
    const before = handlerCalls;
    const res = await request(app.getHttpServer())
      .post('/__http-input/echo')
      .set('Content-Type', 'text/plain')
      .send('hello')
      .expect(400);
    const body = asErrorBody(res.body);
    expect(body.error.code).toBe('validation_failed');
    expect(body.error.details).toContainEqual({
      path: '(body)',
      reason: 'unsupported_content_type',
    });
    expect(handlerCalls).toBe(before);
  });
});
