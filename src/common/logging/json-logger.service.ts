import {
  Inject,
  Injectable,
  Optional,
  type LoggerService,
  type LogLevel as NestLogLevel,
} from '@nestjs/common';
import { getRequestId } from './request-context';
import { redactValue, scrubSecretStrings } from './redact';

export type LoggerLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LoggerLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

type AppConfigLike = { logLevel?: string; nodeEnv?: string };

function normalizeLevel(value: unknown): LoggerLevel | undefined {
  return value === 'debug' ||
    value === 'info' ||
    value === 'warn' ||
    value === 'error'
    ? value
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toMessageText(message: unknown): string {
  if (typeof message === 'string') {
    return message;
  }
  if (message instanceof Error) {
    return `${message.name}: ${message.message}`;
  }
  try {
    return JSON.stringify(redactValue(message)) ?? '[unserialisable]';
  } catch {
    return '[unserialisable]';
  }
}

/**
 * Structured JSON logger (Step 06).
 *
 * Extends the existing Nest `LoggerService` — no new dependency — and emits
 * one JSON object per line: `{ ts, level, msg, requestId?, context?, ... }`.
 * Every structured field passes through secret redaction first, so
 * `ppk_…` keys, bearer tokens, credential-bearing URLs, and sensitive
 * header/config values can never reach the log stream. Request bodies are
 * never logged. The active `requestId` (see `RequestIdMiddleware`) is
 * attached automatically when present.
 */
@Injectable()
export class JsonLoggerService implements LoggerService {
  private level: LoggerLevel;

  constructor(@Optional() @Inject('APP_CONFIG') config?: AppConfigLike) {
    this.level = normalizeLevel(config?.logLevel) ?? 'info';
  }

  /** Direct structured write used by middleware, filters, and bootstrap. */
  write(
    level: LoggerLevel,
    message: string,
    fields: Record<string, unknown> = {},
  ): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.level]) {
      return;
    }
    const redacted = redactValue(fields);
    const rest: Record<string, unknown> = isRecord(redacted) ? redacted : {};
    const alsRequestId = getRequestId();
    const explicitRequestId =
      typeof rest.requestId === 'string' ? rest.requestId : undefined;
    delete rest.requestId;
    const requestId = alsRequestId ?? explicitRequestId;
    const record: Record<string, unknown> = {
      ts: new Date().toISOString(),
      level,
      msg: scrubSecretStrings(message),
      ...(requestId === undefined ? {} : { requestId }),
      ...rest,
    };
    process.stdout.write(`${JSON.stringify(record)}\n`);
  }

  log(message: unknown, ...optionalParams: unknown[]): void {
    const { context, fields } = splitNestArgs(optionalParams);
    this.write('info', toMessageText(message), { ...fields, ...context });
  }

  debug(message: unknown, ...optionalParams: unknown[]): void {
    const { context, fields } = splitNestArgs(optionalParams);
    this.write('debug', toMessageText(message), { ...fields, ...context });
  }

  verbose(message: unknown, ...optionalParams: unknown[]): void {
    const { context, fields } = splitNestArgs(optionalParams);
    this.write('debug', toMessageText(message), { ...fields, ...context });
  }

  warn(message: unknown, ...optionalParams: unknown[]): void {
    const { context, fields } = splitNestArgs(optionalParams);
    this.write('warn', toMessageText(message), { ...fields, ...context });
  }

  error(message: unknown, ...optionalParams: unknown[]): void {
    const { context, stack, fields } = splitErrorArgs(optionalParams);
    this.write('error', toMessageText(message), {
      ...fields,
      ...stack,
      ...context,
    });
  }

  fatal(message: unknown, ...optionalParams: unknown[]): void {
    const { context, stack, fields } = splitErrorArgs(optionalParams);
    this.write('error', toMessageText(message), {
      ...fields,
      ...stack,
      ...context,
    });
  }

  setLogLevels(levels: NestLogLevel[]): void {
    const mapped = levels
      .map((level) =>
        level === 'verbose'
          ? 'debug'
          : level === 'log' || level === 'fatal'
            ? 'info'
            : normalizeLevel(level),
      )
      .filter((level): level is LoggerLevel => level !== undefined);
    if (mapped.length > 0) {
      const first = mapped[0];
      this.level =
        mapped.length > 1 && first !== undefined
          ? mapped.reduce((a, b) => (LEVEL_ORDER[a] <= LEVEL_ORDER[b] ? a : b))
          : (first ?? 'info');
    }
  }
}

function splitNestArgs(args: unknown[]): {
  context: Record<string, unknown>;
  fields: Record<string, unknown>;
} {
  const [context, ...rest] = args;
  const [only] = rest;
  const fields =
    rest.length === 1 && isRecord(only)
      ? { ...only }
      : rest.length > 0
        ? { params: rest }
        : {};
  return {
    context:
      typeof context === 'string'
        ? { context }
        : isRecord(context)
          ? { context: context.context }
          : {},
    fields,
  };
}

function splitErrorArgs(args: unknown[]): {
  context: Record<string, unknown>;
  stack: Record<string, unknown>;
  fields: Record<string, unknown>;
} {
  // Nest convention: error(message, stack?, context?).
  const [second, third, ...rest] = args;
  const stack =
    typeof second === 'string' && second.includes('\n')
      ? { stack: second }
      : {};
  const context =
    typeof third === 'string'
      ? { context: third }
      : typeof second === 'string' && !('stack' in stack)
        ? { context: second }
        : {};
  const [only] = rest;
  const fields =
    rest.length === 1 && isRecord(only)
      ? { ...only }
      : rest.length > 0
        ? { params: rest }
        : isRecord(second) && 'stack' in stack === false
          ? { ...second }
          : {};
  return { context, stack, fields };
}
