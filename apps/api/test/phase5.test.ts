import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { type NestFastifyApplication } from '@nestjs/platform-fastify';
import { PLANS } from '@fangevo/licensing';
import { JobQueue } from '../src/core/jobs/job-queue.service';
import { type Client, asTenant, signUp, startApp } from './helpers';

let app: NestFastifyApplication;
beforeAll(async () => {
  app = await startApp();
});
afterAll(async () => app.close());

async function setup(plan: 'starter' | 'business' | 'professional' = 'professional') {
  const s = await signUp(app, 'Import GmbH');
  s.client.companyId = s.companyId;
  if (plan !== 'starter')
    await asTenant(s.accountId, (tx) =>
      tx.entitlement.update({
        where: { accountId: s.accountId },
        data: { plan, modules: [...PLANS[plan].modules] },
      }),
    );
  const md = (await s.client.get('/company/master-data')).body;
  return { ...s, md };
}

const b64 = (s: string | Buffer) => Buffer.from(s).toString('base64');

/** Komplett durchlaufen: hochladen, Prüflauf mit Vorschlag, starten, Warteschlange abarbeiten. */
async function runImport(
  client: Client,
  entity: string,
  fileName: string,
  content: string | Buffer,
  extra: Record<string, unknown> = {},
) {
  const up = await client.post('/imports', { entity, fileName, contentBase64: b64(content) });
  expect(up.status).toBe(201);
  const dry = await client.post(`/imports/${up.body.id}/validate`, {
    mapping: up.body.suggestion,
    ...extra,
  });
  expect(dry.status).toBe(201);
  expect((await client.post(`/imports/${up.body.id}/start`)).status).toBe(201);
  const q = app.get(JobQueue);
  for (let i = 0; i < 20 && (await q.runOnce(10)) > 0; i++);
  const job = (await client.get(`/imports/${up.body.id}`)).body;
  return { upload: up.body, dry: dry.body, job };
}

