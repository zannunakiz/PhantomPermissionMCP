import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import {
  AppConfig,
  ConfigValidationError,
  formatConfigError,
  loadAppConfig,
  redactConfigForLogging,
} from './config';

async function bootstrap() {
  let config: AppConfig;
  try {
    config = loadAppConfig();
  } catch (error: unknown) {
    if (error instanceof ConfigValidationError) {
      // Never print secret values — the formatter masks them.
      console.error(formatConfigError(error));
    } else {
      console.error('Failed to load runtime configuration.');
    }
    process.exit(1);
  }
  if (config.isPepperInsecure) {
    console.warn(
      'WARNING: using the insecure development API-key pepper. ' +
        'Set API_KEY_PEPPER for any shared environment.',
    );
  }
  // Startup log carries redacted values only.
  console.info(
    `Starting in ${config.nodeEnv} mode: ` +
      JSON.stringify(
        redactConfigForLogging({
          NODE_ENV: config.nodeEnv,
          PORT: config.port,
          DATABASE_URL: config.databaseUrl,
          API_KEY_PEPPER: config.apiKeyPepper,
          CORS_ORIGINS: config.corsOrigins,
          LOG_LEVEL: config.logLevel,
          REQUEST_BODY_LIMIT: config.requestBodyLimit,
          RATE_LIMIT_WINDOW_MS: config.rateLimitWindowMs,
          RATE_LIMIT_MAX: config.rateLimitMax,
          METRICS_ENABLED: config.metricsEnabled,
        }),
      ),
  );
  const app = await NestFactory.create(AppModule);
  await app.listen(config.port);
}
void bootstrap();
