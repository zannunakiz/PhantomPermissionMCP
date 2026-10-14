import { JsonLoggerService } from './json-logger.service';
import {
  REDACTED,
  redactHeaders,
  redactUrl,
  redactValue,
  scrubSecretStrings,
} from './redact';
import { getRequestId, runWithRequestId } from './request-context';

function stdoutWriter(): typeof process.stdout.write {
  // `Function.prototype.bind` is typed as `any` under this repo's
  // relaxed tsconfig; isolate the unsafe boundary in one helper.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  return process.stdout.write.bind(process.stdout);
}

function captureStdout(fn: () => void): string[] {
  const lines: string[] = [];
  const original = stdoutWriter();
  const patched = (chunk: string | Uint8Array, ...rest: unknown[]): boolean => {
    lines.push(typeof chunk === 'string' ? chunk : String(chunk));
    void rest;
    return true;
  };
  (process.stdout as unknown as { write: typeof patched }).write = patched;
  try {
    fn();
  } finally {
    process.stdout.write = original;
  }
  return lines;
}

function parseLines(lines: string[]): Array<Record<string, unknown>> {
  return lines
    .join('')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as unknown as Record<string, unknown>);
}

describe('secret redaction', () => {
  it('masks sensitive header values wholesale', () => {
    expect(
      redactHeaders({
        authorization: 'Bearer ppk_live-abc123',
        cookie: 'session=xyz; ppk_live-abc123',
        'x-api-key': 'ppk_live-abc123',
        'content-type': 'application/json',
      }),
    ).toEqual({
      authorization: REDACTED,
      cookie: REDACTED,
      'x-api-key': REDACTED,
      'content-type': 'application/json',
    });
  });

  it('masks sensitive keys; scrubs key/token/url substrings in safe values', () => {
    const redacted = redactValue({
      password: 'hunter2',
      nested: {
        apiKeyPepper: 'super-secret-pepper',
        note: 'key ppk_live-abc123 leaked?',
        authHeader: 'Bearer abc.def.ghi',
        databaseUrl: 'postgresql://admin:s3cret@db:5432/app',
        ok: 42,
      },
    });
    expect(redacted).toEqual({
      password: REDACTED,
      nested: {
        apiKeyPepper: REDACTED,
        note: 'key [redacted] leaked?',
        authHeader: '[redacted]',
        databaseUrl: REDACTED,
        ok: 42,
      },
    });
  });

  it('redacts sensitive query params while preserving safe ones', () => {
    expect(redactUrl('/api/v1/models?page=2&api_key=ppk_live-x')).toBe(
      '/api/v1/models?page=2&api_key=[redacted]',
    );
    expect(redactUrl('/health/live')).toBe('/health/live');
  });

  it('scrubs free-text secret occurrences', () => {
    expect(scrubSecretStrings('saw ppk_live-abc123 today')).toBe(
      'saw [redacted] today',
    );
    expect(scrubSecretStrings('Authorization: Bearer abc.def ok')).toBe(
      'Authorization: [redacted] ok',
    );
  });
});

describe('JsonLoggerService', () => {
  it('emits one structured JSON line per write with level gating', () => {
    const logger = new JsonLoggerService({ logLevel: 'warn' });
    const lines = captureStdout(() => {
      logger.write('info', 'suppressed', { a: 1 });
      logger.write('warn', 'kept ppk_live-abc123', { authorization: 'x' });
    });
    const records = parseLines(lines);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      level: 'warn',
      msg: 'kept [redacted]',
      authorization: REDACTED,
    });
    expect(typeof records[0]?.ts).toBe('string');
  });

  it('attaches the async request id automatically', () => {
    const logger = new JsonLoggerService({ logLevel: 'info' });
    const lines = captureStdout(() => {
      runWithRequestId({ requestId: 'req_ctx-1' }, () => {
        logger.write('info', 'inside');
      });
      logger.write('info', 'outside');
    });
    const records = parseLines(lines);
    expect(records[0]?.requestId).toBe('req_ctx-1');
    expect(records[1]).not.toHaveProperty('requestId');
    expect(getRequestId()).toBeUndefined();
  });

  it('serves as a Nest LoggerService without leaking secrets', () => {
    const logger = new JsonLoggerService({ logLevel: 'debug' });
    const lines = captureStdout(() => {
      logger.log('hello ppk_live-abc123', 'ctx');
      logger.error('boom postgresql://u:p@host/db', { password: 'x' });
    });
    const joined = lines.join('');
    expect(joined).not.toContain('ppk_live-abc123');
    expect(joined).not.toContain('u:p@host');
    expect(parseLines(lines)).toHaveLength(2);
  });
});
