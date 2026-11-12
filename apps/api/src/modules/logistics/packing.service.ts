import { Inject, Injectable } from '@nestjs/common';
import { type z } from 'zod';
import { type Prisma, uuidv7, type Shipment, type Tx } from '@fangevo/database';
import {
  NO_CHANNEL,
  ORDER_SHIPPABLE,
  ORDER_STATUSES,
  PACKING_PROBLEMS,
  type ListQuery,
  type PackingProblem,
  type OrderStatus,
  type PackComplete,
  type PackingQueueStage,
  type PackingRules,
  type packingQueueQuerySchema,
  type packingStationInputSchema,
} from '@fangevo/shared';
import { AuditService } from '../../core/audit/audit.service';
import { AppError, Errors } from '../../core/http/errors';
import { type TenantContext } from '../../core/http/context';
import { buildListArgs, type FieldSpec } from '../../core/lists/list-query';
import { CompanyDb } from '../common/company-db';
import { dec } from '../common/decimal';
import { openInvoiceCount } from '../documents/document-queries';
import { DocumentsService } from '../documents/documents.service';
import { type CustomerSnapshot, OrdersService } from '../orders/orders.service';
import { renderLabelPdf } from './label-pdf';
import { categorySets, checkRules, loadSubjects, readRules, ruleMessage } from './packing-rules';
import { PickingService } from './picking.service';

type StationInput = z.infer<typeof packingStationInputSchema>;
type PackingQueueQuery = z.infer<typeof packingQueueQuerySchema>;

/** Status je Warteschlangen-Stufe. */
const QUEUE_STATUSES: Record<PackingQueueStage, OrderStatus[]> = {
  packing: ['packing', 'ready_to_ship'],
  pickable: [
    'new',
    'unchecked',
    'in_progress',
    'awaiting_payment',
    'awaiting_stock',
    'ready_to_ship',
  ],
  all: ORDER_SHIPPABLE,
};
/** So viele älteste Aufträge werden je Abruf gegen die Regeln geprüft. */
const QUEUE_SCAN = 1000;
/** So viele Aufträge liefert die Warteschlange höchstens aus. */
const QUEUE_ITEMS = 200;

export const SHIPMENT_FIELDS: FieldSpec = {
  number: { kind: 'string', sortable: true },
  orderId: { kind: 'enum' },
  carrier: { kind: 'enum', sortable: true },
  trackingNumber: { kind: 'string', sortable: true },
  createdAt: { kind: 'date', sortable: true },
};

/**
 * FangEvo Pack: Packtisch-Arbeitsplätze, Packen mit Prüfung gegen den Auftrag,
 * Sendungen mit Paketen und Etikett. Der Abschluss versendet den Auftrag (Bestandsabbuchung
 * mit den gescannten Chargen/Seriennummern) und erstellt auf Wunsch Lieferschein und Rechnung.
 */
@Injectable()
export class PackingService {
  constructor(
    @Inject(CompanyDb) private readonly cdb: CompanyDb,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(OrdersService) private readonly orders: OrdersService,
    @Inject(DocumentsService) private readonly documents: DocumentsService,
    @Inject(PickingService) private readonly picking: PickingService,
  ) {}

  // ───── Packplätze ─────

  stations(t: TenantContext) {
    return this.cdb.run(t, (tx) =>
      tx.packingStation.findMany({ orderBy: [{ archivedAt: 'asc' }, { name: 'asc' }] }),
    );
  }

