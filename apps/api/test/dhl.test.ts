import './setup-env';
import { type NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PLANS } from '@fangevo/licensing';
import { DhlService } from '../src/modules/logistics/dhl/dhl.service';
import { type FetchFn } from '../src/modules/logistics/dhl/dhl-client';
import { type Client, asTenant, inviteNewMember, signUp, startApp } from './helpers';

/**
 * DHL-Anbindung gegen ein simuliertes DHL (kein Netz): Zugang speichern (Passwort verschlüsselt,
 * nie zurückgegeben), Verbindungstest, Etikett am Packtisch, Storno bei gescheiterter Buchung,
 * Fehlermeldungen, Rechte und Mandantentrennung. Live-Test gegen die DHL-Sandbox: docs/DHL.md.
 */

const PDF = Buffer.from('%PDF-1.4 DHL-Testetikett');
const PASSWORD = 'Sandbox-Geheim#1';
let app: NestFastifyApplication;

class FakeDhl {
  tokenRequests: URLSearchParams[] = [];
  orders: { validate: boolean; printFormat: string | null; body: any }[] = [];
  deleted: string[] = [];
  rejectAddress = false;
  counter = 0;

  fetch: FetchFn = async (url, init) => {
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    const u = new URL(url);
    if (u.host !== 'api-sandbox.dhl.com') return new Response('', { status: 404 });
    if (u.pathname.endsWith('/auth/ropc/v1/token')) {
      const b = new URLSearchParams(String(init.body));
      this.tokenRequests.push(b);
      if (b.get('password') !== PASSWORD || b.get('client_secret') !== 'dhl-secret')
        return json({ error: 'invalid_grant' }, 401);
      return json({ access_token: 'dhl-token', expires_in: 1800 });
    }
    if ((init.headers as Record<string, string>).Authorization !== 'Bearer dhl-token')
      return json({}, 401);
    if (u.pathname.endsWith('/shipping/v2/orders') && init.method === 'POST') {
      const body = JSON.parse(String(init.body));
      const validate = u.searchParams.get('validate') === 'true';
      this.orders.push({ validate, printFormat: u.searchParams.get('printFormat'), body });
      if (this.rejectAddress)
        return json(
          {
            status: { title: 'Bad Request', statusCode: 400 },
            items: [
              {
                sstatus: { title: 'Bad Request', statusCode: 400 },
                validationMessages: [
                  {
                    property: 'consignee.postalCode',
                    validationMessage: 'Die Postleitzahl ist ungültig.',
                    validationState: 'Error',
                  },
                ],
              },
            ],
          },
          400,
        );
      const shipmentNo = `0034043333301020000${String(++this.counter).padStart(2, '0')}`;
      return json({
        status: { title: 'ok', statusCode: 200 },
        items: [
          {
            shipmentNo: validate ? undefined : shipmentNo,
            sstatus: { title: 'OK', statusCode: 200 },
            validationMessages: [
              {
                property: 'consignee',
                validationMessage: 'Die Straße konnte nicht gefunden werden.',
                validationState: 'Warning',
              },
            ],
            label: validate ? undefined : { b64: PDF.toString('base64'), fileFormat: 'PDF' },
          },
        ],
      });
    }
    if (u.pathname.endsWith('/shipping/v2/orders') && init.method === 'DELETE') {
      this.deleted.push(u.searchParams.get('shipment') ?? '');
      return json({ status: { statusCode: 200 } });
    }
    throw new Error(`Unerwartete Anfrage ${init.method} ${url}`);
  };
}

const dhl = new FakeDhl();

async function setup() {
  const s = await signUp(app, 'Versand GmbH');
  s.client.companyId = s.companyId;
  await asTenant(s.accountId, (tx) =>
    tx.entitlement.update({
      where: { accountId: s.accountId },
      data: { plan: 'professional', modules: [...PLANS.professional.modules] },
    }),
  );
  const company = (await s.client.get('/admin/companies?pageSize=100')).body.items.find(
    (x: { id: string }) => x.id === s.companyId,
  );
  await s.client.put(`/admin/companies/${s.companyId}`, {
    name: company.name,
    legalName: 'Versand GmbH',
    street: 'Hafenstraße 5',
    postalCode: '25813',
    city: 'Husum',
    country: 'DE',
    version: company.version,
  });
  const md = (await s.client.get('/company/master-data')).body;
  const hl = md.warehouses.find((w: { isDefault: boolean }) => w.isDefault).id as string;
  return { ...s, hl };
}

