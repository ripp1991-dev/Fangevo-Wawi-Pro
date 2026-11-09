import { Inject, Injectable } from '@nestjs/common';
import { Prisma, uuidv7, type PickList, type Tx } from '@fangevo/database';
import { canTransition, ORDER_STATUSES, type ListQuery, type OrderStatus } from '@fangevo/shared';
import { AuditService } from '../../core/audit/audit.service';
import { AppError, Errors } from '../../core/http/errors';
import { type TenantContext } from '../../core/http/context';
import { buildListArgs, type FieldSpec } from '../../core/lists/list-query';
import { CompanyDb, type CompanyContext } from '../common/company-db';
import { dec } from '../common/decimal';
import { type CustomerSnapshot, OrdersService } from '../orders/orders.service';

export const PICK_LIST_FIELDS: FieldSpec = {
  number: { kind: 'string', sortable: true },
  status: { kind: 'enum', sortable: true },
  warehouseId: { kind: 'enum' },
  createdAt: { kind: 'date', sortable: true },
  completedAt: { kind: 'date', sortable: true },
};

/**
 * Picklisten: fassen Aufträge zu einem Lagerrundgang zusammen und schlagen Lagerplatz und Charge vor
 * (Charge mit frühestem MHD zuerst). Der Bestand wird erst beim Versand abgebucht.
 */
@Injectable()
export class PickingService {
  constructor(
    @Inject(CompanyDb) private readonly cdb: CompanyDb,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(OrdersService) private readonly orders: OrdersService,
  ) {}

