import { Inject, Injectable } from '@nestjs/common';
import { type z } from 'zod';
import { Prisma, uuidv7, type SalesChannel, type Tx } from '@fangevo/database';
import {
  orderInputSchema,
  type ChannelOrder,
  type channelInputSchema,
  type channelListingSchema,
  type ListQuery,
} from '@fangevo/shared';
import { AuditService } from '../../core/audit/audit.service';
import { AppError, Errors } from '../../core/http/errors';
import { type TenantContext } from '../../core/http/context';
import { buildListArgs, type FieldSpec } from '../../core/lists/list-query';
import { CompanyDb, type CompanyContext } from '../common/company-db';
import { dec } from '../common/decimal';
import { type CustomerSnapshot, OrdersService } from '../orders/orders.service';
import { CustomersService } from '../customers/customers.service';

export const CHANNEL_FIELDS: FieldSpec = {
  name: { kind: 'string', sortable: true },
  type: { kind: 'enum', sortable: true },
  active: { kind: 'boolean', sortable: true },
  createdAt: { kind: 'date', sortable: true },
};

/**
 * Verkaufskanäle (Connector-Architektur, Playbook 15).
 * Jeder Kanal hat Typ, Konfiguration, Status und Protokoll. Der erste Typ „api“ ist passiv:
 * Ein eigener Shop übergibt Bestellungen per API und liest Bestände/Preise und Versandstatus.
 * Bestellungen werden über OrdersService angelegt (gleiche Prüfungen und Preise wie manuell);
 * die externe Bestellnummer ist je Kanal eindeutig, doppelte Übergaben liefern den vorhandenen Auftrag.
 */
@Injectable()
export class ChannelsService {
  constructor(
    @Inject(CompanyDb) private readonly cdb: CompanyDb,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(OrdersService) private readonly orders: OrdersService,
    @Inject(CustomersService) private readonly customers: CustomersService,
  ) {}

  list(t: TenantContext, q: ListQuery) {
    return this.cdb.run(t, async (tx) => {
      const args = buildListArgs(q, CHANNEL_FIELDS, { search: ['name'], defaultSort: 'name:asc' });
      const where = { AND: [args.where, { archivedAt: null }] };
      const [items, total] = await Promise.all([
        tx.salesChannel.findMany({
          where,
          orderBy: args.orderBy,
          skip: args.skip,
          take: args.take,
          omit: { secretsEnc: true },
        }),
        tx.salesChannel.count({ where }),
      ]);
      const counts = items.length
        ? await tx.salesOrder.groupBy({
            by: ['channelId'],
            where: { channelId: { in: items.map((i) => i.id) } },
            _count: { _all: true },
          })
        : [];
      return {
        items: items.map((c) => ({
          ...c,
          orderCount: counts.find((x) => x.channelId === c.id)?._count._all ?? 0,
        })),
        total,
        page: q.page,
        pageSize: q.pageSize,
      };
    });
  }

  get(t: TenantContext, id: string) {
    return this.cdb.run(t, async (tx) => {
      const ch = await this.require(tx, id);
      const logs = await tx.channelLog.findMany({
        where: { channelId: id },
        orderBy: { createdAt: 'desc' },
        take: 50,
      });
      const { secretsEnc: _s, ...rest } = ch;
      return { ...rest, logs };
    });
  }

  private async require(tx: Tx, id: string): Promise<SalesChannel> {
    const ch = await tx.salesChannel.findUnique({ where: { id } });
    if (!ch || ch.archivedAt) throw Errors.notFound('Verkaufskanal nicht gefunden');
    return ch;
  }

