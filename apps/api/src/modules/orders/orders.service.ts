import { Inject, Injectable } from '@nestjs/common';
import { Prisma, uuidv7, type SalesOrder, type Tx } from '@fangevo/database';
import {
  canTransition,
  ORDER_EDITABLE,
  ORDER_NEEDS_STOCK,
  ORDER_RESERVING,
  ORDER_SHIPPABLE,
  ORDER_STATUSES,
  type ListQuery,
  type OrderInput,
  type OrderStatus,
} from '@fangevo/shared';
import { AuditService } from '../../core/audit/audit.service';
import { AppError, Errors } from '../../core/http/errors';
import { type TenantContext } from '../../core/http/context';
import { buildListArgs, type FieldSpec } from '../../core/lists/list-query';
import { SearchService } from '../../core/search/search.service';
import { CompanyDb, type CompanyContext } from '../common/company-db';
import { dec, normalizeNumbers } from '../common/decimal';
import { loadPartyDetails } from '../common/parties';
import { lineAmounts, summarize } from '../common/totals';
import { customerDisplayName } from '../customers/customers.service';
import { openInvoiceCount } from '../documents/document-queries';
import { InventoryService } from '../inventory/inventory.service';

export const ORDER_FIELDS: FieldSpec = {
  number: { kind: 'string', sortable: true },
  status: { kind: 'enum', sortable: true },
  customerId: { kind: 'enum' },
  externalNumber: { kind: 'string', sortable: true },
  orderDate: { kind: 'date', sortable: true },
  totalNet: { kind: 'number', sortable: true },
  totalGross: { kind: 'number', sortable: true },
  paymentMethod: { kind: 'string', sortable: true },
  shippingMethod: { kind: 'string', sortable: true },
  shippedAt: { kind: 'date', sortable: true },
  createdAt: { kind: 'date', sortable: true },
};

export interface CustomerSnapshot {
  number: string;
  displayName: string;
  type: string;
  email: string | null;
  vatId: string | null;
  priceDisplay: string;
  paymentTermsDays: number;
  billing: AddressSnapshot | null;
  shipping: AddressSnapshot | null;
}

export interface AddressSnapshot {
  name: string | null;
  name2: string | null;
  street: string | null;
  postalCode: string | null;
  city: string | null;
  country: string;
}

export interface Demand {
  lineId: string;
  articleId: string;
  quantity: Prisma.Decimal;
  trackBatches: boolean;
  trackSerials: boolean;
}

/** Konkrete Entnahme beim Packen: Position, Artikel, Menge und ggf. Charge/SN/Lagerplatz. */
export interface Allocation {
  orderLineId: string;
  articleId: string;
  quantity: string;
  batch?: string | null;
  serialNumber?: string | null;
  locationId?: string | null;
}

export interface Shortage {
  articleId: string;
  number: string;
  name: string;
  needed: string;
  available: string;
}

const notOrderable = (msg: string, index: number) =>
  new AppError(422, 'VALIDATION_FAILED', msg, [{ path: `lines.${index}.articleId`, message: msg }]);

/**
 * Aufträge: Anlage mit serverseitiger Preisermittlung, kontrollierte Statuswechsel,
 * Bestandsreservierung (älteste Aufträge zuerst) und Versand mit Bestandsabbuchung.
 */
@Injectable()
export class OrdersService {
  constructor(
    @Inject(CompanyDb) private readonly cdb: CompanyDb,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(SearchService) private readonly search: SearchService,
    @Inject(InventoryService) private readonly inventory: InventoryService,
  ) {}

  list(t: TenantContext, q: ListQuery) {
    return this.cdb.run(t, async (tx) => {
      const args = buildListArgs(q, ORDER_FIELDS, {
        search: ['number', 'externalNumber'],
        defaultSort: 'orderDate:desc',
      });
      const [items, total] = await Promise.all([
        tx.salesOrder.findMany({
          where: args.where,
          orderBy: args.orderBy,
          skip: args.skip,
          take: args.take,
        }),
        tx.salesOrder.count({ where: args.where }),
      ]);
      return {
        items: items.map((o) => ({
          ...o,
          customerName: (o.customerSnapshot as unknown as CustomerSnapshot).displayName,
          customerNumber: (o.customerSnapshot as unknown as CustomerSnapshot).number,
        })),
        total,
        page: q.page,
        pageSize: q.pageSize,
      };
    });
  }

