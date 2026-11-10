import { Inject, Injectable } from '@nestjs/common';
import { type z } from 'zod';
import { type Prisma, uuidv7, type PurchaseOrder, type Tx } from '@fangevo/database';
import {
  PURCHASE_STATUSES,
  type goodsReceiptSchema,
  type ListQuery,
  type PurchaseStatus,
  type purchaseOrderInputSchema,
  type sendDocumentSchema,
} from '@fangevo/shared';
import { AuditService } from '../../core/audit/audit.service';
import { AppError, Errors } from '../../core/http/errors';
import { type TenantContext } from '../../core/http/context';
import { buildListArgs, type FieldSpec } from '../../core/lists/list-query';
import { MailService } from '../../core/mail/mail.service';
import { SearchService } from '../../core/search/search.service';
import { CompanyDb, type CompanyContext } from '../common/company-db';
import { dec, normalizeNumbers } from '../common/decimal';
import { loadPartyDetails } from '../common/parties';
import { round2 } from '../common/totals';
import { renderDocumentPdf } from '../documents/document-pdf';
import { DocumentsService } from '../documents/documents.service';
import { InventoryService } from '../inventory/inventory.service';

type PurchaseInput = z.infer<typeof purchaseOrderInputSchema>;

export const PURCHASE_FIELDS: FieldSpec = {
  number: { kind: 'string', sortable: true },
  status: { kind: 'enum', sortable: true },
  supplierId: { kind: 'enum' },
  expectedDate: { kind: 'date', sortable: true },
  orderedAt: { kind: 'date', sortable: true },
  totalNet: { kind: 'number', sortable: true },
  createdAt: { kind: 'date', sortable: true },
};

/**
 * Einkauf: Bestellvorschläge, Bestellungen an Lieferanten und Wareneingang.
 * Der Wareneingang bucht den Bestand über das Bestandsjournal (InventoryService.apply).
 */
@Injectable()
export class PurchasingService {
  constructor(
    @Inject(CompanyDb) private readonly cdb: CompanyDb,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(SearchService) private readonly search: SearchService,
    @Inject(InventoryService) private readonly inventory: InventoryService,
    @Inject(MailService) private readonly mail: MailService,
    @Inject(DocumentsService) private readonly documents: DocumentsService,
  ) {}

  list(t: TenantContext, q: ListQuery) {
    return this.cdb.run(t, async (tx) => {
      const args = buildListArgs(q, PURCHASE_FIELDS, {
        search: ['number'],
        defaultSort: 'createdAt:desc',
      });
      const [items, total] = await Promise.all([
        tx.purchaseOrder.findMany({
          where: args.where,
          orderBy: args.orderBy,
          skip: args.skip,
          take: args.take,
        }),
        tx.purchaseOrder.count({ where: args.where }),
      ]);
      const suppliers = await tx.supplier.findMany({
        where: { id: { in: [...new Set(items.map((i) => i.supplierId))] } },
        select: { id: true, number: true, name: true },
      });
      return {
        items: items.map((p) => ({
          ...p,
          supplier: suppliers.find((s) => s.id === p.supplierId) ?? null,
        })),
        total,
        page: q.page,
        pageSize: q.pageSize,
      };
    });
  }

  get(t: TenantContext, id: string) {
    return this.cdb.run(t, (tx) => this.load(tx, id));
  }

  private async load(tx: Tx, id: string) {
    const po = await tx.purchaseOrder.findUnique({ where: { id } });
    if (!po) throw Errors.notFound();
    const [lines, receipts, supplier, warehouse] = await Promise.all([
      tx.purchaseOrderLine.findMany({
        where: { purchaseOrderId: id },
        orderBy: { position: 'asc' },
      }),
      tx.goodsReceipt.findMany({ where: { purchaseOrderId: id }, orderBy: { createdAt: 'asc' } }),
      tx.supplier.findUnique({
        where: { id: po.supplierId },
        select: { id: true, number: true, name: true, email: true },
      }),
      tx.warehouse.findUnique({
        where: { id: po.warehouseId },
        select: { id: true, code: true, name: true },
      }),
    ]);
    return { ...po, lines, receipts, supplier, warehouse };
  }

