import { Body, Controller, Get, Inject, Param, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { companyInputSchema } from '@fangevo/shared';
import { RequirePermission, RequiresModule, Tenant, type TenantContext } from '../http/context';
import { ApiZodBody, uuidParam, zodPipe } from '../http/zod';
import { CompaniesService } from './companies.service';

const updateSchema = companyInputSchema.extend({ version: z.number().int().min(1) });

@ApiTags('Administration: Firmen')
@Controller('admin/companies')
@RequiresModule('core')
export class CompaniesController {
  constructor(@Inject(CompaniesService) private readonly companies: CompaniesService) {}

  @Get()
  @RequirePermission('companies.read')
  list(@Tenant() t: TenantContext, @Query('archived') archived?: string) {
    return this.companies.list(t, archived === 'true');
  }

  @Get(':id')
  @RequirePermission('companies.read')
  get(@Tenant() t: TenantContext, @Param('id', uuidParam) id: string) {
    return this.companies.get(t, id);
  }

  @Post()
  @RequirePermission('companies.manage')
  @ApiZodBody(companyInputSchema)
  create(@Tenant() t: TenantContext, @Body(zodPipe(companyInputSchema)) body: z.infer<typeof companyInputSchema>) {
    return this.companies.create(t, body);
  }

  @Put(':id')
  @RequirePermission('companies.manage')
  @ApiZodBody(updateSchema)
  update(@Tenant() t: TenantContext, @Param('id', uuidParam) id: string, @Body(zodPipe(updateSchema)) body: z.infer<typeof updateSchema>) {
    const { version, ...input } = body;
    return this.companies.update(t, id, input, version);
  }

  @Post(':id/archive')
  @RequirePermission('companies.manage')
  archive(@Tenant() t: TenantContext, @Param('id', uuidParam) id: string) {
    return this.companies.setArchived(t, id, true);
  }

  @Post(':id/restore')
  @RequirePermission('companies.manage')
  restore(@Tenant() t: TenantContext, @Param('id', uuidParam) id: string) {
    return this.companies.setArchived(t, id, false);
  }
}
