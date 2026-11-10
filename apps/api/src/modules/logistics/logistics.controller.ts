import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
  Query,
  Res,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { type FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  barcodeInputSchema,
  listQuerySchema,
  packCompleteSchema,
  packingStationInputSchema,
  pickConfirmSchema,
  pickListCreateSchema,
  returnCreateSchema,
  returnReceiveSchema,
} from '@fangevo/shared';
import {
  RequirePermission,
  RequiresCompany,
  RequiresModule,
  Tenant,
  type TenantContext,
} from '../../core/http/context';
import { AppError } from '../../core/http/errors';
import { ApiZodBody, uuidParam, zodPipe } from '../../core/http/zod';
import { PackingService } from './packing.service';
import { PickingService } from './picking.service';
import { ReturnsService } from './returns.service';
import { ScanService } from './scan.service';

type ListQuery = z.infer<typeof listQuerySchema>;
const codeQuery = z.object({ code: z.string().trim().min(1).max(120) });
const trackingSchema = z.object({ trackingNumber: z.string().trim().min(1).max(80) });

@ApiTags('Lager: Scannen')
@Controller('scan')
@RequiresModule('inventory')
@RequiresCompany()
export class ScanController {
  constructor(@Inject(ScanService) private readonly scan: ScanService) {}

  @Get()
  @RequirePermission('inventory.read')
  resolve(@Tenant() t: TenantContext, @Query(zodPipe(codeQuery)) q: z.infer<typeof codeQuery>) {
    return this.scan.resolve(t, q.code);
  }
}

@ApiTags('Artikel: Barcodes')
@Controller('articles/:id/barcodes')
@RequiresModule('articles')
@RequiresCompany()
export class BarcodesController {
  constructor(@Inject(ScanService) private readonly scan: ScanService) {}

  @Get()
  @RequirePermission('articles.read')
  list(@Tenant() t: TenantContext, @Param('id', uuidParam) id: string) {
    return this.scan.barcodes(t, id);
  }

  @Post()
  @RequirePermission('articles.manage')
  @ApiZodBody(barcodeInputSchema)
  add(
    @Tenant() t: TenantContext,
    @Param('id', uuidParam) id: string,
    @Body(zodPipe(barcodeInputSchema)) b: z.infer<typeof barcodeInputSchema>,
  ) {
    return this.scan.addBarcode(t, id, b.code);
  }

  @Delete(':barcodeId')
  @HttpCode(204)
  @RequirePermission('articles.manage')
  async remove(
    @Tenant() t: TenantContext,
    @Param('id', uuidParam) id: string,
    @Param('barcodeId', uuidParam) barcodeId: string,
  ) {
    await this.scan.removeBarcode(t, id, barcodeId);
  }
}

@ApiTags('Lager: Picklisten')
@Controller('pick-lists')
@RequiresModule('inventory')
@RequiresCompany()
export class PickListsController {
  constructor(@Inject(PickingService) private readonly picking: PickingService) {}

  @Get()
  @RequirePermission('picking.execute')
  list(@Tenant() t: TenantContext, @Query(zodPipe(listQuerySchema)) q: ListQuery) {
    return this.picking.list(t, q);
  }

  @Get(':id')
  @RequirePermission('picking.execute')
  get(@Tenant() t: TenantContext, @Param('id', uuidParam) id: string) {
    return this.picking.get(t, id);
  }

  @Post()
  @RequirePermission('picking.execute', 'orders.read')
  @ApiZodBody(pickListCreateSchema)
  create(
    @Tenant() t: TenantContext,
    @Body(zodPipe(pickListCreateSchema)) b: z.infer<typeof pickListCreateSchema>,
  ) {
    return this.picking.create(t, b.orderIds);
  }

  @Post(':id/confirm')
  @RequirePermission('picking.execute')
  @ApiZodBody(pickConfirmSchema)
  confirm(
    @Tenant() t: TenantContext,
    @Param('id', uuidParam) id: string,
    @Body(zodPipe(pickConfirmSchema)) b: z.infer<typeof pickConfirmSchema>,
  ) {
    return this.picking.confirm(t, id, b);
  }

  @Post(':id/complete')
  @RequirePermission('picking.execute')
  complete(@Tenant() t: TenantContext, @Param('id', uuidParam) id: string) {
    return this.picking.complete(t, id);
  }

  @Post(':id/cancel')
  @RequirePermission('picking.execute')
  cancel(@Tenant() t: TenantContext, @Param('id', uuidParam) id: string) {
    return this.picking.cancel(t, id);
  }
}

@ApiTags('Pack: Packtisch')
@Controller('packing')
@RequiresModule('packing')
@RequiresCompany()
export class PackingController {
  constructor(@Inject(PackingService) private readonly packing: PackingService) {}