  /**
   * Bestellvorschläge: Artikel, deren verfügbarer Bestand (Bestand − Reservierungen + offene
   * Bestellmengen) unter dem Mindestbestand liegt. Vorgeschlagen wird der bevorzugte bzw.
   * günstigste Lieferant; die Menge wird auf dessen Mindestbestellmenge aufgerundet.
   */
  async suggestions(t: TenantContext) {
    const rows = await this.cdb.run(
      t,
      (tx, c) =>
        tx.$queryRaw<
          {
            articleId: string;
            number: string;
            name: string;
            unit: string;
            minStock: string;
            stock: string;
            reserved: string;
            incoming: string;
            suggested: string;
            supplierId: string | null;
            supplierName: string | null;
            supplierSku: string | null;
            purchasePriceNet: string | null;
          }[]
        >`
        WITH st AS (
          SELECT article_id, SUM(quantity) AS q FROM stock_levels
          WHERE company_id = ${c.companyId}::uuid GROUP BY article_id
        ), rs AS (
          SELECT article_id, SUM(quantity) AS q FROM stock_reservations
          WHERE company_id = ${c.companyId}::uuid GROUP BY article_id
        ), inc AS (
          SELECT pl.article_id, SUM(pl.quantity - pl.received_quantity) AS q
          FROM purchase_order_lines pl JOIN purchase_orders po ON po.id = pl.purchase_order_id
          WHERE pl.company_id = ${c.companyId}::uuid AND po.status IN ('draft','ordered','partially_received')
          GROUP BY pl.article_id
        ), s AS (
          SELECT a.id, a.number, a.name, a.unit, a.min_stock,
            COALESCE(st.q, 0) AS stock, COALESCE(rs.q, 0) AS reserved, COALESCE(inc.q, 0) AS incoming
          FROM articles a
          LEFT JOIN st ON st.article_id = a.id
          LEFT JOIN rs ON rs.article_id = a.id
          LEFT JOIN inc ON inc.article_id = a.id
          WHERE a.company_id = ${c.companyId}::uuid AND a.archived_at IS NULL AND a.active AND a.stock_tracked
            AND a.kind IN ('standard','variant') AND a.min_stock > 0
        )
        SELECT s.id AS "articleId", s.number, s.name, s.unit, s.min_stock::text AS "minStock",
          s.stock::text AS stock, s.reserved::text AS reserved, s.incoming::text AS incoming,
          GREATEST(s.min_stock - (s.stock - s.reserved + s.incoming), COALESCE(sa.min_order_quantity, 0))::text AS suggested,
          sa.supplier_id AS "supplierId", sup.name AS "supplierName", sa.supplier_sku AS "supplierSku",
          sa.purchase_price_net::text AS "purchasePriceNet"
        FROM s
        LEFT JOIN LATERAL (
          SELECT * FROM supplier_articles x WHERE x.company_id = ${c.companyId}::uuid AND x.article_id = s.id
          ORDER BY x.is_preferred DESC, x.purchase_price_net ASC LIMIT 1
        ) sa ON true
        LEFT JOIN suppliers sup ON sup.id = sa.supplier_id
        WHERE s.stock - s.reserved + s.incoming < s.min_stock
        ORDER BY sup.name NULLS LAST, s.number
        LIMIT 1000`,
    );
    return rows.map((r) =>
      normalizeNumbers(r, [
        'minStock',
        'stock',
        'reserved',
        'incoming',
        'suggested',
        'purchasePriceNet',
      ]),
    );
  }

  create(t: TenantContext, input: PurchaseInput) {
    return this.cdb.run(t, async (tx, c) => {
      const p = await this.prepare(tx, input);
      const id = uuidv7();
      const number = await this.cdb.nextNumber(tx, c.companyId, 'purchase_order');
      const po = await tx.purchaseOrder.create({
        data: {
          id,
          accountId: c.account.id,
          companyId: c.companyId,
          number,
          status: 'draft',
          ...p.header,
          createdBy: c.user.id,
        },
      });
      await this.writeLines(tx, c, id, p.lines);
      await this.log(tx, c, 'purchase_order.created', po, { number });
      await this.index(tx, po, p.supplierName);
      return this.load(tx, id);
    });
  }

  update(t: TenantContext, id: string, input: PurchaseInput, version: number) {
    return this.cdb.run(t, async (tx, c) => {
      const current = await tx.purchaseOrder.findUnique({ where: { id } });
      if (!current) throw Errors.notFound();
      if (current.status !== 'draft')
        throw new AppError(409, 'CONFLICT', 'Nur Entwürfe können geändert werden');
      const p = await this.prepare(tx, input);
      const r = await tx.purchaseOrder.updateMany({
        where: { id, version },
        data: { ...p.header, version: { increment: 1 } },
      });
      if (!r.count) throw Errors.versionConflict();
      await tx.purchaseOrderLine.deleteMany({ where: { purchaseOrderId: id } });
      await this.writeLines(tx, c, id, p.lines);
      const po = (await tx.purchaseOrder.findUnique({ where: { id } }))!;
      await this.log(tx, c, 'purchase_order.updated', po, {});
      await this.index(tx, po, p.supplierName);
      return this.load(tx, id);
    });
  }

