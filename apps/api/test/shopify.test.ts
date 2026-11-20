import './setup-env';
import { createHmac } from 'node:crypto';
import { type NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PLANS } from '@fangevo/licensing';
import { JobQueue } from '../src/core/jobs/job-queue.service';
import { ShopifyService } from '../src/modules/channels/shopify/shopify.service';
import { type FetchFn } from '../src/modules/channels/shopify/shopify-client';
import { type Client, asTenant, drainEvents, inviteNewMember, signUp } from './helpers';

/**
 * Shopify-Anbindung gegen einen simulierten Shop (kein Netz): Verbinden mit signiertem Aufruf,
 * Bestellungen übernehmen (netto, idempotent, Wiederholung nach Fehler), Artikel verknüpfen,
 * Bestand setzen (Vergleich-und-Tausch), Versand melden, Rechte und Mandantentrennung.
 * Der echte Test gegen den Dev-Shop steht in docs/SHOPIFY.md.
 */

const SECRET = 'test-secret';
const SHOP = 'fangevo-test.myshopify.com';
let app: NestFastifyApplication;

function signed(shop = SHOP, ts = Math.floor(Date.now() / 1000), secret = SECRET) {
  const p: Record<string, string> = {
    shop,
    timestamp: String(ts),
    host: 'YWRtaW4uc2hvcGlmeS5jb20',
  };
  const msg = Object.keys(p)
    .sort()
    .map((k) => `${k}=${p[k]}`)
    .join('&');
  return { ...p, hmac: createHmac('sha256', secret).update(msg).digest('hex') };
}

interface FakeOrder {
  id: string;
  name: string;
  status: 'PAID' | 'PENDING';
  sku: string;
  qty: number;
  gross: string;
  updatedAt: string;
  cancelledAt?: string | null;
}

/** Simulierter Shopify-Shop (Token-Endpunkt und die benötigten GraphQL-Operationen). */
class FakeShop {
  orders: FakeOrder[] = [];
  variants = [
    {
      id: 'gid://shopify/ProductVariant/1',
      sku: 'W-1',
      barcode: null,
      item: 'gid://shopify/InventoryItem/11',
    },
    {
      id: 'gid://shopify/ProductVariant/2',
      sku: 'SHOP-SKU',
      barcode: '4006381333948',
      item: 'gid://shopify/InventoryItem/12',
    },
    {
      id: 'gid://shopify/ProductVariant/3',
      sku: 'GIBTS-NICHT',
      barcode: null,
      item: 'gid://shopify/InventoryItem/13',
    },
  ];
  levels = new Map<string, number>([
    ['gid://shopify/InventoryItem/11', 3],
    ['gid://shopify/InventoryItem/12', 0],
  ]);
  setCalls: { inventoryItemId: string; quantity: number; changeFromQuantity: number }[][] = [];
  fulfillments: { fulfillmentOrderIds: string[]; numbers?: string[]; notify: boolean }[] = [];
  tokenRequests = 0;

  order(o: FakeOrder) {
    return {
      id: o.id,
      name: o.name,
      email: 'kundin@example.test',
      phone: null,
      createdAt: '2026-11-20T08:00:00Z',
      updatedAt: o.updatedAt,
      cancelledAt: o.cancelledAt ?? null,
      test: true,
      taxesIncluded: true,
      currencyCode: 'EUR',
      displayFinancialStatus: o.status,
      displayFulfillmentStatus: 'UNFULFILLED',
      note: null,
      paymentGatewayNames: ['bogus'],
      customer: { id: 'gid://shopify/Customer/9', firstName: 'Erika', lastName: 'Muster' },
      billingAddress: {
        firstName: 'Erika',
        lastName: 'Muster',
        address1: 'Deichweg 1',
        zip: '25813',
        city: 'Husum',
        countryCodeV2: 'DE',
      },
      shippingAddress: null,
      shippingLine: {
        title: 'Standard',
        discountedPriceSet: { shopMoney: { amount: '4.90' } },
        taxLines: [{ rate: 0.19 }],
      },
      lineItems: {
        nodes: [
          {
            name: o.sku,
            sku: o.sku,
            currentQuantity: o.qty,
            variant: this.variants.find((v) => v.sku === o.sku)
              ? { id: this.variants.find((v) => v.sku === o.sku)!.id, sku: o.sku, barcode: null }
              : null,
            discountedUnitPriceAfterAllDiscountsSet: { shopMoney: { amount: o.gross } },
            taxLines: [{ rate: 0.19 }],
          },
        ],
      },
    };
  }

