import { Body, Controller, Get, Inject, Param, Post, Put, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { type FastifyReply } from 'fastify';
import { type z } from 'zod';
import { billingDetailsSchema, planChangeSchema } from '@fangevo/shared';
import {
  AllowReadOnly,
  RequirePermission,
  Tenant,
  type TenantContext,
} from '../../core/http/context';
import { ApiZodBody, uuidParam, zodPipe } from '../../core/http/zod';
import { BillingService } from './billing.service';

/**
 * Kundenportal „Abo & Rechnungen“. Auch im Lesemodus erreichbar (abgelaufene Testphase,
 * Sperre), damit Kunden ihr Abo aktivieren, Rechnungen laden und Daten pflegen können.
 */
@ApiTags('Abo & Rechnungen')
@Controller('billing')
@AllowReadOnly()
export class BillingController {
  constructor(@Inject(BillingService) private readonly billing: BillingService) {}

  @Get()
  @RequirePermission('billing.manage')
  overview(@Tenant() t: TenantContext) {
    return this.billing.overview(t);
  }

  @Put('details')
  @RequirePermission('billing.manage')
  @ApiZodBody(billingDetailsSchema)
  details(
    @Tenant() t: TenantContext,
    @Body(zodPipe(billingDetailsSchema)) b: z.infer<typeof billingDetailsSchema>,
  ) {
    return this.billing.updateDetails(t, b);
  }

  @Post('activate')
  @RequirePermission('billing.manage')
  @ApiZodBody(planChangeSchema)
  activate(
    @Tenant() t: TenantContext,
    @Body(zodPipe(planChangeSchema)) b: z.infer<typeof planChangeSchema>,
  ) {
    return this.billing.activate(t, b);
  }

  @Post('plan')
  @RequirePermission('billing.manage')
  @ApiZodBody(planChangeSchema)
  plan(
    @Tenant() t: TenantContext,
    @Body(zodPipe(planChangeSchema)) b: z.infer<typeof planChangeSchema>,
  ) {
    return this.billing.changePlan(t, b);
  }

  @Post('cancel')
  @RequirePermission('billing.manage')
  cancel(@Tenant() t: TenantContext) {
    return this.billing.cancel(t);
  }

  @Post('reactivate')
  @RequirePermission('billing.manage')
  reactivate(@Tenant() t: TenantContext) {
    return this.billing.reactivate(t);
  }

  @Get('invoices/:id/pdf')
  @RequirePermission('billing.manage')
  async pdf(
    @Tenant() t: TenantContext,
    @Param('id', uuidParam) id: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const r = await this.billing.invoicePdf(t, id);
    reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `inline; filename="${r.filename.replace(/[^\w.-]/g, '_')}"`);
    return r.pdf;
  }
}

@ApiTags('Marketplace')
@Controller('marketplace')
export class MarketplaceController {
  constructor(@Inject(BillingService) private readonly billing: BillingService) {}

  @Get()
  @RequirePermission('license.read')
  list(@Tenant() t: TenantContext) {
    return this.billing.marketplace(t);
  }

  @Post(':module/book')
  @RequirePermission('billing.manage')
  book(@Tenant() t: TenantContext, @Param('module') module: string) {
    return this.billing.bookAddon(t, module);
  }

  @Post(':module/cancel')
  @RequirePermission('billing.manage')
  cancel(@Tenant() t: TenantContext, @Param('module') module: string) {
    return this.billing.cancelAddon(t, module);
  }
}
