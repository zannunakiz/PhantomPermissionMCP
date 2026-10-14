import { Global, Module } from '@nestjs/common';
import { JsonLoggerService } from './json-logger.service';
import { RequestIdMiddleware } from './request-id.middleware';

/**
 * Step 06 observability providers. Global so the error filter
 * (`ErrorsModule`), middleware registration (`AppModule`), bootstrap
 * (`main.ts`), and tests can share one `JsonLoggerService` without
 * module cycles. `LoggingModule` itself imports nothing.
 * The `'JsonLoggerService'` string alias lets `HttpExceptionFilter`
 * inject the logger without importing the logging module.
 */
@Global()
@Module({
  providers: [
    JsonLoggerService,
    { provide: 'JsonLoggerService', useExisting: JsonLoggerService },
    RequestIdMiddleware,
  ],
  exports: [JsonLoggerService, 'JsonLoggerService', RequestIdMiddleware],
})
export class LoggingModule {}