  get(t: TenantContext, id: string) {
    return this.cdb.run(t, (tx, c) => this.load(tx, c, id));
  }

  private async load(tx: Tx, c: CompanyContext, id: string) {
    const order = await tx.salesOrder.findUnique({ where: { id } });
    if (!order) throw Errors.notFound();
    const [lines, history, warehouse] = await Promise.all([
      tx.salesOrderLine.findMany({ where: { orderId: id }, orderBy: { position: 'asc' } }),
      tx.orderStatusHistory.findMany({ where: { orderId: id }, orderBy: { createdAt: 'asc' } }),
      tx.warehouse.findUnique({
        where: { id: order.warehouseId },
        select: { id: true, code: true, name: true },
      }),
    ]);
    const reserving = (ORDER_RESERVING as string[]).includes(order.status);
    return {
      ...order,
      lines,
      history,
      warehouse,
      shortages: reserving ? await this.shortages(tx, c, order) : [],
    };
  }

  // ───── Anlage und Bearbeitung ─────

  create(t: TenantContext, input: OrderInput) {
    return this.cdb.run(t, async (tx, c) =>
      this.load(tx, c, (await this.createInTx(tx, c, input)).id),
    );
  }

  /** Auftrag in einer laufenden Transaktion anlegen (auch für Verkaufskanäle). */
  async createInTx(
    tx: Tx,
    c: CompanyContext,
    input: OrderInput,
    origin: { channelId?: string | null; note?: string | null } = {},
  ): Promise<SalesOrder> {
    const prepared = await this.prepare(tx, input);
    const id = uuidv7();
    const number = await this.cdb.nextNumber(tx, c.companyId, 'order');
    const order = await tx.salesOrder.create({
      data: {
        id,
        accountId: c.account.id,
        companyId: c.companyId,
        number,
        status: 'new',
        ...prepared.header,
        channelId: origin.channelId ?? null,
        createdBy: c.user.id,
        updatedBy: c.user.id,
      },
    });
    await this.writeLines(tx, c, id, prepared.lines);
    await this.history(tx, c, id, null, 'new', origin.note ?? null);
    await this.reserve(tx, c, order);
    await this.audit.record(
      tx,
      this.entry(c, 'order.created', order, { number, channelId: origin.channelId ?? undefined }),
    );
    await this.index(tx, order);
    return order;
  }

  update(t: TenantContext, id: string, input: OrderInput, version: number) {
    return this.cdb.run(t, async (tx, c) => {
      const current = await tx.salesOrder.findUnique({ where: { id } });
      if (!current) throw Errors.notFound();
      if (!(ORDER_EDITABLE as string[]).includes(current.status))
        throw new AppError(
          409,
          'CONFLICT',
          `Im Status „${ORDER_STATUSES[current.status as OrderStatus]}“ kann der Auftrag nicht mehr geändert werden`,
        );
      const prepared = await this.prepare(tx, input);
      const res = await tx.salesOrder.updateMany({
        where: { id, version },
        data: { ...prepared.header, updatedBy: c.user.id, version: { increment: 1 } },
      });
      if (res.count === 0) throw Errors.versionConflict();
      await tx.salesOrderLine.deleteMany({ where: { orderId: id } });
      await this.writeLines(tx, c, id, prepared.lines);
      await this.release(tx, id);
      const order = (await tx.salesOrder.findUnique({ where: { id } }))!;
      await this.reserve(tx, c, order);
      await this.audit.record(tx, this.entry(c, 'order.updated', order, {}));
      await this.index(tx, order);
      return this.load(tx, c, id);
    });
  }