  fetch: FetchFn = async (url, init) => {
    const ok = (data: unknown) =>
      new Response(JSON.stringify({ data }), { headers: { 'content-type': 'application/json' } });
    if (!url.startsWith(`https://${SHOP}/`)) return new Response('not found', { status: 404 });
    if (url.endsWith('/admin/oauth/access_token')) {
      this.tokenRequests++;
      const b = new URLSearchParams(String(init.body));
      if (b.get('client_secret') !== SECRET) return new Response('{}', { status: 401 });
      return new Response(
        JSON.stringify({
          access_token: 'shpat_test',
          expires_in: 86399,
          scope:
            'read_orders,read_products,read_inventory,write_inventory,read_locations,read_merchant_managed_fulfillment_orders,write_merchant_managed_fulfillment_orders',
        }),
      );
    }
    const { query, variables } = JSON.parse(String(init.body)) as {
      query: string;
      variables: Record<string, any>;
    };
    if (query.includes('myshopifyDomain'))
      return ok({
        shop: { name: 'Test-Angelshop', myshopifyDomain: SHOP, currencyCode: 'EUR' },
        locations: {
          nodes: [
            {
              id: 'gid://shopify/Location/1',
              name: 'Lager Husum',
              isActive: true,
              fulfillsOnlineOrders: true,
            },
          ],
        },
      });
    if (query.includes('query Orders')) {
      const since = /updated_at:>='([^']+)'/.exec(variables.query)![1]!;
      const nodes = this.orders
        .filter((o) => o.updatedAt >= since)
        .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
        .map((o) => this.order(o));
      return ok({ orders: { pageInfo: { hasNextPage: false, endCursor: null }, nodes } });
    }
    if (query.includes('query Retry'))
      return ok({
        nodes: (variables.ids as string[]).map((id) => {
          const o = this.orders.find((x) => x.id === id);
          return o ? this.order(o) : null;
        }),
      });
    if (query.includes('query Variants'))
      return ok({
        productVariants: {
          pageInfo: { hasNextPage: false, endCursor: null },
          nodes: this.variants.map((v) => ({
            id: v.id,
            sku: v.sku,
            barcode: v.barcode,
            displayName: `Produkt – ${v.sku}`,
            product: { id: 'gid://shopify/Product/1' },
            inventoryItem: { id: v.item, tracked: true },
          })),
        },
      });
    if (query.includes('query Levels'))
      return ok({
        nodes: (variables.ids as string[]).map((id) => ({
          id,
          inventoryLevel: this.levels.has(id)
            ? { quantities: [{ name: 'available', quantity: this.levels.get(id) }] }
            : null,
        })),
      });
    if (query.includes('mutation SetQty')) {
      const q = variables.input.quantities as {
        inventoryItemId: string;
        quantity: number;
        changeFromQuantity: number;
      }[];
      this.setCalls.push(q);
      for (const x of q)
        if (this.levels.get(x.inventoryItemId) !== x.changeFromQuantity)
          return ok({
            inventorySetQuantities: {
              userErrors: [{ code: 'CHANGE_FROM_QUANTITY_STALE', field: null, message: 'stale' }],
            },
          });
      for (const x of q) this.levels.set(x.inventoryItemId, x.quantity);
      return ok({ inventorySetQuantities: { userErrors: [] } });
    }
    if (query.includes('query FO')) {
      const done = this.fulfillments.length > 0;
      return ok({
        order: {
          name: '#1001',
          fulfillmentOrders: {
            nodes: [
              {
                id: 'gid://shopify/FulfillmentOrder/77',
                status: done ? 'CLOSED' : 'OPEN',
                lineItems: { nodes: [{ remainingQuantity: done ? 0 : 2 }] },
              },
            ],
          },
        },
      });
    }
    if (query.includes('mutation Fulfill')) {
      const f = variables.f;
      this.fulfillments.push({
        fulfillmentOrderIds: f.lineItemsByFulfillmentOrder.map(
          (x: { fulfillmentOrderId: string }) => x.fulfillmentOrderId,
        ),
        numbers: f.trackingInfo?.numbers,
        notify: f.notifyCustomer,
      });
      return ok({
        fulfillmentCreate: {
          fulfillment: { id: 'gid://shopify/Fulfillment/900', status: 'SUCCESS' },
          userErrors: [],
        },
      });
    }
    throw new Error(`Unerwartete Anfrage: ${query.slice(0, 80)}`);
  };
}