  saveStation(t: TenantContext, id: string | null, input: StationInput) {
    return this.cdb.run(t, async (tx, c) => {
      await this.validateRules(tx, input.rules);
      if (input.warehouseId) {
        // RLS blendet Lager anderer Firmen aus; archivierte Lager sind nicht wählbar.
        const wh = await tx.warehouse.findUnique({ where: { id: input.warehouseId } });
        if (!wh || wh.archivedAt)
          throw new AppError(422, 'VALIDATION_FAILED', 'Lager nicht gefunden', [
            { path: 'warehouseId', message: 'Lager nicht gefunden' },
          ]);
      }
      const data = {
        name: input.name,
        defaultCarrier: input.defaultCarrier,
        warehouseId: input.warehouseId,
        settings: {
          autoInvoice: input.autoInvoice,
          autoDeliveryNote: input.autoDeliveryNote,
          autoPrint: input.autoPrint,
          rules: input.rules,
        } as unknown as Prisma.InputJsonValue,
      };
      const dup = await tx.packingStation.findFirst({
        where: { name: input.name, ...(id ? { NOT: { id } } : {}) },
      });
      if (dup)
        throw new AppError(409, 'CONFLICT', 'Ein Packplatz mit diesem Namen existiert bereits');
      const st = id
        ? await tx.packingStation.update({ where: { id }, data }).catch(() => {
            throw Errors.notFound();
          })
        : await tx.packingStation.create({
            data: { ...data, id: uuidv7(), accountId: c.account.id, companyId: c.companyId },
          });
      await this.audit.record(tx, {
        accountId: c.account.id,
        userId: c.user.id,
        companyId: c.companyId,
        action: id ? 'packing_station.updated' : 'packing_station.created',
        entityType: 'packing_station',
        entityId: st.id,
        data: { name: st.name },
        ip: c.ip,
      });
      return st;
    });
  }

  archiveStation(t: TenantContext, id: string, archived: boolean) {
    return this.cdb.run(t, async (tx) => {
      const r = await tx.packingStation.updateMany({
        where: { id },
        data: { archivedAt: archived ? new Date() : null },
      });
      if (!r.count) throw Errors.notFound();
    });
  }

  /** Kanäle und Kategorien der Regeln müssen zur aktiven Firma gehören (RLS blendet fremde aus). */
  private async validateRules(tx: Tx, rules: PackingRules) {
    const channelIds = rules.channelIds.filter((x) => x !== NO_CHANNEL);
    if (
      channelIds.length &&
      (await tx.salesChannel.count({ where: { id: { in: channelIds } } })) !== channelIds.length
    )
      throw new AppError(
        422,
        'VALIDATION_FAILED',
        'Mindestens ein Verkaufskanal wurde nicht gefunden',
        [{ path: 'rules.channelIds', message: 'Verkaufskanal nicht gefunden' }],
      );
    const cats = [...new Set([...rules.categoryIds, ...rules.excludeCategoryIds])];
    if (cats.length && (await tx.category.count({ where: { id: { in: cats } } })) !== cats.length)
      throw new AppError(
        422,
        'VALIDATION_FAILED',
        'Mindestens eine Kategorie wurde nicht gefunden',
        [{ path: 'rules.categoryIds', message: 'Kategorie nicht gefunden' }],
      );
    const both = rules.categoryIds.filter((x) => rules.excludeCategoryIds.includes(x));
    if (both.length)
      throw new AppError(
        422,
        'VALIDATION_FAILED',
        'Eine Kategorie kann nicht gleichzeitig ein- und ausgeschlossen sein',
        [{ path: 'rules.excludeCategoryIds', message: 'Doppelt ausgewählt' }],
      );
  }

  private async stationRules(tx: Tx, stationId: string | null | undefined) {
    if (!stationId) return { station: null, rules: readRules({}) };
    const station = await tx.packingStation.findUnique({ where: { id: stationId } });
    if (!station || station.archivedAt)
      throw new AppError(422, 'VALIDATION_FAILED', 'Packplatz nicht gefunden');
    return { station, rules: readRules(station.settings) };
  }

  private async channelNames(tx: Tx, ids: (string | null)[]) {
    const real = [...new Set(ids.filter((x): x is string => !!x))];
    const rows = real.length
      ? await tx.salesChannel.findMany({
          where: { id: { in: real } },
          select: { id: true, name: true },
        })
      : [];
    return new Map(rows.map((r) => [r.id, r.name]));
  }

  // ───── Warteschlange ─────

