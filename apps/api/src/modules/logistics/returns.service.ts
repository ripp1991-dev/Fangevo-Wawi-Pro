import { Inject, Injectable } from '@nestjs/common';
import { type z } from 'zod';
import { type Prisma, uuidv7, type Return, type Tx } from '@fangevo/database';
import { type ListQuery, type returnCreateSchema, type returnReceiveSchema } from '@fangevo/shared';
import { AuditService } from '../../core/audit/audit.service';
import { AppError, Errors } from '../../core/http/errors';
import { type TenantContext } from '../../core/http/context';
import { buildListArgs, type FieldSpec } from '../../core/lists/list-query';
import { CompanyDb, type CompanyContext } from '../common/company-db';
import { dec } from '../common/decimal';
import { DocumentsService } from '../documents/documents.service';
import { InventoryService } from '../inventory/inventory.service';
import { type CustomerSnapshot } from '../orders/orders.service';

export const RETURN_FIELDS: FieldSpec = {
  number: { kind: 'string', sortable: true },
  status: { kind: 'enum', sortable: true },
  orderId: { kind: 'enum' },
  customerId: { kind: 'enum' },
  createdAt: { kind: 'date', sortable: true },
  receivedAt: { kind: 'date', sortable: true },
};

/**
 * Retouren: Anmeldung zu einem versendeten Auftrag, Wareneingang mit Zustand.
 * Wieder verkaufbare Ware wird über das Bestandsjournal (Buchungsart „return“) eingelagert;
 * auf Wunsch entsteht eine Gutschrift (Entwurf) zur Rechnung des Auftrags.
 */
@Injectable()
export class ReturnsService {
  constructor(
    @Inject(CompanyDb) private readonly cdb: CompanyDb,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(InventoryService) private readonly inventory: InventoryService,
    @Inject(DocumentsService) private readonly documents: DocumentsService,
  ) {}