  private async prepare(tx: Tx, input: PurchaseInput) {
    const supplier = await tx.supplier.findUnique({ where: { id: input.supplierId } });
    if (!supplier || supplier.archivedAt)
      throw new AppError(422, 'VALIDATION_FAILED', 'Lieferant nicht gefunden', [
        { path: 'supplierId', message: 'Lieferant nicht gefunden' },
      ]);
    const warehouse = input.warehouseId
      ? await tx.warehouse.findUnique({ where: { id: input.warehouseId } })
      : await tx.warehouse.findFirst({ where: { isDefault: true, archivedAt: null } });
    if (!warehouse || warehouse.archivedAt)
      throw new AppError(422, 'VALIDATION_FAILED', 'Lager nicht gefunden', [
        { path: 'warehouseId', message: 'Lager nicht gefunden' },
      ]);
    const lines = [];
    for (const [i, l] of input.lines.entries()) {
      const a = await tx.article.findUnique({ where: { id: l.articleId } });
      const bad = (msg: string) =>
        new AppError(422, 'VALIDATION_FAILED', msg, [
          { path: `lines.${i}.articleId`, message: msg },
        ]);
      if (!a || a.archivedAt) throw bad('Artikel nicht gefunden');
      if (!a.stockTracked || a.kind === 'parent' || a.kind === 'set')
        throw bad(`${a.number}: Für diesen Artikel wird kein Bestand geführt`);
      const sa = await tx.supplierArticle.findUnique({
        where: { supplierId_articleId: { supplierId: supplier.id, articleId: a.id } },
      });
      const quantity = dec(l.quantity);
      const unitPriceNet = dec(l.unitPriceNet ?? sa?.purchasePriceNet ?? a.purchasePriceNet);
      lines.push({
        articleId: a.id,
        articleNumber: a.number,
        supplierSku: sa?.supplierSku ?? null,
        name: a.name,
        unit: a.unit,
        quantity,
        unitPriceNet,
        lineNet: round2(quantity.times(unitPriceNet)),
      });
    }
    return {
      supplierName: supplier.name,
      header: {
        supplierId: supplier.id,
        warehouseId: warehouse.id,
        expectedDate: input.expectedDate ? new Date(input.expectedDate) : null,
        notes: input.notes,
        totalNet: lines.reduce((s, l) => s.plus(l.lineNet), dec(0)),
      },
      lines,
    };
  }

  private writeLines(
    tx: Tx,
    c: CompanyContext,
    purchaseOrderId: string,
    lines: Awaited<ReturnType<PurchasingService['prepare']>>['lines'],
  ) {
    return tx.purchaseOrderLine.createMany({
      data: lines.map((l, i) => ({
        id: uuidv7(),
        accountId: c.account.id,
        companyId: c.companyId,
        purchaseOrderId,
        position: i + 1,
        ...l,
      })),
    });
  }

  /** Bestellung auslösen (Entwurf → Bestellt). */
  markOrdered(t: TenantContext, id: string) {
    return this.cdb.run(t, async (tx, c) => {
      await this.setOrdered(tx, c, id);
      return this.load(tx, id);
    });
  }

  private async setOrdered(tx: Tx, c: CompanyContext, id: string) {
    const po = await tx.purchaseOrder.findUnique({ where: { id } });
    if (!po) throw Errors.notFound();
    if (po.status !== 'draft') return po;
    const r = await tx.purchaseOrder.updateMany({
      where: { id, status: 'draft' },
      data: { status: 'ordered', orderedAt: new Date(), version: { increment: 1 } },
    });
    if (!r.count) throw Errors.versionConflict();
    await this.log(tx, c, 'purchase_order.ordered', po, { number: po.number });
    return po;
  }

