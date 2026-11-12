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
import { type FastifyReply, type FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  barcodeInputSchema,
  listQuerySchema,
  packCompleteSchema,
  packingDeviceInputSchema,
  packingProblemSchema,
  packingQueueQuerySchema,
  pinLoginSchema,
  setMemberPinSchema,
  setOwnPinSchema,
  packingStationInputSchema,
  pickConfirmSchema,
  pickListCreateSchema,
  returnCreateSchema,
  returnReceiveSchema,
} from '@fangevo/shared';
import { APP_CONFIG, type AppConfig } from '../../config';
import { SESSION_COOKIE } from '../../core/auth/session.service';
import {
  AllowPackingScope,
  Public,
  RateLimit,
  Req,
  RequirePermission,
  RequiresCompany,
  RequiresModule,
  Tenant,
  type TenantContext,
  clientIp,
} from '../../core/http/context';
import { AppError } from '../../core/http/errors';
import { ApiZodBody, uuidParam, zodPipe } from '../../core/http/zod';
import { DEVICE_COOKIE, DEVICE_COOKIE_MAX_AGE_SEC, PackingPinService } from './packing-pin.service';
import { PackingService } from './packing.service';
import { PickingService } from './picking.service';
import { ReturnsService } from './returns.service';
import { ScanService } from './scan.service';

type ListQuery = z.infer<typeof listQuerySchema>;
const codeQuery = z.object({ code: z.string().trim().min(1).max(120) });
const prepareQuery = codeQuery.extend({ stationId: z.uuid().optional() });
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
  @AllowPackingScope()
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

  @Get('queue')
  @AllowPackingScope()
  @RequirePermission('packing.execute')
  queue(
    @Tenant() t: TenantContext,
    @Query(zodPipe(packingQueueQuerySchema)) q: z.infer<typeof packingQueueQuerySchema>,
  ) {
    return this.packing.queue(t, q);
  }

  @Get('orders')
  @AllowPackingScope()
  @RequirePermission('packing.execute')
  prepare(
    @Tenant() t: TenantContext,
    @Query(zodPipe(prepareQuery)) q: z.infer<typeof prepareQuery>,
  ) {
    return this.packing.prepare(t, q.code, q.stationId);
  }

  @Post('orders/:id/complete')
  @AllowPackingScope()
  @RequirePermission('packing.execute')
  @ApiZodBody(packCompleteSchema)
  complete(
    @Tenant() t: TenantContext,
    @Param('id', uuidParam) id: string,
    @Body(zodPipe(packCompleteSchema)) b: z.infer<typeof packCompleteSchema>,
  ) {
    return this.packing.complete(t, id, b);
  }

  /** Problem am Packtisch melden: Auftrag zurückstellen („In Bearbeitung“) mit Grund im Verlauf. */
  @Post('orders/:id/problem')
  @AllowPackingScope()
  @RequirePermission('packing.execute')
  @ApiZodBody(packingProblemSchema)
  problem(
    @Tenant() t: TenantContext,
    @Param('id', uuidParam) id: string,
    @Body(zodPipe(packingProblemSchema)) b: z.infer<typeof packingProblemSchema>,
  ) {
    return this.packing.reportProblem(t, id, b);
  }

  @Get('shipments')
  @AllowPackingScope()
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
  @AllowPackingScope()
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

/**
 * Touch-Packtisch: Lagerrechner freigeben und Packer per PIN anmelden.
 * Die PIN-Sitzung erreicht nur Endpunkte mit @AllowPackingScope (AccessGuard).
 */