  /** Prüft Kunde, Lager und Artikel und ermittelt Preise und Summen. */
  private async prepare(tx: Tx, input: OrderInput) {
    const customer = await tx.customer.findUnique({ where: { id: input.customerId } });
    if (!customer || customer.archivedAt)
      throw new AppError(422, 'VALIDATION_FAILED', 'Kunde nicht gefunden', [
        { path: 'customerId', message: 'Kunde nicht gefunden' },
      ]);
    if (customer.blocked)
      throw new AppError(
        409,
        'CONFLICT',
        `Der Kunde ist gesperrt${customer.blockedReason ? `: ${customer.blockedReason}` : ''}`,
      );
    const group = customer.customerGroupId
      ? await tx.customerGroup.findUnique({ where: { id: customer.customerGroupId } })
      : null;
    const warehouse = input.warehouseId
      ? await tx.warehouse.findUnique({ where: { id: input.warehouseId } })
      : await tx.warehouse.findFirst({ where: { isDefault: true, archivedAt: null } });
    if (!warehouse || warehouse.archivedAt)
      throw new AppError(422, 'VALIDATION_FAILED', 'Lager nicht gefunden', [
        { path: 'warehouseId', message: 'Lager nicht gefunden' },
      ]);
    const taxRates = await tx.taxRate.findMany();
    const defaultTax = taxRates.find((r) => r.isDefault && !r.archivedAt) ?? taxRates[0];
    if (!defaultTax) throw new AppError(422, 'VALIDATION_FAILED', 'Kein Steuersatz angelegt');

    const lines = [];
    for (const [i, l] of input.lines.entries()) {
      const quantity = dec(l.quantity);
      if (l.articleId) {
        const a = await tx.article.findUnique({ where: { id: l.articleId } });
        if (!a || a.archivedAt) throw notOrderable('Artikel nicht gefunden', i);
        if (!a.active) throw notOrderable(`Artikel ${a.number} ist inaktiv`, i);
        if (a.kind === 'parent')
          throw notOrderable(`${a.number} ist ein Vaterartikel. Bitte eine Variante wählen`, i);
        const rate = taxRates.find((r) => r.id === a.taxRateId);
        const price = l.unitPriceNet
          ? { price: dec(l.unitPriceNet), specific: true }
          : await this.resolvePrice(tx, a, group?.id ?? null, quantity);
        const discount =
          l.discountPercent != null
            ? dec(l.discountPercent)
            : price.specific
              ? dec(0)
              : dec(group?.discountPercent ?? 0);
        const base = {
          articleId: a.id,
          articleNumber: a.number,
          name: l.name || a.name,
          unit: a.unit,
          quantity,
          unitPriceNet: price.price,
          discountPercent: discount,
          taxRate: dec(rate?.rate ?? defaultTax.rate),
        };
        lines.push({ ...base, ...lineAmounts(base) });
      } else {
        const rate = l.taxRateId ? taxRates.find((r) => r.id === l.taxRateId) : defaultTax;
        if (!rate)
          throw new AppError(422, 'VALIDATION_FAILED', 'Steuersatz nicht gefunden', [
            { path: `lines.${i}.taxRateId`, message: 'Steuersatz nicht gefunden' },
          ]);
        const base = {
          articleId: null,
          articleNumber: null,
          name: l.name!,
          unit: 'Stück',
          quantity,
          unitPriceNet: dec(l.unitPriceNet ?? 0),
          discountPercent: dec(l.discountPercent ?? 0),
          taxRate: dec(rate.rate),
        };
        lines.push({ ...base, ...lineAmounts(base) });
      }
    }
    const shippingNet = dec(input.shippingNet);
    const totals = summarize([
      ...lines.map((l) => ({ net: l.lineNet, taxRate: l.taxRate })),
      ...(shippingNet.isZero() ? [] : [{ net: shippingNet, taxRate: dec(defaultTax.rate) }]),
    ]);
    const details = await loadPartyDetails(tx, 'customer', customer.id);
    const pick = (kind: 'billing' | 'shipping') => {
      const a =
        details.addresses.find((x) => x.kind === kind && x.isDefault) ??
        details.addresses.find((x) => x.kind === kind);
      return a
        ? {
            name: a.name,
            name2: a.name2,
            street: a.street,
            postalCode: a.postalCode,
            city: a.city,
            country: a.country,
          }
        : null;
    };
    const billing = pick('billing');
    const snapshot: CustomerSnapshot = {
      number: customer.number,
      displayName: customerDisplayName(customer),
      type: customer.type,
      email: customer.email,
      vatId: customer.vatId,
      priceDisplay: group?.priceDisplay ?? 'gross',
      paymentTermsDays: customer.paymentTermsDays,
      billing,
      shipping: pick('shipping') ?? billing,
    };
    return {
      header: {
        customerId: customer.id,
        customerSnapshot: snapshot as unknown as Prisma.InputJsonValue,
        priceDisplay: snapshot.priceDisplay,
        warehouseId: warehouse.id,
        externalNumber: input.externalNumber,
        paymentMethod: input.paymentMethod,
        shippingMethod: input.shippingMethod,
        shippingNet,
        shippingTaxRate: dec(defaultTax.rate),
        totalNet: totals.totalNet,
        totalTax: totals.totalTax,
        totalGross: totals.totalGross,
        notes: input.notes,
      },
      lines,
    };
  }