  save(t: TenantContext, id: string | null, input: z.infer<typeof channelInputSchema>) {
    return this.cdb.run(t, async (tx, c) => {
      const warehouse = input.warehouseId
        ? await tx.warehouse.findUnique({ where: { id: input.warehouseId } })
        : await tx.warehouse.findFirst({ where: { isDefault: true, archivedAt: null } });
      if (!warehouse || warehouse.archivedAt)
        throw new AppError(422, 'VALIDATION_FAILED', 'Lager nicht gefunden');
      const dup = await tx.salesChannel.findFirst({
        where: { name: input.name, archivedAt: null, ...(id ? { NOT: { id } } : {}) },
      });
      if (dup) throw new AppError(409, 'CONFLICT', 'Ein Kanal mit diesem Namen existiert bereits');
      const data = {
        name: input.name,
        type: input.type,
        active: input.active,
        warehouseId: warehouse.id,
        config: { listedOnly: input.listedOnly } as Prisma.InputJsonValue,
      };
      const ch = id
        ? (await this.require(tx, id),
          await tx.salesChannel.update({ where: { id }, data, omit: { secretsEnc: true } }))
        : await tx.salesChannel.create({
            data: { ...data, id: uuidv7(), accountId: c.account.id, companyId: c.companyId },
            omit: { secretsEnc: true },
          });
      await this.log(tx, c, ch.id, 'info', id ? 'Einstellungen geändert' : 'Kanal angelegt', {
        name: input.name,
      });
      await this.audit.record(tx, {
        accountId: c.account.id,
        userId: c.user.id,
        companyId: c.companyId,
        action: id ? 'channel.updated' : 'channel.created',
        entityType: 'channel',
        entityId: ch.id,
        data: { name: input.name, type: input.type },
        ip: c.ip,
      });
      return ch;
    });
  }

  archive(t: TenantContext, id: string) {
    return this.cdb.run(t, async (tx) => {
      await this.require(tx, id);
      await tx.salesChannel.update({
        where: { id },
        data: { archivedAt: new Date(), active: false },
      });
    });
  }

  // ───── Artikel je Kanal ─────

  listings(t: TenantContext, id: string) {
    return this.cdb.run(t, async (tx) => {
      await this.require(tx, id);
      const rows = await tx.channelListing.findMany({ where: { channelId: id } });
      const arts = await tx.article.findMany({
        where: { id: { in: rows.map((r) => r.articleId) } },
        select: { id: true, number: true, name: true, salePriceNet: true },
      });
      return rows.map((r) => ({ ...r, article: arts.find((a) => a.id === r.articleId) ?? null }));
    });
  }

  setListing(
    t: TenantContext,
    id: string,
    articleId: string,
    input: z.infer<typeof channelListingSchema>,
  ) {
    return this.cdb.run(t, async (tx, c) => {
      await this.require(tx, id);
      const a = await tx.article.findUnique({ where: { id: articleId } });
      if (!a || a.kind === 'parent')
        throw new AppError(422, 'VALIDATION_FAILED', 'Artikel nicht gefunden oder Vaterartikel');
      const priceNet = input.priceNet ? dec(input.priceNet) : null;
      return tx.channelListing.upsert({
        where: { channelId_articleId: { channelId: id, articleId } },
        update: { active: input.active, priceNet },
        create: {
          accountId: c.account.id,
          companyId: c.companyId,
          channelId: id,
          articleId,
          active: input.active,
          priceNet,
        },
      });
    });
  }

  // ───── Schnittstelle für den Shop ─────

