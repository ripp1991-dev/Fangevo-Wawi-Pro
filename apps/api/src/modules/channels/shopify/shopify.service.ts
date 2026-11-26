import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma, uuidv7, type SalesChannel, type Tx } from '@fangevo/database';
import { channelOrderSchema, shopifySettingsSchema, type ShopifySettings } from '@fangevo/shared';
import { APP_CONFIG, type AppConfig } from '../../../config';
import { AccessService } from '../../../core/access/access.service';
import { AuditService } from '../../../core/audit/audit.service';
import { Database } from '../../../core/database/database.service';
import { type DomainEvent, type EventHandler } from '../../../core/events/event-types';
import { AppError, Errors } from '../../../core/http/errors';
import { type TenantContext } from '../../../core/http/context';
import { JobQueue, type JobHandler, type QueuedJob } from '../../../core/jobs/job-queue.service';
import { CompanyDb, type CompanyContext } from '../../common/company-db';
import { dec } from '../../common/decimal';
import { ChannelsService, syncSchedule } from '../channels.service';
import {
  ShopifyClient,
  ShopifyError,
  shopifyCredentials,
  type FetchFn,
  type ShopifyUserError,
} from './shopify-client';
import {
  MappingError,
  ORDER_FIELDS,
  decideOrder,
  legacyId,
  mapOrder,
  type ShopifyOrderNode,
} from './shopify-mapping';

/** Zustand des Abgleichs (in sales_channels.config.shopifyState, nie Geheimnisse). */
interface ShopifyState {
  orderCursor?: string;
  failedOrders?: string[];
  links?: {
    refreshedAt: string;
    linked: number;
    variants: number;
    unmatched: number;
    unmatchedSample: string[];
    duplicates: string[];
  };
  stock?: { at: string; updated: number; unchanged: number; notStocked: number; stale: number };
  shopName?: string;
  locationName?: string | null;
}

interface ShopifyConfig {
  listedOnly?: boolean;
  shopify: ShopifySettings;
  shopifyState?: ShopifyState;
  /** Benutzer, in dessen Namen der Abgleich läuft (Rechte, Protokoll) */
  runAs?: string;
}

export interface ShopifyLocation {
  id: string;
  name: string;
  isActive: boolean;
  fulfillsOnlineOrders: boolean;
}

const LINK_REFRESH_MS = 60 * 60 * 1000;
const MAX_ORDER_PAGES = 10;
const MAX_FAILED = 200;
/** Die Signatur eines Aufrufs aus dem Shopify-Admin gilt so lange (Schutz vor Wiederverwendung). */
const LAUNCH_MAX_AGE_SEC = 60 * 60;

const SHOP_QUERY = `query {
  shop { name myshopifyDomain currencyCode }
  locations(first: 50) { nodes { id name isActive fulfillsOnlineOrders } }
}`;

const user = (errs: ShopifyUserError[] | undefined) =>
  (errs ?? []).map((e) => e.message).join('; ');

/**
 * Shopify-Anbindung (ADR-015): Verbinden aus dem Shopify-Admin (signierter Aufruf), Bestellungen holen,
 * Artikel über SKU/Barcode verknüpfen, Bestand setzen, Versand mit Sendungsnummer melden.
 * Alles läuft im Hintergrund über die JobQueue mit Mandanten- und Firmenkontext (RLS).
 */