const account = {
  gkpUser: 'user-valid',
  gkpPassword: PASSWORD,
  billingNumber: '33333333330102',
  printFormat: '910-300-410',
};

async function orderFor(client: Client, hl: string, country = 'DE') {
  const a = (await client.post('/articles', { name: 'Rolle', salePriceNet: '9' })).body;
  await client.post('/inventory/bookings', {
    type: 'receipt',
    articleId: a.id,
    warehouseId: hl,
    quantity: '5',
  });
  const k = (
    await client.post('/customers', {
      type: 'private',
      firstName: 'Erika',
      lastName: 'Muster',
      email: 'erika@example.test',
      addresses: [
        { kind: 'billing', street: 'Deichweg 1', postalCode: '25813', city: 'Husum', country },
      ],
    })
  ).body;
  const o = (
    await client.post('/orders', { customerId: k.id, lines: [{ articleId: a.id, quantity: '1' }] })
  ).body;
  await client.post('/pick-lists', { orderIds: [o.id] });
  return { o, a };
}

const pack = (client: Client, o: any, a: any, extra: Record<string, unknown> = {}) =>
  client.post(`/packing/orders/${o.id}/complete`, {
    carrier: 'dhl',
    parcels: [{ weightKg: '1.2' }],
    items: [{ orderLineId: o.lines[0].id, articleId: a.id, quantity: '1' }],
    ...extra,
  });

beforeAll(async () => {
  app = await startApp({ DHL_API_KEY: 'dhl-key', DHL_API_SECRET: 'dhl-secret' });
  app.get(DhlService).useFetch(dhl.fetch);
});
afterAll(async () => {
  await app?.close();
});

