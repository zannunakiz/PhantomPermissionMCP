import { Global, Module } from '@nestjs/common';
import { TracingMiddleware } from './tracing.middleware';
import { TracingService } from './tracing.service';

/** Step 51 wiring: global service so HTTP/DB/simulation code can hook in. */
@Global()
@Module({
  providers: [TracingService, TracingMiddleware],
  exports: [TracingService, TracingMiddleware],
})
export class TracingModule {}
