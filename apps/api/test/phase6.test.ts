import { createServer, type IncomingMessage, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type NestFastifyApplication } from '@nestjs/platform-fastify';
import { withTenant } from '@fangevo/database';
import { PLANS } from '@fangevo/licensing';
import { JobQueue } from '../src/core/jobs/job-queue.service';
import { isPrivateAddress, sign } from '../src/modules/automation/webhooks.service';
import { WorkflowsService } from '../src/modules/automation/workflows.service';
import { type Client, asTenant, drainEvents, ownerDb, signUp, startApp } from './helpers';

let app: NestFastifyApplication;
let server: Server;
let port = 0;
let status = 200;
const received: { headers: IncomingMessage['headers']; body: string }[] = [];

beforeAll(async () => {
  app = await startApp();
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (c: Buffer) => (body += c.toString()));
    req.on('end', () => {
      received.push({ headers: req.headers, body });
      res.statusCode = status;
      res.end('ok');
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  port = (server.address() as { port: number }).port;
});
afterAll(async () => {
  server.close();
  await app.close();
});

async function setup(plan: 'business' | 'professional' = 'professional') {
  const s = await signUp(app, 'Automatik GmbH');
  s.client.companyId = s.companyId;
  await asTenant(s.accountId, (tx) =>
    tx.entitlement.update({
      where: { accountId: s.accountId },
      data: { plan, modules: [...PLANS[plan].modules] },
    }),
  );
  return s;
}

/** Ereignisse und Hintergrundaufgaben abarbeiten (wie der Worker). */
async function work() {
  const q = app.get(JobQueue);
  for (let i = 0; i < 10; i++) {
    await drainEvents(app);
    if ((await q.runOnce(50)) === 0) {
      await drainEvents(app);
      if ((await q.runOnce(50)) === 0) break;
    }
  }
}

async function order(client: Client, price: string) {
  const k = (
    await client.post('/customers', {
      type: 'private',
      lastName: 'Muster',
      addresses: [
        { kind: 'billing', street: 'Weg 1', postalCode: '25813', city: 'Husum', country: 'AT' },
      ],
    })
  ).body;
  const a = (
    await client.post('/articles', { name: 'Rute', salePriceNet: price, stockTracked: false })
  ).body;
  const o = await client.post('/orders', {
    customerId: k.id,
    lines: [{ articleId: a.id, quantity: '1' }],
  });
  expect(o.status).toBe(201);
  return o.body as { id: string; number: string };
}

describe('Webhooks', () => {
  it('signierte Zustellung bei neuem Auftrag, Protokoll, Ping', async () => {
    const { client } = await setup();
    const w = await client.post('/webhooks', {
      name: 'Shop',
      url: `http://127.0.0.1:${port}/hook`,
      events: ['order.created'],
    });
    expect(w.status).toBe(201);
    expect(w.body.secret).toMatch(/^whsec_/);
    expect((await client.get('/webhooks')).body[0].secret).toBeUndefined();
    received.length = 0;
    const o = await order(client, '50');
    await work();
    const hit = received.find((r) => r.headers['x-fangevo-event'] === 'order.created');
    expect(hit).toBeTruthy();
    const body = JSON.parse(hit!.body);
    expect(body).toMatchObject({
      type: 'order.created',
      data: { entityType: 'order', entityId: o.id, number: o.number },
    });
    expect(hit!.headers['x-fangevo-signature']).toBe(
      sign(w.body.secret, String(hit!.headers['x-fangevo-timestamp']), hit!.body),
    );
    const dl = (await client.get(`/webhooks/${w.body.id}/deliveries`)).body;
    expect(dl[0]).toMatchObject({ status: 'delivered', responseStatus: 200, attempts: 1 });

    expect((await client.post(`/webhooks/${w.body.id}/ping`)).status).toBe(201);
    await work();
    expect(received.some((r) => r.headers['x-fangevo-event'] === 'ping')).toBe(true);
  });

  it('Fehler werden später wiederholt; private Ziele sind in Produktion gesperrt', async () => {
    const { client } = await setup();
    const w = (
      await client.post('/webhooks', {
        name: 'Kaputt',
        url: `http://127.0.0.1:${port}/x`,
        events: ['order.created'],
      })
    ).body;
    status = 500;
    await order(client, '5');
    await work();
    status = 200;
    const d = (await client.get(`/webhooks/${w.id}/deliveries`)).body[0];
    expect(d).toMatchObject({ status: 'pending', attempts: 1, responseStatus: 500 });
    expect(isPrivateAddress('127.0.0.1')).toBe(true);
    expect(isPrivateAddress('10.1.2.3')).toBe(true);
    expect(isPrivateAddress('192.168.0.5')).toBe(true);
    expect(isPrivateAddress('169.254.169.254')).toBe(true);
    expect(isPrivateAddress('::1')).toBe(true);
    expect(isPrivateAddress('::ffff:10.0.0.1')).toBe(true);
    expect(isPrivateAddress('8.8.8.8')).toBe(false);
    expect(
      (
        await client.post('/webhooks', {
          name: 'ftp',
          url: 'ftp://x.example',
          events: ['order.created'],
        })
      ).status,
    ).toBe(422);
  });
});

describe('Regeln (Workflows)', () => {
  it('Wenn neue Bestellung ab 100 € aus AT, dann Status, Versandart, Benachrichtigung; sonst übersprungen', async () => {
    const { client } = await setup();
    const rule = await client.post('/workflows', {
      name: 'Große Bestellungen',
      active: true,
      definition: {
        trigger: { type: 'order.created' },
        conditions: [
          { field: 'order.totalGross', op: 'gte', value: '100' },
          { field: 'order.customerCountry', op: 'eq', value: 'at' },
        ],
        actions: [
          { type: 'set_order_status', status: 'awaiting_payment' },
          { type: 'set_shipping_method', value: 'Spedition' },
          {
            type: 'notify',
            permission: 'orders.read',
            title: 'Großauftrag {{order.number}}',
            message: '{{order.totalGross}} €',
          },
        ],
      },
    });
    expect(rule.status).toBe(201);
    const big = await order(client, '200');
    const small = await order(client, '10');
    await work();
    const b = (await client.get(`/orders/${big.id}`)).body;
    expect(b).toMatchObject({ status: 'awaiting_payment', shippingMethod: 'Spedition' });
    expect((await client.get(`/orders/${small.id}`)).body.status).toBe('new');
    const detail = (await client.get(`/workflows/${rule.body.id}`)).body;
    const runs = detail.runs as {
      status: string;
      steps: { ok: boolean }[];
      error: string | null;
    }[];
    expect(runs.map((r) => r.status).sort()).toEqual(['skipped', 'success']);
    expect(runs.find((r) => r.status === 'success')!.steps.every((s) => s.ok)).toBe(true);
    const notes = (await client.get('/notifications')).body;
    expect(JSON.stringify(notes)).toContain(`Großauftrag ${big.number}`);

    // Testlauf ändert nichts
    const t = await client.post(`/workflows/${rule.body.id}/test`, { entityId: small.id });
    expect(t.body).toMatchObject({ matched: false });
    expect(t.body.conditions[0]).toMatchObject({ ok: false, actual: 11.9 });

    // Neue Fassung = neue Version; alte Fassungen sind unveränderlich
    const upd = await client.put(`/workflows/${rule.body.id}`, {
      name: 'Große Bestellungen',
      active: false,
      definition: {
        trigger: { type: 'order.created' },
        conditions: [],
        actions: [{ type: 'set_shipping_method', value: 'DHL' }],
      },
    });
    expect(upd.body.currentVersion).toBe(2);
    expect((await client.get(`/workflows/${rule.body.id}`)).body.versions).toHaveLength(2);
    await expect(
      withTenant(
        ownerDb(),
        { accountId: detail.accountId, userId: null, companyId: detail.companyId },
        (tx) =>
          tx.workflowVersion.updateMany({ where: { ruleId: rule.body.id }, data: { version: 99 } }),
      ),
    ).rejects.toThrow();
  });

  it('Schutz vor Endlosschleifen bei sich gegenseitig auslösenden Regeln', async () => {
    const { client } = await setup();
    const mk = (name: string, to: string, set: string) =>
      client.post('/workflows', {
        name,
        active: true,
        definition: {
          trigger: { type: 'order.status_changed', toStatus: to },
          actions: [{ type: 'set_order_status', status: set }],
        },
      });
    expect((await mk('Hin', 'in_progress', 'awaiting_payment')).status).toBe(201);
    expect((await mk('Her', 'awaiting_payment', 'in_progress')).status).toBe(201);
    const o = await order(client, '20');
    await client.post(`/orders/${o.id}/status`, { to: 'in_progress' });
    await work();
    await work();
    const list = (await client.get('/workflows')).body.items as { id: string }[];
    const runs = (
      await Promise.all(list.map(async (r) => (await client.get(`/workflows/${r.id}`)).body.runs))
    ).flat() as { status: string }[];
    expect(runs.filter((r) => r.status === 'success').length).toBeLessThanOrEqual(6);
    expect(runs.some((r) => r.status === 'skipped')).toBe(true);
  });

  it('zeitgesteuert: Artikel unter Mindestbestand → Benachrichtigung; ungültige Aktionen abgelehnt', async () => {
    const { client } = await setup();
    await client.post('/articles', { number: 'LOW-1', name: 'Knapp', minStock: '5' });
    const bad = await client.post('/workflows', {
      name: 'Falsch',
      definition: {
        trigger: { type: 'stock.low' },
        actions: [{ type: 'set_order_status', status: 'picking' }],
      },
    });
    expect(bad.status).toBe(422);
    const r = await client.post('/workflows', {
      name: 'Nachbestellen',
      active: true,
      definition: {
        trigger: { type: 'schedule', schedule: { every: 'day', hour: 7, check: 'low_stock' } },
        actions: [
          {
            type: 'notify',
            permission: 'inventory.read',
            title: '{{article.number}} nachbestellen',
          },
        ],
      },
    });
    expect(r.status).toBe(201);
    expect(
      await app.get(WorkflowsService).tick(new Date(Date.now() + 2 * 86_400_000)),
    ).toBeGreaterThan(0);
    await work();
    const runs = (await client.get(`/workflows/${r.body.id}`)).body.runs;
    expect(runs[0]).toMatchObject({ status: 'success', eventType: 'schedule' });
    expect(JSON.stringify((await client.get('/notifications')).body)).toContain(
      'LOW-1 nachbestellen',
    );
  });

  it('nur mit Modul Automatisierung; andere Firmen sehen nichts', async () => {
    const b = await setup('business');
    expect((await b.client.get('/workflows')).body.code).toBe('MODULE_NOT_LICENSED');
    const { client } = await setup();
    const r = (
      await client.post('/workflows', {
        name: 'X',
        definition: {
          trigger: { type: 'order.created' },
          actions: [{ type: 'set_shipping_method', value: 'DHL' }],
        },
      })
    ).body;
    const two = (await client.post('/admin/companies', { name: 'Zweit', country: 'DE' })).body;
    client.companyId = two.id;
    expect((await client.get(`/workflows/${r.id}`)).status).toBe(404);
    expect((await client.get('/workflows')).body.total).toBe(0);
  });
});
