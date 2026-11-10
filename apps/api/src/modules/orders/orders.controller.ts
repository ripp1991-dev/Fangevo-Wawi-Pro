import { Body, Controller, Get, Inject, Param, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  listQuerySchema,
  orderCancelSchema,
  orderInputSchema,
  orderTransitionSchema,
} from '@fangevo/shared';
import {
  RequirePermission,
  RequiresCompany,
  RequiresModule,
  Tenant,
  type TenantContext,
} from '../../core/http/context';
import { ApiZodBody, uuidParam, zodPipe } from '../../core/http/zod';
import { OrdersService } from './orders.service';

const updateSchema = orderInputSchema.and(z.object({ version: z.number().int().min(1) }));
const shipSchema = z.object({ note: z.string().trim().max(500).nullable().optional() });

@ApiTags('Aufträge')
@Controller('orders')
@RequiresModule('orders')
@RequiresCompany()
export class OrdersController {
  constructor(@Inject(OrdersService) private readonly orders: OrdersService) {}

  @Get()
  @RequirePermission('orders.read')
  list(
    @Tenant() t: TenantContext,
    @Query(zodPipe(listQuerySchema)) q: z.infer<typeof listQuerySchema>,
  ) {
    return this.orders.list(t, q);
  }

  @Get('stats')
  @RequirePermission('orders.read')
  stats(@Tenant() t: TenantContext) {
    return this.orders.stats(t);
  }

  @Get('tree')
  @RequirePermission('orders.read')
  tree(@Tenant() t: TenantContext) {
    return this.orders.tree(t);
  }

  @Get(':id')
  @RequirePermission('orders.read')
  get(@Tenant() t: TenantContext, @Param('id', uuidParam) id: string) {
    return this.orders.get(t, id);
  }

  @Post()
  @RequirePermission('orders.manage')
  @ApiZodBody(orderInputSchema)
  create(
    @Tenant() t: TenantContext,
    @Body(zodPipe(orderInputSchema)) b: z.infer<typeof orderInputSchema>,
  ) {
    return this.orders.create(t, b);
  }

  @Put(':id')
  @RequirePermission('orders.manage')
  update(
    @Tenant() t: TenantContext,
    @Param('id', uuidParam) id: string,
    @Body(zodPipe(updateSchema)) b: z.infer<typeof updateSchema>,
  ) {
    const { version, ...input } = b;
    return this.orders.update(t, id, input, version);
  }

  @Post(':id/status')
  @RequirePermission('orders.manage')
  @ApiZodBody(orderTransitionSchema)
  transition(
    @Tenant() t: TenantContext,
    @Param('id', uuidParam) id: string,
    @Body(zodPipe(orderTransitionSchema)) b: z.infer<typeof orderTransitionSchema>,
  ) {
    return this.orders.transition(t, id, b.to, b.note);
  }

  @Post(':id/ship')
  @RequirePermission('orders.manage')
  ship(
    @Tenant() t: TenantContext,
    @Param('id', uuidParam) id: string,
    @Body(zodPipe(shipSchema)) b: z.infer<typeof shipSchema>,
  ) {
    return this.orders.ship(t, id, b.note ?? null);
  }

  @Post(':id/cancel')
  @RequirePermission('orders.manage')
  @ApiZodBody(orderCancelSchema)
  cancel(
    @Tenant() t: TenantContext,
    @Param('id', uuidParam) id: string,
    @Body(zodPipe(orderCancelSchema)) b: z.infer<typeof orderCancelSchema>,
  ) {
    return this.orders.cancel(t, id, b.reason);
  }
}