  /** Bestellung aus dem Shop übernehmen (idempotent je externer Bestellnummer). */
  receiveOrder(t: TenantContext, id: string, input: ChannelOrder) {
    return this.cdb.run(t, async (tx, c) => {
      const ch = await this.require(tx, id);
      if (!ch.active) throw new AppError(409, 'CONFLICT', 'Der Verkaufskanal ist deaktiviert');
      const known = await tx.externalRef.findUnique({
        where: {
          channelId_entityType_externalId: {
            channelId: id,
            entityType: 'order',
            externalId: input.externalId,
          },
        },
      });
      if (known) {
        const o = await tx.salesOrder.findUnique({
          where: { id: known.internalId },
          select: { id: true, number: true, status: true },
        });
        return { created: false, order: o };
      }
      // Kunde: über externe Kunden-ID oder E-Mail wiederfinden, sonst anlegen
      let customerId: string | null = null;
      if (input.customer.externalId) {
        const ref = await tx.externalRef.findUnique({
          where: {
            channelId_entityType_externalId: {
              channelId: id,
              entityType: 'customer',
              externalId: input.customer.externalId,
            },
          },
        });
        customerId = ref?.internalId ?? null;
      }
      customerId ??=
        (
          await tx.customer.findFirst({
            where: { email: input.customer.email, archivedAt: null },
            select: { id: true },
          })
        )?.id ?? null;
      if (!customerId) {
        const addresses = [
          {
            kind: 'billing' as const,
            isDefault: true,
            ...input.billingAddress,
            name: input.billingAddress.name ?? null,
            name2: null,
          },
          ...(input.shippingAddress
            ? [
                {
                  kind: 'shipping' as const,
                  isDefault: true,
                  ...input.shippingAddress,
                  name: input.shippingAddress.name ?? null,
                  name2: null,
                },
              ]
            : []),
        ];
        const created = await this.customers.createInTx(tx, c, {
          number: null,
          type: input.customer.companyName ? 'business' : 'private',
          companyName: input.customer.companyName ?? null,
          salutation: null,
          firstName: input.customer.firstName ?? null,
          lastName:
            input.customer.lastName ?? (input.customer.companyName ? null : input.customer.email),
          email: input.customer.email,
          phone: input.customer.phone ?? null,
          vatId: input.customer.vatId ?? null,
          customerGroupId: null,
          paymentTermsDays: 14,
          blocked: false,
          blockedReason: null,
          notes: `Angelegt über Kanal ${ch.name}`,
          addresses,
          contacts: [],
        });
        customerId = created.id;
        if (input.customer.externalId)
          await tx.externalRef.create({
            data: {
              id: uuidv7(),
              accountId: c.account.id,
              companyId: c.companyId,
              channelId: id,
              entityType: 'customer',
              externalId: input.customer.externalId,
              internalId: customerId,
            },
          });
      }
      // Artikel über Nummer, EAN oder Zusatz-Barcode
      const lines = [];
      for (const [i, l] of input.lines.entries()) {
        const a =
          (await tx.article.findFirst({ where: { number: l.sku, archivedAt: null } })) ??
          (await tx.article.findFirst({ where: { gtin: l.sku, archivedAt: null } })) ??
          (await tx.articleBarcode
            .findFirst({ where: { code: l.sku } })
            .then((b) => (b ? tx.article.findUnique({ where: { id: b.articleId } }) : null)));
        if (!a) {
          throw new AppError(422, 'VALIDATION_FAILED', `Artikel „${l.sku}“ ist unbekannt`, [
            { path: `lines.${i}.sku`, message: 'Unbekannter Artikel' },
          ]);
        }
        const listing = await tx.channelListing.findUnique({
          where: { channelId_articleId: { channelId: id, articleId: a.id } },
        });
        lines.push({
          articleId: a.id,
          quantity: l.quantity,
          unitPriceNet: l.unitPriceNet ?? listing?.priceNet?.toString() ?? null,
        });
      }
      // Externe Nummer zuerst sichern: Gleichzeitige Übergaben derselben Bestellung scheitern am eindeutigen Index
      const refId = uuidv7();
      try {
        await tx.externalRef.create({
          data: {
            id: refId,
            accountId: c.account.id,
            companyId: c.companyId,
            channelId: id,
            entityType: 'order',
            externalId: input.externalId,
            internalId: refId,
          },
        });
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')
          throw new AppError(409, 'CONFLICT', 'Diese Bestellung wird gerade bereits übernommen');
        throw e;
      }
      const order = await this.orders.createInTx(
        tx,
        c,
        orderInputSchema.parse({
          customerId,
          warehouseId: ch.warehouseId,
          externalNumber: input.externalId,
          paymentMethod: input.paymentMethod,
          shippingMethod: input.shippingMethod,
          shippingNet: input.shippingNet,
          notes: input.notes,
          lines,
        }),
        { channelId: id, note: `Übernommen aus ${ch.name}` },
      );
      await tx.externalRef.update({ where: { id: refId }, data: { internalId: order.id } });
      await tx.salesChannel.update({
        where: { id },
        data: { lastSyncAt: new Date(), status: 'ok', lastError: null },
      });
      await this.log(
        tx,
        c,
        id,
        'info',
        `Bestellung ${input.externalId} als ${order.number} übernommen`,
        { orderId: order.id },
      );
      return { created: true, order: { id: order.id, number: order.number, status: order.status } };
    });
  }