  /**
   * Preisermittlung: Preis der Kundengruppe vor allgemeinem Staffelpreis vor Verkaufspreis.
   * Bei Staffeln gilt die höchste erreichte Mindestmenge. Varianten ohne eigene Preise erben vom Vaterartikel.
   */
  async resolvePrice(
    tx: Tx,
    article: { id: string; parentId: string | null; salePriceNet: Prisma.Decimal },
    groupId: string | null,
    quantity: Prisma.Decimal,
  ): Promise<{ price: Prisma.Decimal; specific: boolean }> {
    const ids = [article.id, ...(article.parentId ? [article.parentId] : [])];
    for (const articleId of ids) {
      const prices = await tx.articlePrice.findMany({
        where: { articleId, minQuantity: { lte: quantity } },
        orderBy: { minQuantity: 'desc' },
      });
      const forGroup = groupId ? prices.find((p) => p.customerGroupId === groupId) : undefined;
      if (forGroup) return { price: dec(forGroup.priceNet), specific: true };
      const general = prices.find((p) => !p.customerGroupId);
      if (general) return { price: dec(general.priceNet), specific: false };
    }
    let sale = dec(article.salePriceNet);
    if (sale.isZero() && article.parentId) {
      const parent = await tx.article.findUnique({ where: { id: article.parentId } });
      if (parent) sale = dec(parent.salePriceNet);
    }
    return { price: sale, specific: false };
  }

  private async writeLines(
    tx: Tx,
    c: CompanyContext,
    orderId: string,
    lines: Awaited<ReturnType<OrdersService['prepare']>>['lines'],
  ) {
    await tx.salesOrderLine.createMany({
      data: lines.map((l, i) => ({
        id: uuidv7(),
        accountId: c.account.id,
        companyId: c.companyId,
        orderId,
        position: i + 1,
        ...l,
      })),
    });
  }

  // ───── Reservierung ─────

  /** Bestandsbedarf je Position; Sets werden in ihre Komponenten aufgelöst. */
  async demands(tx: Tx, orderId: string): Promise<Demand[]> {
    const lines = await tx.salesOrderLine.findMany({
      where: { orderId, articleId: { not: null } },
      orderBy: { position: 'asc' },
    });
    if (!lines.length) return [];
    const articles = await tx.article.findMany({
      where: { id: { in: lines.map((l) => l.articleId!) } },
    });
    const out: Demand[] = [];
    for (const l of lines) {
      const a = articles.find((x) => x.id === l.articleId);
      if (!a) continue;
      if (a.kind === 'set') {
        const comps = await tx.setComponent.findMany({ where: { setArticleId: a.id } });
        const compArticles = await tx.article.findMany({
          where: { id: { in: comps.map((x) => x.componentArticleId) } },
        });
        for (const comp of comps) {
          const ca = compArticles.find((x) => x.id === comp.componentArticleId);
          if (ca?.stockTracked)
            out.push({
              lineId: l.id,
              articleId: ca.id,
              quantity: dec(l.quantity).times(comp.quantity),
              trackBatches: ca.trackBatches,
              trackSerials: ca.trackSerials,
            });
        }
      } else if (a.stockTracked) {
        out.push({
          lineId: l.id,
          articleId: a.id,
          quantity: dec(l.quantity),
          trackBatches: a.trackBatches,
          trackSerials: a.trackSerials,
        });
      }
    }
    return out;
  }

