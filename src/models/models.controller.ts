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
import type { TenantContext } from '../tenancy/tenant-context';
import { createModelBodySchema, type CreateModelBody } from './models.dto';
import { createVersionBodySchema, type CreateVersionBody } from './models.dto';
import { ModelsService, type CreatedModel } from './models.service';
import { z } from 'zod';

const listQuerySchema = paginationQuerySchema
  .extend({ orderBy: z.enum(['name', 'createdAt']).default('createdAt') })
  .strict();

const detailQuerySchema = z
  .object({ version: z.coerce.number().int().min(1).optional() })
  .strict();

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

  @Get()
  @RequireScopes('models:read')
  list(
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(listQuerySchema))
    query: z.infer<typeof listQuerySchema>,
  ): unknown {
    return this.service.listModels(tenant, query);
  }

  @Get(':id')
  @RequireScopes('models:read')
  detail(
    @CurrentTenant() tenant: TenantContext,
    @Param('id') id: string,
    @Query(new ZodValidationPipe(detailQuerySchema))
    query: z.infer<typeof detailQuerySchema>,
  ): unknown {
    return this.service.getModel(tenant, id, query.version);
  }

  @Post(':id/versions')
  @RequireScopes('models:write')
  @HttpCode(201)
  createVersion(
    @CurrentTenant() tenant: TenantContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(createVersionBodySchema))
    body: CreateVersionBody,
    @Headers('if-match') ifMatch?: string,
  ): unknown {
    return this.service.createVersion(tenant, id, body, ifMatch);
  }
}