  /**
   * Aufträge, die an einem Packplatz zum Packen bereitstehen (älteste zuerst), gefiltert nach den
   * Packregeln des Platzes. Zähler je Kanal für die Reiter. Höchstens QUEUE_SCAN Aufträge werden geprüft.
   */
  queue(t: TenantContext, q: PackingQueueQuery) {
    return this.cdb.run(t, async (tx) => {
      const { station, rules } = await this.stationRules(tx, q.stationId);
      if (q.allChannels && rules.locked)
        throw new AppError(409, 'CONFLICT', 'Dieser Packplatz ist auf seine Kanäle festgelegt');
      const channelIds = q.allChannels ? [] : rules.channelIds;
      if (q.channelId && channelIds.length && !channelIds.includes(q.channelId))
        throw new AppError(
          422,
          'VALIDATION_FAILED',
          'Dieser Kanal gehört nicht zu den Regeln des Packplatzes',
        );
      const candidates = await tx.salesOrder.findMany({
        where: {
          status: { in: QUEUE_STATUSES[q.stage] },
          // Ein Packplatz sieht nur Aufträge aus seinem Lager (dort liegt die Ware).
          ...(station?.warehouseId ? { warehouseId: station.warehouseId } : {}),
          ...this.channelWhere(channelIds),
        },
        orderBy: [{ orderDate: 'asc' }, { id: 'asc' }],
        take: QUEUE_SCAN + 1,
        select: {
          id: true,
          number: true,
          status: true,
          orderDate: true,
          channelId: true,
          customerSnapshot: true,
          shippingMethod: true,
          externalNumber: true,
        },
      });
      const truncated = candidates.length > QUEUE_SCAN;
      const scanned = candidates.slice(0, QUEUE_SCAN);
      const subjects = await loadSubjects(tx, scanned);
      const { include, exclude } = await categorySets(tx, rules);
      const matching = scanned.filter(
        (o) => checkRules(subjects.get(o.id)!, { channelIds: [] }, include, exclude).ok,
      );
      const names = await this.channelNames(
        tx,
        matching.map((o) => o.channelId),
      );
      const counts = new Map<string, number>();
      for (const o of matching) {
        const k = o.channelId ?? NO_CHANNEL;
        counts.set(k, (counts.get(k) ?? 0) + 1);
      }
      const selected = q.channelId
        ? matching.filter((o) => (o.channelId ?? NO_CHANNEL) === q.channelId)
        : matching;
      return {
        rules,
        channels: [...counts.entries()]
          .map(([id, count]) => ({
            id,
            name: id === NO_CHANNEL ? 'Ohne Kanal' : (names.get(id) ?? 'Unbekannter Kanal'),
            count,
          }))
          .sort((a, b) => a.name.localeCompare(b.name, 'de')),
        total: matching.length,
        truncated,
        items: selected.slice(0, QUEUE_ITEMS).map((o) => ({
          id: o.id,
          number: o.number,
          status: o.status,
          orderDate: o.orderDate,
          externalNumber: o.externalNumber,
          shippingMethod: o.shippingMethod,
          customerName: (o.customerSnapshot as unknown as CustomerSnapshot).displayName,
          channelId: o.channelId,
          channelName: o.channelId ? (names.get(o.channelId) ?? null) : null,
          positions: subjects.get(o.id)!.categoryIds.length,
        })),
      };
    });
  }

  private channelWhere(channelIds: string[]): Prisma.SalesOrderWhereInput {
    if (!channelIds.length) return {};
    const real = channelIds.filter((x) => x !== NO_CHANNEL);
    const or: Prisma.SalesOrderWhereInput[] = [];
    if (real.length) or.push({ channelId: { in: real } });
    if (channelIds.includes(NO_CHANNEL)) or.push({ channelId: null });
    return { OR: or };
  }

  /**
   * Wird der Auftrag aus einem anderen Lager versendet als dem des Packplatzes?
   * Dann kann er hier nicht gepackt werden (immer gesperrt, unabhängig von „Nur warnen“).
   */
  private async warehouseMismatch(
    tx: Tx,
    order: { warehouseId: string },
    station: { warehouseId: string | null } | null,
  ): Promise<string | null> {
    if (!station?.warehouseId || station.warehouseId === order.warehouseId) return null;
    const wh = await tx.warehouse.findUnique({
      where: { id: order.warehouseId },
      select: { name: true },
    });
    return `Der Auftrag wird aus dem Lager „${wh?.name ?? 'unbekannt'}“ versendet, nicht von diesem Packplatz`;
  }