  private async reserve(tx: Tx, c: CompanyContext, order: SalesOrder) {
    const demands = await this.demands(tx, order.id);
    if (!demands.length) return;
    await tx.stockReservation.createMany({
      data: demands.map((d) => ({
        id: uuidv7(),
        accountId: c.account.id,
        companyId: c.companyId,
        articleId: d.articleId,
        warehouseId: order.warehouseId,
        orderId: order.id,
        orderLineId: d.lineId,
        quantity: d.quantity,
      })),
    });
  }

  private release(tx: Tx, orderId: string) {
    return tx.stockReservation.deleteMany({ where: { orderId } });
  }

  /**
   * Fehlmengen eines Auftrags. Verfügbar ist der Lagerbestand abzüglich der Reservierungen
   * älterer Aufträge (Reihenfolge nach Anlage, die IDs sind zeitlich sortiert).
   */
  async shortages(
    tx: Tx,
    c: CompanyContext,
    order: Pick<SalesOrder, 'id' | 'warehouseId'>,
  ): Promise<Shortage[]> {
    const rows = await tx.$queryRaw<
      { articleId: string; number: string; name: string; needed: string; available: string }[]
    >`
      WITH need AS (
        SELECT article_id, SUM(quantity) AS needed FROM stock_reservations
        WHERE company_id = ${c.companyId}::uuid AND order_id = ${order.id}::uuid
        GROUP BY article_id
      )
      SELECT n.article_id AS "articleId", a.number, a.name, n.needed::text AS needed,
        (COALESCE((SELECT SUM(l.quantity) FROM stock_levels l
                   WHERE l.company_id = ${c.companyId}::uuid AND l.article_id = n.article_id AND l.warehouse_id = ${order.warehouseId}::uuid), 0)
         - COALESCE((SELECT SUM(r.quantity) FROM stock_reservations r
                   WHERE r.company_id = ${c.companyId}::uuid AND r.article_id = n.article_id AND r.warehouse_id = ${order.warehouseId}::uuid
                     AND r.order_id < ${order.id}::uuid), 0))::text AS available
      FROM need n JOIN articles a ON a.id = n.article_id
      ORDER BY a.number`;
    return rows
      .filter((r) => dec(r.available).lessThan(dec(r.needed)))
      .map((r) => ({
        ...r,
        needed: dec(r.needed).toString(),
        available: dec(r.available).toString(),
      }));
  }

  private async requireStock(tx: Tx, c: CompanyContext, order: SalesOrder) {
    const settings = await tx.companySettings.findUnique({ where: { companyId: c.companyId } });
    if (settings?.allowNegativeStock) return;
    const missing = await this.shortages(tx, c, order);
    if (missing.length)
      throw new AppError(
        409,
        'CONFLICT',
        `Nicht genug Bestand für: ${missing.map((m) => `${m.number} (benötigt ${dec(m.needed).toString()}, verfügbar ${dec(m.available).toString()})`).join(', ')}`,
        missing.map((m) => ({ path: m.number, message: 'Nicht genug Bestand' })),
      );
  }

  // ───── Status ─────

  transition(t: TenantContext, id: string, to: OrderStatus, note: string | null) {
    return this.cdb.run(t, async (tx, c) => {
      await this.transitionInTx(tx, c, id, to, note);
      return this.load(tx, c, id);
    });
  }

