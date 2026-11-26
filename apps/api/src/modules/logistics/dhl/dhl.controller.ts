import { Body, Controller, Get, Inject, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { type z } from 'zod';
import { dhlAccountSchema } from '@fangevo/shared';
import {
  RequirePermission,
  RequiresCompany,
  RequiresModule,
  Tenant,
  type TenantContext,
} from '../../../core/http/context';
import { ApiZodBody, zodPipe } from '../../../core/http/zod';
import { DhlService } from './dhl.service';

/** DHL-Zugang der Firma (ADR-016). Das Passwort wird nie zurückgegeben. */
@ApiTags('Pack: Versanddienstleister')
@Controller('packing/carriers/dhl')
@RequiresModule('packing')
@RequiresCompany()
export class DhlController {
  constructor(@Inject(DhlService) private readonly dhl: DhlService) {}

  @Get()
  @RequirePermission('shipping.manage')
  account(@Tenant() t: TenantContext) {
    return this.dhl.account(t);
  }

  @Put()
  @RequirePermission('shipping.manage')
  @ApiZodBody(dhlAccountSchema)
  save(
    @Tenant() t: TenantContext,
    @Body(zodPipe(dhlAccountSchema)) b: z.infer<typeof dhlAccountSchema>,
  ) {
    return this.dhl.save(t, b);
  }

  @Post('test')
  @RequirePermission('shipping.manage')
  test(@Tenant() t: TenantContext) {
    return this.dhl.test(t);
  }
}
