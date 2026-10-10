import {
  ConfigValidationError,
  formatConfigError,
  loadAppConfig,
  redactConfigForLogging,
} from './app-config';

describe('loadAppConfig', () => {
  const baseEnv = {
    NODE_ENV: 'test',
    PORT: '3100',
    DATABASE_URL: 'postgresql://u:p@localhost:5432/t',
    API_KEY_PEPPER: 'a-strong-test-pepper-value',
    CORS_ORIGINS: 'http://a.test, http://b.test',
    LOG_LEVEL: 'warn',
    REQUEST_BODY_LIMIT: '256kb',
    RATE_LIMIT_WINDOW_MS: '1000',
    RATE_LIMIT_MAX: '10',
    METRICS_ENABLED: 'false',
  };

  it('accepts a valid local/test configuration', () => {
    expect(loadAppConfig({ ...baseEnv })).toEqual({
      nodeEnv: 'test',
      port: 3100,
      databaseUrl: 'postgresql://u:p@localhost:5432/t',
      apiKeyPepper: 'a-strong-test-pepper-value',
      isPepperInsecure: false,
      corsOrigins: ['http://a.test', 'http://b.test'],
      logLevel: 'warn',
      requestBodyLimit: '256kb',
      rateLimitWindowMs: 1000,
      rateLimitMax: 10,
      metricsEnabled: false,
    });
  });

  it('applies safe non-secret defaults outside production', () => {
    const config = loadAppConfig({ NODE_ENV: 'development' });
    expect(config.port).toBe(3000);
    expect(config.isPepperInsecure).toBe(true);
    expect(config.corsOrigins).toEqual([]);
    expect(config.metricsEnabled).toBe(true);
  });

  it('rejects invalid production configuration with clear errors', () => {
    let error: ConfigValidationError | undefined;
    try {
      loadAppConfig({ NODE_ENV: 'production' });
    } catch (thrown) {
      error = thrown as ConfigValidationError;
    }
    expect(error).toBeInstanceOf(ConfigValidationError);
    expect(error?.issues).toEqual(
      expect.arrayContaining([
        'DATABASE_URL is required in production',
        'API_KEY_PEPPER is required in production',
      ]),
    );
  });

  it('rejects placeholder secrets and invalid values', () => {
    expect(() =>
      loadAppConfig({
        ...baseEnv,
        API_KEY_PEPPER: 'change-me-please',
        PORT: 'not-a-port',
        LOG_LEVEL: 'verbose',
      }),
    ).toThrow(ConfigValidationError);
  });

  it('never exposes secret values in errors or redacted logs', () => {
    const pepper = 'super-secret-pepper-xyz';
    let message = '';
    try {
      loadAppConfig({
        NODE_ENV: 'production',
        API_KEY_PEPPER: pepper,
        PORT: 'not-a-port',
      });
    } catch (error) {
      message = formatConfigError(error as ConfigValidationError);
    }
    expect(message).not.toContain(pepper);

    const logged = redactConfigForLogging({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://u:p@host/db',
      API_KEY_PEPPER: pepper,
      PORT: 3000,
    });
    expect(logged).toEqual({
      NODE_ENV: 'production',
      DATABASE_URL: '[redacted]',
      API_KEY_PEPPER: '[redacted]',
      PORT: 3000,
    });
  });
});
