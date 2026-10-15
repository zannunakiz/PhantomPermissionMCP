import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard, CurrentTenant, RequireScopes } from '../auth/auth.guard';
import { paginationQuerySchema, ZodValidationPipe } from '../common/http';
import type { PaginationQuery } from '../common/http';
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

  @Get(':id')
  @RequireScopes('simulations:read')
  detail(
    @CurrentTenant() tenant: TenantContext,
    @Param('id') id: string,
  ): unknown {
    return this.service.getSimulation(tenant, id);
  }

  @Get(':id/report')
  @RequireScopes('simulations:read')
  report(
    @CurrentTenant() tenant: TenantContext,
    @Param('id') id: string,
    @Query(new ZodValidationPipe(paginationQuerySchema)) query: PaginationQuery,
  ): unknown {
    return this.service.getReport(tenant, id, query);
  }
}