const shop = new FakeShop();

async function setup() {
  const s = await signUp(app, 'Shopify GmbH');
  s.client.companyId = s.companyId;
  await asTenant(s.accountId, (tx) =>
    tx.entitlement.update({
      where: { accountId: s.accountId },
      data: { plan: 'professional', modules: [...PLANS.professional.modules] },
    }),
  );
  const md = (await s.client.get('/company/master-data')).body;
  const hl = md.warehouses.find((w: { isDefault: boolean }) => w.isDefault).id as string;
  const connect = async () => {
    const r = await s.client.post('/channels/shopify/connect', { params: signed() });
    if (r.body?.channel?.id) created.push({ client: s.client, id: r.body.channel.id });
    return r;
  };
  return { ...s, hl, connect };
}

async function work() {
  const q = app.get(JobQueue);
  await drainEvents(app);
  for (let i = 0; i < 20 && (await q.runOnce(10)) > 0; i++) await drainEvents(app);
}

beforeAll(async () => {
  const { startApp } = await import('./helpers');
  app = await startApp({ SHOPIFY_CLIENT_ID: 'test-client', SHOPIFY_CLIENT_SECRET: SECRET });
  app.get(ShopifyService).useFetch(shop.fetch);
});
const created: { client: Client; id: string }[] = [];
afterAll(async () => {
  // Kanäle archivieren, damit spätere Testläufe sie nicht mehr einplanen (Testdatenbank wird nicht geleert)
  for (const c of created) await c.client.post(`/channels/${c.id}/archive`);
  await app?.close();
});