  cancel(t: TenantContext, id: string) {
    return this.cdb.run(t, async (tx, c) => {
      const po = await tx.purchaseOrder.findUnique({ where: { id } });
      if (!po) throw Errors.notFound();
      if (!['draft', 'ordered'].includes(po.status))
        throw new AppError(
          409,
          'CONFLICT',
          `Im Status „${PURCHASE_STATUSES[po.status as PurchaseStatus]}“ kann nicht storniert werden`,
        );
      const r = await tx.purchaseOrder.updateMany({
        where: { id, status: po.status },
        data: { status: 'cancelled', version: { increment: 1 } },
      });
      if (!r.count) throw Errors.versionConflict();
      await this.log(tx, c, 'purchase_order.cancelled', po, { number: po.number });
      return this.load(tx, id);
    });
  }

  /** Wareneingang (auch teilweise): bucht Bestand und schreibt den Eingang fest. */
  receive(t: TenantContext, id: string, input: z.infer<typeof goodsReceiptSchema>) {
    return this.cdb.run(t, async (tx, c) => {
      const rows = await tx.$queryRaw<{ status: string }[]>`
        SELECT status FROM purchase_orders WHERE id = ${id}::uuid FOR UPDATE`;
      const po = await tx.purchaseOrder.findUnique({ where: { id } });
      if (!po || !rows[0]) throw Errors.notFound();
      if (!['ordered', 'partially_received'].includes(po.status))
        throw new AppError(
          409,
          'CONFLICT',
          po.status === 'draft'
            ? 'Bitte die Bestellung zuerst auslösen'
            : `Im Status „${PURCHASE_STATUSES[po.status as PurchaseStatus]}“ ist kein Wareneingang möglich`,
        );
      const lines = await tx.purchaseOrderLine.findMany({ where: { purchaseOrderId: id } });
      const booked: Record<string, unknown>[] = [];
      for (const [i, r] of input.lines.entries()) {
        const line = lines.find((l) => l.id === r.lineId);
        if (!line)
          throw new AppError(422, 'VALIDATION_FAILED', 'Position gehört nicht zur Bestellung', [
            { path: `lines.${i}.lineId`, message: 'Unbekannte Position' },
          ]);
        const qty = dec(r.quantity);
        const open = dec(line.quantity).minus(line.receivedQuantity);
        if (qty.greaterThan(open))
          throw new AppError(
            422,
            'VALIDATION_FAILED',
            `${line.articleNumber}: höchstens ${open.toString()} offen`,
            [{ path: `lines.${i}.quantity`, message: `Höchstens ${open.toString()}` }],
          );
        const slot = {
          articleId: line.articleId,
          warehouseId: po.warehouseId,
          locationId: r.locationId ?? null,
        };
        const article = await this.inventory.checkSlot(tx, slot, true);
        this.inventory.checkTracking(article, 'receipt', qty, r);
        const balance = await this.inventory.apply(tx, c, slot, qty, 'receipt', {
          batch: r.batch,
          serialNumber: r.serialNumber,
          bestBefore: r.bestBefore,
          note: `Wareneingang ${po.number}`,
          referenceType: 'purchase_order',
          referenceId: po.id,
        });
        await tx.purchaseOrderLine.update({
          where: { id: line.id },
          data: { receivedQuantity: { increment: qty } },
        });
        line.receivedQuantity = dec(line.receivedQuantity).plus(qty);
        booked.push({
          lineId: line.id,
          articleId: line.articleId,
          articleNumber: line.articleNumber,
          quantity: qty.toString(),
          locationId: slot.locationId,
          batch: r.batch ?? null,
          serialNumber: r.serialNumber ?? null,
          bestBefore: r.bestBefore ?? null,
          balance: balance.toString(),
        });
      }
      const complete = lines.every((l) => dec(l.receivedQuantity).greaterThanOrEqualTo(l.quantity));
      await tx.purchaseOrder.update({
        where: { id },
        data: { status: complete ? 'received' : 'partially_received', version: { increment: 1 } },
      });
      await tx.goodsReceipt.create({
        data: {
          id: uuidv7(),
          accountId: c.account.id,
          companyId: c.companyId,
          purchaseOrderId: id,
          lines: booked as Prisma.InputJsonValue,
          note: input.note,
          createdBy: c.user.id,
        },
      });
      await this.log(tx, c, 'purchase_order.received', po, {
        number: po.number,
        lines: booked.length,
        complete,
      });
      return this.load(tx, id);
    });
  }

  pdf(t: TenantContext, id: string) {
    return this.cdb.run(t, (tx, c) => this.renderPdf(tx, c, id));
  }

