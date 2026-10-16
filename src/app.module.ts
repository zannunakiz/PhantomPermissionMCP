import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ErrorsModule } from './common/errors';
import { LoggingModule, RequestIdMiddleware } from './common/logging';
import { AppConfigModule } from './config';
import { AuthModule } from './auth/auth.module';
import { HealthModule } from './health';
import { McpModule } from './mcp/mcp.module';
import { ModelsModule } from './models/models.module';
import { SimulationsModule } from './simulations/simulations.module';
import { AuditModule } from './audit/audit.module';
import { PrismaModule } from './persistence';
import { RepositoriesModule } from './repositories';

@Module({
  imports: [
    AppConfigModule,
    LoggingModule,
    ErrorsModule,
    PrismaModule,
    RepositoriesModule,
    AuthModule,
    HealthModule,
    ModelsModule,
    SimulationsModule,
    AuditModule,
    McpModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Every route (current and future) gets request-id + access logging.
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