describe('Shopify-Anbindung', () => {
  it('Verbinden nur mit gültig signiertem, frischem Aufruf aus Shopify', async () => {
    const { client, connect } = await setup();
    const bad = await client.post('/channels/shopify/connect', {
      params: { ...signed(), hmac: 'a'.repeat(64) },
    });
    expect(bad.status).toBe(403);
    const old = await client.post('/channels/shopify/connect', {
      params: signed(SHOP, Math.floor(Date.now() / 1000) - 7200),
    });
    expect(old.status).toBe(422);
    const wrongKey = await client.post('/channels/shopify/connect', {
      params: signed(SHOP, undefined, 'falsch'),
    });
    expect(wrongKey.status).toBe(403);
    const r = await connect();
    expect(r.status).toBe(201);
    expect(r.body.created).toBe(true);
    expect(r.body.channel).toMatchObject({ type: 'shopify', name: 'Shopify Test-Angelshop' });
    expect(r.body.channel.config.shopify).toMatchObject({
      shopDomain: SHOP,
      locationId: 'gid://shopify/Location/1',
    });
    expect(r.body.channel.secretsEnc).toBeUndefined();
    const again = await client.post('/channels/shopify/connect', { params: signed() });
    expect(again.body).toMatchObject({ created: false, channel: { id: r.body.channel.id } });
    // Ohne Verbindung aus Shopify kein Shopify-Kanal
    const direct = await client.post('/channels', {
      name: 'Direkt',
      type: 'shopify',
      shopify: { shopDomain: SHOP },
    });
    expect(direct.status).toBe(422);
  });

  it('Bestellungen, Verknüpfung, Bestand und Versand', async () => {
    const { client, hl, connect } = await setup();
    const art = async (number: string, gtin?: string) => {
      const a = (await client.post('/articles', { number, name: number, gtin, salePriceNet: '9' }))
        .body;
      await client.post('/inventory/bookings', {
        type: 'receipt',
        articleId: a.id,
        warehouseId: hl,
        quantity: '10',
      });
      return a;
    };
    await art('W-1');
    await art('K-7', '4006381333948'); // verknüpft über Barcode
    const ch = (await connect()).body.channel;
    shop.orders = [
      {
        id: 'gid://shopify/Order/1',
        name: '#1001',
        status: 'PAID',
        sku: 'W-1',
        qty: 2,
        gross: '11.90',
        updatedAt: '2026-11-20T09:00:00Z',
      },
      {
        id: 'gid://shopify/Order/2',
        name: '#1002',
        status: 'PENDING',
        sku: 'W-1',
        qty: 1,
        gross: '11.90',
        updatedAt: '2026-11-20T09:01:00Z',
      },
      {
        id: 'gid://shopify/Order/3',
        name: '#1003',
        status: 'PAID',
        sku: 'NEU-1',
        qty: 1,
        gross: '5.95',
        updatedAt: '2026-11-20T09:02:00Z',
      },
    ];
    // Zeitpunkt der Bestellungen liegt vor „heute − 7 Tage“? Für den Test ab 2026-11-01 übernehmen.
    const detail = (await client.get(`/channels/${ch.id}`)).body;
    expect(
      (
        await client.put(`/channels/${ch.id}`, {
          type: 'shopify',
          name: detail.name,
          warehouseId: hl,
          active: true,
          shopify: { ...detail.config.shopify, importSince: '2026-11-01' },
        })
      ).status,
    ).toBe(200);

    expect((await client.post(`/channels/${ch.id}/shopify/sync`, {})).status).toBe(201);
    await work();

    const orders = (await client.get('/orders?pageSize=50')).body.items as {
      id: string;
      externalNumber: string;
      channelId: string;
    }[];
    const o1 = orders.find((o) => o.externalNumber === '#1001');
    expect(o1?.channelId).toBe(ch.id);
    expect(orders.find((o) => o.externalNumber === '#1002')).toBeUndefined(); // unbezahlt
    expect(orders.find((o) => o.externalNumber === '#1003')).toBeUndefined(); // Artikel fehlt
    const full = (await client.get(`/orders/${o1!.id}`)).body;
    expect(full.lines[0].unitPriceNet).toMatch(/^10(\.0+)?$/);
    expect(full.shippingNet).toMatch(/^4\.1176/);

    let d = (await client.get(`/channels/${ch.id}`)).body;
    expect(d.config.shopifyState.failedOrders).toEqual(['gid://shopify/Order/3']);
    expect(
      d.logs.some(
        (l: { message: string }) => l.message.includes('#1003') && l.message.includes('NEU-1'),
      ),
    ).toBe(true);
    expect(d.config.shopifyState.links).toMatchObject({ linked: 2, variants: 3, unmatched: 1 });

    // Bestand: W-1 hat 10, davon 2 reserviert → 8; K-7 → 10. Shopify vorher 3 bzw. 0.
    expect(shop.levels.get('gid://shopify/InventoryItem/11')).toBe(8);
    expect(shop.levels.get('gid://shopify/InventoryItem/12')).toBe(10);
    expect(shop.setCalls.at(-1)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          inventoryItemId: 'gid://shopify/InventoryItem/11',
          quantity: 8,
          changeFromQuantity: 3,
        }),
      ]),
    );

    // Fehlenden Artikel anlegen → beim nächsten Abgleich wird #1003 übernommen
    await art('NEU-1');
    await client.post(`/channels/${ch.id}/shopify/sync`, {});
    await work();
    d = (await client.get(`/channels/${ch.id}`)).body;
    expect(d.config.shopifyState.failedOrders).toEqual([]);
    const after = (await client.get('/orders?pageSize=50')).body.items as {
      externalNumber: string;
    }[];
    expect(after.filter((o) => o.externalNumber === '#1001')).toHaveLength(1); // nicht doppelt
    expect(after.some((o) => o.externalNumber === '#1003')).toBe(true);

    // Gleicher Bestand in Shopify → keine weitere Änderung
    const calls = shop.setCalls.length;
    await client.post(`/channels/${ch.id}/shopify/sync`, {});
    await work();
    expect(shop.setCalls.length).toBe(calls);

    // Versand → an Shopify melden (einmal)
    expect((await client.post(`/orders/${o1!.id}/ship`, {})).status).toBe(201);
    await work();
    expect(shop.fulfillments).toHaveLength(1);
    expect(shop.fulfillments[0]).toMatchObject({
      fulfillmentOrderIds: ['gid://shopify/FulfillmentOrder/77'],
      notify: true,
    });
    d = (await client.get(`/channels/${ch.id}`)).body;
    expect(d.logs.some((l: { message: string }) => l.message.includes('an Shopify gemeldet'))).toBe(
      true,
    );

    // Storno in Shopify nach Übernahme → Warnung im Protokoll
    shop.orders.push({
      ...shop.orders[2]!,
      cancelledAt: '2026-11-20T10:00:00Z',
      updatedAt: '2026-11-20T10:00:00Z',
    });
    shop.orders.splice(2, 1);
    await client.post(`/channels/${ch.id}/shopify/sync`, {});
    await work();
    d = (await client.get(`/channels/${ch.id}`)).body;
    expect(
      d.logs.some(
        (l: { level: string; message: string }) =>
          l.level === 'warning' && l.message.includes('#1003 wurde in Shopify storniert'),
      ),
    ).toBe(true);
  });

  it('Zeitsteuerung plant aktive Shopify-Kanäle ein', async () => {
    const { connect } = await setup();
    const ch = (await connect()).body.channel;
    const svc = app.get(ShopifyService);
    expect(await svc.tick(new Date(Date.now() + 1000))).toBeGreaterThan(0);
    const { ownerDb } = await import('./helpers');
    const jobs = await ownerDb().jobQueue.count({ where: { kind: 'shopify_sync', refId: ch.id } });
    expect(jobs).toBe(1);
    await work();
  });

  it('Rechte und Mandantentrennung', async () => {
    const a = await setup();
    const ch = (await a.connect()).body.channel;
    // Andere Firma/anderer Account sieht den Kanal nicht und kann nichts auslösen
    const b = await setup();
    expect((await b.client.get(`/channels/${ch.id}`)).status).toBe(404);
    expect((await b.client.post(`/channels/${ch.id}/shopify/sync`, {})).status).toBe(404);
    expect((await b.client.get(`/channels/${ch.id}/shopify/links`)).status).toBe(404);
    // Mitarbeiter ohne Recht „Verkaufskanäle verwalten“
    const m = await inviteNewMember(app, a.client, { allCompanies: true });
    m.client.companyId = a.companyId;
    expect((await m.client.post('/channels/shopify/connect', { params: signed() })).status).toBe(
      403,
    );
    expect((await m.client.post(`/channels/${ch.id}/shopify/sync`, {})).status).toBe(403);
  });
});