describe('FangEvo Import', () => {
  it('nur mit Lizenz (ab Business)', async () => {
    const { client } = await setup('starter');
    expect((await client.get('/imports')).body.code).toBe('MODULE_NOT_LICENSED');
  });

  it('Artikel aus CSV (Semikolon, deutsche Zahlen, Windows-1252): Vorschlag, Prüflauf, Ausführung, Kategorien', async () => {
    const { client } = await setup('business');
    const csv = Buffer.from(
      'Artikelnummer;Bezeichnung;VK Netto;MwSt;Kategorie;Hersteller;EAN;Aktiv\r\n' +
        'R-100;Spinnrute Größe L;49,90;19;Angeln > Ruten;Shimano;4006381333931;ja\r\n' +
        'R-200;Köder;1.234,50;7;Angeln > Köder;;;nein\r\n' +
        'R-300;Kaputt;abc;19;;;;\r\n' +
        ';Ohne Nummer;5;19;;;;ja\r\n',
      'latin1',
    );
    const { upload, dry, job } = await runImport(client, 'articles', 'artikel.csv', csv);
    expect(upload.headers).toEqual([
      'Artikelnummer',
      'Bezeichnung',
      'VK Netto',
      'MwSt',
      'Kategorie',
      'Hersteller',
      'EAN',
      'Aktiv',
    ]);
    expect(upload.suggestion).toMatchObject({
      number: 0,
      name: 1,
      salePriceNet: 2,
      taxRate: 3,
      category: 4,
      manufacturer: 5,
      gtin: 6,
      active: 7,
    });
    expect(dry).toMatchObject({ create: 3, error: 1 });
    expect(dry.errors[0]).toMatchObject({ row: 4 });
    expect(dry.errors[0].message).toContain('abc');
    expect(job).toMatchObject({ status: 'done', okRows: 3, errorRows: 1, processedRows: 4 });
    const r = (await client.get('/articles?q=R-200')).body.items[0];
    expect(r).toMatchObject({ name: 'Köder', salePriceNet: '1234.5', active: false });
    const md = (await client.get('/company/master-data')).body;
    expect(md.categories.map((c: { name: string }) => c.name).sort()).toEqual([
      'Angeln',
      'Köder',
      'Ruten',
    ]);
    expect(md.manufacturers.map((m: { name: string }) => m.name)).toEqual(['Shimano']);
    // Ohne Nummer: automatisch vergeben
    expect((await client.get('/articles?q=Ohne Nummer')).body.items[0].number).toMatch(/^A-/);

    // Zweiter Import ändert per Nummer, legt nichts doppelt an
    const upd = await runImport(
      client,
      'articles',
      'update.csv',
      'Artikelnummer;VK Netto\nR-100;44,00\nR-999;1\n',
      { mode: 'update' },
    );
    expect(upd.dry).toMatchObject({ update: 1, error: 1 });
    const r100 = (await client.get('/articles?q=R-100')).body.items[0];
    expect(r100).toMatchObject({
      salePriceNet: '44',
      name: 'Spinnrute Größe L',
      gtin: '4006381333931',
    });

    // Rückgängig: angelegte Artikel werden archiviert
    const rb = await client.post(`/imports/${job.id}/rollback`);
    expect(rb.body.archived).toBe(3);
    expect((await client.get('/articles?q=R-200')).body.total).toBe(0);
  });

  it('Kunden, Bestände und Preise; Excel-Datei', async () => {
    const { client, md } = await setup('business');
    const k = await runImport(
      client,
      'customers',
      'kunden.csv',
      'Kundennummer,Firma,Vorname,Nachname,E-Mail,Straße,PLZ,Ort,Land\nK-9001,Angelsport Nord GmbH,,,INFO@nord.example,Hafen 1,25813,Husum,DE\nK-9002,,Erika,Muster,erika@example.test,Deich 2,25813,Husum,de\n',
    );
    expect(k.job).toMatchObject({ okRows: 2, errorRows: 0 });
    const kd = (await client.get('/customers?q=K-9001')).body.items[0];
    expect(kd).toMatchObject({ type: 'business', email: 'info@nord.example', city: 'Husum' });

    await client.post('/articles', { number: 'B-1', name: 'Blinker', salePriceNet: '3' });
    const hl = md.warehouses.find((w: { isDefault: boolean }) => w.isDefault);
    const st = await runImport(
      client,
      'stock',
      'bestand.csv',
      `Artikelnummer;Lager;Lagerplatz;Bestand\nB-1;${hl.code};R-01;12\nGIBTSNICHT;;;1\n`,
    );
    expect(st.job).toMatchObject({ okRows: 1, errorRows: 1 });
    const levels = (await client.get('/inventory/levels')).body;
    expect(levels[0]).toMatchObject({ quantity: '12', location: { code: 'R-01' } });
    // Erneut setzen: gleiche Menge ⇒ keine Buchung, kein Fehler
    expect(
      (await runImport(client, 'stock', 'b2.csv', 'Artikelnummer;Bestand\nB-1;12\n')).job.errorRows,
    ).toBe(0);

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Preise');
    ws.addRow(['Artikelnummer', 'Kundengruppe', 'Ab Menge', 'Preis netto']);
    ws.addRow(['B-1', '', 10, 2.5]);
    ws.addRow(['B-1', 'Geschäftskunden', 1, 2.2]);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const pr = await runImport(client, 'prices', 'preise.xlsx', buf);
    expect(pr.upload.headers).toEqual(['Artikelnummer', 'Kundengruppe', 'Ab Menge', 'Preis netto']);
    expect(pr.job).toMatchObject({ okRows: 2, errorRows: 0 });
    const art = (await client.get('/articles?q=B-1')).body.items[0];
    const detail = (await client.get(`/articles/${art.id}`)).body;
    expect(
      detail.prices
        .map((p: { minQuantity: string; priceNet: string }) => [p.minQuantity, p.priceNet])
        .sort(),
    ).toEqual([
      ['1', '2.2'],
      ['10', '2.5'],
    ]);
  });

  it('Export als CSV, Vorlagen, Trennung', async () => {
    const { client } = await setup('business');
    await client.post('/articles', { number: 'E-1', name: 'Export; "Test"', salePriceNet: '9.5' });
    const csv = await client.get('/imports/export/articles');
    expect(csv.headers['content-type']).toContain('text/csv');
    const text = csv.raw.toString('utf8');
    expect(text.startsWith('﻿Artikelnummer;Bezeichnung')).toBe(true);
    expect(text).toContain('E-1;"Export; ""Test""";;;Stück;9,5');
    const tpl = await client.post('/imports/templates', {
      entity: 'articles',
      name: 'JTL Artikel',
      columns: { number: 'cArtNr', name: 'cName' },
      config: { mode: 'upsert' },
    });
    expect(tpl.status).toBe(201);
    expect((await client.get('/imports/templates?entity=articles')).body).toHaveLength(1);

    const up = (
      await client.post('/imports', {
        entity: 'categories',
        fileName: 'k.csv',
        contentBase64: b64('Kategorie\nA > B\n'),
      })
    ).body;
    const two = (await client.post('/admin/companies', { name: 'Filiale', country: 'DE' })).body;
    client.companyId = two.id;
    expect((await client.get(`/imports/${up.id}`)).status).toBe(404);
    expect((await client.post(`/imports/${up.id}/validate`, { mapping: { path: 0 } })).status).toBe(
      404,
    );
    const other = await setup('business');
    expect((await other.client.get(`/imports/${up.id}`)).status).toBe(404);
  });

  it('Prüflauf ist Pflicht; leere und kaputte Dateien werden abgelehnt', async () => {
    const { client } = await setup('business');
    expect(
      (
        await client.post('/imports', {
          entity: 'articles',
          fileName: 'x.csv',
          contentBase64: b64('nur kopf\n'),
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await client.post('/imports', {
          entity: 'articles',
          fileName: 'x.xlsx',
          contentBase64: b64('PKkaputt'),
        })
      ).status,
    ).toBe(422);
    const up = (
      await client.post('/imports', {
        entity: 'articles',
        fileName: 'a.csv',
        contentBase64: b64('Bezeichnung\nA\n'),
      })
    ).body;
    expect((await client.post(`/imports/${up.id}/start`)).status).toBe(409);
    expect((await client.post(`/imports/${up.id}/validate`, { mapping: {} })).status).toBe(422);
  });
});

/** Anfrage mit API-Schlüssel (ohne Cookie, ohne CSRF-Header). */
async function keyReq(
  method: string,
  url: string,
  token: string,
  body?: unknown,
  headers: Record<string, string> = {},
) {
  const r = await app
    .getHttpAdapter()
    .getInstance()
    .inject({
      method: method as 'GET',
      url: `/api/v1${url}`,
      payload: body as object,
      headers: { authorization: `Bearer ${token}`, ...headers },
    });
  return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : undefined };
}

describe('Öffentliche API mit Schlüsseln', () => {
  it('Schlüssel einmalig anzeigen, nur erlaubte Rechte, Firma fest, sperrbar', async () => {
    const { client, companyId } = await setup('professional');
    const perms = (await client.get('/api-keys/permissions')).body.map(
      (p: { key: string }) => p.key,
    );
    expect(perms).toContain('articles.read');
    expect(perms).not.toContain('users.manage');
    expect(
      (await client.post('/api-keys', { name: 'Admin?', permissions: ['users.manage'] })).status,
    ).toBe(422);
    const k = await client.post('/api-keys', { name: 'Shop', permissions: ['articles.read'] });
    expect(k.status).toBe(201);
    expect(k.body.token).toMatch(/^fe_live_/);
    expect((await client.get('/api-keys')).body[0].token).toBeUndefined();

    await client.post('/articles', { number: 'K-1', name: 'Kescher' });
    const ok = await keyReq('GET', '/articles', k.body.token);
    expect(ok.status).toBe(200);
    expect(ok.body.items[0].number).toBe('K-1');
    // Ohne passendes Recht, ohne CSRF-Header trotzdem nur Rechte des Schlüssels
    expect((await keyReq('POST', '/articles', k.body.token, { name: 'X' })).status).toBe(403);
    expect((await keyReq('GET', '/admin/members', k.body.token)).status).toBe(403);
    // Andere Firma per Header: abgelehnt
    const two = (await client.post('/admin/companies', { name: 'Zweit', country: 'DE' })).body;
    expect(
      (await keyReq('GET', '/articles', k.body.token, undefined, { 'x-company-id': two.id }))
        .status,
    ).toBe(403);
    expect(
      (await keyReq('GET', '/articles', k.body.token, undefined, { 'x-company-id': companyId }))
        .status,
    ).toBe(200);
    // Gesperrt / falsch
    expect((await client.post(`/api-keys/${k.body.id}/revoke`)).status).toBe(204);
    expect((await keyReq('GET', '/articles', k.body.token)).status).toBe(401);
    expect((await keyReq('GET', '/articles', 'fe_live_falsch')).status).toBe(401);
  });

  it('nur mit Modul „Öffentliche API“', async () => {
    const { client } = await setup('business');
    expect((await client.get('/api-keys')).body.code).toBe('MODULE_NOT_LICENSED');
  });
});

describe('Verkaufskanäle', () => {
  it('Shop übergibt Bestellungen per API (idempotent), liest Bestand und Versandstatus', async () => {
    const { client, md } = await setup('professional');
    const hl = md.warehouses.find((w: { isDefault: boolean }) => w.isDefault).id;
    const a = (
      await client.post('/articles', {
        number: 'W-1',
        name: 'Wobbler',
        gtin: '4006381333931',
        salePriceNet: '6.5',
      })
    ).body;
    await client.post('/inventory/bookings', {
      type: 'receipt',
      articleId: a.id,
      warehouseId: hl,
      quantity: '10',
    });
    const ch = await client.post('/channels', { name: 'Mein Shop', type: 'api' });
    expect(ch.status).toBe(201);
    expect(
      (
        await client.put(`/channels/${ch.body.id}/listings/${a.id}`, {
          active: true,
          priceNet: '5,90',
        })
      ).status,
    ).toBe(200);
    const key = (
      await client.post('/api-keys', {
        name: 'Shop',
        permissions: ['channels.read', 'orders.manage', 'orders.read', 'inventory.read'],
      })
    ).body;

    const order = {
      externalId: 'SHOP-1001',
      customer: {
        email: 'Kunde@Example.test',
        firstName: 'Erika',
        lastName: 'Muster',
        externalId: 'C-77',
      },
      billingAddress: { street: 'Deichweg 1', postalCode: '25813', city: 'Husum', country: 'de' },
      lines: [{ sku: '4006381333931', quantity: 2 }],
      shippingNet: '4.90',
      paymentMethod: 'PayPal',
    };
    const r1 = await keyReq('POST', `/channels/${ch.body.id}/orders`, key.token, order);
    expect(r1.status).toBe(201);
    expect(r1.body.created).toBe(true);
    const r2 = await keyReq('POST', `/channels/${ch.body.id}/orders`, key.token, order);
    expect(r2.body).toMatchObject({ created: false, order: { id: r1.body.order.id } });
    const o = (await client.get(`/orders/${r1.body.order.id}`)).body;
    expect(o).toMatchObject({
      externalNumber: 'SHOP-1001',
      channelId: ch.body.id,
      paymentMethod: 'PayPal',
    });
    expect(o.lines[0].unitPriceNet).toBe('5.9');
    expect((await client.get('/customers?q=kunde@example.test')).body.total).toBe(1);

    const stock = await keyReq('GET', `/channels/${ch.body.id}/stock`, key.token);
    expect(stock.body.items.find((i: { number: string }) => i.number === 'W-1')).toMatchObject({
      available: '8',
      priceNet: '5.9',
      active: true,
    });

    const bad = await keyReq('POST', `/channels/${ch.body.id}/orders`, key.token, {
      ...order,
      externalId: 'SHOP-1002',
      lines: [{ sku: 'NIX', quantity: 1 }],
    });
    expect(bad.status).toBe(422);
    const logs = (await client.get(`/channels/${ch.body.id}`)).body.logs;
    expect(logs[0]).toMatchObject({ level: 'error' });
    expect(logs[0].message).toContain('SHOP-1002');

    await client.post(`/orders/${r1.body.order.id}/ship`, {});
    const st = await keyReq('GET', `/channels/${ch.body.id}/orders/SHOP-1001`, key.token);
    expect(st.body).toMatchObject({ status: 'shipped', number: o.number });
    expect(
      (await keyReq('GET', `/channels/${ch.body.id}/orders/UNBEKANNT`, key.token)).status,
    ).toBe(404);

    // Andere Firma sieht den Kanal nicht
    const two = (await client.post('/admin/companies', { name: 'Zweit', country: 'DE' })).body;
    client.companyId = two.id;
    expect((await client.get(`/channels/${ch.body.id}`)).status).toBe(404);
  });
});
