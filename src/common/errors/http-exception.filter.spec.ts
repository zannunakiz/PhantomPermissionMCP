import { HttpStatus } from '@nestjs/common';
import { AppError } from './app-error';
import type { ErrorCode } from './error-codes';
import { ERROR_CODE_STATUS, ERROR_CODES } from './error-codes';
import type { ErrorEnvelope } from './error-envelope';
import { codeForStatus, HttpExceptionFilter } from './http-exception.filter';
import { REQUEST_ID_HEADER } from './request-id';

type MockResponse = {
  statusCode: number;
  body: unknown;
  headers: Record<string, string>;
};

function runFilter(
  exception: unknown,
  options: {
    nodeEnv?: string;
    incomingRequestId?: string;
  } = {},
): MockResponse {
  const filter = new HttpExceptionFilter({
    nodeEnv: options.nodeEnv ?? 'test',
  });
  const captured: MockResponse = {
    statusCode: 0,
    body: undefined,
    headers: {},
  };
  const res = {
    setHeader: (name: string, value: string) => {
      captured.headers[name] = value;
    },
    status: (code: number) => ({
      json: (body: unknown) => {
        captured.statusCode = code;
        captured.body = body;
      },
    }),
  };
  const req = {
    headers:
      options.incomingRequestId === undefined
        ? {}
        : { [REQUEST_ID_HEADER]: options.incomingRequestId },
  };
  const host = {
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => res,
    }),
  };
  filter.catch(exception, host as never);
  return captured;
}

describe('error codes', () => {
  it('keeps the v1 code list stable and status-mapped', () => {
    expect([...ERROR_CODES]).toEqual([
      'validation_failed',
      'unauthorized',
      'forbidden_scope',
      'tenant_forbidden',
      'not_found',
      'conflict_version',
      'idempotency_conflict',
      'payload_too_large',
      'rate_limited',
      'internal_error',
    ]);
    expect(ERROR_CODE_STATUS.not_found).toBe(404);
    expect(ERROR_CODE_STATUS.internal_error).toBe(500);
  });

  it('maps representative HTTP statuses to stable codes', () => {
    expect(codeForStatus(HttpStatus.BAD_REQUEST)).toBe('validation_failed');
    expect(codeForStatus(HttpStatus.UNAUTHORIZED)).toBe('unauthorized');
    expect(codeForStatus(HttpStatus.FORBIDDEN)).toBe('forbidden_scope');
    expect(codeForStatus(HttpStatus.NOT_FOUND)).toBe('not_found');
    expect(codeForStatus(HttpStatus.CONFLICT)).toBe('conflict_version');
    expect(codeForStatus(HttpStatus.PAYLOAD_TOO_LARGE)).toBe(
      'payload_too_large',
    );
    expect(codeForStatus(HttpStatus.UNPROCESSABLE_ENTITY)).toBe(
      'validation_failed',
    );
    expect(codeForStatus(HttpStatus.TOO_MANY_REQUESTS)).toBe('rate_limited');
    expect(codeForStatus(HttpStatus.INTERNAL_SERVER_ERROR)).toBe(
      'internal_error',
    );
  });
});

describe('HttpExceptionFilter', () => {
  it('serialises AppError with details and reuses the caller request id', () => {
    const out = runFilter(
      new AppError('tenant_forbidden', 'Cross-tenant read denied', {
        details: [{ path: 'params.id', reason: 'wrong_tenant' }],
      }),
      { incomingRequestId: 'req_caller-123' },
    );

    expect(out.statusCode).toBe(403);
    expect(out.headers[REQUEST_ID_HEADER]).toBe('req_caller-123');
    expect(out.body).toEqual({
      error: {
        code: 'tenant_forbidden',
        message: 'Cross-tenant read denied',
        status: 403,
        details: [{ path: 'params.id', reason: 'wrong_tenant' }],
        requestId: 'req_caller-123',
      },
    });
  });

  it('generates a req_ id when the caller sends none', () => {
    const out = runFilter(new AppError('not_found', 'No such model'));
    const body = out.body as ErrorEnvelope;
    expect(out.statusCode).toBe(404);
    expect(body.error.requestId).toMatch(/^req_[0-9a-f]{24}$/);
    expect(out.headers[REQUEST_ID_HEADER]).toBe(body.error.requestId);
  });

  it('covers validation, auth, conflict, rate-limit, and payload codes', () => {
    const cases: Array<{ code: ErrorCode; status: number }> = [
      { code: 'validation_failed', status: 400 },
      { code: 'unauthorized', status: 401 },
      { code: 'forbidden_scope', status: 403 },
      { code: 'conflict_version', status: 409 },
      { code: 'idempotency_conflict', status: 409 },
      { code: 'payload_too_large', status: 413 },
      { code: 'rate_limited', status: 429 },
    ];
    for (const { code, status } of cases) {
      const out = runFilter(new AppError(code, `${code} happened`));
      expect(out.statusCode).toBe(status);
      expect((out.body as ErrorEnvelope).error).toMatchObject({
        code,
        status,
      });
    }
  });

  it('hides internal messages, stacks, and SQL in production', () => {
    const secretKey = 'ppk_live-secret-value';
    const out = runFilter(
      new AppError('internal_error', `boom with ${secretKey}`, {
        details: [{ path: 'db', reason: 'SELECT * FROM api_keys' }],
      }),
      { nodeEnv: 'production' },
    );
    const body = out.body as ErrorEnvelope;
    expect(out.statusCode).toBe(500);
    expect(body.error).toEqual({
      code: 'internal_error',
      message: 'Internal server error',
      status: 500,
      details: [],
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      requestId: expect.any(String),
    });
    expect(JSON.stringify(out.body)).not.toContain(secretKey);
    expect(JSON.stringify(out.body)).not.toContain('SELECT');
  });

  it('converts unknown throwables to internal_error without leaking', () => {
    const dev = runFilter(new Error('SELECT * FROM users WHERE id=1'), {
      nodeEnv: 'development',
    });
    expect(dev.statusCode).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect((dev.body as ErrorEnvelope).error.code).toBe('internal_error');

    const prod = runFilter(new TypeError('cannot read property of undefined'), {
      nodeEnv: 'production',
    });
    expect((prod.body as ErrorEnvelope).error.message).toBe(
      'Internal server error',
    );
  });
});
