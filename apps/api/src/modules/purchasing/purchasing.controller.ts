import { Body, Controller, Get, Inject, Param, Post, Put, Query, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { type FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  goodsReceiptSchema,
  listQuerySchema,
  purchaseOrderInputSchema,
  sendDocumentSchema,
} from '@fangevo/shared';
import {
  RequirePermission,
  RequiresCompany,
  RequiresModule,
  Tenant,
  type TenantContext,
} from '../../core/http/context';
import { ApiZodBody, uuidParam, zodPipe } from '../../core/http/zod';
import { PurchasingService } from './purchasing.service';

const updateSchema = purchaseOrderInputSchema.and(z.object({ version: z.number().int().min(1) }));

@ApiTags('Einkauf')
@Controller('purchase-orders')
@RequiresModule('purchasing')
@RequiresCompany()
export class PurchasingController {
  constructor(@Inject(PurchasingService) private readonly purchasing: PurchasingService) {}

  @Get()
  @RequirePermission('purchasing.read')
  list(
    @Tenant() t: TenantContext,
    @Query(zodPipe(listQuerySchema)) q: z.infer<typeof listQuerySchema>,
  ) {
    return this.purchasing.list(t, q);
  }

  @Get('suggestions')
  @RequirePermission('purchasing.read')
  suggestions(@Tenant() t: TenantContext) {
    return this.purchasing.suggestions(t);
  }

  @Get(':id')
  @RequirePermission('purchasing.read')
  get(@Tenant() t: TenantContext, @Param('id', uuidParam) id: string) {
    return this.purchasing.get(t, id);
  }

  @Get(':id/pdf')
  @RequirePermission('purchasing.read')
  async pdf(
    @Tenant() t: TenantContext,
    @Param('id', uuidParam) id: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const { filename, content } = await this.purchasing.pdf(t, id);
    reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `inline; filename="${filename.replace(/[^\w.-]/g, '_')}"`)
      .header('Cache-Control', 'private, no-store');
    return content;
  }

  @Post()
  @RequirePermission('purchasing.manage')
  @ApiZodBody(purchaseOrderInputSchema)
  create(
    @Tenant() t: TenantContext,
    @Body(zodPipe(purchaseOrderInputSchema)) b: z.infer<typeof purchaseOrderInputSchema>,
  ) {
    return this.purchasing.create(t, b);
  }

  @Put(':id')
  @RequirePermission('purchasing.manage')
  update(
    @Tenant() t: TenantContext,
    @Param('id', uuidParam) id: string,
    @Body(zodPipe(updateSchema)) b: z.infer<typeof updateSchema>,
  ) {
    const { version, ...input } = b;
    return this.purchasing.update(t, id, input, version);
  }

  @Post(':id/order')
  @RequirePermission('purchasing.manage')
  order(@Tenant() t: TenantContext, @Param('id', uuidParam) id: string) {
    return this.purchasing.markOrdered(t, id);
  }

  @Post(':id/cancel')
  @RequirePermission('purchasing.manage')
  cancel(@Tenant() t: TenantContext, @Param('id', uuidParam) id: string) {
    return this.purchasing.cancel(t, id);
  }

  @Post(':id/send')
  @RequirePermission('purchasing.manage')
  @ApiZodBody(sendDocumentSchema)
  send(
    @Tenant() t: TenantContext,
    @Param('id', uuidParam) id: string,
    @Body(zodPipe(sendDocumentSchema)) b: z.infer<typeof sendDocumentSchema>,
  ) {
    return this.purchasing.send(t, id, b);
  }

  @Post(':id/receipts')
  @RequirePermission('purchasing.manage')
  @ApiZodBody(goodsReceiptSchema)
  receive(
    @Tenant() t: TenantContext,
    @Param('id', uuidParam) id: string,
    @Body(zodPipe(goodsReceiptSchema)) b: z.infer<typeof goodsReceiptSchema>,
  ) {
    return this.purchasing.receive(t, id, b);
  }
}
