import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard, CurrentTenant, RequireScopes } from '../auth/auth.guard';
import { ZodValidationPipe } from '../common/http';
import type { TenantContext } from '../tenancy/tenant-context';
import {
  createSimulationBodySchema,
  type CreateSimulationBody,
} from './simulations.dto';
import { SimulationsService } from './simulations.service';

@Controller('api/v1/simulations')
@UseGuards(AuthGuard)
export class SimulationsController {
  constructor(private readonly service: SimulationsService) {}

  @Post()
  @RequireScopes('simulations:run')
  @HttpCode(201)
  create(
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(createSimulationBodySchema))
    body: CreateSimulationBody,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): unknown {
    return this.service.createSimulation(tenant, body, idempotencyKey);
  }
}
