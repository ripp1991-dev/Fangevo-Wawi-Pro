import { Inject, Injectable } from '@nestjs/common';
import { type z } from 'zod';
import { Prisma, uuidv7, type Tx } from '@fangevo/database';
import {
  type stockBookingSchema,
  type stockCorrectionSchema,
  type stockTransferSchema,
} from '@fangevo/shared';
import { AuditService } from '../../core/audit/audit.service';
import { AppError } from '../../core/http/errors';
import { type TenantContext } from '../../core/http/context';
import { CompanyDb, type CompanyContext } from '../common/company-db';
import { dec } from '../common/decimal';

const NO_LOCATION = '00000000-0000-0000-0000-000000000000';

export interface Slot {
  articleId: string;
  warehouseId: string;
  locationId: string | null;
  /** Charge / Seriennummer gehören zum Lagerort (Bestand je Charge/SN) */
  batch?: string | null;
  serialNumber?: string | null;
}

interface Tracking {
  batch?: string | null;
  serialNumber?: string | null;
  bestBefore?: string | null;
  note?: string | null;
}

/**
 * Bestandsführung über ein unveränderliches Journal (stock_movements).
 * Der aktuelle Bestand (stock_levels) wird in derselben Transaktion fortgeschrieben.
 * Die Bestandszeile wird dabei gesperrt (UPDATE … RETURNING), sodass parallele Buchungen
 * nacheinander laufen und kein Bestand doppelt verbraucht werden kann.
 */