describe('DHL-Anbindung', () => {
  it('Zugang speichern: Passwort verschlüsselt und nie in der Antwort; Verbindungstest', async () => {
    const { client, accountId } = await setup();
    expect((await client.get('/packing/carriers/dhl')).body).toMatchObject({
      configured: true,
      env: 'sandbox',
      account: null,
    });
    expect(
      (await client.put('/packing/carriers/dhl', { ...account, gkpPassword: null })).status,
    ).toBe(422);
    expect(
      (await client.put('/packing/carriers/dhl', { ...account, billingNumber: '123' })).status,
    ).toBe(422);
    expect((await client.put('/packing/carriers/dhl', account)).status).toBe(200);
    const view = await client.get('/packing/carriers/dhl');
    expect(view.body.account).toMatchObject({ gkpUser: 'user-valid', hasPassword: true });
    expect(JSON.stringify(view.body)).not.toContain(PASSWORD);
    const row = await asTenant(
      accountId,
      (tx) =>
        tx.$queryRaw<{ secrets_enc: string; config: unknown }[]>`
        SELECT secrets_enc, config FROM carrier_accounts`,
    );
    // Ohne Firmenkontext zeigt RLS keine Zeile; in keinem Fall steht das Passwort im Klartext
    expect(JSON.stringify(row)).not.toContain(PASSWORD);

    const test = await client.post('/packing/carriers/dhl/test');
    expect(test.body).toMatchObject({ ok: true, env: 'sandbox' });
    expect(dhl.orders.at(-1)).toMatchObject({ validate: true });
    expect(dhl.tokenRequests.at(-1)!.get('client_id')).toBe('dhl-key');

    // Passwort leer lassen = unverändert; falsches Passwort → verständliche Meldung
    expect(
      (await client.put('/packing/carriers/dhl', { ...account, gkpPassword: '' })).status,
    ).toBe(200);
    expect((await client.post('/packing/carriers/dhl/test')).body.ok).toBe(true);
    await client.put('/packing/carriers/dhl', {
      ...account,
      gkpUser: 'anderer',
      gkpPassword: 'falsch',
    });
    const bad = (await client.post('/packing/carriers/dhl/test')).body;
    expect(bad.ok).toBe(false);
    expect(bad.error).toContain('Anmeldung abgelehnt');
    expect((await client.get('/packing/carriers/dhl')).body.account.lastError).toContain(
      'abgelehnt',
    );
  });

  it('Packtisch: Etikett und Sendungsnummer von DHL, Warnungen bleiben sichtbar', async () => {
    const { client, hl } = await setup();
    await client.put('/packing/carriers/dhl', account);
    const { o, a } = await orderFor(client, hl);
    const r = await pack(client, o, a);
    expect(r.status).toBe(201);
    expect(r.body.shipment).toMatchObject({ carrier: 'dhl', hasLabel: true });
    expect(r.body.shipment.trackingNumber).toMatch(/^003404333330102/);
    expect(r.body.warnings.join(' ')).toContain('DHL: consignee');
    const sent = dhl.orders.at(-1)!;
    expect(sent).toMatchObject({ validate: false, printFormat: '910-300-410' });
    expect(sent.body.shipments[0]).toMatchObject({
      product: 'V01PAK',
      billingNumber: '33333333330102',
      shipper: { name1: 'Versand GmbH', addressStreet: 'Hafenstraße 5', country: 'DEU' },
      consignee: {
        name1: 'Erika Muster',
        addressStreet: 'Deichweg 1',
        postalCode: '25813',
        city: 'Husum',
        country: 'DEU',
      },
      details: { weight: { uom: 'kg', value: 1.2 } },
    });
    expect(sent.body.shipments[0].refNo).toContain(o.number);
    const label = await client.get(`/packing/shipments/${r.body.shipment.id}/label`);
    expect(label.status).toBe(200);
    expect(label.raw.subarray(0, 8).toString()).toBe('%PDF-1.4');
    expect((await client.get(`/orders/${o.id}`)).body.status).toBe('shipped');
  });

  it('Fehler von DHL: nichts wird gebucht; gescheiterte Buchung storniert die DHL-Sendung', async () => {
    const { client, hl } = await setup();
    const { o, a } = await orderFor(client, hl);
    // Ohne Zugang
    const none = await pack(client, o, a);
    expect(none.status).toBe(422);
    expect(none.body.detail).toContain('nicht eingerichtet');
    await client.put('/packing/carriers/dhl', account);
    // Mehrere Pakete
    expect(
      (await pack(client, o, a, { parcels: [{ weightKg: '1' }, { weightKg: '1' }] })).status,
    ).toBe(422);
    // DHL lehnt die Adresse ab
    dhl.rejectAddress = true;
    const rejected = await pack(client, o, a);
    dhl.rejectAddress = false;
    expect(rejected.status).toBe(422);
    expect(rejected.body.detail).toContain('Postleitzahl ist ungültig');
    expect((await client.get(`/orders/${o.id}`)).body.status).not.toBe('shipped');
    // Unvollständig gepackt: Prüfung schlägt vor dem DHL-Aufruf fehl
    const calls = dhl.orders.length;
    expect((await pack(client, o, a, { items: [] })).status).toBe(422);
    expect(dhl.orders.length).toBe(calls);
    // Buchung scheitert nach dem Etikett (unbekannter Packplatz) → Storno bei DHL
    const failed = await pack(client, o, a, {
      stationId: '01a00000-0000-7000-8000-000000000000',
    });
    expect(failed.status).toBe(422);
    expect(dhl.deleted).toHaveLength(1);
    expect((await client.get(`/orders/${o.id}`)).body.status).not.toBe('shipped');
    // Drittland
    const us = await orderFor(client, hl, 'US');
    const r = await pack(client, us.o, us.a);
    expect(r.status).toBe(422);
    expect(r.body.detail).toContain('Zollangaben');
  });

  it('Rechte und Mandantentrennung', async () => {
    const a = await setup();
    await a.client.put('/packing/carriers/dhl', account);
    const b = await setup();
    expect((await b.client.get('/packing/carriers/dhl')).body.account).toBeNull();
    const m = await inviteNewMember(app, a.client, { allCompanies: true });
    m.client.companyId = a.companyId;
    expect((await m.client.get('/packing/carriers/dhl')).status).toBe(403);
    expect((await m.client.put('/packing/carriers/dhl', account)).status).toBe(403);
  });
});