  /** Bestände und Preise für den Shop (verfügbar = Bestand − Reservierungen im Kanallager). */
  stock(t: TenantContext, id: string, opts: { cursor?: string; limit: number }) {
    return this.cdb.run(t, async (tx, c) => {
      const ch = await this.require(tx, id);
      const listedOnly = !!(ch.config as { listedOnly?: boolean }).listedOnly;
      const rows = await tx.$queryRaw<
        {
          id: string;
          number: string;
          gtin: string | null;
          name: string;
          available: string;
          priceNet: string;
          active: boolean;
        }[]
      >`
        SELECT a.id, a.number, a.gtin, a.name,
          (COALESCE((SELECT SUM(quantity) FROM stock_levels l WHERE l.company_id = a.company_id AND l.article_id = a.id AND l.warehouse_id = ${ch.warehouseId}::uuid), 0)
           - COALESCE((SELECT SUM(quantity) FROM stock_reservations r WHERE r.company_id = a.company_id AND r.article_id = a.id AND r.warehouse_id = ${ch.warehouseId}::uuid), 0))::text AS available,
          COALESCE(cl.price_net, a.sale_price_net)::text AS "priceNet",
          (a.active AND COALESCE(cl.active, NOT ${listedOnly})) AS active
        FROM articles a
        LEFT JOIN channel_listings cl ON cl.channel_id = ${id}::uuid AND cl.article_id = a.id
        WHERE a.company_id = ${c.companyId}::uuid AND a.archived_at IS NULL AND a.kind <> 'parent'
          AND (${!listedOnly} OR cl.article_id IS NOT NULL)
          AND (${opts.cursor ?? null}::text IS NULL OR a.number > ${opts.cursor ?? ''})
        ORDER BY a.number
        LIMIT ${opts.limit + 1}`;
      const page = rows.slice(0, opts.limit);
      return {
        items: page.map((r) => ({
          ...r,
          available: Prisma.Decimal.max(dec(r.available), 0).toString(),
          priceNet: dec(r.priceNet).toString(),
        })),
        nextCursor: rows.length > opts.limit ? (page.at(-1)?.number ?? null) : null,
      };
    });
  }

  /** Status einer übernommenen Bestellung inkl. Versand und Trackingnummern. */
  orderStatus(t: TenantContext, id: string, externalId: string) {
    return this.cdb.run(t, async (tx) => {
      await this.require(tx, id);
      const ref = await tx.externalRef.findUnique({
        where: {
          channelId_entityType_externalId: { channelId: id, entityType: 'order', externalId },
        },
      });
      if (!ref) throw Errors.notFound('Bestellung in diesem Kanal unbekannt');
      const o = await tx.salesOrder.findUnique({ where: { id: ref.internalId } });
      if (!o) throw Errors.notFound();
      const shipments = await tx.shipment.findMany({
        where: { orderId: o.id },
        select: { number: true, carrier: true, trackingNumber: true, createdAt: true },
      });
      return {
        externalId,
        number: o.number,
        status: o.status,
        shippedAt: o.shippedAt,
        customer: (o.customerSnapshot as unknown as CustomerSnapshot).number,
        shipments,
      };
    });
  }

  /** Fehler einer Übergabe protokollieren (eigene Transaktion, da die Übergabe zurückgerollt wird). */
  logError(t: TenantContext, id: string, message: string) {
    return this.cdb
      .run(t, async (tx, c) => {
        if (!(await tx.salesChannel.count({ where: { id } }))) return;
        await this.log(tx, c, id, 'error', message.slice(0, 500));
        await tx.salesChannel.update({
          where: { id },
          data: { status: 'error', lastError: message.slice(0, 500) },
        });
      })
      .catch(() => undefined);
  }

  private log(
    tx: Tx,
    c: CompanyContext,
    channelId: string,
    level: 'info' | 'warning' | 'error',
    message: string,
    data?: Record<string, unknown>,
  ) {
    return tx.channelLog.create({
      data: {
        id: uuidv7(),
        accountId: c.account.id,
        companyId: c.companyId,
        channelId,
        level,
        message,
        data: (data ?? null) as Prisma.InputJsonValue,
      },
    });
  }
}
