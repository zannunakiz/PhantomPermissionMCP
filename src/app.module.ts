import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ErrorsModule } from './common/errors';
import { LoggingModule, RequestIdMiddleware } from './common/logging';
import { AppConfigModule } from './config';
import { AuthModule } from './auth/auth.module';
import { HealthModule } from './health';
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
