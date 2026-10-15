import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { AuthGuard, CurrentTenant, RequireScopes } from '../auth/auth.guard';
import { ZodValidationPipe } from '../common/http/zod-validation.pipe';
import type { TenantContext } from '../tenancy/tenant-context';
import { createModelBodySchema, type CreateModelBody } from './models.dto';
import { ModelsService, type CreatedModel } from './models.service';

@Controller('api/v1/models')
@UseGuards(AuthGuard)
export class ModelsController {
  constructor(private readonly service: ModelsService) {}

  @Post()
  @RequireScopes('models:write')
  @HttpCode(201)
  create(
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(createModelBodySchema)) body: CreateModelBody,
  ): Promise<CreatedModel> {
    return this.service.createModel(tenant, body);
  }
}