  list(t: TenantContext, q: ListQuery) {
    return this.cdb.run(t, async (tx) => {
      const args = buildListArgs(q, RETURN_FIELDS, {
        search: ['number'],
        defaultSort: 'createdAt:desc',
      });
      const [items, total] = await Promise.all([
        tx.return.findMany({
          where: args.where,
          orderBy: args.orderBy,
          skip: args.skip,
          take: args.take,
        }),
        tx.return.count({ where: args.where }),
      ]);
      const orders = await tx.salesOrder.findMany({
        where: { id: { in: items.map((i) => i.orderId) } },
        select: { id: true, number: true, customerSnapshot: true },
      });
      return {
        items: items.map((r) => {
          const o = orders.find((x) => x.id === r.orderId);
          return {
            ...r,
            orderNumber: o?.number ?? null,
            customerName: o
              ? (o.customerSnapshot as unknown as CustomerSnapshot).displayName
              : null,
          };
        }),
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
    const r = await tx.return.findUnique({ where: { id } });
    if (!r) throw Errors.notFound();
    const [lines, order] = await Promise.all([
      tx.returnLine.findMany({ where: { returnId: id }, orderBy: { id: 'asc' } }),
      tx.salesOrder.findUnique({
        where: { id: r.orderId },
        select: { id: true, number: true, customerSnapshot: true, warehouseId: true },
      }),
    ]);
    return {
      ...r,
      lines,
      order: order
        ? {
            id: order.id,
            number: order.number,
            customerName: (order.customerSnapshot as unknown as CustomerSnapshot).displayName,
          }
        : null,
    };
  }

  /** Noch retournierbare Mengen je Auftragsposition (versendet minus bereits angemeldet). */
  async returnable(tx: Tx, orderId: string) {
    const lines = await tx.salesOrderLine.findMany({
      where: { orderId },
      orderBy: { position: 'asc' },
    });
    const prev = await tx.returnLine.findMany({
      where: { orderLineId: { in: lines.map((l) => l.id) } },
      select: { orderLineId: true, quantity: true, returnId: true },
    });
    const active = await tx.return.findMany({
      where: {
        id: { in: [...new Set(prev.map((p) => p.returnId))] },
        status: { not: 'cancelled' },
      },
      select: { id: true },
    });
    return lines.map((l) => {
      const used = prev
        .filter((p) => p.orderLineId === l.id && active.some((a) => a.id === p.returnId))
        .reduce((s, p) => s.plus(p.quantity), dec(0));
      return { line: l, open: dec(l.quantity).minus(used) };
    });
  }

  openLines(t: TenantContext, orderId: string) {
    return this.cdb.run(t, async (tx) => {
      const order = await tx.salesOrder.findUnique({ where: { id: orderId } });
      if (!order) throw Errors.notFound();
      return (await this.returnable(tx, orderId)).map(({ line, open }) => ({
        orderLineId: line.id,
        articleNumber: line.articleNumber,
        name: line.name,
        unit: line.unit,
        ordered: line.quantity.toString(),
        returnable: open.toString(),
      }));
    });
  }

  create(t: TenantContext, input: z.infer<typeof returnCreateSchema>) {
    return this.cdb.run(t, async (tx, c) => {
      const order = await tx.salesOrder.findUnique({ where: { id: input.orderId } });
      if (!order) throw Errors.notFound('Auftrag nicht gefunden');
      if (!['shipped', 'completed'].includes(order.status))
        throw new AppError(409, 'CONFLICT', 'Retouren sind nur für versendete Aufträge möglich');
      const avail = await this.returnable(tx, order.id);
      const rows: Prisma.ReturnLineCreateManyInput[] = [];
      const id = uuidv7();
      for (const [i, l] of input.lines.entries()) {
        const a = avail.find((x) => x.line.id === l.orderLineId);
        if (!a)
          throw new AppError(422, 'VALIDATION_FAILED', 'Position gehört nicht zum Auftrag', [
            { path: `lines.${i}.orderLineId`, message: 'Unbekannte Position' },
          ]);
        if (dec(l.quantity).greaterThan(a.open))
          throw new AppError(
            422,
            'VALIDATION_FAILED',
            `Höchstens ${a.open.toString()} retournierbar`,
            [{ path: `lines.${i}.quantity`, message: `Höchstens ${a.open.toString()}` }],
          );
        rows.push({
          id: uuidv7(),
          accountId: c.account.id,
          companyId: c.companyId,
          returnId: id,
          orderLineId: a.line.id,
          articleId: a.line.articleId,
          articleNumber: a.line.articleNumber,
          name: a.line.name,
          quantity: dec(l.quantity),
        });
      }
      const number = await this.cdb.nextNumber(tx, c.companyId, 'return');
      const r = await tx.return.create({
        data: {
          id,
          accountId: c.account.id,
          companyId: c.companyId,
          number,
          orderId: order.id,
          customerId: order.customerId,
          warehouseId: order.warehouseId,
          reason: input.reason,
          notes: input.notes,
          createdBy: c.user.id,
        },
      });
      await tx.returnLine.createMany({ data: rows });
      await this.log(tx, c, 'return.created', r, { number, order: order.number });
      return this.load(tx, id);
    });
  }

  /** Wareneingang der Retoure: Zustand je Position, Einlagerung, optional Gutschrift. */
  receive(t: TenantContext, id: string, input: z.infer<typeof returnReceiveSchema>) {
    return this.cdb.run(t, async (tx, c) => {
      const r = await tx.return.findUnique({ where: { id } });
      if (!r) throw Errors.notFound();
      if (r.status !== 'open')
        throw new AppError(409, 'CONFLICT', 'Die Retoure ist bereits bearbeitet');
      const lines = await tx.returnLine.findMany({ where: { returnId: id } });
      if (
        input.lines.length !== lines.length ||
        lines.some((l) => !input.lines.some((x) => x.lineId === l.id))
      )
        throw new AppError(422, 'VALIDATION_FAILED', 'Bitte für jede Position den Zustand angeben');
      for (const [i, sel] of input.lines.entries()) {
        const line = lines.find((l) => l.id === sel.lineId)!;
        await tx.returnLine.update({
          where: { id: line.id },
          data: {
            condition: sel.condition,
            locationId: sel.locationId ?? null,
            batch: sel.batch,
            serialNumber: sel.serialNumber,
          },
        });
        if (sel.condition !== 'resell' || !line.articleId) continue;
        const article = await tx.article.findUnique({ where: { id: line.articleId } });
        if (!article) continue;
        // Sets: Komponenten einlagern; Artikel ohne Bestandsführung: nichts buchen
        const parts =
          article.kind === 'set'
            ? (await tx.setComponent.findMany({ where: { setArticleId: article.id } })).map(
                (sc) => ({
                  articleId: sc.componentArticleId,
                  quantity: dec(line.quantity).times(sc.quantity),
                }),
              )
            : [{ articleId: article.id, quantity: dec(line.quantity) }];
        for (const p of parts) {
          const slot = {
            articleId: p.articleId,
            warehouseId: r.warehouseId,
            locationId: sel.locationId ?? null,
            batch: sel.batch,
            serialNumber: sel.serialNumber,
          };
          const a = await tx.article.findUnique({ where: { id: p.articleId } });
          if (!a?.stockTracked) continue;
          try {
            await this.inventory.checkSlot(tx, slot);
            this.inventory.checkTracking(a, 'return', p.quantity, sel);
          } catch (e) {
            if (e instanceof AppError)
              throw new AppError(
                e.getStatus(),
                e.code,
                `Position ${i + 1} (${line.name}): ${e.message}`,
                e.errors,
              );
            throw e;
          }
          await this.inventory.apply(tx, c, slot, p.quantity, 'return', {
            referenceType: 'return',
            referenceId: r.id,
            note: `Retoure ${r.number}`,
          });
        }
      }
      let creditNoteId: string | null = null;
      if (input.createCreditNote) {
        const invoice = await tx.document.findFirst({
          where: {
            orderId: r.orderId,
            type: 'invoice',
            status: 'finalized',
            paymentStatus: { not: 'cancelled' },
          },
        });
        if (!invoice)
          throw new AppError(
            409,
            'CONFLICT',
            'Zum Auftrag gibt es keine festgeschriebene Rechnung für eine Gutschrift',
          );
        const orderLines = await tx.salesOrderLine.findMany({
          where: { orderId: r.orderId },
          orderBy: { position: 'asc' },
        });
        // Rechnungspositionen entsprechen den Auftragspositionen in gleicher Reihenfolge
        const doc = await this.documents.creditNoteInTx(tx, c, invoice.id, {
          lines: lines.map((l) => ({
            index: orderLines.findIndex((o) => o.id === l.orderLineId),
            quantity: l.quantity.toString(),
          })),
          reason: `Retoure ${r.number}${r.reason ? `: ${r.reason}` : ''}`,
        });
        creditNoteId = doc.id;
      }
      await tx.return.update({
        where: { id },
        data: { status: 'received', receivedAt: new Date(), creditNoteId },
      });
      await this.log(tx, c, 'return.received', r, {
        number: r.number,
        resell: input.lines.filter((l) => l.condition === 'resell').length,
        creditNote: !!creditNoteId,
      });
      return this.load(tx, id);
    });
  }

  cancel(t: TenantContext, id: string) {
    return this.cdb.run(t, async (tx, c) => {
      const r = await tx.return.findUnique({ where: { id } });
      if (!r) throw Errors.notFound();
      if (r.status !== 'open')
        throw new AppError(409, 'CONFLICT', 'Nur angemeldete Retouren können storniert werden');
      await tx.return.update({ where: { id }, data: { status: 'cancelled' } });
      await this.log(tx, c, 'return.cancelled', r, { number: r.number });
      return this.load(tx, id);
    });
  }

  private log(tx: Tx, c: CompanyContext, action: string, r: Return, data: Record<string, unknown>) {
    return this.audit.record(tx, {
      accountId: c.account.id,
      userId: c.user.id,
      companyId: c.companyId,
      action,
      entityType: 'order',
      entityId: r.orderId,
      data: { ...data, returnId: r.id },
      ip: c.ip,
    });
  }
}