  /** Prüft einen Auftrag gegen die Regeln eines Packplatzes. */
  private async checkOrder(
    tx: Tx,
    order: { id: string; channelId: string | null },
    rules: PackingRules,
  ): Promise<{ ok: boolean; message: string | null }> {
    const subject = (await loadSubjects(tx, [order])).get(order.id)!;
    const { include, exclude } = await categorySets(tx, rules);
    const r = checkRules(subject, rules, include, exclude);
    if (r.ok) return { ok: true, message: null };
    const names = await this.channelNames(tx, [order.channelId]);
    return {
      ok: false,
      message: ruleMessage(r.reason, order.channelId ? (names.get(order.channelId) ?? null) : null),
    };
  }

  // ───── Packen ─────

  /** Auftrag zum Packen laden (per ID oder gescannter Auftragsnummer). */
  prepare(t: TenantContext, ref: string, stationId?: string | null) {
    return this.cdb.run(t, async (tx) => {
      const isId = /^[0-9a-f-]{36}$/i.test(ref);
      const order = await tx.salesOrder.findFirst({
        where: isId ? { id: ref } : { number: { equals: ref.trim(), mode: 'insensitive' } },
      });
      if (!order) throw Errors.notFound('Auftrag nicht gefunden');
      const { station, rules } = await this.stationRules(tx, stationId);
      const wrongWarehouse = await this.warehouseMismatch(tx, order, station);
      const rule = wrongWarehouse
        ? { ok: false, message: wrongWarehouse, mismatch: 'block' as const }
        : { ...(await this.checkOrder(tx, order, rules)), mismatch: rules.mismatch };
      const channelName = order.channelId
        ? ((await this.channelNames(tx, [order.channelId])).get(order.channelId) ?? null)
        : null;
      const demands = await this.orders.demands(tx, order.id);
      const articles = await tx.article.findMany({
        where: { id: { in: [...new Set(demands.map((d) => d.articleId))] } },
        select: { id: true, number: true, name: true, unit: true, gtin: true, parentId: true },
      });
      const barcodes = await tx.articleBarcode.findMany({
        where: { articleId: { in: articles.map((a) => a.id) } },
      });
      const picks = await this.picking.latestLinesForOrder(tx, order.id);
      const lines = await tx.salesOrderLine.findMany({ where: { orderId: order.id } });
      const snap = order.customerSnapshot as unknown as CustomerSnapshot;
      const shipments = await tx.shipment.findMany({
        where: { orderId: order.id },
        omit: { labelPdf: true },
        orderBy: { createdAt: 'asc' },
      });
      return {
        order: {
          id: order.id,
          number: order.number,
          status: order.status,
          shippable: (ORDER_SHIPPABLE as string[]).includes(order.status),
          customerName: snap.displayName,
          shippingAddress: snap.shipping,
          shippingMethod: order.shippingMethod,
          notes: order.notes,
          channelId: order.channelId,
          channelName,
        },
        /** Passt der Auftrag zu den Regeln des Packplatzes? (mismatch: warn | block) */
        rule,
        items: demands.map((d) => {
          const a = articles.find((x) => x.id === d.articleId);
          const pick = picks.find((p) => p.orderLineId === d.lineId && p.articleId === d.articleId);
          const line = lines.find((l) => l.id === d.lineId);
          return {
            orderLineId: d.lineId,
            articleId: d.articleId,
            articleNumber: a?.number ?? '',
            name: a?.name ?? '',
            unit: a?.unit ?? '',
            /** Gehört zu einem Set (Positionsname des Sets) */
            setName: line && line.articleId !== d.articleId ? line.name : null,
            quantity: d.quantity.toString(),
            trackBatches: d.trackBatches,
            trackSerials: d.trackSerials,
            barcodes: [
              a?.gtin,
              a?.number,
              ...barcodes.filter((b) => b.articleId === d.articleId).map((b) => b.code),
            ].filter((x): x is string => !!x),
            suggestedBatch: pick?.batch ?? null,
            suggestedLocationId: pick?.locationId ?? null,
          };
        }),
        shipments,
      };
    });
  }