@Injectable()
export class ShopifyService implements JobHandler, EventHandler {
  readonly kind = 'shopify_sync';
  readonly name = 'shopify';
  private readonly logger = new Logger('Shopify');
  private client: ShopifyClient | null = null;
  private ticker: NodeJS.Timeout | undefined;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(CompanyDb) private readonly cdb: CompanyDb,
    @Inject(Database) private readonly db: Database,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(JobQueue) private readonly queue: JobQueue,
    @Inject(AccessService) private readonly access: AccessService,
    @Inject(ChannelsService) private readonly channels: ChannelsService,
  ) {
    this.useFetch();
  }

  /** Netzwerkzugriff austauschen (nur Tests: simulierter Shop). */
  useFetch(fetchImpl?: FetchFn): void {
    const pem = this.config.SHOPIFY_PRIVATE_KEY_FILE
      ? readFileSync(this.config.SHOPIFY_PRIVATE_KEY_FILE, 'utf8')
      : undefined;
    const creds = shopifyCredentials({ ...this.config, privateKeyPem: pem });
    this.client = creds
      ? new ShopifyClient(creds, this.config.SHOPIFY_API_VERSION, fetchImpl)
      : null;
  }

  private api(): ShopifyClient {
    if (!this.client)
      throw new AppError(
        503,
        'INTEGRATION_NOT_CONFIGURED',
        'Die Shopify-App ist auf diesem Server noch nicht eingerichtet (SHOPIFY_CLIENT_ID/SHOPIFY_CLIENT_SECRET)',
      );
    return this.client;
  }

  /** Für die Oberfläche: ist Shopify eingerichtet, wie wird angemeldet? */
  info() {
    return {
      configured: !!this.client && !!this.config.SHOPIFY_CLIENT_SECRET,
      mode: this.config.SHOPIFY_PRIVATE_KEY_FILE ? 'key_pair' : 'client_secret',
      apiVersion: this.config.SHOPIFY_API_VERSION,
    };
  }

  // ───── Verbinden ─────

  /**
   * Prüft die Signatur, mit der Shopify die App-Seite aufruft (nach der Installation oder beim Öffnen
   * der App im Shopify-Admin). Nur wer den Shop verwaltet, kommt an einen gültig signierten Aufruf –
   * so kann niemand fremde Shops mit seinem Wawi-Konto verbinden.
   */
  verifyLaunch(params: Record<string, string>, now = Date.now()): string {
    const secret = this.config.SHOPIFY_CLIENT_SECRET;
    if (!secret)
      throw new AppError(
        503,
        'INTEGRATION_NOT_CONFIGURED',
        'SHOPIFY_CLIENT_SECRET ist nicht gesetzt',
      );
    const { hmac, signature: _sig, ...rest } = params;
    const shop = rest.shop ?? '';
    if (!hmac || !/^[0-9a-f]{64}$/i.test(hmac))
      throw new AppError(422, 'VALIDATION_FAILED', 'Signatur von Shopify fehlt');
    const message = Object.keys(rest)
      .sort()
      .map((k) => `${k}=${rest[k]}`)
      .join('&');
    const expected = createHmac('sha256', secret).update(message).digest();
    const given = Buffer.from(hmac, 'hex');
    if (given.length !== expected.length || !timingSafeEqual(given, expected))
      throw new AppError(403, 'FORBIDDEN', 'Die Signatur von Shopify ist ungültig');
    const ts = Number(rest.timestamp);
    if (!Number.isFinite(ts) || Math.abs(now / 1000 - ts) > LAUNCH_MAX_AGE_SEC)
      throw new AppError(
        422,
        'VALIDATION_FAILED',
        'Der Aufruf aus Shopify ist abgelaufen. Bitte die App im Shopify-Admin erneut öffnen',
      );
    const parsed = shopifySettingsSchema.shape.shopDomain.safeParse(shop);
    if (!parsed.success) throw new AppError(422, 'VALIDATION_FAILED', 'Shop-Adresse ungültig');
    return parsed.data;
  }

  private async shopInfo(shop: string) {
    const d = await this.api().graphql<{
      shop: { name: string; myshopifyDomain: string; currencyCode: string };
      locations: { nodes: ShopifyLocation[] };
    }>(shop, SHOP_QUERY);
    return d;
  }

  /** Neuen Shopify-Kanal aus einem signierten Aufruf anlegen (oder vorhandenen wiederfinden). */
  async connect(
    t: TenantContext,
    input: { params: Record<string, string>; name?: string | null; warehouseId?: string | null },
  ) {
    const shop = this.verifyLaunch(input.params);
    let info;
    try {
      info = await this.shopInfo(shop);
    } catch (e) {
      throw this.asAppError(e);
    }
    if (info.shop.currencyCode !== 'EUR')
      throw new AppError(
        422,
        'VALIDATION_FAILED',
        `Der Shop rechnet in ${info.shop.currencyCode}. Derzeit werden nur Shops in Euro unterstützt`,
      );
    const location =
      info.locations.nodes.find((l) => l.isActive && l.fulfillsOnlineOrders) ??
      info.locations.nodes.find((l) => l.isActive) ??
      null;
    return this.cdb.run(t, async (tx, c) => {
      const all = await tx.salesChannel.findMany({ where: { type: 'shopify', archivedAt: null } });
      const known = all.find(
        (x) => (x.config as unknown as ShopifyConfig).shopify?.shopDomain === shop,
      );
      if (known) return { created: false, channel: this.view(known) };
      const warehouse = input.warehouseId
        ? await tx.warehouse.findUnique({ where: { id: input.warehouseId } })
        : await tx.warehouse.findFirst({ where: { isDefault: true, archivedAt: null } });
      if (!warehouse || warehouse.archivedAt)
        throw new AppError(422, 'VALIDATION_FAILED', 'Lager nicht gefunden');
      let name = (input.name?.trim() || `Shopify ${info.shop.name}`).slice(0, 80);
      if (await tx.salesChannel.count({ where: { name, archivedAt: null } }))
        name = `${name.slice(0, 70)} (${shop.split('.')[0]})`.slice(0, 80);
      const since = new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10);
      const config: ShopifyConfig = {
        listedOnly: false,
        shopify: shopifySettingsSchema.parse({
          shopDomain: shop,
          locationId: location?.id ?? null,
          importSince: since,
        }),
        shopifyState: { shopName: info.shop.name, locationName: location?.name ?? null },
        runAs: c.user.id,
      };
      const ch = await tx.salesChannel.create({
        data: {
          id: uuidv7(),
          accountId: c.account.id,
          companyId: c.companyId,
          type: 'shopify',
          name,
          active: true,
          warehouseId: warehouse.id,
          config: config as unknown as Prisma.InputJsonValue,
        },
      });
      await syncSchedule(tx, ch);
      await this.log(tx, c, ch.id, 'info', `Mit Shopify verbunden: ${info.shop.name} (${shop})`);
      await this.audit.record(tx, {
        accountId: c.account.id,
        userId: c.user.id,
        companyId: c.companyId,
        action: 'channel.created',
        entityType: 'channel',
        entityId: ch.id,
        data: { name, type: 'shopify', shop },
        ip: c.ip,
      });
      return { created: true, channel: this.view(ch) };
    });
  }

  private view(ch: SalesChannel) {
    const { secretsEnc: _s, ...rest } = ch;
    return rest;
  }

  private asAppError(e: unknown): AppError {
    if (e instanceof AppError) return e;
    if (e instanceof ShopifyError)
      return new AppError(e.kind === 'network' ? 502 : 422, 'UPSTREAM_ERROR', e.message);
    return new AppError(502, 'UPSTREAM_ERROR', `Shopify: ${String(e)}`);
  }

  private async requireShopify(tx: Tx, id: string) {
    const ch = await tx.salesChannel.findUnique({ where: { id } });
    if (!ch || ch.archivedAt || ch.type !== 'shopify')
      throw Errors.notFound('Shopify-Kanal nicht gefunden');
    return { ch, cfg: ch.config as unknown as ShopifyConfig };
  }

  /** Verbindung prüfen: Shop, Standorte und gewährte Berechtigungen. */
  async check(t: TenantContext, id: string) {
    const { ch, cfg } = await this.cdb.run(t, (tx) => this.requireShopify(tx, id));
    const shop = cfg.shopify.shopDomain;
    try {
      const info = await this.shopInfo(shop);
      const granted = this.api().scopes(shop);
      const needed = [
        'read_orders',
        'read_products',
        'read_inventory',
        'write_inventory',
        'read_locations',
        'read_merchant_managed_fulfillment_orders',
        'write_merchant_managed_fulfillment_orders',
      ];
      // Shopify nennt bei gewährtem Schreibrecht das Leserecht nicht eigens: write_x schließt read_x ein
      const has = (s: string) =>
        granted.includes(s) || (s.startsWith('read_') && granted.includes(`write_${s.slice(5)}`));
      const missing = granted.length ? needed.filter((s) => !has(s)) : [];
      await this.cdb.run(t, async (tx, c) => {
        await this.log(
          tx,
          c,
          ch.id,
          missing.length ? 'warning' : 'info',
          missing.length
            ? `Verbindung ok, aber Berechtigungen fehlen: ${missing.join(', ')}`
            : `Verbindung ok: ${info.shop.name}`,
        );
        if (!missing.length)
          await tx.salesChannel.update({
            where: { id },
            data: { status: 'ok', lastError: null },
          });
      });
      return {
        ok: missing.length === 0,
        shop: info.shop,
        locations: info.locations.nodes,
        scopes: granted,
        missingScopes: missing,
      };
    } catch (e) {
      const err = this.asAppError(e);
      await this.channels.logError(t, id, err.message);
      throw err;
    }
  }

  /** Abgleich sofort einplanen (Bestellungen, Verknüpfungen, Bestand). */
  requestSync(t: TenantContext, id: string, opts: { relink?: boolean } = {}) {
    return this.cdb.run(t, async (tx, c) => {
      const { ch, cfg } = await this.requireShopify(tx, id);
      if (!ch.active) throw new AppError(409, 'CONFLICT', 'Der Kanal ist deaktiviert');
      if (opts.relink && cfg.shopifyState?.links) {
        const state = {
          ...cfg.shopifyState,
          links: { ...cfg.shopifyState.links, refreshedAt: '1970-01-01T00:00:00Z' },
        };
        await tx.salesChannel.update({
          where: { id },
          data: { config: { ...cfg, shopifyState: state } as unknown as Prisma.InputJsonValue },
        });
      }
      await this.queue.enqueue(tx, {
        kind: 'shopify_sync',
        accountId: c.account.id,
        companyId: c.companyId,
        userId: c.user.id,
        refId: id,
      });
      await this.log(tx, c, id, 'info', 'Abgleich angestoßen');
      return { queued: true };
    });
  }

  /** Verknüpfte Artikel mit zuletzt übertragenem Bestand. */
  links(t: TenantContext, id: string) {
    return this.cdb.run(t, async (tx) => {
      const { cfg } = await this.requireShopify(tx, id);
      const rows = await tx.channelArticleLink.findMany({
        where: { channelId: id },
        orderBy: { externalSku: 'asc' },
        take: 1000,
      });
      const arts = await tx.article.findMany({
        where: { id: { in: rows.map((r) => r.articleId) } },
        select: { id: true, number: true, name: true },
      });
      return {
        summary: cfg.shopifyState?.links ?? null,
        stock: cfg.shopifyState?.stock ?? null,
        items: rows.map((r) => ({
          articleId: r.articleId,
          article: arts.find((a) => a.id === r.articleId) ?? null,
          sku: r.externalSku,
          title: r.externalTitle,
          matchedBy: r.matchedBy,
          stockTracked: r.stockTracked,
          lastStockSent: r.lastStockSent?.toString() ?? null,
          lastStockSentAt: r.lastStockSentAt,
        })),
      };
    });
  }

  // ───── Zeitsteuerung ─────

  startScheduler(intervalMs = 30_000): void {
    const loop = async () => {
      try {
        await this.tick();
      } catch (err) {
        this.logger.error(`Zeitsteuerung: ${String(err)}`);
      }
      this.ticker = setTimeout(loop, intervalMs);
    };
    this.ticker = setTimeout(loop, 2000);
  }

  stopScheduler(): void {
    if (this.ticker) clearTimeout(this.ticker);
  }

  /** Fällige Kanäle einplanen (mehrere Worker möglich). */
  async tick(now = new Date()): Promise<number> {
    return this.db.global.$transaction(async (g) => {
      const due = await g.$queryRaw<
        { channel_id: string; account_id: string; company_id: string }[]
      >`
        SELECT channel_id, account_id, company_id FROM channel_sync_schedule
        WHERE next_run_at <= ${now} ORDER BY next_run_at LIMIT 50 FOR UPDATE SKIP LOCKED`;
      for (const r of due) {
        await g.channelSyncSchedule.update({
          where: { channelId: r.channel_id },
          data: { nextRunAt: new Date(now.getTime() + this.config.CHANNEL_SYNC_MINUTES * 60_000) },
        });
        const runAs = await this.db.tenant(
          { accountId: r.account_id, userId: null, companyId: r.company_id },
          async (tx) => {
            const ch = await tx.salesChannel.findUnique({ where: { id: r.channel_id } });
            if (!ch || !ch.active || ch.archivedAt || ch.type !== 'shopify') return null;
            return (ch.config as unknown as ShopifyConfig).runAs ?? null;
          },
        );
        if (!runAs) {
          await g.channelSyncSchedule.deleteMany({ where: { channelId: r.channel_id } });
          continue;
        }
        // Nicht doppelt einplanen, solange ein Abgleich dieses Kanals noch wartet
        const pending = await g.jobQueue.count({
          where: { kind: 'shopify_sync', refId: r.channel_id },
        });
        if (pending) continue;
        await this.queue.enqueue(g, {
          kind: 'shopify_sync',
          accountId: r.account_id,
          companyId: r.company_id,
          userId: runAs,
          refId: r.channel_id,
        });
      }
      return due.length;
    });
  }

  // ───── Hintergrund ─────

  private async contextFor(job: QueuedJob): Promise<TenantContext | null> {
    if (!job.userId || !job.companyId) return null;
    const account = await this.access.loadAccountContext(job.userId, job.accountId);
    if (!account) return null;
    return {
      sessionId: `job:${job.id}`,
      user: { id: job.userId, email: '', name: 'Shopify-Abgleich', mfaEnabled: false },
      account,
      companyId: job.companyId,
      ip: null,
    };
  }

  async run(job: QueuedJob): Promise<void> {
    const t = await this.contextFor(job);
    if (!t) {
      await this.db.tenant(
        { accountId: job.accountId, userId: null, companyId: job.companyId },
        async (tx) => {
          if (!(await tx.salesChannel.count({ where: { id: job.refId } }))) return;
          await tx.salesChannel.update({
            where: { id: job.refId },
            data: {
              status: 'error',
              lastError:
                'Die Person, in deren Namen der Abgleich läuft, hat keinen Zugriff mehr. Bitte Kanal neu speichern',
            },
          });
        },
      );
      return;
    }
    await this.sync(t, job.refId);
  }

  /** Vollständiger Abgleich eines Kanals. */
  async sync(t: TenantContext, id: string): Promise<void> {
    const loaded = await this.cdb.run(t, (tx) => this.requireShopify(tx, id)).catch(() => null);
    if (!loaded || !loaded.ch.active) return;
    const { cfg } = loaded;
    const errors: string[] = [];
    const step = async (label: string, fn: () => Promise<void>) => {
      try {
        await fn();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        errors.push(`${label}: ${msg}`);
        this.logger.warn(`Kanal ${id} – ${label}: ${msg}`);
      }
    };
    if (cfg.shopify.importOrders)
      await step('Bestellungen', async () => void (await this.importOrders(t, id)));
    await step('Verknüpfung', () => this.refreshLinks(t, id));
    if (cfg.shopify.syncStock && cfg.shopify.locationId)
      await step('Bestand', async () => void (await this.pushStock(t, id)));
    await this.cdb.run(t, async (tx, c) => {
      if (errors.length) await this.log(tx, c, id, 'error', errors.join(' | ').slice(0, 500));
      await tx.salesChannel.update({
        where: { id },
        data: errors.length
          ? { status: 'error', lastError: errors.join(' | ').slice(0, 500), lastSyncAt: new Date() }
          : { status: 'ok', lastError: null, lastSyncAt: new Date() },
      });
    });
  }

  private async saveState(t: TenantContext, id: string, patch: Partial<ShopifyState>) {
    await this.cdb.run(t, async (tx) => {
      const { cfg } = await this.requireShopify(tx, id);
      const next = { ...cfg, shopifyState: { ...(cfg.shopifyState ?? {}), ...patch } };
      await tx.salesChannel.update({
        where: { id },
        data: { config: next as unknown as Prisma.InputJsonValue },
      });
    });
  }

  // ───── Bestellungen ─────

  async importOrders(t: TenantContext, id: string): Promise<{ imported: number; failed: number }> {
    const { ch, cfg } = await this.cdb.run(t, (tx) => this.requireShopify(tx, id));
    const shop = cfg.shopify.shopDomain;
    const state = cfg.shopifyState ?? {};
    const since = cfg.shopify.importSince ?? ch.createdAt.toISOString().slice(0, 10);
    let cursor = state.orderCursor ?? `${since}T00:00:00Z`;
    const failed = new Set(state.failedOrders ?? []);
    const links = await this.cdb.run(t, (tx) =>
      tx.channelArticleLink.findMany({
        where: { channelId: id },
        select: { externalVariantId: true, articleId: true },
      }),
    );
    const numbers = new Map(
      (
        await this.cdb.run(t, (tx) =>
          tx.article.findMany({
            where: { id: { in: links.map((l) => l.articleId) } },
            select: { id: true, number: true },
          }),
        )
      ).map((a) => [a.id, a.number]),
    );
    const skuByVariant = new Map(links.map((l) => [l.externalVariantId, numbers.get(l.articleId)]));
    const skuFor = (v: string) => skuByVariant.get(v);
    let imported = 0;

    const handle = async (o: ShopifyOrderNode) => {
      const extId = legacyId(o.id);
      const known = await this.cdb.run(t, (tx) =>
        tx.externalRef.findUnique({
          where: {
            channelId_entityType_externalId: {
              channelId: id,
              entityType: 'order',
              externalId: extId,
            },
          },
        }),
      );
      const d = decideOrder(o, cfg.shopify.importUnpaid);
      if (known) {
        failed.delete(o.id);
        if (d.action === 'skip' && d.cancelled)
          await this.cdb.run(t, async (tx, c) => {
            const order = await tx.salesOrder.findUnique({
              where: { id: known.internalId },
              select: { number: true, status: true },
            });
            if (order && !['cancelled', 'shipped', 'completed'].includes(order.status))
              await this.log(
                tx,
                c,
                id,
                'warning',
                `Bestellung ${o.name} wurde in Shopify storniert – bitte Auftrag ${order.number} prüfen`,
              );
          });
        return;
      }
      if (d.action === 'skip') {
        failed.delete(o.id);
        return;
      }
      try {
        const input = channelOrderSchema.parse(mapOrder(o, skuFor));
        const r = await this.cdb.run(t, async (tx, c) => {
          const current = await tx.salesChannel.findUniqueOrThrow({ where: { id } });
          return this.channels.receiveOrderInTx(tx, c, current, input);
        });
        failed.delete(o.id);
        if (r.created) imported++;
      } catch (e) {
        failed.add(o.id);
        const msg =
          e instanceof MappingError || e instanceof AppError
            ? e.message
            : e instanceof Error
              ? e.message
              : String(e);
        await this.cdb.run(t, (tx, c) =>
          this.log(
            tx,
            c,
            id,
            'error',
            `Bestellung ${o.name} nicht übernommen: ${msg}`.slice(0, 500),
            {
              shopifyOrder: o.name,
            },
          ),
        );
      }
    };

    // 1) Früher gescheiterte Bestellungen erneut versuchen (z. B. nach Anlage des fehlenden Artikels)
    const retry = [...failed].slice(0, 100);
    if (retry.length) {
      const r = await this.api().graphql<{ nodes: (ShopifyOrderNode | null)[] }>(
        shop,
        `query Retry($ids: [ID!]!) { nodes(ids: $ids) { ... on Order { ${ORDER_FIELDS} } } }`,
        { ids: retry },
      );
      for (const [i, o] of r.nodes.entries()) {
        if (o) await handle(o);
        else failed.delete(retry[i]!);
      }
    }

    // 2) Neue und geänderte Bestellungen seit dem letzten Abgleich
    let after: string | null = null;
    for (let page = 0; page < MAX_ORDER_PAGES; page++) {
      const r: {
        orders: {
          pageInfo: { hasNextPage: boolean; endCursor: string | null };
          nodes: ShopifyOrderNode[];
        };
      } = await this.api().graphql(
        shop,
        `query Orders($first: Int!, $after: String, $query: String) {
          orders(first: $first, after: $after, query: $query, sortKey: UPDATED_AT) {
            pageInfo { hasNextPage endCursor }
            nodes { ${ORDER_FIELDS} }
          }
        }`,
        { first: 50, after, query: `updated_at:>='${cursor}' AND created_at:>='${since}'` },
      );
      for (const o of r.orders.nodes) await handle(o);
      const last = r.orders.nodes.at(-1);
      if (last && last.updatedAt > cursor) cursor = last.updatedAt;
      if (!r.orders.pageInfo.hasNextPage) break;
      after = r.orders.pageInfo.endCursor;
    }
    await this.saveState(t, id, {
      orderCursor: cursor,
      failedOrders: [...failed].slice(-MAX_FAILED),
    });
    if (imported)
      await this.cdb.run(t, (tx, c) =>
        this.log(tx, c, id, 'info', `${imported} Bestellung(en) aus Shopify übernommen`),
      );
    return { imported, failed: failed.size };
  }

  // ───── Artikel verknüpfen ─────

  /** Shopify-Varianten über SKU (= Artikelnummer) oder Barcode (= EAN/Zusatz-Barcode) verknüpfen. */
  async refreshLinks(t: TenantContext, id: string, force = false): Promise<void> {
    const { cfg } = await this.cdb.run(t, (tx) => this.requireShopify(tx, id));
    const last = cfg.shopifyState?.links?.refreshedAt;
    if (!force && last && Date.now() - Date.parse(last) < LINK_REFRESH_MS) return;
    const shop = cfg.shopify.shopDomain;
    type Variant = {
      id: string;
      sku: string | null;
      barcode: string | null;
      displayName: string;
      product: { id: string };
      inventoryItem: { id: string; tracked: boolean } | null;
    };
    const variants: Variant[] = [];
    let after: string | null = null;
    for (let page = 0; page < 200; page++) {
      const r: {
        productVariants: {
          pageInfo: { hasNextPage: boolean; endCursor: string | null };
          nodes: Variant[];
        };
      } = await this.api().graphql(
        shop,
        `query Variants($after: String) {
          productVariants(first: 250, after: $after) {
            pageInfo { hasNextPage endCursor }
            nodes { id sku barcode displayName product { id } inventoryItem { id tracked } }
          }
        }`,
        { after },
      );
      variants.push(...r.productVariants.nodes);
      if (!r.productVariants.pageInfo.hasNextPage) break;
      after = r.productVariants.pageInfo.endCursor;
    }

    await this.cdb.run(t, async (tx, c) => {
      const arts = await tx.article.findMany({
        where: { archivedAt: null, kind: { not: 'parent' } },
        select: { id: true, number: true, gtin: true },
      });
      const barcodes = await tx.articleBarcode.findMany({
        select: { articleId: true, code: true },
      });
      const byNumber = new Map(arts.map((a) => [a.number.trim().toLowerCase(), a.id]));
      const byCode = new Map<string, string>();
      for (const a of arts) if (a.gtin) byCode.set(a.gtin.trim(), a.id);
      for (const b of barcodes) byCode.set(b.code.trim(), b.articleId);

      const seen = new Map<string, Variant & { matchedBy: string }>();
      const duplicates: string[] = [];
      const unmatched: string[] = [];
      for (const v of variants) {
        const sku = v.sku?.trim() ?? '';
        const code = v.barcode?.trim() ?? '';
        let articleId = sku ? byNumber.get(sku.toLowerCase()) : undefined;
        let matchedBy = 'sku';
        if (!articleId && code) {
          articleId = byCode.get(code);
          matchedBy = 'barcode';
        }
        if (!articleId && sku) {
          articleId = byCode.get(sku);
          matchedBy = 'barcode';
        }
        if (!articleId) {
          unmatched.push(sku || code || v.displayName);
          continue;
        }
        if (seen.has(articleId)) {
          duplicates.push(sku || code);
          continue;
        }
        seen.set(articleId, { ...v, matchedBy });
      }
      const existing = await tx.channelArticleLink.findMany({ where: { channelId: id } });
      const keep = new Set<string>();
      for (const [articleId, v] of seen) {
        keep.add(articleId);
        const data = {
          externalProductId: v.product.id,
          externalVariantId: v.id,
          externalInventoryItemId: v.inventoryItem?.id ?? null,
          externalSku: v.sku,
          externalTitle: v.displayName.slice(0, 300),
          matchedBy: v.matchedBy,
          stockTracked: v.inventoryItem?.tracked ?? false,
        };
        const prev = existing.find((e) => e.articleId === articleId);
        // Variante hängt bisher an einem anderen Artikel: alte Verknüpfung zuerst lösen (eindeutiger Index)
        const clash = existing.find(
          (e) => e.externalVariantId === v.id && e.articleId !== articleId,
        );
        if (clash) {
          await tx.channelArticleLink.delete({
            where: { channelId_articleId: { channelId: id, articleId: clash.articleId } },
          });
          existing.splice(existing.indexOf(clash), 1);
        }
        if (prev)
          await tx.channelArticleLink.update({
            where: { channelId_articleId: { channelId: id, articleId } },
            data: {
              ...data,
              // Neue Variante: Bestand erneut übertragen
              ...(prev.externalVariantId !== v.id
                ? { lastStockSent: null, lastStockSentAt: null }
                : {}),
            },
          });
        else
          await tx.channelArticleLink.create({
            data: {
              ...data,
              accountId: c.account.id,
              companyId: c.companyId,
              channelId: id,
              articleId,
            },
          });
      }
      const stale = existing.filter((e) => !keep.has(e.articleId)).map((e) => e.articleId);
      if (stale.length)
        await tx.channelArticleLink.deleteMany({
          where: { channelId: id, articleId: { in: stale } },
        });
      const summary = {
        refreshedAt: new Date().toISOString(),
        linked: seen.size,
        variants: variants.length,
        unmatched: unmatched.length,
        unmatchedSample: unmatched.slice(0, 30),
        duplicates: duplicates.slice(0, 30),
      };
      const fresh = await this.requireShopify(tx, id);
      await tx.salesChannel.update({
        where: { id },
        data: {
          config: {
            ...fresh.cfg,
            shopifyState: { ...(fresh.cfg.shopifyState ?? {}), links: summary },
          } as unknown as Prisma.InputJsonValue,
        },
      });
      await this.log(
        tx,
        c,
        id,
        unmatched.length || duplicates.length ? 'warning' : 'info',
        `Artikel verknüpft: ${seen.size} von ${variants.length} Varianten` +
          (unmatched.length ? `, ${unmatched.length} ohne passenden Artikel` : '') +
          (duplicates.length ? `, ${duplicates.length} doppelt` : ''),
      );
    });
  }

  // ───── Bestand ─────

  /**
   * Setzt den verfügbaren Bestand der verknüpften Varianten am Shopify-Standort.
   * Die Wawi ist führend: verfügbar = Bestand − Reservierungen im Kanallager (nie negativ).
   * Vergleich-und-Tausch: gesetzt wird nur, wenn Shopify noch den eben gelesenen Wert hat;
   * sonst (z. B. gerade eingegangene Bestellung) im nächsten Lauf nach dem Bestellabruf.
   */
  async pushStock(t: TenantContext, id: string) {
    const { ch, cfg } = await this.cdb.run(t, (tx) => this.requireShopify(tx, id));
    const shop = cfg.shopify.shopDomain;
    const locationId = cfg.shopify.locationId!;
    const rows = await this.cdb.run(
      t,
      (tx, c) =>
        tx.$queryRaw<{ articleId: string; itemId: string; available: string; active: boolean }[]>`
        SELECT k.article_id AS "articleId", k.external_inventory_item_id AS "itemId",
          (COALESCE((SELECT SUM(quantity) FROM stock_levels l WHERE l.company_id = a.company_id AND l.article_id = a.id AND l.warehouse_id = ${ch.warehouseId}::uuid), 0)
           - COALESCE((SELECT SUM(quantity) FROM stock_reservations r WHERE r.company_id = a.company_id AND r.article_id = a.id AND r.warehouse_id = ${ch.warehouseId}::uuid), 0))::text AS available,
          (a.active AND a.stock_tracked AND COALESCE(cl.active, true)) AS active
        FROM channel_article_links k
        JOIN articles a ON a.id = k.article_id AND a.archived_at IS NULL
        LEFT JOIN channel_listings cl ON cl.channel_id = k.channel_id AND cl.article_id = k.article_id
        WHERE k.company_id = ${c.companyId}::uuid AND k.channel_id = ${id}::uuid
          AND k.stock_tracked AND k.external_inventory_item_id IS NOT NULL`,
    );
    const targets = rows.filter((r) => r.active);
    let updated = 0;
    let unchanged = 0;
    let notStocked = 0;
    let stale = 0;
    const sent: { articleId: string; qty: number }[] = [];
    for (let i = 0; i < targets.length; i += 100) {
      const batch = targets.slice(i, i + 100);
      const levels = await this.api().graphql<{
        nodes: ({
          id: string;
          inventoryLevel: { quantities: { name: string; quantity: number }[] } | null;
        } | null)[];
      }>(
        shop,
        `query Levels($ids: [ID!]!, $loc: ID!) {
          nodes(ids: $ids) {
            ... on InventoryItem { id inventoryLevel(locationId: $loc) { quantities(names: ["available"]) { name quantity } } }
          }
        }`,
        { ids: batch.map((b) => b.itemId), loc: locationId },
      );
      const quantities: {
        inventoryItemId: string;
        locationId: string;
        quantity: number;
        changeFromQuantity: number;
      }[] = [];
      const pending: { articleId: string; qty: number }[] = [];
      for (const [j, b] of batch.entries()) {
        const node = levels.nodes[j];
        const level = node?.inventoryLevel;
        const target = Math.max(0, Math.floor(Number(dec(b.available).toString())));
        if (!level) {
          // Artikel wird am gewählten Standort noch nicht geführt: dort mit dem Wawi-Bestand aktivieren
          if (!node) {
            notStocked++;
            continue;
          }
          const a = await this.api().graphql<{
            inventoryActivate: {
              inventoryLevel: { id: string } | null;
              userErrors: ShopifyUserError[];
            };
          }>(
            shop,
            `mutation Activate($item: ID!, $loc: ID!, $available: Int, $key: String!) {
              inventoryActivate(inventoryItemId: $item, locationId: $loc, available: $available) @idempotent(key: $key) {
                inventoryLevel { id }
                userErrors { field message }
              }
            }`,
            { item: b.itemId, loc: locationId, available: target, key: randomUUID() },
          );
          if (a.inventoryActivate.inventoryLevel) {
            updated++;
            sent.push({ articleId: b.articleId, qty: target });
          } else {
            notStocked++;
            this.logger.warn(
              `Kanal ${id}: Aktivieren am Standort fehlgeschlagen: ${user(a.inventoryActivate.userErrors)}`,
            );
          }
          continue;
        }
        const current = level.quantities.find((q) => q.name === 'available')?.quantity ?? 0;
        if (current === target) {
          unchanged++;
          sent.push({ articleId: b.articleId, qty: target });
          continue;
        }
        quantities.push({
          inventoryItemId: b.itemId,
          locationId,
          quantity: target,
          changeFromQuantity: current,
        });
        pending.push({ articleId: b.articleId, qty: target });
      }
      if (!quantities.length) continue;
      const r = await this.api().graphql<{
        inventorySetQuantities: { userErrors: (ShopifyUserError & { code?: string })[] };
      }>(
        shop,
        `mutation SetQty($input: InventorySetQuantitiesInput!, $key: String!) {
          inventorySetQuantities(input: $input) @idempotent(key: $key) {
            userErrors { code field message }
          }
        }`,
        {
          input: {
            name: 'available',
            reason: 'correction',
            referenceDocumentUri: `fangevo://wawi/channel/${id}/stock`,
            quantities,
          },
          key: randomUUID(),
        },
      );
      const errs = r.inventorySetQuantities.userErrors;
      if (errs.length) {
        // Bei veraltetem Vergleichswert lehnt Shopify die ganze Anfrage ab: nächster Lauf
        if (errs.every((e) => e.code === 'CHANGE_FROM_QUANTITY_STALE')) stale += quantities.length;
        else throw new ShopifyError(`Bestand setzen: ${user(errs)}`, 'user');
      } else {
        updated += quantities.length;
        sent.push(...pending);
      }
    }
    await this.cdb.run(t, async (tx, c) => {
      const now = new Date();
      for (const s of sent)
        await tx.channelArticleLink.update({
          where: { channelId_articleId: { channelId: id, articleId: s.articleId } },
          data: { lastStockSent: new Prisma.Decimal(s.qty), lastStockSentAt: now },
        });
      if (updated || notStocked || stale)
        await this.log(
          tx,
          c,
          id,
          notStocked ? 'warning' : 'info',
          `Bestand an Shopify: ${updated} aktualisiert, ${unchanged} unverändert` +
            (stale ? `, ${stale} im nächsten Lauf (gerade geändert)` : '') +
            (notStocked ? `, ${notStocked} am Standort nicht aktivierbar` : ''),
        );
    });
    await this.saveState(t, id, {
      stock: { at: new Date().toISOString(), updated, unchanged, notStocked, stale },
    });
    return { updated, unchanged, notStocked, stale };
  }

  // ───── Versand melden ─────

  handles(type: string): boolean {
    return type === 'order.shipped' || type === 'shipment.tracking_set';
  }

  /** Versand eines Shopify-Auftrags im Hintergrund an Shopify melden (idempotent). */
  async handle(_tx: Tx, e: DomainEvent): Promise<void> {
    if (!e.companyId || !e.entityId) return;
    await this.db.tenant(
      { accountId: e.accountId, userId: null, companyId: e.companyId },
      async (tx) => {
        const order = await tx.salesOrder.findUnique({
          where: { id: e.entityId! },
          select: { id: true, channelId: true },
        });
        if (!order?.channelId) return;
        const ch = await tx.salesChannel.findUnique({ where: { id: order.channelId } });
        if (!ch || ch.type !== 'shopify' || !ch.active || ch.archivedAt) return;
        const cfg = ch.config as unknown as ShopifyConfig;
        if (!cfg.shopify.pushFulfillment || !cfg.runAs) return;
        await this.queue.enqueue(tx, {
          kind: 'shopify_fulfillment',
          accountId: e.accountId,
          companyId: e.companyId,
          userId: cfg.runAs,
          refId: order.id,
        });
      },
    );
  }

  /** Läuft als Job „shopify_fulfillment“ (eigener Handler, siehe unten). */
  async runFulfillment(job: QueuedJob): Promise<void> {
    const t = await this.contextFor(job);
    if (!t) return;
    await this.fulfill(t, job.refId);
  }

  async fulfill(t: TenantContext, orderId: string): Promise<'created' | 'updated' | 'skipped'> {
    const ctx = await this.cdb.run(t, async (tx) => {
      const order = await tx.salesOrder.findUnique({ where: { id: orderId } });
      if (!order?.channelId || (order.status !== 'shipped' && order.status !== 'completed'))
        return null;
      const { ch, cfg } = await this.requireShopify(tx, order.channelId).catch(() => ({
        ch: null,
        cfg: null,
      }));
      if (!ch || !cfg) return null;
      const ref = await tx.externalRef.findFirst({
        where: { channelId: ch.id, entityType: 'order', internalId: order.id },
      });
      if (!ref) return null;
      const fulfillment = await tx.externalRef.findFirst({
        where: { channelId: ch.id, entityType: 'fulfillment', internalId: order.id },
      });
      const shipments = await tx.shipment.findMany({
        where: { orderId: order.id },
        select: { trackingNumber: true },
        orderBy: { createdAt: 'asc' },
      });
      return {
        ch,
        cfg,
        order,
        orderGid: `gid://shopify/Order/${ref.externalId}`,
        fulfillmentId: fulfillment?.externalId ?? null,
        numbers: shipments.map((s) => s.trackingNumber?.trim()).filter((n): n is string => !!n),
      };
    });
    if (!ctx) return 'skipped';
    const { ch, cfg, order, orderGid, numbers } = ctx;
    const shop = cfg.shopify.shopDomain;
    const notify = cfg.shopify.notifyCustomer;

    if (ctx.fulfillmentId) {
      if (!numbers.length) return 'skipped';
      const r = await this.api().graphql<{
        fulfillmentTrackingInfoUpdate: { userErrors: ShopifyUserError[] };
      }>(
        shop,
        `mutation Track($id: ID!, $info: FulfillmentTrackingInput!, $notify: Boolean) {
          fulfillmentTrackingInfoUpdate(fulfillmentId: $id, trackingInfoInput: $info, notifyCustomer: $notify) {
            userErrors { field message }
          }
        }`,
        { id: ctx.fulfillmentId, info: { numbers }, notify },
      );
      if (r.fulfillmentTrackingInfoUpdate.userErrors.length)
        throw new ShopifyError(
          `Sendungsnummer melden: ${user(r.fulfillmentTrackingInfoUpdate.userErrors)}`,
          'user',
        );
      await this.cdb.run(t, (tx, c) =>
        this.log(tx, c, ch.id, 'info', `Sendungsnummer zu ${order.number} an Shopify gemeldet`),
      );
      return 'updated';
    }

    const fo = await this.api().graphql<{
      order: {
        name: string;
        fulfillmentOrders: {
          nodes: {
            id: string;
            status: string;
            lineItems: { nodes: { remainingQuantity: number }[] };
          }[];
        };
      } | null;
    }>(
      shop,
      `query FO($id: ID!) {
        order(id: $id) {
          name
          fulfillmentOrders(first: 20) {
            nodes { id status lineItems(first: 100) { nodes { remainingQuantity } } }
          }
        }
      }`,
      { id: orderGid },
    );
    if (!fo.order) throw new ShopifyError('Bestellung in Shopify nicht gefunden', 'user');
    const open = fo.order.fulfillmentOrders.nodes.filter(
      (f) =>
        ['OPEN', 'IN_PROGRESS'].includes(f.status) &&
        f.lineItems.nodes.some((l) => l.remainingQuantity > 0),
    );
    if (!open.length) {
      await this.cdb.run(t, (tx, c) =>
        this.log(
          tx,
          c,
          ch.id,
          'info',
          `${fo.order!.name}: in Shopify nichts mehr offen – kein Versand gemeldet`,
        ),
      );
      return 'skipped';
    }
    const r = await this.api().graphql<{
      fulfillmentCreate: { fulfillment: { id: string } | null; userErrors: ShopifyUserError[] };
    }>(
      shop,
      `mutation Fulfill($f: FulfillmentInput!) {
        fulfillmentCreate(fulfillment: $f) {
          fulfillment { id status }
          userErrors { field message }
        }
      }`,
      {
        f: {
          notifyCustomer: notify,
          lineItemsByFulfillmentOrder: open.map((f) => ({ fulfillmentOrderId: f.id })),
          ...(numbers.length ? { trackingInfo: { numbers } } : {}),
        },
      },
    );
    const created = r.fulfillmentCreate.fulfillment;
    if (!created)
      throw new ShopifyError(`Versand melden: ${user(r.fulfillmentCreate.userErrors)}`, 'user');
    await this.cdb.run(t, async (tx, c) => {
      await tx.externalRef.create({
        data: {
          id: uuidv7(),
          accountId: c.account.id,
          companyId: c.companyId,
          channelId: ch.id,
          entityType: 'fulfillment',
          externalId: created.id,
          internalId: order.id,
        },
      });
      await this.log(
        tx,
        c,
        ch.id,
        'info',
        `Versand von ${order.number} an Shopify gemeldet (${fo.order!.name})` +
          (numbers.length ? `, Sendungsnummer ${numbers.join(', ')}` : ''),
      );
    });
    return 'created';
  }

  /** Letzter Fehlversuch beim Versandmelden: im Kanalprotokoll sichtbar machen. */
  async fulfillmentFailed(job: QueuedJob, error: unknown): Promise<void> {
    const t = await this.contextFor(job);
    if (!t) return;
    const chId = await this.cdb
      .run(t, (tx) =>
        tx.salesOrder.findUnique({
          where: { id: job.refId },
          select: { channelId: true, number: true },
        }),
      )
      .catch(() => null);
    if (!chId?.channelId) return;
    await this.channels.logError(
      t,
      chId.channelId,
      `Versand von ${chId.number} konnte nicht an Shopify gemeldet werden: ${error instanceof Error ? error.message : String(error)}`,
    );
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

  /** Sync-Fehler (letzter Versuch) im Kanal sichtbar machen. */
  async failed(job: QueuedJob, error: unknown): Promise<void> {
    const t = await this.contextFor(job);
    if (!t) return;
    await this.channels.logError(
      t,
      job.refId,
      `Abgleich fehlgeschlagen: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/** Hintergrund-Handler für das Melden des Versands. */
@Injectable()
export class ShopifyFulfillmentHandler implements JobHandler {
  readonly kind = 'shopify_fulfillment';
  constructor(@Inject(ShopifyService) private readonly shopify: ShopifyService) {}
  run(job: QueuedJob) {
    return this.shopify.runFulfillment(job);
  }
  failed(job: QueuedJob, error: unknown) {
    return this.shopify.fulfillmentFailed(job, error);
  }
}
