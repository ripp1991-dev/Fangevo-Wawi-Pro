import { Body, Controller, Get, Inject, Param, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  CHANNEL_TYPES,
  PLANNED_CHANNELS,
  channelInputSchema,
  channelListingSchema,
  channelOrderSchema,
  listQuerySchema,
} from '@fangevo/shared';
import {
  RequirePermission,
  RequiresCompany,
  RequiresModule,
  Tenant,
  type TenantContext,
} from '../../core/http/context';
import { ApiZodBody, uuidParam, zodPipe } from '../../core/http/zod';
import { ChannelsService } from './channels.service';

const stockQuery = z.object({
  cursor: z.string().max(80).optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(500),
});

@ApiTags('Verkaufskanäle')
@Controller('channels')
@RequiresModule('multichannel')
@RequiresCompany()
export class ChannelsController {
  constructor(@Inject(ChannelsService) private readonly channels: ChannelsService) {}

  @Get('types')
  @RequirePermission('channels.read')
  types() {
    return {
      available: Object.entries(CHANNEL_TYPES).map(([key, label]) => ({ key, label })),
      planned: PLANNED_CHANNELS,
      note: 'Weitere Anbindungen werden erst freigeschaltet, wenn Zugangsdaten vorliegen und Tests im Testsystem des Anbieters bestanden sind.',
    };
  }

  @Get()
  @RequirePermission('channels.read')
  list(
    @Tenant() t: TenantContext,
    @Query(zodPipe(listQuerySchema)) q: z.infer<typeof listQuerySchema>,
  ) {
    return this.channels.list(t, q);
  }

  @Get(':id')
  @RequirePermission('channels.read')
  get(@Tenant() t: TenantContext, @Param('id', uuidParam) id: string) {
    return this.channels.get(t, id);
  }

  @Post()
  @RequirePermission('channels.manage')
  @ApiZodBody(channelInputSchema)
  create(
    @Tenant() t: TenantContext,
    @Body(zodPipe(channelInputSchema)) b: z.infer<typeof channelInputSchema>,
  ) {
    return this.channels.save(t, null, b);
  }

  @Put(':id')
  @RequirePermission('channels.manage')
  update(
    @Tenant() t: TenantContext,
    @Param('id', uuidParam) id: string,
    @Body(zodPipe(channelInputSchema)) b: z.infer<typeof channelInputSchema>,
  ) {
    return this.channels.save(t, id, b);
  }

  @Post(':id/archive')
  @RequirePermission('channels.manage')
  async archive(@Tenant() t: TenantContext, @Param('id', uuidParam) id: string) {
    await this.channels.archive(t, id);
    return { ok: true };
  }

  @Get(':id/listings')
  @RequirePermission('channels.read')
  listings(@Tenant() t: TenantContext, @Param('id', uuidParam) id: string) {
    return this.channels.listings(t, id);
  }

  @Put(':id/listings/:articleId')
  @RequirePermission('channels.manage')
  setListing(
    @Tenant() t: TenantContext,
    @Param('id', uuidParam) id: string,
    @Param('articleId', uuidParam) articleId: string,
    @Body(zodPipe(channelListingSchema)) b: z.infer<typeof channelListingSchema>,
  ) {
    return this.channels.setListing(t, id, articleId, b);
  }

  // ───── Schnittstelle für den Shop (typisch per API-Schlüssel) ─────

  @Post(':id/orders')
  @RequirePermission('channels.read', 'orders.manage')
  @ApiZodBody(channelOrderSchema)
  async receiveOrder(
    @Tenant() t: TenantContext,
    @Param('id', uuidParam) id: string,
    @Body(zodPipe(channelOrderSchema)) b: z.infer<typeof channelOrderSchema>,
  ) {
    try {
      return await this.channels.receiveOrder(t, id, b);
    } catch (e) {
      await this.channels.logError(
        t,
        id,
        `Bestellung ${b.externalId}: ${e instanceof Error ? e.message : String(e)}`,
      );
      throw e;
    }
  }

  @Get(':id/orders/:externalId')
  @RequirePermission('channels.read', 'orders.read')
  orderStatus(
    @Tenant() t: TenantContext,
    @Param('id', uuidParam) id: string,
    @Param('externalId') externalId: string,
  ) {
    return this.channels.orderStatus(t, id, externalId);
  }

  @Get(':id/stock')
  @RequirePermission('channels.read', 'inventory.read')
  stock(
    @Tenant() t: TenantContext,
    @Param('id', uuidParam) id: string,
    @Query(zodPipe(stockQuery)) q: z.infer<typeof stockQuery>,
  ) {
    return this.channels.stock(t, id, q);
  }
}