  @Get('stations')
  @RequirePermission('packing.execute')
  stations(@Tenant() t: TenantContext) {
    return this.packing.stations(t);
  }

  @Post('stations')
  @RequirePermission('shipping.manage')
  @ApiZodBody(packingStationInputSchema)
  createStation(
    @Tenant() t: TenantContext,
    @Body(zodPipe(packingStationInputSchema)) b: z.infer<typeof packingStationInputSchema>,
  ) {
    return this.packing.saveStation(t, null, b);
  }

  @Put('stations/:id')
  @RequirePermission('shipping.manage')
  updateStation(
    @Tenant() t: TenantContext,
    @Param('id', uuidParam) id: string,
    @Body(zodPipe(packingStationInputSchema)) b: z.infer<typeof packingStationInputSchema>,
  ) {
    return this.packing.saveStation(t, id, b);
  }

  @Post('stations/:id/archive')
  @HttpCode(204)
  @RequirePermission('shipping.manage')
  async archiveStation(@Tenant() t: TenantContext, @Param('id', uuidParam) id: string) {
    await this.packing.archiveStation(t, id, true);
  }

  @Get('orders')
  @RequirePermission('packing.execute')
  prepare(@Tenant() t: TenantContext, @Query(zodPipe(codeQuery)) q: z.infer<typeof codeQuery>) {
    return this.packing.prepare(t, q.code);
  }

  @Post('orders/:id/complete')
  @RequirePermission('packing.execute')
  @ApiZodBody(packCompleteSchema)
  complete(
    @Tenant() t: TenantContext,
    @Param('id', uuidParam) id: string,
    @Body(zodPipe(packCompleteSchema)) b: z.infer<typeof packCompleteSchema>,
  ) {
    return this.packing.complete(t, id, b);
  }

  @Get('shipments')
  @RequirePermission('packing.execute')
  shipments(@Tenant() t: TenantContext, @Query(zodPipe(listQuerySchema)) q: ListQuery) {
    return this.packing.listShipments(t, q);
  }

  @Put('shipments/:id/tracking')
  @RequirePermission('packing.execute')
  @ApiZodBody(trackingSchema)
  tracking(
    @Tenant() t: TenantContext,
    @Param('id', uuidParam) id: string,
    @Body(zodPipe(trackingSchema)) b: z.infer<typeof trackingSchema>,
  ) {
    return this.packing.setTracking(t, id, b.trackingNumber);
  }

  @Get('shipments/:id/label')
  @RequirePermission('packing.execute')
  async label(
    @Tenant() t: TenantContext,
    @Param('id', uuidParam) id: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const { filename, content } = await this.packing.label(t, id);
    reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `inline; filename="${filename.replace(/[^\w.-]/g, '_')}"`)
      .header('Cache-Control', 'private, no-store');
    return content;
  }
}

@ApiTags('Retouren')
@Controller('returns')
@RequiresModule('returns')
@RequiresCompany()
export class ReturnsController {
  constructor(@Inject(ReturnsService) private readonly returns: ReturnsService) {}

  @Get()
  @RequirePermission('returns.read')
  list(@Tenant() t: TenantContext, @Query(zodPipe(listQuerySchema)) q: ListQuery) {
    return this.returns.list(t, q);
  }

  @Get('returnable/:orderId')
  @RequirePermission('returns.read', 'orders.read')
  returnable(@Tenant() t: TenantContext, @Param('orderId', uuidParam) orderId: string) {
    return this.returns.openLines(t, orderId);
  }

  @Get(':id')
  @RequirePermission('returns.read')
  get(@Tenant() t: TenantContext, @Param('id', uuidParam) id: string) {
    return this.returns.get(t, id);
  }

  @Post()
  @RequirePermission('returns.manage')
  @ApiZodBody(returnCreateSchema)
  create(
    @Tenant() t: TenantContext,
    @Body(zodPipe(returnCreateSchema)) b: z.infer<typeof returnCreateSchema>,
  ) {
    return this.returns.create(t, b);
  }

  @Post(':id/receive')
  @RequirePermission('returns.manage')
  @ApiZodBody(returnReceiveSchema)
  receive(
    @Tenant() t: TenantContext,
    @Param('id', uuidParam) id: string,
    @Body(zodPipe(returnReceiveSchema)) b: z.infer<typeof returnReceiveSchema>,
  ) {
    if (b.createCreditNote && !t.account.permissions.has('documents.manage'))
      throw new AppError(
        403,
        'PERMISSION_DENIED',
        'Für die Gutschrift fehlt das Recht documents.manage',
      );
    return this.returns.receive(t, id, b);
  }

  @Post(':id/cancel')
  @RequirePermission('returns.manage')
  cancel(@Tenant() t: TenantContext, @Param('id', uuidParam) id: string) {
    return this.returns.cancel(t, id);
  }
}
