import { Body, Controller, Get, HttpCode, Inject, Param, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { type z } from 'zod';
import { Prisma, uuidv7, type Tx } from '@fangevo/database';
import {
  NUMBER_SEQUENCE_KEYS,
  categoryInputSchema,
  companySettingsInputSchema,
  customerGroupInputSchema,
  manufacturerInputSchema,
  numberSequenceInputSchema,
  storageLocationInputSchema,
  taxRateInputSchema,
  warehouseInputSchema,
  type NumberSequenceKey,
} from '@fangevo/shared';
import { AuditService } from '../../core/audit/audit.service';
import { AppError, Errors } from '../../core/http/errors';
import {
  RequirePermission,
  RequiresCompany,
  Tenant,
  type TenantContext,
} from '../../core/http/context';
import { ApiZodBody, uuidParam, zodPipe } from '../../core/http/zod';
import { CompanyDb, type CompanyContext } from '../common/company-db';

/**
 * Firmeneinstellungen für die Warenwirtschaft. Lesen dürfen alle mit Zugriff auf die Firma
 * (für Auswahllisten in Formularen), ändern nur mit company_settings.manage.
 * Gelöscht wird nichts: nicht mehr benötigte Einträge werden archiviert.
 */
@ApiTags('Firmeneinstellungen')
@Controller('company')
@RequiresCompany()
export class SettingsController {
  constructor(
    @Inject(CompanyDb) private readonly cdb: CompanyDb,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  private log(
    tx: Tx,
    c: CompanyContext,
    action: string,
    entityType: string,
    entityId: string,
    data?: Record<string, unknown>,
  ) {
    return this.audit.record(tx, {
      accountId: c.account.id,
      userId: c.user.id,
      companyId: c.companyId,
      action,
      entityType,
      entityId,
      data,
      ip: c.ip,
    });
  }

  /** Alle Auswahllisten einer Firma in einer Anfrage (für Formulare). */
  @Get('master-data')
  masterData(@Tenant() t: TenantContext) {
    return this.cdb.run(t, async (tx) => {
      const [
        settings,
        taxRates,
        customerGroups,
        categories,
        manufacturers,
        warehouses,
        locations,
        sequences,
      ] = await Promise.all([
        tx.companySettings.findFirst(),
        tx.taxRate.findMany({ orderBy: [{ archivedAt: 'asc' }, { rate: 'desc' }] }),
        tx.customerGroup.findMany({ orderBy: { name: 'asc' } }),
        tx.category.findMany({ orderBy: [{ position: 'asc' }, { name: 'asc' }] }),
        tx.manufacturer.findMany({ orderBy: { name: 'asc' } }),
        tx.warehouse.findMany({ orderBy: [{ isDefault: 'desc' }, { name: 'asc' }] }),
        tx.storageLocation.findMany({ where: { archivedAt: null }, orderBy: { code: 'asc' } }),
        tx.numberSequence.findMany(),
      ]);
      return {
        settings,
        taxRates,
        customerGroups,
        categories,
        manufacturers,
        warehouses,
        locations,
        sequences: sequences.map((s) => ({
          ...s,
          label: NUMBER_SEQUENCE_KEYS[s.key as NumberSequenceKey] ?? s.key,
        })),
      };
    });
  }

  @Put('settings')
  @HttpCode(204)
  @RequirePermission('company_settings.manage')
  @ApiZodBody(companySettingsInputSchema)
  async settings(
    @Tenant() t: TenantContext,
    @Body(zodPipe(companySettingsInputSchema)) b: z.infer<typeof companySettingsInputSchema>,
  ) {
    await this.cdb.run(t, async (tx, c) => {
      await tx.companySettings.update({ where: { companyId: c.companyId }, data: b });
      await this.log(tx, c, 'company_settings.updated', 'company', c.companyId, b);
    });
  }

  // ───── Steuersätze ─────
  private async setDefault(
    tx: Tx,
    model: 'taxRate' | 'customerGroup' | 'warehouse',
    id: string,
  ): Promise<void> {
    const m = tx[model] as unknown as { updateMany: (a: object) => Promise<unknown> };
    await m.updateMany({ where: { id: { not: id } }, data: { isDefault: false } });
    await m.updateMany({ where: { id }, data: { isDefault: true } });
  }

  @Post('tax-rates')
  @RequirePermission('company_settings.manage')
  @ApiZodBody(taxRateInputSchema)
  createTax(
    @Tenant() t: TenantContext,
    @Body(zodPipe(taxRateInputSchema)) b: z.infer<typeof taxRateInputSchema>,
  ) {
    return this.cdb.run(t, async (tx, c) => {
      const id = uuidv7();
      const r = await tx.taxRate.create({
        data: {
          id,
          accountId: c.account.id,
          companyId: c.companyId,
          name: b.name,
          rate: new Prisma.Decimal(b.rate),
        },
      });
      if (b.isDefault) await this.setDefault(tx, 'taxRate', id);
      await this.log(tx, c, 'tax_rate.created', 'tax_rate', id, b);
      return r;
    });
  }

  /** Der Satz selbst ist nach Anlage fest (bereits verwendete Artikel/Belege). Nur Name und Standard änderbar. */
  @Put('tax-rates/:id')
  @HttpCode(204)
  @RequirePermission('company_settings.manage')
  @ApiZodBody(taxRateInputSchema)
  async updateTax(
    @Tenant() t: TenantContext,
    @Param('id', uuidParam) id: string,
    @Body(zodPipe(taxRateInputSchema)) b: z.infer<typeof taxRateInputSchema>,
  ) {
    await this.cdb.run(t, async (tx, c) => {
      const r = await tx.taxRate.findUnique({ where: { id } });
      if (!r) throw Errors.notFound();
      if (!r.rate.equals(new Prisma.Decimal(b.rate)))
        throw new AppError(
          409,
          'CONFLICT',
          'Der Prozentsatz kann nicht geändert werden. Legen Sie einen neuen Steuersatz an und archivieren Sie den alten.',
        );
      await tx.taxRate.update({ where: { id }, data: { name: b.name } });
      if (b.isDefault) await this.setDefault(tx, 'taxRate', id);
      await this.log(tx, c, 'tax_rate.updated', 'tax_rate', id, b);
    });
  }

  @Post('tax-rates/:id/archive')
  @HttpCode(204)
  @RequirePermission('company_settings.manage')
  async archiveTax(@Tenant() t: TenantContext, @Param('id', uuidParam) id: string) {
    await this.cdb.run(t, async (tx, c) => {
      const r = await tx.taxRate.findUnique({ where: { id } });
      if (!r) throw Errors.notFound();
      if (r.isDefault)
        throw new AppError(409, 'CONFLICT', 'Der Standard-Steuersatz kann nicht archiviert werden');
      await tx.taxRate.update({
        where: { id },
        data: { archivedAt: r.archivedAt ? null : new Date() },
      });
      await this.log(
        tx,
        c,
        r.archivedAt ? 'tax_rate.restored' : 'tax_rate.archived',
        'tax_rate',
        id,
      );
    });
  }

  // ───── Kundengruppen ─────
  @Post('customer-groups')
  @RequirePermission('company_settings.manage')
  @ApiZodBody(customerGroupInputSchema)
  createGroup(
    @Tenant() t: TenantContext,
    @Body(zodPipe(customerGroupInputSchema)) b: z.infer<typeof customerGroupInputSchema>,
  ) {
    return this.cdb.run(t, async (tx, c) => {
      const id = uuidv7();
      const g = await tx.customerGroup.create({
        data: {
          id,
          accountId: c.account.id,
          companyId: c.companyId,
          name: b.name,
          priceDisplay: b.priceDisplay,
          discountPercent: new Prisma.Decimal(b.discountPercent),
        },
      });
      if (b.isDefault) await this.setDefault(tx, 'customerGroup', id);
      await this.log(tx, c, 'customer_group.created', 'customer_group', id, b);
      return g;
    });
  }

  @Put('customer-groups/:id')
  @HttpCode(204)
  @RequirePermission('company_settings.manage')
  @ApiZodBody(customerGroupInputSchema)
  async updateGroup(
    @Tenant() t: TenantContext,
    @Param('id', uuidParam) id: string,
    @Body(zodPipe(customerGroupInputSchema)) b: z.infer<typeof customerGroupInputSchema>,
  ) {
    await this.cdb.run(t, async (tx, c) => {
      const r = await tx.customerGroup.updateMany({
        where: { id },
        data: {
          name: b.name,
          priceDisplay: b.priceDisplay,
          discountPercent: new Prisma.Decimal(b.discountPercent),
        },
      });
      if (!r.count) throw Errors.notFound();
      if (b.isDefault) await this.setDefault(tx, 'customerGroup', id);
      await this.log(tx, c, 'customer_group.updated', 'customer_group', id, b);
    });
  }

  // ───── Kategorien und Hersteller ─────
  @Post('categories')
  @RequirePermission('company_settings.manage')
  @ApiZodBody(categoryInputSchema)
  createCategory(
    @Tenant() t: TenantContext,
    @Body(zodPipe(categoryInputSchema)) b: z.infer<typeof categoryInputSchema>,
  ) {
    return this.cdb.run(t, async (tx, c) => {
      if (b.parentId && !(await tx.category.count({ where: { id: b.parentId } })))
        throw new AppError(422, 'VALIDATION_FAILED', 'Oberkategorie nicht gefunden');
      const id = uuidv7();
      const cat = await tx.category.create({
        data: {
          id,
          accountId: c.account.id,
          companyId: c.companyId,
          name: b.name,
          parentId: b.parentId ?? null,
          position: b.position,
        },
      });
      await this.log(tx, c, 'category.created', 'category', id, b);
      return cat;
    });
  }

  @Put('categories/:id')
  @HttpCode(204)
  @RequirePermission('company_settings.manage')
  @ApiZodBody(categoryInputSchema)
  async updateCategory(
    @Tenant() t: TenantContext,
    @Param('id', uuidParam) id: string,
    @Body(zodPipe(categoryInputSchema)) b: z.infer<typeof categoryInputSchema>,
  ) {
    await this.cdb.run(t, async (tx, c) => {
      // Zyklen verhindern: neue Oberkategorie darf nicht die Kategorie selbst oder ein Nachfahre sein
      for (let p = b.parentId ?? null, depth = 0; p; depth++) {
        if (p === id || depth > 50)
          throw new AppError(
            422,
            'VALIDATION_FAILED',
            'Eine Kategorie kann nicht unter sich selbst liegen',
          );
        p = (await tx.category.findUnique({ where: { id: p } }))?.parentId ?? null;
      }
      const r = await tx.category.updateMany({
        where: { id },
        data: { name: b.name, parentId: b.parentId ?? null, position: b.position },
      });
      if (!r.count) throw Errors.notFound();
      await this.log(tx, c, 'category.updated', 'category', id, b);
    });
  }

  @Post('categories/:id/archive')
  @HttpCode(204)
  @RequirePermission('company_settings.manage')
  async archiveCategory(@Tenant() t: TenantContext, @Param('id', uuidParam) id: string) {
    await this.cdb.run(t, async (tx, c) => {
      const cat = await tx.category.findUnique({ where: { id } });
      if (!cat) throw Errors.notFound();
      await tx.category.update({
        where: { id },
        data: { archivedAt: cat.archivedAt ? null : new Date() },
      });
      await this.log(
        tx,
        c,
        cat.archivedAt ? 'category.restored' : 'category.archived',
        'category',
        id,
      );
    });
  }

  @Post('manufacturers')
  @RequirePermission('articles.manage')
  @ApiZodBody(manufacturerInputSchema)
  createManufacturer(
    @Tenant() t: TenantContext,
    @Body(zodPipe(manufacturerInputSchema)) b: z.infer<typeof manufacturerInputSchema>,
  ) {
    return this.cdb.run(t, async (tx, c) => {
      const id = uuidv7();
      const m = await tx.manufacturer.create({
        data: { id, accountId: c.account.id, companyId: c.companyId, name: b.name },
      });
      await this.log(tx, c, 'manufacturer.created', 'manufacturer', id, b);
      return m;
    });
  }

  // ───── Nummernkreise ─────
  /** Die nächste Nummer darf nur erhöht werden (keine doppelten Nummern). */
  @Put('number-sequences/:key')
  @HttpCode(204)
  @RequirePermission('company_settings.manage')
  @ApiZodBody(numberSequenceInputSchema)
  async sequence(
    @Tenant() t: TenantContext,
    @Param('key') key: string,
    @Body(zodPipe(numberSequenceInputSchema)) b: z.infer<typeof numberSequenceInputSchema>,
  ) {
    if (!(key in NUMBER_SEQUENCE_KEYS)) throw Errors.notFound();
    await this.cdb.run(t, async (tx, c) => {
      const s = await tx.numberSequence.findUnique({
        where: { companyId_key: { companyId: c.companyId, key } },
      });
      if (!s) throw Errors.notFound();
      if (b.nextValue < s.nextValue)
        throw new AppError(
          409,
          'CONFLICT',
          `Die nächste Nummer kann nur erhöht werden (aktuell ${s.nextValue})`,
        );
      await tx.numberSequence.update({
        where: { companyId_key: { companyId: c.companyId, key } },
        data: b,
      });
      await this.log(tx, c, 'number_sequence.updated', 'number_sequence', c.companyId, {
        key,
        before: { prefix: s.prefix, nextValue: s.nextValue, padding: s.padding },
        after: b,
      });
    });
  }

  // ───── Lager und Lagerplätze ─────
  @Post('warehouses')
  @RequirePermission('company_settings.manage')
  @ApiZodBody(warehouseInputSchema)
  createWarehouse(
    @Tenant() t: TenantContext,
    @Body(zodPipe(warehouseInputSchema)) b: z.infer<typeof warehouseInputSchema>,
  ) {
    return this.cdb.run(t, async (tx, c) => {
      const id = uuidv7();
      const { isDefault, ...data } = b;
      const w = await tx.warehouse.create({
        data: { ...data, id, accountId: c.account.id, companyId: c.companyId },
      });
      if (isDefault) await this.setDefault(tx, 'warehouse', id);
      await this.log(tx, c, 'warehouse.created', 'warehouse', id, b);
      return w;
    });
  }

  @Put('warehouses/:id')
  @HttpCode(204)
  @RequirePermission('company_settings.manage')
  @ApiZodBody(warehouseInputSchema)
  async updateWarehouse(
    @Tenant() t: TenantContext,
    @Param('id', uuidParam) id: string,
    @Body(zodPipe(warehouseInputSchema)) b: z.infer<typeof warehouseInputSchema>,
  ) {
    await this.cdb.run(t, async (tx, c) => {
      const { isDefault, ...data } = b;
      const r = await tx.warehouse.updateMany({ where: { id }, data });
      if (!r.count) throw Errors.notFound();
      if (isDefault) await this.setDefault(tx, 'warehouse', id);
      await this.log(tx, c, 'warehouse.updated', 'warehouse', id, b);
    });
  }

  @Post('warehouses/:id/archive')
  @HttpCode(204)
  @RequirePermission('company_settings.manage')
  async archiveWarehouse(@Tenant() t: TenantContext, @Param('id', uuidParam) id: string) {
    await this.cdb.run(t, async (tx, c) => {
      const w = await tx.warehouse.findUnique({ where: { id } });
      if (!w) throw Errors.notFound();
      if (!w.archivedAt) {
        if (w.isDefault)
          throw new AppError(409, 'CONFLICT', 'Das Standardlager kann nicht archiviert werden');
        const stock = await tx.stockLevel.findFirst({
          where: { warehouseId: id, quantity: { not: 0 } },
        });
        if (stock)
          throw new AppError(
            409,
            'CONFLICT',
            'Im Lager liegt noch Bestand. Bitte zuerst umlagern oder ausbuchen.',
          );
      }
      await tx.warehouse.update({
        where: { id },
        data: { archivedAt: w.archivedAt ? null : new Date() },
      });
      await this.log(
        tx,
        c,
        w.archivedAt ? 'warehouse.restored' : 'warehouse.archived',
        'warehouse',
        id,
      );
    });
  }

  @Post('warehouses/:id/locations')
  @RequirePermission('company_settings.manage')
  @ApiZodBody(storageLocationInputSchema)
  createLocation(
    @Tenant() t: TenantContext,
    @Param('id', uuidParam) warehouseId: string,
    @Body(zodPipe(storageLocationInputSchema)) b: z.infer<typeof storageLocationInputSchema>,
  ) {
    return this.cdb.run(t, async (tx, c) => {
      if (!(await tx.warehouse.count({ where: { id: warehouseId } }))) throw Errors.notFound();
      const id = uuidv7();
      const l = await tx.storageLocation.create({
        data: {
          id,
          accountId: c.account.id,
          companyId: c.companyId,
          warehouseId,
          code: b.code,
          description: b.description,
        },
      });
      await this.log(tx, c, 'storage_location.created', 'storage_location', id, {
        warehouseId,
        ...b,
      });
      return l;
    });
  }
}