  /** Versandart ändern (z. B. durch eine Regel), solange der Auftrag nicht versendet ist. */
  async setShippingMethodInTx(tx: Tx, c: CompanyContext, id: string, value: string, note: string) {
    const order = await tx.salesOrder.findUnique({ where: { id } });
    if (!order) throw Errors.notFound();
    if (['shipped', 'completed', 'cancelled'].includes(order.status))
      throw new AppError(409, 'CONFLICT', 'Der Auftrag ist bereits abgeschlossen');
    await tx.salesOrder.update({
      where: { id },
      data: { shippingMethod: value, updatedBy: c.user.id, version: { increment: 1 } },
    });
    await this.audit.record(
      tx,
      this.entry(c, 'order.updated', order, {
        shippingMethod: { from: order.shippingMethod, to: value },
        note,
      }),
    );
  }

  /** Statuswechsel innerhalb einer laufenden Transaktion (z. B. aus Picklisten). */
  async transitionInTx(
    tx: Tx,
    c: CompanyContext,
    id: string,
    to: OrderStatus,
    note: string | null,
  ) {
    {
      const order = await tx.salesOrder.findUnique({ where: { id } });
      if (!order) throw Errors.notFound();
      const from = order.status as OrderStatus;
      if (!canTransition(from, to))
        throw new AppError(
          409,
          'CONFLICT',
          `Statuswechsel von „${ORDER_STATUSES[from]}“ nach „${ORDER_STATUSES[to]}“ ist nicht erlaubt`,
        );
      if ((ORDER_NEEDS_STOCK as string[]).includes(to)) await this.requireStock(tx, c, order);
      await this.setStatus(tx, c, order, to, note);
      return order;
    }
  }

  /** Versand: bucht den Bestand im Auftragslager ab und gibt die Reservierungen frei. */
  ship(t: TenantContext, id: string, note: string | null) {
    return this.cdb.run(t, async (tx, c) => {
      await this.shipInTx(tx, c, id, note, []);
      return this.load(tx, c, id);
    });
  }

  /**
   * Versand innerhalb einer laufenden Transaktion (auch vom Packtisch genutzt).
   * `allocations` legt Charge/Seriennummer/Lagerplatz fest; der Rest wird automatisch entnommen
   * (Chargen: frühestes MHD zuerst). Seriennummern müssen immer angegeben werden.
   */
  async shipInTx(
    tx: Tx,
    c: CompanyContext,
    id: string,
    note: string | null,
    allocations: Allocation[],
  ): Promise<SalesOrder> {
    const order = await tx.salesOrder.findUnique({ where: { id } });
    if (!order) throw Errors.notFound();
    if (!(ORDER_SHIPPABLE as string[]).includes(order.status))
      throw new AppError(
        409,
        'CONFLICT',
        `Im Status „${ORDER_STATUSES[order.status as OrderStatus]}“ kann nicht versendet werden`,
      );
    await this.requireStock(tx, c, order);
    const demands = await this.demands(tx, id);
    const pool = allocations.map((a) => ({ ...a, left: dec(a.quantity) }));
    for (const d of demands) {
      let rest = d.quantity;
      for (const a of pool.filter(
        (x) => x.orderLineId === d.lineId && x.articleId === d.articleId && x.left.greaterThan(0),
      )) {
        if (rest.lessThanOrEqualTo(0)) break;
        const take = Prisma.Decimal.min(rest, a.left);
        await this.issue(tx, c, order, d.articleId, take, {
          batch: a.batch ?? null,
          serialNumber: a.serialNumber ?? null,
          locationId: a.locationId ?? null,
        });
        a.left = a.left.minus(take);
        rest = rest.minus(take);
      }
      if (rest.greaterThan(0)) {
        if (d.trackSerials)
          throw new AppError(
            409,
            'CONFLICT',
            'Für Artikel mit Seriennummern bitte über den Packtisch versenden und die Seriennummern scannen',
          );
        await this.issue(tx, c, order, d.articleId, rest, null, d.trackBatches);
      }
    }
    if (pool.some((a) => a.left.greaterThan(0)))
      throw new AppError(422, 'VALIDATION_FAILED', 'Es wurde mehr verpackt als bestellt');
    await this.release(tx, id);
    await this.setStatus(tx, c, order, 'shipped', note, { shippedAt: new Date() });
    return order;
  }