@Injectable()
export class InventoryService {
  constructor(
    @Inject(CompanyDb) private readonly cdb: CompanyDb,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /** Prüft Artikel, Lager und Lagerplatz (alles innerhalb der Firma, RLS). */
  async checkSlot(tx: Tx, s: Slot, forReceipt = false) {
    const article = await tx.article.findUnique({ where: { id: s.articleId } });
    if (!article)
      throw new AppError(422, 'VALIDATION_FAILED', 'Artikel nicht gefunden', [
        { path: 'articleId', message: 'Artikel nicht gefunden' },
      ]);
    if (!article.stockTracked || article.kind === 'parent' || article.kind === 'set') {
      throw new AppError(
        422,
        'VALIDATION_FAILED',
        'Für diesen Artikel wird kein Bestand geführt (Vaterartikel, Set oder Bestandsführung aus)',
      );
    }
    if (forReceipt && article.archivedAt)
      throw new AppError(
        422,
        'VALIDATION_FAILED',
        'Archivierte Artikel können nicht eingebucht werden',
      );
    const wh = await tx.warehouse.findUnique({ where: { id: s.warehouseId } });
    if (!wh || wh.archivedAt)
      throw new AppError(422, 'VALIDATION_FAILED', 'Lager nicht gefunden oder archiviert', [
        { path: 'warehouseId', message: 'Lager nicht gefunden' },
      ]);
    if (s.locationId) {
      const loc = await tx.storageLocation.findUnique({ where: { id: s.locationId } });
      if (!loc || loc.warehouseId !== s.warehouseId || loc.archivedAt)
        throw new AppError(422, 'VALIDATION_FAILED', 'Lagerplatz gehört nicht zu diesem Lager', [
          { path: 'locationId', message: 'Lagerplatz ungültig' },
        ]);
    }
    return article;
  }

  checkTracking(
    article: { trackBatches: boolean; trackSerials: boolean; trackBestBefore: boolean },
    type: string,
    qty: Prisma.Decimal,
    t: Tracking,
  ): void {
    const errors: { path: string; message: string }[] = [];
    if (article.trackBatches && !t.batch)
      errors.push({ path: 'batch', message: 'Charge ist Pflicht für diesen Artikel' });
    if (article.trackSerials) {
      if (!t.serialNumber)
        errors.push({
          path: 'serialNumber',
          message: 'Seriennummer ist Pflicht für diesen Artikel',
        });
      if (!qty.abs().equals(1))
        errors.push({
          path: 'quantity',
          message: 'Bei Seriennummern wird je Stück einzeln gebucht (Menge 1)',
        });
    }
    if (article.trackBestBefore && type === 'receipt' && !t.bestBefore)
      errors.push({ path: 'bestBefore', message: 'MHD ist Pflicht für diesen Artikel' });
    if (errors.length)
      throw new AppError(422, 'VALIDATION_FAILED', 'Angaben zur Rückverfolgung fehlen', errors);
  }

  /**
   * Bucht eine Bestandsänderung an einem Lagerort und schreibt das Journal.
   * Gibt den neuen Bestand zurück. Wirft, wenn der Bestand negativ würde und das nicht erlaubt ist.
   */
  async apply(
    tx: Tx,
    c: CompanyContext,
    s: Slot,
    delta: Prisma.Decimal,
    type: string,
    extra: Tracking & { transferId?: string; referenceType?: string; referenceId?: string },
  ): Promise<Prisma.Decimal> {
    const loc = s.locationId ?? NO_LOCATION;
    const batch = s.batch ?? extra.batch ?? null;
    const serial = s.serialNumber ?? extra.serialNumber ?? null;
    const bestBefore = extra.bestBefore ?? null;
    if (serial && delta.isPositive()) {
      // Eine Seriennummer gibt es je Artikel höchstens einmal im Bestand (über alle Lager)
      const total = await tx.$queryRaw<{ q: Prisma.Decimal | null }[]>`
        SELECT SUM(quantity) AS q FROM stock_levels
        WHERE company_id = ${c.companyId}::uuid AND article_id = ${s.articleId}::uuid AND serial_number = ${serial}`;
      if (
        dec(total[0]?.q ?? 0)
          .plus(delta)
          .greaterThan(1)
      )
        throw new AppError(409, 'CONFLICT', `Seriennummer ${serial} ist bereits im Bestand`, [
          { path: 'serialNumber', message: 'Bereits im Bestand' },
        ]);
    }
    await tx.$executeRaw`
      INSERT INTO stock_levels (id, account_id, company_id, article_id, warehouse_id, location_id, batch, serial_number, best_before, quantity, reserved, updated_at)
      VALUES (${uuidv7()}::uuid, ${c.account.id}::uuid, ${c.companyId}::uuid, ${s.articleId}::uuid, ${s.warehouseId}::uuid, ${s.locationId}::uuid,
              ${batch}, ${serial}, ${bestBefore}::date, 0, 0, now())
      ON CONFLICT (company_id, article_id, warehouse_id, (COALESCE(location_id, '00000000-0000-0000-0000-000000000000'::uuid)),
                   (COALESCE(batch, '')), (COALESCE(serial_number, ''))) DO NOTHING`;
    const rows = await tx.$queryRaw<{ quantity: Prisma.Decimal }[]>`
      UPDATE stock_levels SET quantity = quantity + ${delta}::numeric, updated_at = now(),
             best_before = COALESCE(best_before, ${bestBefore}::date)
      WHERE company_id = ${c.companyId}::uuid AND article_id = ${s.articleId}::uuid AND warehouse_id = ${s.warehouseId}::uuid
        AND COALESCE(location_id, '00000000-0000-0000-0000-000000000000'::uuid) = ${loc}::uuid
        AND COALESCE(batch, '') = ${batch ?? ''} AND COALESCE(serial_number, '') = ${serial ?? ''}
      RETURNING quantity`;
    const balance = dec(rows[0]!.quantity);
    if (balance.isNegative()) {
      const settings = await tx.companySettings.findUnique({ where: { companyId: c.companyId } });
      if (!settings?.allowNegativeStock) {
        throw new AppError(
          409,
          'CONFLICT',
          `Nicht genug Bestand. Verfügbar: ${balance.minus(delta).toString()}`,
          [{ path: 'quantity', message: 'Nicht genug Bestand' }],
        );
      }
    }
    await tx.stockMovement.create({
      data: {
        id: uuidv7(),
        accountId: c.account.id,
        companyId: c.companyId,
        articleId: s.articleId,
        warehouseId: s.warehouseId,
        locationId: s.locationId,
        type,
        quantity: delta,
        balanceAfter: balance,
        batch,
        serialNumber: serial,
        bestBefore: bestBefore ? new Date(bestBefore) : null,
        note: extra.note ?? null,
        transferId: extra.transferId ?? null,
        referenceType: extra.referenceType ?? null,
        referenceId: extra.referenceId ?? null,
        createdBy: c.user.id,
      },
    });
    return balance;
  }

  book(t: TenantContext, b: z.infer<typeof stockBookingSchema>) {
    return this.cdb.run(t, async (tx, c) => {
      const slot = {
        articleId: b.articleId,
        warehouseId: b.warehouseId,
        locationId: b.locationId ?? null,
      };
      const article = await this.checkSlot(tx, slot, b.type === 'receipt');
      const qty = dec(b.quantity);
      this.checkTracking(article, b.type, qty, b);
      const delta = b.type === 'receipt' ? qty : qty.negated();
      const balance = await this.apply(tx, c, slot, delta, b.type, b);
      await this.log(tx, c, b.type === 'receipt' ? 'stock.received' : 'stock.issued', b.articleId, {
        warehouseId: b.warehouseId,
        quantity: b.quantity,
        balance: balance.toString(),
        batch: b.batch,
        serialNumber: b.serialNumber,
        note: b.note,
      });
      return { balance: balance.toString() };
    });
  }

  transfer(t: TenantContext, b: z.infer<typeof stockTransferSchema>) {
    return this.cdb.run(t, async (tx, c) => {
      const lot = { batch: b.batch ?? null, serialNumber: b.serialNumber ?? null };
      const from = {
        articleId: b.articleId,
        warehouseId: b.fromWarehouseId,
        locationId: b.fromLocationId ?? null,
        ...lot,
      };
      const to = {
        articleId: b.articleId,
        warehouseId: b.toWarehouseId,
        locationId: b.toLocationId ?? null,
        ...lot,
      };
      if (from.warehouseId === to.warehouseId && from.locationId === to.locationId)
        throw new AppError(422, 'VALIDATION_FAILED', 'Quelle und Ziel sind identisch');
      const article = await this.checkSlot(tx, from);
      await this.checkSlot(tx, to);
      const qty = dec(b.quantity);
      this.checkTracking(article, 'transfer', qty, lot);
      const transferId = uuidv7();
      const fromBalance = await this.apply(tx, c, from, qty.negated(), 'transfer_out', {
        transferId,
        note: b.note,
      });
      const toBalance = await this.apply(tx, c, to, qty, 'transfer_in', {
        transferId,
        note: b.note,
      });
      await this.log(tx, c, 'stock.transferred', b.articleId, {
        from,
        to,
        quantity: b.quantity,
        note: b.note,
      });
      return { fromBalance: fromBalance.toString(), toBalance: toBalance.toString() };
    });
  }

  /** Inventur/Korrektur: gebucht wird die Differenz zwischen gezähltem und aktuellem Bestand. */
  correct(t: TenantContext, b: z.infer<typeof stockCorrectionSchema>) {
    return this.cdb.run(t, async (tx, c) => {
      const slot = {
        articleId: b.articleId,
        warehouseId: b.warehouseId,
        locationId: b.locationId ?? null,
        batch: b.batch ?? null,
        serialNumber: b.serialNumber ?? null,
      };
      const article = await this.checkSlot(tx, slot);
      const counted = dec(b.countedQuantity);
      if (article.trackBatches && !slot.batch)
        throw new AppError(422, 'VALIDATION_FAILED', 'Charge ist Pflicht für diesen Artikel', [
          { path: 'batch', message: 'Charge fehlt' },
        ]);
      if (article.trackSerials && (!slot.serialNumber || counted.greaterThan(1)))
        throw new AppError(
          422,
          'VALIDATION_FAILED',
          'Bei Seriennummern je Nummer zählen (0 oder 1)',
          [{ path: 'serialNumber', message: 'Seriennummer fehlt oder Menge > 1' }],
        );
      const current = await tx.$queryRaw<{ quantity: Prisma.Decimal }[]>`
        SELECT quantity FROM stock_levels
        WHERE company_id = ${c.companyId}::uuid AND article_id = ${slot.articleId}::uuid AND warehouse_id = ${slot.warehouseId}::uuid
          AND COALESCE(location_id, '00000000-0000-0000-0000-000000000000'::uuid) = ${slot.locationId ?? NO_LOCATION}::uuid
          AND COALESCE(batch, '') = ${slot.batch ?? ''} AND COALESCE(serial_number, '') = ${slot.serialNumber ?? ''}
        FOR UPDATE`;
      const delta = counted.minus(dec(current[0]?.quantity ?? 0));
      if (delta.isZero())
        throw new AppError(409, 'CONFLICT', 'Keine Abweichung, es wurde nichts gebucht');
      const balance = await this.apply(tx, c, slot, delta, 'correction', {
        note: b.note,
        bestBefore: b.bestBefore,
      });
      await this.log(tx, c, 'stock.corrected', b.articleId, {
        warehouseId: b.warehouseId,
        counted: counted.toString(),
        delta: delta.toString(),
        note: b.note,
      });
      return { delta: delta.toString(), balance: balance.toString() };
    });
  }

  /** Bestände je Artikel und Lager(platz), optional gefiltert. */
  levels(t: TenantContext, f: { articleId?: string; warehouseId?: string }) {
    return this.cdb.run(t, async (tx) => {
      const rows = await tx.stockLevel.findMany({
        where: {
          ...(f.articleId ? { articleId: f.articleId } : {}),
          ...(f.warehouseId ? { warehouseId: f.warehouseId } : {}),
          NOT: { AND: [{ quantity: 0 }, { reserved: 0 }] },
        },
        take: 5000,
      });
      const [articles, warehouses, locations] = await Promise.all([
        tx.article.findMany({
          where: { id: { in: [...new Set(rows.map((r) => r.articleId))] } },
          select: { id: true, number: true, name: true, unit: true, minStock: true },
        }),
        tx.warehouse.findMany({ select: { id: true, code: true, name: true } }),
        tx.storageLocation.findMany({
          where: { id: { in: rows.map((r) => r.locationId).filter((x): x is string => !!x) } },
          select: { id: true, code: true },
        }),
      ]);
      // Reservierungen gelten je Artikel und Lager (nicht je Lagerplatz)
      const res = rows.length
        ? await tx.stockReservation.groupBy({
            by: ['articleId', 'warehouseId'],
            where: { articleId: { in: [...new Set(rows.map((r) => r.articleId))] } },
            _sum: { quantity: true },
          })
        : [];
      return rows.map((r) => ({
        ...r,
        reservedInWarehouse: (
          res.find((x) => x.articleId === r.articleId && x.warehouseId === r.warehouseId)?._sum
            .quantity ?? dec(0)
        ).toString(),
        article: articles.find((a) => a.id === r.articleId) ?? null,
        warehouse: warehouses.find((w) => w.id === r.warehouseId) ?? null,
        location: r.locationId ? (locations.find((l) => l.id === r.locationId) ?? null) : null,
      }));
    });
  }

  /** Journal (neueste zuerst), Cursor über die zeitlich sortierbare ID. */
  movements(
    t: TenantContext,
    f: { articleId?: string; warehouseId?: string; cursor?: string; limit: number },
  ) {
    return this.cdb.run(t, async (tx) => {
      const rows = await tx.stockMovement.findMany({
        where: {
          ...(f.articleId ? { articleId: f.articleId } : {}),
          ...(f.warehouseId ? { warehouseId: f.warehouseId } : {}),
          ...(f.cursor ? { id: { lt: f.cursor } } : {}),
        },
        orderBy: { id: 'desc' },
        take: f.limit + 1,
      });
      const page = rows.slice(0, f.limit);
      const articles = await tx.article.findMany({
        where: { id: { in: [...new Set(page.map((r) => r.articleId))] } },
        select: { id: true, number: true, name: true },
      });
      const warehouses = await tx.warehouse.findMany({
        select: { id: true, code: true, name: true },
      });
      return {
        items: page.map((m) => ({
          ...m,
          article: articles.find((a) => a.id === m.articleId) ?? null,
          warehouse: warehouses.find((w) => w.id === m.warehouseId) ?? null,
        })),
        nextCursor: rows.length > f.limit ? (page.at(-1)?.id ?? null) : null,
      };
    });
  }

  /** Artikel unter Mindestbestand (Summe über alle Lager). */
  lowStock(t: TenantContext, limit = 100) {
    return this.cdb.run(
      t,
      (tx, c) =>
        tx.$queryRaw<
          {
            id: string;
            number: string;
            name: string;
            unit: string;
            minStock: string;
            stock: string;
          }[]
        >`
        SELECT a.id, a.number, a.name, a.unit, a.min_stock::text AS "minStock", COALESCE(SUM(l.quantity), 0)::text AS stock
        FROM articles a
        LEFT JOIN stock_levels l ON l.article_id = a.id AND l.company_id = a.company_id
        WHERE a.company_id = ${c.companyId}::uuid AND a.archived_at IS NULL AND a.active AND a.stock_tracked AND a.min_stock > 0
        GROUP BY a.id
        HAVING COALESCE(SUM(l.quantity), 0) < a.min_stock
        ORDER BY (COALESCE(SUM(l.quantity), 0) / NULLIF(a.min_stock, 0)) ASC, a.number
        LIMIT ${Prisma.raw(String(Math.min(Math.max(limit, 1), 500)))}`,
    );
  }

  private log(
    tx: Tx,
    c: CompanyContext,
    action: string,
    articleId: string,
    data: Record<string, unknown>,
  ) {
    return this.audit.record(tx, {
      accountId: c.account.id,
      userId: c.user.id,
      companyId: c.companyId,
      action,
      entityType: 'article',
      entityId: articleId,
      data,
      ip: c.ip,
    });
  }
}
