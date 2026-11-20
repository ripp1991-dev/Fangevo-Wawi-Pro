import { Body, Controller, Get, Inject, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  RequirePermission,
  RequiresCompany,
  RequiresModule,
  Tenant,
  type TenantContext,
} from '../../../core/http/context';
import { ApiZodBody, uuidParam, zodPipe } from '../../../core/http/zod';
import { ShopifyService } from './shopify.service';

/** Parameter, mit denen Shopify die App-Seite aufruft (shop, timestamp, host, hmac …). */
const connectSchema = z.object({
  params: z
    .record(z.string().max(40), z.string().max(2000))
    .refine((p) => Object.keys(p).length <= 20, 'Zu viele Parameter'),
  name: z.string().trim().max(80).optional().nullable(),
  warehouseId: z.uuid().optional().nullable(),
});

const syncSchema = z.object({ relink: z.boolean().default(false) });

@ApiTags('Verkaufskanäle')
@Controller('channels')
@RequiresModule('multichannel')
@RequiresCompany()
export class ShopifyController {
  constructor(@Inject(ShopifyService) private readonly shopify: ShopifyService) {}

  @Get('shopify/info')
  @RequirePermission('channels.read')
  info() {
    return this.shopify.info();
  }

  /** Shop verbinden: nur mit einem von Shopify signierten Aufruf der App-Seite. */
  @Post('shopify/connect')
  @RequirePermission('channels.manage')
  @ApiZodBody(connectSchema)
  connect(
    @Tenant() t: TenantContext,
    @Body(zodPipe(connectSchema)) b: z.infer<typeof connectSchema>,
  ) {
    return this.shopify.connect(t, b);
  }

  @Post(':id/shopify/check')
  @RequirePermission('channels.manage')
  check(@Tenant() t: TenantContext, @Param('id', uuidParam) id: string) {
    return this.shopify.check(t, id);
  }

  @Post(':id/shopify/sync')
  @RequirePermission('channels.manage')
  sync(
    @Tenant() t: TenantContext,
    @Param('id', uuidParam) id: string,
    @Body(zodPipe(syncSchema)) b: z.infer<typeof syncSchema>,
  ) {
    return this.shopify.requestSync(t, id, b);
  }

  @Get(':id/shopify/links')
  @RequirePermission('channels.read')
  links(@Tenant() t: TenantContext, @Param('id', uuidParam) id: string) {
    return this.shopify.links(t, id);
  }
}