  /** Packen abschließen: prüft Vollständigkeit, versendet, erstellt Sendung und ggf. Belege. */
  complete(t: TenantContext, orderId: string, input: PackComplete) {
    return this.cdb.run(t, async (tx, c) => {
      const order = await tx.salesOrder.findUnique({ where: { id: orderId } });
      if (!order) throw Errors.notFound();
      if (!(ORDER_SHIPPABLE as string[]).includes(order.status))
        throw new AppError(
          409,
          'CONFLICT',
          `Im Status „${ORDER_STATUSES[order.status as OrderStatus]}“ kann nicht gepackt werden`,
        );
      await this.verify(tx, orderId, input);
      const station = input.stationId
        ? await tx.packingStation.findUnique({ where: { id: input.stationId } })
        : null;
      if (input.stationId && (!station || station.archivedAt))
        throw new AppError(422, 'VALIDATION_FAILED', 'Packplatz nicht gefunden');
      if (station) {
        const wrongWarehouse = await this.warehouseMismatch(tx, order, station);
        if (wrongWarehouse) throw new AppError(409, 'CONFLICT', wrongWarehouse);
        const rules = readRules(station.settings);
        if (rules.mismatch === 'block') {
          const r = await this.checkOrder(tx, order, rules);
          if (!r.ok) throw new AppError(409, 'CONFLICT', r.message!);
        }
      }

      await this.orders.shipInTx(
        tx,
        c,
        orderId,
        station ? `Gepackt an ${station.name}` : 'Gepackt',
        input.items.map((i) => ({ ...i, quantity: i.quantity })),
      );

      const number = await this.cdb.nextNumber(tx, c.companyId, 'shipment');
      const snap = order.customerSnapshot as unknown as CustomerSnapshot;
      let labelPdf: Uint8Array<ArrayBuffer> | null = null;
      if (input.carrier === 'own_label') {
        const sender = await this.documents.sender(tx, c);
        const to = snap.shipping ?? snap.billing;
        if (!to?.street || !to.city)
          throw new AppError(422, 'VALIDATION_FAILED', 'Für das Etikett fehlt die Lieferadresse');
        const buf = await renderLabelPdf(
          input.parcels.map((p, i) => ({
            sender: [
              sender.legalName || sender.name,
              sender.street ?? '',
              [sender.postalCode, sender.city].filter(Boolean).join(' '),
            ].filter(Boolean),
            recipient: [
              to.name ?? snap.displayName,
              to.name2 ?? '',
              to.street ?? '',
              [to.postalCode, to.city].filter(Boolean).join(' '),
              to.country !== 'DE' ? to.country : '',
            ].filter(Boolean),
            shipmentNumber: number,
            orderNumber: order.number,
            parcel: i + 1,
            parcels: input.parcels.length,
            weightKg: dec(p.weightKg).toString().replace('.', ','),
          })),
        );
        labelPdf = new Uint8Array(
          buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer,
        );
      }
      const shipment = await tx.shipment.create({
        data: {
          id: uuidv7(),
          accountId: c.account.id,
          companyId: c.companyId,
          number,
          orderId,
          stationId: station?.id ?? null,
          carrier: input.carrier,
          trackingNumber: input.trackingNumber,
          parcels: input.parcels as unknown as Prisma.InputJsonValue,
          items: input.items as unknown as Prisma.InputJsonValue,
          labelPdf,
          createdBy: c.user.id,
        },
      });
      await this.audit.record(tx, {
        accountId: c.account.id,
        userId: c.user.id,
        companyId: c.companyId,
        action: 'shipment.created',
        entityType: 'order',
        entityId: orderId,
        data: {
          number,
          carrier: input.carrier,
          trackingNumber: input.trackingNumber,
          parcels: input.parcels.length,
        },
        ip: c.ip,
      });

      // Belege nach Einstellung des Packplatzes
      const settings = (station?.settings ?? {}) as {
        autoInvoice?: boolean;
        autoDeliveryNote?: boolean;
      };
      const documents: { type: string; id: string; number: string | null }[] = [];
      const warnings: string[] = [];
      for (const type of ['delivery_note', 'invoice'] as const) {
        const wanted = type === 'invoice' ? settings.autoInvoice : settings.autoDeliveryNote;
        if (!wanted) continue;
        if (type === 'invoice' && (await openInvoiceCount(tx, orderId)) > 0) continue;
        const doc = await this.documents.fromOrderInTx(tx, c, orderId, { type, notes: null });
        try {
          await this.documents.doFinalize(tx, c, doc);
          const fin = await tx.document.findUnique({ where: { id: doc.id } });
          documents.push({ type, id: doc.id, number: fin?.number ?? null });
        } catch (e) {
          // Pflichtangaben fehlen: Beleg bleibt als Entwurf, der Versand ist trotzdem gebucht.
          if (!(e instanceof AppError) || e.getStatus() !== 422) throw e;
          documents.push({ type, id: doc.id, number: null });
          warnings.push(e.message);
        }
      }
      return { shipment: this.public(shipment), documents, warnings };
    });
  }

