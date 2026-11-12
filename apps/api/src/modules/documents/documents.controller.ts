import { Body, Controller, Delete, Get, Inject, Param, Post, Query, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { type FastifyReply } from 'fastify';
import { type z } from 'zod';
import {
  creditNoteSchema,
  documentFromOrderSchema,
  listQuerySchema,
  orderCancelSchema,
  paymentInputSchema,
  sendDocumentSchema,
} from '@fangevo/shared';
import {
  AllowPackingScope,
  RequirePermission,
  RequiresCompany,
  RequiresModule,
  Tenant,
  type TenantContext,
} from '../../core/http/context';
import { ApiZodBody, uuidParam, zodPipe } from '../../core/http/zod';
import { DocumentsService } from './documents.service';

@ApiTags('Belege')
@Controller('documents')
@RequiresModule('documents')
@RequiresCompany()
export class DocumentsController {
  constructor(@Inject(DocumentsService) private readonly docs: DocumentsService) {}

  @Get()
  @RequirePermission('documents.read')
  list(
    @Tenant() t: TenantContext,
    @Query(zodPipe(listQuerySchema)) q: z.infer<typeof listQuerySchema>,
  ) {
    return this.docs.list(t, q);
  }

  @Get('stats')
  @RequirePermission('documents.read')
  stats(@Tenant() t: TenantContext) {
    return this.docs.stats(t);
  }

  @Get(':id')
  @RequirePermission('documents.read')
  get(@Tenant() t: TenantContext, @Param('id', uuidParam) id: string) {
    return this.docs.get(t, id);
  }

  @Get(':id/pdf')
  @AllowPackingScope()
  @RequirePermission('documents.read')
  async pdf(
    @Tenant() t: TenantContext,
    @Param('id', uuidParam) id: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const { filename, content } = await this.docs.pdf(t, id);
    reply
      .header('Content-Type', 'application/pdf')
      .header(
        'Content-Disposition',
        `inline; filename="${filename.replace(/[^\w.-]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      )
      .header('Cache-Control', 'private, no-store');
    return content;
  }

  @Post('from-order/:orderId')
  @RequirePermission('documents.manage')
  @ApiZodBody(documentFromOrderSchema)
  fromOrder(
    @Tenant() t: TenantContext,
    @Param('orderId', uuidParam) orderId: string,
    @Body(zodPipe(documentFromOrderSchema)) b: z.infer<typeof documentFromOrderSchema>,
  ) {
    return this.docs.fromOrder(t, orderId, b);
  }

  @Post(':id/finalize')
  @RequirePermission('documents.manage')
  finalize(@Tenant() t: TenantContext, @Param('id', uuidParam) id: string) {
    return this.docs.finalize(t, id);
  }

  @Delete(':id')
  @RequirePermission('documents.manage')
  remove(@Tenant() t: TenantContext, @Param('id', uuidParam) id: string) {
    return this.docs.remove(t, id);
  }

  @Post(':id/send')
  @RequirePermission('documents.manage')
  @ApiZodBody(sendDocumentSchema)
  send(
    @Tenant() t: TenantContext,
    @Param('id', uuidParam) id: string,
    @Body(zodPipe(sendDocumentSchema)) b: z.infer<typeof sendDocumentSchema>,
  ) {
    return this.docs.send(t, id, b);
  }

  @Post(':id/payments')
  @RequirePermission('documents.manage')
  @ApiZodBody(paymentInputSchema)
  addPayment(
    @Tenant() t: TenantContext,
    @Param('id', uuidParam) id: string,
    @Body(zodPipe(paymentInputSchema)) b: z.infer<typeof paymentInputSchema>,
  ) {
    return this.docs.addPayment(t, id, b);
  }

  @Post(':id/credit-note')
  @RequirePermission('documents.manage')
  @ApiZodBody(creditNoteSchema)
  creditNote(
    @Tenant() t: TenantContext,
    @Param('id', uuidParam) id: string,
    @Body(zodPipe(creditNoteSchema)) b: z.infer<typeof creditNoteSchema>,
  ) {
    return this.docs.creditNote(t, id, b);
  }

  @Post(':id/cancel')
  @RequirePermission('documents.manage')
  @ApiZodBody(orderCancelSchema)
  cancel(
    @Tenant() t: TenantContext,
    @Param('id', uuidParam) id: string,
    @Body(zodPipe(orderCancelSchema)) b: z.infer<typeof orderCancelSchema>,
  ) {
    return this.docs.cancelInvoice(t, id, b.reason);
  }
}
