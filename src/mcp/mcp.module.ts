import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ModelsModule } from '../models/models.module';
import { SimulationsModule } from '../simulations/simulations.module';
import { McpService } from './mcp.service';

@Module({
  imports: [AuthModule, ModelsModule, SimulationsModule],
  providers: [McpService],
  exports: [McpService],
})
export class McpModule {}