  /**
   * Bucht eine Menge im Auftragslager ab. Mit `lot` genau aus dieser Charge/SN (und ggf. diesem Platz),
   * sonst von Plätzen mit dem meisten Bestand bzw. bei Chargen mit dem frühesten MHD.
   */
  private async issue(
    tx: Tx,
    c: CompanyContext,
    order: SalesOrder,
    articleId: string,
    quantity: Prisma.Decimal,
    lot: { batch: string | null; serialNumber: string | null; locationId: string | null } | null,
    tracked = false,
  ) {
    const slots = await tx.$queryRaw<
      {
        locationId: string | null;
        batch: string | null;
        serialNumber: string | null;
        quantity: Prisma.Decimal;
      }[]
    >`
      SELECT location_id AS "locationId", batch, serial_number AS "serialNumber", quantity FROM stock_levels
      WHERE company_id = ${c.companyId}::uuid AND article_id = ${articleId}::uuid
        AND warehouse_id = ${order.warehouseId}::uuid AND quantity > 0
        AND (${lot === null} OR COALESCE(batch, '') = ${lot?.batch ?? ''})
        AND (${lot === null} OR COALESCE(serial_number, '') = ${lot?.serialNumber ?? ''})
        AND (${!lot?.locationId} OR location_id = ${lot?.locationId ?? null}::uuid)
      ORDER BY best_before ASC NULLS LAST, quantity DESC, location_id NULLS FIRST
      FOR UPDATE`;
    let rest = quantity;
    const extra = {
      referenceType: 'sales_order',
      referenceId: order.id,
      note: `Versand ${order.number}`,
    };
    for (const s of slots) {
      if (rest.lessThanOrEqualTo(0)) break;
      const take = Prisma.Decimal.min(rest, dec(s.quantity));
      await this.inventory.apply(
        tx,
        c,
        {
          articleId,
          warehouseId: order.warehouseId,
          locationId: s.locationId,
          batch: s.batch,
          serialNumber: s.serialNumber,
        },
        take.negated(),
        'issue',
        extra,
      );
      rest = rest.minus(take);
    }
    if (rest.greaterThan(0)) {
      if (lot?.serialNumber)
        throw new AppError(
          409,
          'CONFLICT',
          `Seriennummer ${lot.serialNumber} ist in diesem Lager nicht im Bestand`,
        );
      if (tracked || lot?.batch)
        throw new AppError(
          409,
          'CONFLICT',
          `Nicht genug Bestand${lot?.batch ? ` in Charge ${lot.batch}` : ' in Chargen'} für diesen Artikel`,
        );
      // Rest nur bei erlaubtem Minusbestand (apply prüft das)
      await this.inventory.apply(
        tx,
        c,
        { articleId, warehouseId: order.warehouseId, locationId: lot?.locationId ?? null },
        rest.negated(),
        'issue',
        extra,
      );
    }
  }

  cancel(t: TenantContext, id: string, reason: string) {
    return this.cdb.run(t, async (tx, c) => {
      const order = await tx.salesOrder.findUnique({ where: { id } });
      if (!order) throw Errors.notFound();
      if (['shipped', 'completed', 'cancelled'].includes(order.status))
        throw new AppError(
          409,
          'CONFLICT',
          `Ein Auftrag im Status „${ORDER_STATUSES[order.status as OrderStatus]}“ kann nicht storniert werden`,
        );
      if ((await openInvoiceCount(tx, id)) > 0)
        throw new AppError(
          409,
          'CONFLICT',
          'Zu diesem Auftrag gibt es eine Rechnung. Bitte zuerst eine Stornorechnung erstellen',
        );
      await this.release(tx, id);
      await this.setStatus(tx, c, order, 'cancelled', reason, { cancelReason: reason });
      return this.load(tx, c, id);
    });
  }