  list(t: TenantContext, q: ListQuery) {
    return this.cdb.run(t, async (tx) => {
      const args = buildListArgs(q, PICK_LIST_FIELDS, {
        search: ['number'],
        defaultSort: 'createdAt:desc',
      });
      const [items, total] = await Promise.all([
        tx.pickList.findMany({
          where: args.where,
          orderBy: args.orderBy,
          skip: args.skip,
          take: args.take,
        }),
        tx.pickList.count({ where: args.where }),
      ]);
      const counts = items.length
        ? await tx.pickListLine.groupBy({
            by: ['pickListId'],
            where: { pickListId: { in: items.map((i) => i.id) } },
            _count: { _all: true },
            _sum: { quantity: true, pickedQuantity: true },
          })
        : [];
      return {
        items: items.map((p) => {
          const c = counts.find((x) => x.pickListId === p.id);
          return {
            ...p,
            lineCount: c?._count._all ?? 0,
            quantity: (c?._sum.quantity ?? dec(0)).toString(),
            picked: (c?._sum.pickedQuantity ?? dec(0)).toString(),
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
    const pl = await tx.pickList.findUnique({ where: { id } });
    if (!pl) throw Errors.notFound();
    const lines = await tx.pickListLine.findMany({
      where: { pickListId: id },
      orderBy: { position: 'asc' },
    });
    const [locations, orders, warehouse] = await Promise.all([
      tx.storageLocation.findMany({
        where: { id: { in: lines.map((l) => l.locationId).filter((x): x is string => !!x) } },
        select: { id: true, code: true },
      }),
      tx.salesOrder.findMany({
        where: { id: { in: [...new Set(lines.map((l) => l.orderId))] } },
        select: { id: true, number: true, status: true, customerSnapshot: true },
      }),
      tx.warehouse.findUnique({
        where: { id: pl.warehouseId },
        select: { id: true, code: true, name: true },
      }),
    ]);
    return {
      ...pl,
      warehouse,
      orders: orders.map((o) => ({
        id: o.id,
        number: o.number,
        status: o.status,
        customerName: (o.customerSnapshot as unknown as CustomerSnapshot).displayName,
      })),
      lines: lines.map((l) => ({
        ...l,
        locationCode: locations.find((x) => x.id === l.locationId)?.code ?? null,
        orderNumber: orders.find((o) => o.id === l.orderId)?.number ?? null,
      })),
    };
  }

  /** Pickliste aus Aufträgen eines Lagers; die Aufträge wechseln auf „Kommissionierung“. */
  create(t: TenantContext, orderIds: string[]) {
    return this.cdb.run(t, async (tx, c) => {
      const ids = [...new Set(orderIds)];
      const orders = await tx.salesOrder.findMany({ where: { id: { in: ids } } });
      if (orders.length !== ids.length)
        throw new AppError(422, 'VALIDATION_FAILED', 'Mindestens ein Auftrag wurde nicht gefunden');
      const warehouseId = orders[0]!.warehouseId;
      for (const o of orders) {
        if (o.warehouseId !== warehouseId)
          throw new AppError(
            422,
            'VALIDATION_FAILED',
            'Alle Aufträge einer Pickliste müssen aus demselben Lager kommen',
          );
        const startable = ['new', 'unchecked'].includes(o.status);
        if (!startable && !canTransition(o.status as OrderStatus, 'picking'))
          throw new AppError(
            409,
            'CONFLICT',
            `Auftrag ${o.number} ist im Status „${ORDER_STATUSES[o.status as OrderStatus]}“ und kann nicht kommissioniert werden`,
          );
      }
      const used = await tx.pickListLine.findMany({
        where: { orderId: { in: ids } },
        select: { pickListId: true },
        distinct: ['pickListId'],
      });
      const busy = used.length
        ? await tx.pickList.findFirst({
            where: {
              id: { in: used.map((u) => u.pickListId) },
              status: { in: ['open', 'in_progress'] },
            },
          })
        : null;
      if (busy)
        throw new AppError(
          409,
          'CONFLICT',
          `Ein Auftrag steht bereits auf Pickliste ${busy.number}`,
        );

      const id = uuidv7();
      const number = await this.cdb.nextNumber(tx, c.companyId, 'pick_list');
      const pl = await tx.pickList.create({
        data: {
          id,
          accountId: c.account.id,
          companyId: c.companyId,
          number,
          warehouseId,
          createdBy: c.user.id,
        },
      });
      const rows: Prisma.PickListLineCreateManyInput[] = [];
      // Bereits für diese Liste verplanter Bestand je Lagerort (damit Vorschläge sich nicht überschneiden)
      const planned = new Map<string, Prisma.Decimal>();
      for (const o of [...orders].sort((a, b) => (a.id < b.id ? -1 : 1))) {
        // Neue Aufträge gehen zuerst in Bearbeitung; der Wechsel auf „Kommissionierung“
        // prüft die Verfügbarkeit (älteste Aufträge zuerst)
        if (['new', 'unchecked'].includes(o.status))
          await this.orders.transitionInTx(tx, c, o.id, 'in_progress', `Pickliste ${number}`);
        await this.orders.transitionInTx(tx, c, o.id, 'picking', `Pickliste ${number}`);
        for (const d of await this.orders.demands(tx, o.id)) {
          const article = await tx.article.findUnique({
            where: { id: d.articleId },
            select: { number: true, name: true },
          });
          const slots = await tx.$queryRaw<
            { locationId: string | null; batch: string | null; quantity: Prisma.Decimal }[]
          >`
            SELECT location_id AS "locationId", batch, SUM(quantity) AS quantity FROM stock_levels
            WHERE company_id = ${c.companyId}::uuid AND article_id = ${d.articleId}::uuid
              AND warehouse_id = ${warehouseId}::uuid AND quantity > 0
            GROUP BY location_id, batch, best_before
            ORDER BY best_before ASC NULLS LAST, SUM(quantity) DESC`;
          let rest = d.quantity;
          for (const s of slots) {
            if (rest.lessThanOrEqualTo(0)) break;
            const key = `${d.articleId}|${s.locationId ?? ''}|${s.batch ?? ''}`;
            const free = dec(s.quantity).minus(planned.get(key) ?? 0);
            if (free.lessThanOrEqualTo(0)) continue;
            const take = Prisma.Decimal.min(rest, free);
            planned.set(key, (planned.get(key) ?? dec(0)).plus(take));
            rows.push(this.row(c, id, o.id, d, article, take, s.locationId, s.batch));
            rest = rest.minus(take);
          }
          if (rest.greaterThan(0)) rows.push(this.row(c, id, o.id, d, article, rest, null, null));
        }
      }
      if (!rows.length)
        throw new AppError(422, 'VALIDATION_FAILED', 'Die Aufträge enthalten keine Lagerartikel');
      // Rundgang: nach Lagerplatz sortieren
      const codes = await tx.storageLocation.findMany({
        where: { id: { in: rows.map((r) => r.locationId).filter((x): x is string => !!x) } },
        select: { id: true, code: true },
      });
      const code = (r: Prisma.PickListLineCreateManyInput) =>
        codes.find((x) => x.id === r.locationId)?.code ?? '~';
      rows.sort(
        (a, b) =>
          code(a).localeCompare(code(b), 'de') || a.articleNumber.localeCompare(b.articleNumber),
      );
      await tx.pickListLine.createMany({ data: rows.map((r, i) => ({ ...r, position: i + 1 })) });
      await this.log(tx, c, 'pick_list.created', pl, {
        number,
        orders: orders.map((o) => o.number),
      });
      return this.load(tx, id);
    });
  }

  private row(
    c: CompanyContext,
    pickListId: string,
    orderId: string,
    d: { lineId: string; articleId: string },
    article: { number: string; name: string } | null,
    quantity: Prisma.Decimal,
    locationId: string | null,
    batch: string | null,
  ): Prisma.PickListLineCreateManyInput {
    return {
      id: uuidv7(),
      accountId: c.account.id,
      companyId: c.companyId,
      pickListId,
      position: 0,
      orderId,
      orderLineId: d.lineId,
      articleId: d.articleId,
      articleNumber: article?.number ?? '',
      name: article?.name ?? '',
      locationId,
      batch,
      quantity,
    };
  }

  /** Entnahme bestätigen (auch in Teilmengen). Abweichende Charge/Platz werden übernommen. */
  confirm(
    t: TenantContext,
    id: string,
    input: { lineId: string; quantity: string; locationId?: string | null; batch?: string | null },
  ) {
    return this.cdb.run(t, async (tx, c) => {
      const pl = await this.requireOpen(tx, id);
      const line = await tx.pickListLine.findUnique({ where: { id: input.lineId } });
      if (!line || line.pickListId !== id) throw Errors.notFound('Position nicht gefunden');
      const qty = dec(input.quantity);
      const open = dec(line.quantity).minus(line.pickedQuantity);
      if (qty.greaterThan(open))
        throw new AppError(422, 'VALIDATION_FAILED', `Höchstens ${open.toString()} offen`, [
          { path: 'quantity', message: `Höchstens ${open.toString()}` },
        ]);
      if (input.locationId) {
        const loc = await tx.storageLocation.findUnique({ where: { id: input.locationId } });
        if (!loc || loc.warehouseId !== pl.warehouseId)
          throw new AppError(422, 'VALIDATION_FAILED', 'Lagerplatz gehört nicht zu diesem Lager');
      }
      await tx.pickListLine.update({
        where: { id: line.id },
        data: {
          pickedQuantity: { increment: qty },
          ...(input.locationId ? { locationId: input.locationId } : {}),
          ...(input.batch ? { batch: input.batch } : {}),
        },
      });
      if (pl.status === 'open')
        await tx.pickList.update({
          where: { id },
          data: { status: 'in_progress', assignedTo: pl.assignedTo ?? c.user.id },
        });
      return this.load(tx, id);
    });
  }

  /** Abschluss: vollständig gepickte Aufträge gehen in „Verpackung“, die übrigen bleiben in „Kommissionierung“. */
  complete(t: TenantContext, id: string) {
    return this.cdb.run(t, async (tx, c) => {
      const pl = await this.requireOpen(tx, id);
      const lines = await tx.pickListLine.findMany({ where: { pickListId: id } });
      const incomplete = new Set(
        lines.filter((l) => dec(l.pickedQuantity).lessThan(l.quantity)).map((l) => l.orderId),
      );
      const done: string[] = [];
      for (const orderId of new Set(lines.map((l) => l.orderId))) {
        if (incomplete.has(orderId)) continue;
        const o = await tx.salesOrder.findUnique({ where: { id: orderId } });
        if (o?.status === 'picking') {
          await this.orders.transitionInTx(tx, c, orderId, 'packing', `Pickliste ${pl.number}`);
          done.push(o.number);
        }
      }
      await tx.pickList.update({
        where: { id },
        data: { status: 'done', completedAt: new Date() },
      });
      await this.log(tx, c, 'pick_list.completed', pl, {
        number: pl.number,
        packing: done,
        incomplete: incomplete.size,
      });
      return { ...(await this.load(tx, id)), incompleteOrders: incomplete.size };
    });
  }

  /** Stornieren: Aufträge in „Kommissionierung“ gehen zurück auf „In Bearbeitung“. */
  cancel(t: TenantContext, id: string) {
    return this.cdb.run(t, async (tx, c) => {
      const pl = await this.requireOpen(tx, id);
      const lines = await tx.pickListLine.findMany({ where: { pickListId: id } });
      for (const orderId of new Set(lines.map((l) => l.orderId))) {
        const o = await tx.salesOrder.findUnique({ where: { id: orderId } });
        if (o?.status === 'picking')
          await this.orders.transitionInTx(
            tx,
            c,
            orderId,
            'in_progress',
            `Pickliste ${pl.number} storniert`,
          );
      }
      await tx.pickList.update({ where: { id }, data: { status: 'cancelled' } });
      await this.log(tx, c, 'pick_list.cancelled', pl, { number: pl.number });
      return this.load(tx, id);
    });
  }

  /** Neueste Pickzeilen eines Auftrags (Vorschlag für Charge/Platz am Packtisch). */
  async latestLinesForOrder(tx: Tx, orderId: string) {
    const lines = await tx.pickListLine.findMany({
      where: { orderId },
      orderBy: { id: 'desc' },
    });
    if (!lines.length) return [];
    const newest = lines[0]!.pickListId;
    return lines.filter((l) => l.pickListId === newest);
  }

  private async requireOpen(tx: Tx, id: string): Promise<PickList> {
    const pl = await tx.pickList.findUnique({ where: { id } });
    if (!pl) throw Errors.notFound();
    if (!['open', 'in_progress'].includes(pl.status))
      throw new AppError(409, 'CONFLICT', 'Die Pickliste ist bereits abgeschlossen');
    return pl;
  }

  private log(
    tx: Tx,
    c: CompanyContext,
    action: string,
    pl: PickList,
    data: Record<string, unknown>,
  ) {
    return this.audit.record(tx, {
      accountId: c.account.id,
      userId: c.user.id,
      companyId: c.companyId,
      action,
      entityType: 'pick_list',
      entityId: pl.id,
      data,
      ip: c.ip,
    });
  }
}