  /**
   * Problem am Packtisch: Der Auftrag wird zurückgestellt („In Bearbeitung“), damit er aus der
   * Packliste verschwindet und im Büro geklärt wird. Der Grund steht im Statusverlauf.
   * Nur erlaubte Statuswechsel (Verpackung/Versandbereit → Kommissionierung → In Bearbeitung).
   */
  reportProblem(
    t: TenantContext,
    orderId: string,
    input: { reason: PackingProblem; note: string | null; stationId?: string | null },
  ) {
    return this.cdb.run(t, async (tx, c) => {
      const order = await tx.salesOrder.findUnique({ where: { id: orderId } });
      if (!order) throw Errors.notFound();
      const status = order.status as OrderStatus;
      if (!(ORDER_SHIPPABLE as string[]).includes(status))
        throw new AppError(
          409,
          'CONFLICT',
          `Im Status „${ORDER_STATUSES[status]}“ kann kein Problem gemeldet werden`,
        );
      const station = input.stationId
        ? await tx.packingStation.findUnique({ where: { id: input.stationId } })
        : null;
      const text = [
        `Problem am Packtisch${station ? ` (${station.name})` : ''}: ${PACKING_PROBLEMS[input.reason]}`,
        input.note,
      ]
        .filter(Boolean)
        .join(' – ');
      const path: OrderStatus[] =
        status === 'packing' || status === 'ready_to_ship'
          ? ['picking', 'in_progress']
          : status === 'in_progress'
            ? []
            : ['in_progress'];
      for (const to of path) await this.orders.transitionInTx(tx, c, orderId, to, text);
      await this.audit.record(tx, {
        accountId: c.account.id,
        userId: c.user.id,
        companyId: c.companyId,
        action: 'order.packing_problem',
        entityType: 'order',
        entityId: orderId,
        data: { number: order.number, reason: input.reason, note: input.note },
        ip: c.ip,
      });
      return { status: 'in_progress' as const, message: text };
    });
  }

