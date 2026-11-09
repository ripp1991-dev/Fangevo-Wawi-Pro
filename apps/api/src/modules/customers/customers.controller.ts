import { Body, Controller, Get, Inject, Param, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { customerInputSchema, listQuerySchema } from '@fangevo/shared';
import { RequirePermission, RequiresCompany, RequiresModule, Tenant, type TenantContext } from '../../core/http/context';
import { ApiZodBody, uuidParam, zodPipe } from '../../core/http/zod';
import { CustomersService } from './customers.service';

const updateSchema = customerInputSchema.and(z.object({ version: z.number().int().min(1) }));

@ApiTags('Kunden')
@Controller('customers')
@RequiresModule('customers')
@RequiresCompany()
export class CustomersController {
  constructor(@Inject(CustomersService) private readonly customers: CustomersService) {}

  @Get()
  @RequirePermission('customers.read')
  list(@Tenant() t: TenantContext, @Query(zodPipe(listQuerySchema)) q: z.infer<typeof listQuerySchema>) {
    return this.customers.list(t, q);
  }

  @Get(':id')
  @RequirePermission('customers.read')
  get(@Tenant() t: TenantContext, @Param('id', uuidParam) id: string) {
    return this.customers.get(t, id);
  }

  @Post()
  @RequirePermission('customers.manage')
  @ApiZodBody(customerInputSchema)
  create(@Tenant() t: TenantContext, @Body(zodPipe(customerInputSchema)) b: z.infer<typeof customerInputSchema>) {
    return this.customers.create(t, b);
  }

  @Put(':id')
  @RequirePermission('customers.manage')
  update(@Tenant() t: TenantContext, @Param('id', uuidParam) id: string, @Body(zodPipe(updateSchema)) b: z.infer<typeof updateSchema>) {
    const { version, ...input } = b;
    return this.customers.update(t, id, input, version);
  }

  @Post(':id/archive')
  @RequirePermission('customers.manage')
  archive(@Tenant() t: TenantContext, @Param('id', uuidParam) id: string) {
    return this.customers.setArchived(t, id, true);
  }

  @Post(':id/restore')
  @RequirePermission('customers.manage')
  restore(@Tenant() t: TenantContext, @Param('id', uuidParam) id: string) {
    return this.customers.setArchived(t, id, false);
  }
}
