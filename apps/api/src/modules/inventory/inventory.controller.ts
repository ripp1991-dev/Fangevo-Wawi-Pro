import { Body, Controller, Get, Inject, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { stockBookingSchema, stockCorrectionSchema, stockTransferSchema } from '@fangevo/shared';
import {
  RateLimit,
  RequirePermission,
  RequiresCompany,
  RequiresModule,
  Tenant,
  type TenantContext,
} from '../../core/http/context';
import { ApiZodBody, zodPipe } from '../../core/http/zod';
import { InventoryService } from './inventory.service';

const levelsSchema = z.object({ articleId: z.uuid().optional(), warehouseId: z.uuid().optional() });
const movementsSchema = levelsSchema.extend({
  cursor: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

@ApiTags('Lager')
@Controller('inventory')
@RequiresModule('inventory')
@RequiresCompany()
export class InventoryController {
  constructor(@Inject(InventoryService) private readonly inventory: InventoryService) {}

  @Get('levels')
  @RequirePermission('inventory.read')
  levels(
    @Tenant() t: TenantContext,
    @Query(zodPipe(levelsSchema)) q: z.infer<typeof levelsSchema>,
  ) {
    return this.inventory.levels(t, q);
  }

  @Get('movements')
  @RequirePermission('inventory.read')
  movements(
    @Tenant() t: TenantContext,
    @Query(zodPipe(movementsSchema)) q: z.infer<typeof movementsSchema>,
  ) {
    return this.inventory.movements(t, q);
  }

  @Get('low-stock')
  @RequirePermission('inventory.read')
  lowStock(@Tenant() t: TenantContext) {
    return this.inventory.lowStock(t);
  }

  @Post('bookings')
  @RequirePermission('inventory.manage')
  @RateLimit({ key: 'stock', limit: 600, windowSec: 60 })
  @ApiZodBody(stockBookingSchema)
  book(
    @Tenant() t: TenantContext,
    @Body(zodPipe(stockBookingSchema)) b: z.infer<typeof stockBookingSchema>,
  ) {
    return this.inventory.book(t, b);
  }

  @Post('transfers')
  @RequirePermission('inventory.manage')
  @ApiZodBody(stockTransferSchema)
  transfer(
    @Tenant() t: TenantContext,
    @Body(zodPipe(stockTransferSchema)) b: z.infer<typeof stockTransferSchema>,
  ) {
    return this.inventory.transfer(t, b);
  }

  @Post('corrections')
  @RequirePermission('inventory.manage')
  @ApiZodBody(stockCorrectionSchema)
  correct(
    @Tenant() t: TenantContext,
    @Body(zodPipe(stockCorrectionSchema)) b: z.infer<typeof stockCorrectionSchema>,
  ) {
    return this.inventory.correct(t, b);
  }
}