  /** Vergleicht die gepackten Positionen mit dem Auftrag (Menge, Artikel, Seriennummern). */
  private async verify(tx: Tx, orderId: string, input: PackComplete) {
    const demands = await this.orders.demands(tx, orderId);
    const errors: { path: string; message: string }[] = [];
    const key = (l: string, a: string) => `${l}|${a}`;
    const packed = new Map<string, Prisma.Decimal>();
    for (const i of input.items) {
      const k = key(i.orderLineId, i.articleId);
      if (!demands.some((d) => key(d.lineId, d.articleId) === k)) {
        errors.push({ path: i.articleId, message: 'Artikel gehört nicht zu diesem Auftrag' });
        continue;
      }
      packed.set(k, (packed.get(k) ?? dec(0)).plus(i.quantity));
    }
    const articles = await tx.article.findMany({
      where: { id: { in: demands.map((d) => d.articleId) } },
      select: { id: true, number: true },
    });
    const nr = (id: string) => articles.find((a) => a.id === id)?.number ?? id;
    for (const d of demands) {
      const got = packed.get(key(d.lineId, d.articleId)) ?? dec(0);
      if (got.lessThan(d.quantity))
        errors.push({
          path: d.articleId,
          message: `${nr(d.articleId)}: ${got.toString()} von ${d.quantity.toString()} gepackt`,
        });
      if (got.greaterThan(d.quantity))
        errors.push({
          path: d.articleId,
          message: `${nr(d.articleId)}: ${got.toString()} gepackt, bestellt ${d.quantity.toString()}`,
        });
      if (d.trackSerials) {
        const items = input.items.filter(
          (i) => i.orderLineId === d.lineId && i.articleId === d.articleId,
        );
        if (items.some((i) => !i.serialNumber || !dec(i.quantity).equals(1)))
          errors.push({
            path: d.articleId,
            message: `${nr(d.articleId)}: jede Einheit mit Seriennummer scannen`,
          });
      }
    }
    const serials = input.items
      .filter((i) => i.serialNumber)
      .map((i) => `${i.articleId}|${i.serialNumber}`);
    if (new Set(serials).size !== serials.length)
      errors.push({ path: 'serialNumber', message: 'Eine Seriennummer wurde doppelt gescannt' });
    if (errors.length)
      throw new AppError(422, 'VALIDATION_FAILED', 'Der Auftrag ist nicht korrekt gepackt', errors);
  }

  // ───── Sendungen ─────

  listShipments(t: TenantContext, q: ListQuery) {
    return this.cdb.run(t, async (tx) => {
      const args = buildListArgs(q, SHIPMENT_FIELDS, {
        search: ['number', 'trackingNumber'],
        defaultSort: 'createdAt:desc',
      });
      const [items, total] = await Promise.all([
        tx.shipment.findMany({
          where: args.where,
          orderBy: args.orderBy,
          skip: args.skip,
          take: args.take,
          omit: { labelPdf: true },
        }),
        tx.shipment.count({ where: args.where }),
      ]);
      const orders = await tx.salesOrder.findMany({
        where: { id: { in: items.map((i) => i.orderId) } },
        select: { id: true, number: true, customerSnapshot: true },
      });
      const withLabel = await tx.shipment.findMany({
        where: { id: { in: items.map((i) => i.id) }, labelPdf: { not: null } },
        select: { id: true },
      });
      return {
        items: items.map((s) => {
          const o = orders.find((x) => x.id === s.orderId);
          return {
            ...s,
            hasLabel: withLabel.some((w) => w.id === s.id),
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

  /** Trackingnummer nachtragen (z. B. nach manueller Frankierung). */
  setTracking(t: TenantContext, id: string, trackingNumber: string) {
    return this.cdb.run(t, async (tx, c) => {
      const s = await tx.shipment.findUnique({ where: { id }, omit: { labelPdf: true } });
      if (!s) throw Errors.notFound();
      const u = await tx.shipment.update({
        where: { id },
        data: { trackingNumber },
        omit: { labelPdf: true },
      });
      await this.audit.record(tx, {
        accountId: c.account.id,
        userId: c.user.id,
        companyId: c.companyId,
        action: 'shipment.tracking_set',
        entityType: 'order',
        entityId: s.orderId,
        data: { number: s.number, trackingNumber },
        ip: c.ip,
      });
      return u;
    });
  }

  label(t: TenantContext, id: string) {
    return this.cdb.run(t, async (tx) => {
      const s = await tx.shipment.findUnique({ where: { id } });
      if (!s) throw Errors.notFound();
      if (!s.labelPdf) throw Errors.notFound('Für diese Sendung gibt es kein Etikett');
      return { filename: `Etikett-${s.number}.pdf`, content: Buffer.from(s.labelPdf) };
    });
  }

  private public(s: Shipment) {
    const { labelPdf, ...rest } = s;
    return { ...rest, hasLabel: !!labelPdf };
  }
}
