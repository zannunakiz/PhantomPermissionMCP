import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { setupHttpHandling } from './common/http';
import { JsonLoggerService } from './common/logging';

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
  const bootstrapLogger = new JsonLoggerService({
    logLevel: config.logLevel,
    nodeEnv: config.nodeEnv,
  });
  if (config.isPepperInsecure) {
    bootstrapLogger.warn(
      'Using the insecure development API-key pepper. ' +
        'Set API_KEY_PEPPER for any shared environment.',
      { context: 'bootstrap' },
    );
  }
  // Startup log carries redacted values only.
  bootstrapLogger.write('info', 'starting', {
    context: 'bootstrap',
    nodeEnv: config.nodeEnv,
    config: redactConfigForLogging({
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
  });
  const app = await NestFactory.create(AppModule, {
    logger: bootstrapLogger,
    bodyParser: false,
  });
  // Content-type guard + size-limited parsers + v1 error mapping
  // for malformed/oversized payloads. Applied before listen so every
  // route (current and future) is protected.
  setupHttpHandling(app, { requestBodyLimit: config.requestBodyLimit });
  await app.listen(config.port);
}
void bootstrap();
