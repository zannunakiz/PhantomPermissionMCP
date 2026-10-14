import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ErrorsModule } from './common/errors';
import { AppConfigModule } from './config';

@Module({
  imports: [AppConfigModule, ErrorsModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
