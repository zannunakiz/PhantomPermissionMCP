import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SimulationsModule } from '../simulations/simulations.module';
import { McpService } from './mcp.service';

@Module({
  imports: [AuthModule, SimulationsModule],
  providers: [McpService],
  exports: [McpService],
})
export class McpModule {}