  private async renderPdf(tx: Tx, c: CompanyContext, id: string) {
    const po = await this.load(tx, id);
    const sender = await this.documents.sender(tx, c);
    const supplier = await tx.supplier.findUnique({ where: { id: po.supplierId } });
    const details = await loadPartyDetails(tx, 'supplier', po.supplierId);
    const addr =
      details.addresses.find((a) => a.kind === 'billing' && a.isDefault) ?? details.addresses[0];
    const content = await renderDocumentPdf({
      type: 'purchase_order',
      number: po.number,
      draft: po.status === 'draft',
      issueDate: po.orderedAt ?? new Date(),
      serviceDate: null,
      dueDate: null,
      sender,
      recipient: {
        address: {
          name: addr?.name ?? supplier?.name ?? null,
          name2: addr?.name2 ?? null,
          street: addr?.street ?? null,
          postalCode: addr?.postalCode ?? null,
          city: addr?.city ?? null,
          country: addr?.country ?? 'DE',
        },
        customerNumber: null,
      },
      reference: [
        ...(supplier?.customerNumber
          ? [{ label: 'Unsere Kundennr.', value: supplier.customerNumber }]
          : []),
        ...(po.expectedDate
          ? [
              {
                label: 'Liefertermin',
                value: new Intl.DateTimeFormat('de-DE').format(po.expectedDate),
              },
            ]
          : []),
        ...(po.warehouse ? [{ label: 'Lieferung an', value: po.warehouse.name }] : []),
      ],
      priceDisplay: 'net',
      showPrices: true,
      showTax: false,
      lines: po.lines.map((l) => ({
        articleNumber: l.supplierSku ?? l.articleNumber,
        name: l.name,
        unit: l.unit,
        quantity: l.quantity.toString(),
        unitPriceNet: l.unitPriceNet.toString(),
        discountPercent: '0',
        taxRate: '0',
        lineNet: l.lineNet.toFixed(2),
        lineGross: l.lineNet.toFixed(2),
      })),
      taxSummary: [],
      totalNet: dec(po.totalNet).toFixed(2),
      totalTax: '0.00',
      totalGross: dec(po.totalNet).toFixed(2),
      intro: 'Wir bestellen zu den vereinbarten Konditionen (Preise netto):',
      notes: po.notes,
      currency: sender.currency,
    });
    return { po, content, filename: `Bestellung-${po.number}.pdf`, sender };
  }

  /** Bestellung per E-Mail an den Lieferanten senden; ein Entwurf wird dabei ausgelöst. */
  send(t: TenantContext, id: string, input: z.infer<typeof sendDocumentSchema>) {
    return this.cdb.run(t, async (tx, c) => {
      const before = await tx.purchaseOrder.findUnique({ where: { id } });
      if (!before) throw Errors.notFound();
      if (['cancelled', 'received'].includes(before.status))
        throw new AppError(409, 'CONFLICT', 'Diese Bestellung kann nicht mehr versendet werden');
      await this.setOrdered(tx, c, id);
      const { po, content, filename, sender } = await this.renderPdf(tx, c, id);
      await this.mail.send({
        to: input.to,
        subject: input.subject ?? `Bestellung ${po.number} – ${sender.legalName || sender.name}`,
        text:
          input.message ??
          `Guten Tag,\n\nanbei erhalten Sie unsere Bestellung ${po.number}. Bitte bestätigen Sie den Liefertermin.\n\nMit freundlichen Grüßen\n${sender.legalName || sender.name}`,
        attachments: [{ filename, content, contentType: 'application/pdf' }],
      });
      await this.log(tx, c, 'purchase_order.sent', po, { number: po.number, to: input.to });
      return this.load(tx, id);
    });
  }

  private log(
    tx: Tx,
    c: CompanyContext,
    action: string,
    po: PurchaseOrder,
    data: Record<string, unknown>,
  ) {
    return this.audit.record(tx, {
      accountId: c.account.id,
      userId: c.user.id,
      companyId: c.companyId,
      action,
      entityType: 'purchase_order',
      entityId: po.id,
      data,
      ip: c.ip,
    });
  }

  private index(tx: Tx, po: PurchaseOrder, supplierName: string) {
    return this.search.upsert(tx, po.accountId, {
      entityType: 'purchase_order',
      entityId: po.id,
      companyId: po.companyId,
      permission: 'purchasing.read',
      title: `Bestellung ${po.number}`,
      subtitle: supplierName,
      url: `/purchasing?id=${po.id}`,
    });
  }
}
