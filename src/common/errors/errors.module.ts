import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { HttpExceptionFilter } from './http-exception.filter';

/**
 * Registers the global REST error filter.
 * Imported once by `AppModule` so unit, e2e, and runtime apps
 * share the same stable error envelope.
 */
@Module({
  providers: [{ provide: APP_FILTER, useClass: HttpExceptionFilter }],
})
export class ErrorsModule {}