@ApiTags('Pack: Geräte und PIN')
@Controller('packing')
export class PackingAccessController {
  constructor(
    @Inject(PackingPinService) private readonly pins: PackingPinService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Post('devices')
  @RequiresModule('packing')
  @RequiresCompany()
  @RequirePermission('shipping.manage')
  @ApiZodBody(packingDeviceInputSchema)
  async registerDevice(
    @Tenant() t: TenantContext,
    @Body(zodPipe(packingDeviceInputSchema)) b: z.infer<typeof packingDeviceInputSchema>,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const r = await this.pins.registerDevice(t, b);
    void reply.setCookie(DEVICE_COOKIE, r.cookie, {
      httpOnly: true,
      secure: this.config.isProd,
      sameSite: 'strict',
      path: '/',
      maxAge: DEVICE_COOKIE_MAX_AGE_SEC,
    });
    return r.device;
  }

  @Get('devices')
  @RequiresModule('packing')
  @RequiresCompany()
  @RequirePermission('shipping.manage')
  devices(@Tenant() t: TenantContext) {
    return this.pins.listDevices(t);
  }

  @Get('devices/current')
  @AllowPackingScope()
  @RequiresModule('packing')
  @RequiresCompany()
  @RequirePermission('packing.execute')
  current(@Tenant() t: TenantContext) {
    return this.pins.currentDevice(t);
  }

  @Post('devices/:id/revoke')
  @HttpCode(204)
  @RequiresModule('packing')
  @RequiresCompany()
  @RequirePermission('shipping.manage')
  async revokeDevice(@Tenant() t: TenantContext, @Param('id', uuidParam) id: string) {
    await this.pins.revokeDevice(t, id);
  }

  /** Startbildschirm am freigegebenen Gerät (ohne Anmeldung, nur mit Geräte-Cookie). */
  @Get('pin/device')
  @Public()
  @RateLimit({ key: 'pin-device', limit: 120, windowSec: 900 })
  device(@Req() req: FastifyRequest) {
    return this.pins.deviceInfo(req.cookies?.[DEVICE_COOKIE]);
  }

  @Post('pin/login')
  @Public()
  @HttpCode(200)
  @RateLimit(
    { key: 'pin-login-ip', limit: 60, windowSec: 900 },
    { key: 'pin-login', limit: 20, windowSec: 900, byBodyField: 'userId' },
  )
  @ApiZodBody(pinLoginSchema)
  async login(
    @Req() req: FastifyRequest,
    @Body(zodPipe(pinLoginSchema)) b: z.infer<typeof pinLoginSchema>,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const r = await this.pins.login(req.cookies?.[DEVICE_COOKIE], b, {
      ip: clientIp(req),
      userAgent: (req.headers['user-agent'] as string | undefined) ?? null,
    });
    void reply.setCookie(SESSION_COOKIE, r.token, {
      httpOnly: true,
      secure: this.config.isProd,
      sameSite: 'lax',
      path: '/',
      maxAge: r.maxAgeSec,
    });
    return { status: 'ok', companyId: r.companyId };
  }

  @Get('pins/me')
  @RequirePermission('packing.execute')
  async myPin(@Tenant() t: TenantContext) {
    return { hasPin: await this.pins.hasPin(t, t.user.id) };
  }

  @Put('pins/me')
  @HttpCode(204)
  @RequirePermission('packing.execute')
  @RateLimit({ key: 'pin-set', limit: 10, windowSec: 900 })
  @ApiZodBody(setOwnPinSchema)
  async setMyPin(
    @Tenant() t: TenantContext,
    @Body(zodPipe(setOwnPinSchema)) b: z.infer<typeof setOwnPinSchema>,
  ) {
    await this.pins.setOwnPin(t, b.pin, b.password);
  }

  @Put('pins/:membershipId')
  @HttpCode(204)
  @RequirePermission('users.manage')
  @ApiZodBody(setMemberPinSchema)
  async setMemberPin(
    @Tenant() t: TenantContext,
    @Param('membershipId', uuidParam) id: string,
    @Body(zodPipe(setMemberPinSchema)) b: z.infer<typeof setMemberPinSchema>,
  ) {
    await this.pins.setMemberPin(t, id, b.pin);
  }

  @Delete('pins/:membershipId')
  @HttpCode(204)
  @RequirePermission('users.manage')
  async removeMemberPin(@Tenant() t: TenantContext, @Param('membershipId', uuidParam) id: string) {
    await this.pins.removeMemberPin(t, id);
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