  private async setStatus(
    tx: Tx,
    c: CompanyContext,
    order: SalesOrder,
    to: OrderStatus,
    note: string | null,
    extra: Prisma.SalesOrderUpdateManyMutationInput = {},
  ) {
    const res = await tx.salesOrder.updateMany({
      where: { id: order.id, status: order.status },
      data: { status: to, updatedBy: c.user.id, version: { increment: 1 }, ...extra },
    });
    if (res.count === 0) throw Errors.versionConflict();
    await this.history(tx, c, order.id, order.status, to, note);
    await this.audit.record(
      tx,
      this.entry(
        c,
        `order.${to === 'shipped' ? 'shipped' : to === 'cancelled' ? 'cancelled' : 'status_changed'}`,
        order,
        {
          number: order.number,
          from: order.status,
          to,
          note,
        },
      ),
    );
  }

  private history(
    tx: Tx,
    c: CompanyContext,
    orderId: string,
    fromStatus: string | null,
    toStatus: string,
    note: string | null,
  ) {
    return tx.orderStatusHistory.create({
      data: {
        id: uuidv7(),
        accountId: c.account.id,
        companyId: c.companyId,
        orderId,
        fromStatus,
        toStatus,
        note,
        createdBy: c.user.id,
      },
    });
  }

  // ───── Kennzahlen ─────

  /** Offene Aufträge je Status und meistverkaufte Artikel (versendet, letzte 30 Tage). */
  stats(t: TenantContext) {
    return this.cdb.run(t, async (tx, c) => {
      const open = await tx.salesOrder.groupBy({
        by: ['status'],
        where: { status: { in: ORDER_RESERVING } },
        _count: { _all: true },
        _sum: { totalGross: true },
      });
      const since = new Date(Date.now() - 30 * 86_400_000);
      const top = await tx.$queryRaw<
        { articleId: string; number: string; name: string; quantity: string; net: string }[]
      >`
        SELECT l.article_id AS "articleId", MAX(l.article_number) AS number, MAX(l.name) AS name,
               SUM(l.quantity)::text AS quantity, SUM(l.line_net)::text AS net
        FROM sales_order_lines l JOIN sales_orders o ON o.id = l.order_id
        WHERE o.company_id = ${c.companyId}::uuid AND o.status IN ('shipped','completed')
          AND o.shipped_at >= ${since} AND l.article_id IS NOT NULL
        GROUP BY l.article_id
        ORDER BY SUM(l.line_net) DESC
        LIMIT 10`;
      return {
        open: open.map((g) => ({
          status: g.status,
          count: g._count._all,
          totalGross: (g._sum.totalGross ?? dec(0)).toString(),
        })),
        openCount: open.reduce((s, g) => s + g._count._all, 0),
        topSellers: top.map((r) => normalizeNumbers(r, ['quantity', 'net'])),
      };
    });
  }

  /** Auftrag für Belege laden (Kopf und Positionen). */
  async forDocument(tx: Tx, id: string) {
    const order = await tx.salesOrder.findUnique({ where: { id } });
    if (!order) throw Errors.notFound();
    const lines = await tx.salesOrderLine.findMany({
      where: { orderId: id },
      orderBy: { position: 'asc' },
    });
    return { order, lines };
  }

  private entry(
    c: CompanyContext,
    action: string,
    order: SalesOrder,
    data: Record<string, unknown>,
  ) {
    return {
      accountId: c.account.id,
      userId: c.user.id,
      companyId: c.companyId,
      action,
      entityType: 'order',
      entityId: order.id,
      data,
      ip: c.ip,
    };
  }

  private index(tx: Tx, o: SalesOrder) {
    const s = o.customerSnapshot as unknown as CustomerSnapshot;
    return this.search.upsert(tx, o.accountId, {
      entityType: 'order',
      entityId: o.id,
      companyId: o.companyId,
      permission: 'orders.read',
      title: `Auftrag ${o.number}`,
      subtitle: [s.displayName, s.number].filter(Boolean).join(' · '),
      body: [o.externalNumber, s.email].filter(Boolean).join(' '),
      url: `/orders?id=${o.id}`,
    });
  }
}
