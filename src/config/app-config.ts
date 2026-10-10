import { z } from 'zod';

/**
 * Names of settings whose values must never appear in logs or error
 * messages. Used by {@link formatConfigError} and the startup logger.
 */
export const SECRET_KEYS = ['DATABASE_URL', 'API_KEY_PEPPER'] as const;

const TRUE_VALUES = new Set(['true', '1', 'yes']);
const FALSE_VALUES = new Set(['false', '0', 'no']);

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') {
    return fallback;
  }
  const normalised = value.trim().toLowerCase();
  if (TRUE_VALUES.has(normalised)) {
    return true;
  }
  if (FALSE_VALUES.has(normalised)) {
    return false;
  }
  throw new Error(`expected a boolean, received "${value}"`);
}

function parseStringList(value: string | undefined): string[] {
  if (value === undefined || value.trim() === '') {
    return [];
  }
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

const rawEnvSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    DATABASE_URL: z.string().optional(),
    API_KEY_PEPPER: z.string().optional(),
    CORS_ORIGINS: z.string().optional(),
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
    REQUEST_BODY_LIMIT: z.string().default('1mb'),
    RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60000),
    RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),
    METRICS_ENABLED: z.string().optional(),
  })
  .catchall(z.string().optional());

export type AppConfig = {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  databaseUrl: string;
  apiKeyPepper: string;
  /** True when the insecure dev/test fallback pepper is in use. */
  isPepperInsecure: boolean;
  corsOrigins: string[];
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  requestBodyLimit: string;
  rateLimitWindowMs: number;
  rateLimitMax: number;
  metricsEnabled: boolean;
};

const PLACEHOLDER_PATTERNS = [/change-?me/i, /example/i, /placeholder/i];

function isPlaceholderSecret(value: string): boolean {
  return PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(value));
}

export class ConfigValidationError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(
      `Invalid runtime configuration:\n${issues.map((issue) => ` - ${issue}`).join('\n')}`,
    );
    this.name = 'ConfigValidationError';
    this.issues = issues;
  }
}

/**
 * Validate raw environment variables into a typed {@link AppConfig}.
 * Throws {@link ConfigValidationError} listing every problem at once.
 * Secret *values* are never interpolated into messages — only key names.
 */
export function loadAppConfig(
  rawEnv: Record<string, string | undefined> = process.env,
): AppConfig {
  const parsed = rawEnvSchema.safeParse(rawEnv);
  if (!parsed.success) {
    throw new ConfigValidationError(
      parsed.error.issues.map(
        (issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`,
      ),
    );
  }
  const env = parsed.data;
  const issues: string[] = [];
  const isProduction = env.NODE_ENV === 'production';

  let databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) {
    if (isProduction) {
      issues.push('DATABASE_URL is required in production');
    } else {
      databaseUrl =
        'postgresql://phantom:phantom@localhost:5432/phantom_permission_dev';
    }
  }

  let apiKeyPepper = env.API_KEY_PEPPER;
  let isPepperInsecure = false;
  if (!apiKeyPepper) {
    if (isProduction) {
      issues.push('API_KEY_PEPPER is required in production');
    } else {
      apiKeyPepper = 'dev-only-insecure-pepper';
      isPepperInsecure = true;
    }
  } else if (isPlaceholderSecret(apiKeyPepper)) {
    issues.push('API_KEY_PEPPER must not be a placeholder value');
  }

  let metricsEnabled = true;
  try {
    metricsEnabled = parseBoolean(env.METRICS_ENABLED, true);
  } catch {
    issues.push('METRICS_ENABLED must be a boolean ("true"/"false")');
  }

  if (issues.length > 0) {
    throw new ConfigValidationError(issues);
  }

  return {
    nodeEnv: env.NODE_ENV,
    port: env.PORT,
    databaseUrl: databaseUrl as string,
    apiKeyPepper: apiKeyPepper as string,
    isPepperInsecure,
    corsOrigins: parseStringList(env.CORS_ORIGINS),
    logLevel: env.LOG_LEVEL,
    requestBodyLimit: env.REQUEST_BODY_LIMIT,
    rateLimitWindowMs: env.RATE_LIMIT_WINDOW_MS,
    rateLimitMax: env.RATE_LIMIT_MAX,
    metricsEnabled,
  };
}

/** Keys whose values must be masked before logging or reporting. */
const SECRET_KEY_SET = new Set<string>(SECRET_KEYS);

/**
 * Render a config object for logs: every secret value replaced with
 * `[redacted]`, everything else untouched.
 */
export function redactConfigForLogging(
  config: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(config).map(([key, value]) =>
      SECRET_KEY_SET.has(key) ? [key, '[redacted]'] : [key, value],
    ),
  );
}

/**
 * Format a {@link ConfigValidationError} for startup output, guaranteeing
 * no secret value is printed even if a future issue message is careless.
 */
export function formatConfigError(error: ConfigValidationError): string {
  let message = error.message;
  for (const key of SECRET_KEY_SET) {
    const value = process.env[key];
    if (value) {
      message = message.split(value).join('[redacted]');
    }
  }
  return message;
}
