import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { loadAppConfig } from './app-config';

/**
 * Configuration boundary of the application. All environment access must
 * go through this module — application code injects the validated
 * `APP_CONFIG` token instead of reading `process.env` directly.
 * Validation runs at startup via `validate`; misconfiguration fails fast.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: () => loadAppConfig(),
    }),
  ],
  providers: [
    {
      provide: 'APP_CONFIG',
      useFactory: () => loadAppConfig(),
    },
  ],
  exports: ['APP_CONFIG'],
})
export class AppConfigModule {}
