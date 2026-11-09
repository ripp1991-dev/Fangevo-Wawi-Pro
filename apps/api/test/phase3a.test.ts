import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type NestFastifyApplication } from '@nestjs/platform-fastify';
import { createPrismaClient, uuidv7, withTenant } from '@fangevo/database';
import { Client, asTenant, inviteNewMember, roleIdByName, signUp, startApp } from './helpers';

let app: NestFastifyApplication;
beforeAll(async () => {
  app = await startApp();
});
afterAll(async () => app.close());

/** Konto mit aktiver Firma (Header X-Company-Id gesetzt). */
async function setup(name = 'Handel GmbH') {
  const s = await signUp(app, name);
  s.client.companyId = s.companyId;
  const md = (await s.client.get('/company/master-data')).body;
  return { ...s, md };
}

describe('Firmeneinstellungen', () => {
  it('legt Standardwerte an: Steuersätze, Kundengruppen, Hauptlager, Nummernkreise', async () => {
    const { md } = await setup();
    expect(md.taxRates.map((t: { rate: string }) => t.rate).sort()).toEqual(['0', '19', '7']);
    expect(md.taxRates.find((t: { isDefault: boolean }) => t.isDefault).rate).toBe('19');
    expect(md.customerGroups.map((g: { name: string }) => g.name).sort()).toEqual([
      'Endkunden',
      'Geschäftskunden',
    ]);
    expect(md.warehouses[0]).toMatchObject({ code: 'HL', isDefault: true });
    expect(md.sequences.map((s: { key: string }) => s.key).sort()).toEqual([
      'article',
      'cancellation',
      'credit_note',
      'customer',
      'delivery_note',
      'invoice',
      'offer',
      'order',
      'order_confirmation',
      'purchase_order',
      'supplier',
    ]);
  });

  it('ohne aktive Firma keine Fachdaten', async () => {
    const s = await signUp(app);
    const r = await s.client.get('/articles');
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('COMPANY_REQUIRED');
  });

  it('eigene Steuersätze; Prozentsatz nach Anlage fest; Standard nicht archivierbar', async () => {
    const { client, md } = await setup();
    const t = await client.post('/company/tax-rates', { name: 'Landwirtschaft', rate: '10,7' });
    expect(t.status).toBe(201);
    expect(t.body.rate).toBe('10.7');
    expect(
      (await client.put(`/company/tax-rates/${t.body.id}`, { name: 'X', rate: '12' })).status,
    ).toBe(409);
    expect(
      (
        await client.put(`/company/tax-rates/${t.body.id}`, {
          name: 'Landwirte',
          rate: '10.7',
          isDefault: true,
        })
      ).status,
    ).toBe(204);
    const old = md.taxRates.find((x: { rate: string }) => x.rate === '19');
    expect((await client.post(`/company/tax-rates/${old.id}/archive`)).status).toBe(204);
    expect((await client.post(`/company/tax-rates/${t.body.id}/archive`)).status).toBe(409);
    expect((await client.post('/company/tax-rates', { name: 'Unsinn', rate: '120' })).status).toBe(
      422,
    );
  });

  it('Nummernkreis: nächste Nummer nur erhöhbar', async () => {
    const { client } = await setup();
    expect(
      (
        await client.put('/company/number-sequences/article', {
          prefix: 'ART',
          nextValue: 1000,
          padding: 5,
        })
      ).status,
    ).toBe(204);
    expect((await client.post('/articles', { name: 'X' })).body.number).toBe('ART01000');
    expect(
      (
        await client.put('/company/number-sequences/article', {
          prefix: 'ART',
          nextValue: 5,
          padding: 5,
        })
      ).status,
    ).toBe(409);
  });

  it('Kategorien ohne Zyklen', async () => {
    const { client } = await setup();
    const a = (await client.post('/company/categories', { name: 'Angeln' })).body;
    const b = (await client.post('/company/categories', { name: 'Ruten', parentId: a.id })).body;
    expect(
      (await client.put(`/company/categories/${a.id}`, { name: 'Angeln', parentId: b.id })).status,
    ).toBe(422);
  });
});

describe('Artikel', () => {
  it('Nummer automatisch und lückenlos, GTIN-Prüfung, Standard-Steuersatz', async () => {
    const { client, md } = await setup();
    expect((await client.post('/articles', { name: 'Kaputt', gtin: '4006381333932' })).status).toBe(
      422,
    );
    const a = await client.post('/articles', {
      name: 'Spinnrute 2,40 m',
      gtin: '4006381333931',
      salePriceNet: '49,90',
      purchasePriceNet: '21.5',
    });
    expect(a.status).toBe(201);
    expect(a.body.number).toBe('A-000001');
    expect(a.body.salePriceNet).toBe('49.9');
    expect(a.body.taxRateId).toBe(md.taxRates.find((t: { isDefault: boolean }) => t.isDefault).id);
    const b = await client.post('/articles', {
      name: 'Köder',
      taxRateId: md.taxRates.find((t: { rate: string }) => t.rate === '7').id,
    });
    expect(b.body.number).toBe('A-000002');
    expect((await client.post('/articles', { number: 'A-000002', name: 'Doppelt' })).status).toBe(
      409,
    );
  });

  it('Staffel- und Kundengruppenpreise, Liste mit Suche und Bestand', async () => {
    const { client, md } = await setup();
    const group = md.customerGroups.find((g: { name: string }) => g.name === 'Geschäftskunden').id;
    const a = await client.post('/articles', {
      name: 'Vorfach',
      salePriceNet: '3',
      prices: [
        { minQuantity: '10', priceNet: '2.50' },
        { customerGroupId: group, minQuantity: '1', priceNet: '2.20' },
      ],
    });
    const full = (await client.get(`/articles/${a.body.id}`)).body;
    expect(full.prices.map((p: { priceNet: string }) => p.priceNet).sort()).toEqual(['2.2', '2.5']);
    const list = await client.get('/articles?q=vorf');
    expect(list.body.items.map((x: { name: string }) => x.name)).toEqual(['Vorfach']);
    expect(list.body.items[0].stock).toBe('0');
  });

  it('Einkaufspreise nur mit Recht „Preise“', async () => {
    const owner = await setup();
    const role = (
      await owner.client.post('/admin/roles', {
        name: 'Artikelpflege',
        permissions: ['articles.read', 'articles.manage', 'companies.read'],
      })
    ).body;
    const m = await inviteNewMember(app, owner.client, {
      roleIds: [role.id],
      companyIds: [owner.companyId],
    });
    m.client.companyId = owner.companyId;
    const a = (
      await owner.client.post('/articles', {
        name: 'Rolle',
        purchasePriceNet: '30',
        salePriceNet: '59',
      })
    ).body;
    const seen = (await m.client.get(`/articles/${a.id}`)).body;
    expect(seen.purchasePriceNet).toBeUndefined();
    expect(seen.salePriceNet).toBe('59');
    expect((await m.client.get('/articles?sort=purchasePriceNet:asc')).status).toBe(403);
    expect(
      (
        await m.client.put(`/articles/${a.id}`, {
          name: 'Rolle 2',
          salePriceNet: '1',
          version: seen.version,
        })
      ).status,
    ).toBe(403);
    const ok = await m.client.put(`/articles/${a.id}`, {
      name: 'Rolle 2',
      salePriceNet: '59',
      version: seen.version,
    });
    expect(ok.status).toBe(200);
    expect((await owner.client.get(`/articles/${a.id}`)).body.purchasePriceNet).toBe('30');
  });

  it('Sets, Varianten und optimistische Sperre', async () => {
    const { client } = await setup();
    const rute = (await client.post('/articles', { name: 'Rute' })).body;
    const rolle = (await client.post('/articles', { name: 'Rolle' })).body;
    expect((await client.post('/articles', { name: 'Set ohne Teile', kind: 'set' })).status).toBe(
      422,
    );
    const set = await client.post('/articles', {
      name: 'Starter-Set',
      kind: 'set',
      setComponents: [
        { articleId: rute.id, quantity: '1' },
        { articleId: rolle.id, quantity: '1' },
      ],
    });
    expect(set.status).toBe(201);
    expect(
      (
        await client.post('/articles', {
          name: 'Set im Set',
          kind: 'set',
          setComponents: [{ articleId: set.body.id, quantity: '1' }],
        })
      ).status,
    ).toBe(422);

    const parent = await client.post('/articles', {
      name: 'Wathose',
      kind: 'parent',
      variantAttributes: [
        { name: 'Größe', values: ['M', 'L'] },
        { name: 'Farbe', values: ['grün', 'braun'] },
      ],
    });
    expect(parent.status).toBe(201);
    expect((await client.post(`/articles/${parent.body.id}/variants/generate`)).body).toEqual({
      created: 4,
      total: 4,
    });
    expect((await client.post(`/articles/${parent.body.id}/variants/generate`)).body).toEqual({
      created: 0,
      total: 4,
    });
    const p = (await client.get(`/articles/${parent.body.id}`)).body;
    expect(p.variants.map((v: { name: string }) => v.name)).toContain('Wathose (L, braun)');

    const r1 = await client.put(`/articles/${rute.id}`, {
      name: 'Rute neu',
      version: rute.version,
    });
    expect(r1.status).toBe(200);
    expect(
      (await client.put(`/articles/${rute.id}`, { name: 'Rute alt', version: rute.version }))
        .status,
    ).toBe(409);
  });

  it('nicht gebuchtes Modul ist gesperrt', async () => {
    const s = await setup();
    await asTenant(s.accountId, (tx) =>
      tx.entitlement.update({ where: { accountId: s.accountId }, data: { modules: ['core'] } }),
    );
    const r = await s.client.get('/articles');
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('MODULE_NOT_LICENSED');
  });
});

describe('Kunden und Lieferanten', () => {
  it('Kunden mit Nummer, Pflichtfeldern, Adressen und Sperre', async () => {
    const { client } = await setup();
    expect((await client.post('/customers', { type: 'business' })).status).toBe(422);
    const c = await client.post('/customers', {
      type: 'business',
      companyName: 'Angelsport Nord GmbH',
      email: 'Info@Angelsport-Nord.example',
      vatId: 'DE123456789',
      addresses: [
        { kind: 'billing', street: 'Hafenstraße 1', postalCode: '25813', city: 'Husum' },
        { kind: 'shipping', street: 'Lager 2', city: 'Husum' },
        { kind: 'shipping', street: 'Lager 3', city: 'Kiel', isDefault: true },
      ],
      contacts: [{ name: 'Jens Jensen', role: 'Einkauf' }],
    });
    expect(c.status).toBe(201);
    expect(c.body.number).toBe('K-000001');
    expect(c.body.email).toBe('info@angelsport-nord.example');
    const full = (await client.get(`/customers/${c.body.id}`)).body;
    expect(full.customerGroupId).toBeTruthy();
    expect(
      full.addresses
        .filter((a: { isDefault: boolean }) => a.isDefault)
        .map((a: { city: string }) => a.city)
        .sort(),
    ).toEqual(['Husum', 'Kiel']);
    const blocked = await client.put(`/customers/${c.body.id}`, {
      ...full,
      addresses: full.addresses.map((a: object) => ({ ...a, id: undefined })),
      contacts: [],
      blocked: true,
      blockedReason: 'Zahlungsrückstand',
      version: full.version,
    });
    expect(blocked.status).toBe(200);
    expect(blocked.body.blocked).toBe(true);
    const list = await client.get(
      `/customers?filters=${encodeURIComponent(JSON.stringify([{ field: 'blocked', op: 'eq', value: true }]))}`,
    );
    expect(list.body.items.map((x: { displayName: string }) => x.displayName)).toEqual([
      'Angelsport Nord GmbH',
    ]);
    expect(list.body.items[0].city).toBe('Husum');
  });

  it('Lieferanten-Artikel mit bevorzugter Bezugsquelle', async () => {
    const { client } = await setup();
    const art = (await client.post('/articles', { name: 'Haken Gr. 6' })).body;
    const s1 = (await client.post('/suppliers', { name: 'Großhandel A' })).body;
    const s2 = (await client.post('/suppliers', { name: 'Großhandel B' })).body;
    expect(s1.number).toBe('L-00001');
    expect(
      (
        await client.put(`/suppliers/${s1.id}/articles`, {
          articleId: art.id,
          supplierSku: 'H6-100',
          purchasePriceNet: '0.12',
          isPreferred: true,
        })
      ).status,
    ).toBe(200);
    await client.put(`/suppliers/${s2.id}/articles`, {
      articleId: art.id,
      purchasePriceNet: '0.10',
      isPreferred: true,
    });
    const a = (await client.get(`/articles/${art.id}`)).body;
    expect(
      a.supplierArticles
        .filter((x: { isPreferred: boolean }) => x.isPreferred)
        .map((x: { supplier: { name: string } }) => x.supplier.name),
    ).toEqual(['Großhandel B']);
    expect(
      (await client.get('/suppliers')).body.items.find(
        (x: { name: string }) => x.name === 'Großhandel A',
      ).articleCount,
    ).toBe(1);
  });
});

describe('Lager und Bestand', () => {
  it('Zugang, Abgang, kein Minusbestand, Umlagerung, Inventur, Journal', async () => {
    const { client, md } = await setup();
    const hl = md.warehouses[0].id;
    const second = (await client.post('/company/warehouses', { code: 'AL', name: 'Außenlager' }))
      .body;
    const loc = (await client.post(`/company/warehouses/${second.id}/locations`, { code: 'R1-F2' }))
      .body;
    const art = (await client.post('/articles', { name: 'Kescher', minStock: '10' })).body;
    expect(
      (
        await client.post('/inventory/bookings', {
          type: 'receipt',
          articleId: art.id,
          warehouseId: hl,
          quantity: '10',
        })
      ).body.balance,
    ).toBe('10');
    expect(
      (
        await client.post('/inventory/bookings', {
          type: 'issue',
          articleId: art.id,
          warehouseId: hl,
          quantity: '3',
        })
      ).body.balance,
    ).toBe('7');
    const tooMuch = await client.post('/inventory/bookings', {
      type: 'issue',
      articleId: art.id,
      warehouseId: hl,
      quantity: '8',
    });
    expect(tooMuch.status).toBe(409);
    expect(
      (
        await client.post('/inventory/transfers', {
          articleId: art.id,
          fromWarehouseId: hl,
          toWarehouseId: second.id,
          toLocationId: loc.id,
          quantity: '4',
        })
      ).body,
    ).toEqual({ fromBalance: '3', toBalance: '4' });
    expect(
      (
        await client.post('/inventory/transfers', {
          articleId: art.id,
          fromWarehouseId: hl,
          toWarehouseId: hl,
          quantity: '1',
        })
      ).status,
    ).toBe(422);
    const corr = await client.post('/inventory/corrections', {
      articleId: art.id,
      warehouseId: hl,
      countedQuantity: '2',
      note: 'Inventur',
    });
    expect(corr.body).toEqual({ delta: '-1', balance: '2' });
    expect(
      (
        await client.post('/inventory/corrections', {
          articleId: art.id,
          warehouseId: hl,
          countedQuantity: '2',
        })
      ).status,
    ).toBe(409);
    const levels = (await client.get(`/inventory/levels?articleId=${art.id}`)).body;
    expect(levels.map((l: { quantity: string }) => l.quantity).sort()).toEqual(['2', '4']);
    const journal = (await client.get(`/inventory/movements?articleId=${art.id}`)).body.items;
    expect(journal.map((m: { type: string }) => m.type)).toEqual([
      'correction',
      'transfer_in',
      'transfer_out',
      'issue',
      'receipt',
    ]);
    expect(
      (await client.get('/inventory/low-stock')).body.map((x: { name: string }) => x.name),
    ).toContain('Kescher');
    expect((await client.get(`/articles/${art.id}`)).body.stock.length).toBe(2);
  });

  it('Minusbestand nur, wenn in der Firma erlaubt', async () => {
    const { client, md } = await setup();
    const art = (await client.post('/articles', { name: 'Pose' })).body;
    expect(
      (
        await client.post('/inventory/bookings', {
          type: 'issue',
          articleId: art.id,
          warehouseId: md.warehouses[0].id,
          quantity: '1',
        })
      ).status,
    ).toBe(409);
    await client.put('/company/settings', { allowNegativeStock: true });
    expect(
      (
        await client.post('/inventory/bookings', {
          type: 'issue',
          articleId: art.id,
          warehouseId: md.warehouses[0].id,
          quantity: '1',
        })
      ).body.balance,
    ).toBe('-1');
  });

  it('Chargen, Seriennummern und MHD sind Pflicht, wenn am Artikel aktiviert', async () => {
    const { client, md } = await setup();
    const art = (
      await client.post('/articles', { name: 'Futter', trackBatches: true, trackBestBefore: true })
    ).body;
    const r = await client.post('/inventory/bookings', {
      type: 'receipt',
      articleId: art.id,
      warehouseId: md.warehouses[0].id,
      quantity: '5',
    });
    expect(r.status).toBe(422);
    expect(r.body.errors.map((e: { path: string }) => e.path).sort()).toEqual([
      'batch',
      'bestBefore',
    ]);
    expect(
      (
        await client.post('/inventory/bookings', {
          type: 'receipt',
          articleId: art.id,
          warehouseId: md.warehouses[0].id,
          quantity: '5',
          batch: 'CH-01',
          bestBefore: '2027-06-30',
        })
      ).status,
    ).toBe(201);
    const set = (
      await client.post('/articles', {
        name: 'Set',
        kind: 'set',
        setComponents: [{ articleId: art.id, quantity: '1' }],
      })
    ).body;
    expect(
      (
        await client.post('/inventory/bookings', {
          type: 'receipt',
          articleId: set.id,
          warehouseId: md.warehouses[0].id,
          quantity: '1',
        })
      ).status,
    ).toBe(422);
  });

  it('gleichzeitige Abgänge verbrauchen nie mehr als den Bestand', async () => {
    const { client, md } = await setup();
    const hl = md.warehouses[0].id;
    const art = (await client.post('/articles', { name: 'Blinker' })).body;
    await client.post('/inventory/bookings', {
      type: 'receipt',
      articleId: art.id,
      warehouseId: hl,
      quantity: '10',
    });
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        client.post('/inventory/bookings', {
          type: 'issue',
          articleId: art.id,
          warehouseId: hl,
          quantity: '1',
        }),
      ),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(10);
    expect(results.filter((r) => r.status === 409)).toHaveLength(10);
    const level = (await client.get(`/inventory/levels?articleId=${art.id}`)).body;
    expect(level).toEqual([]);
    const moves = (await client.get(`/inventory/movements?articleId=${art.id}&limit=50`)).body
      .items;
    expect(moves).toHaveLength(11);
  });
});

describe('Trennung der Firmen innerhalb eines Accounts', () => {
  it('Daten von Firma A sind mit Firmenkontext B unsichtbar (API und Datenbank)', async () => {
    const s = await setup('Zwei Firmen GmbH');
    const firmB = (await s.client.post('/admin/companies', { name: 'Firma B', country: 'DE' }))
      .body;
    const art = (await s.client.post('/articles', { name: 'Nur in A' })).body;
    const cust = (await s.client.post('/customers', { lastName: 'Nur-in-A' })).body;

    const b = new Client(app);
    b.cookie = s.client.cookie;
    b.companyId = firmB.id;
    expect((await b.get(`/articles/${art.id}`)).status).toBe(404);
    expect((await b.get('/articles')).body.items).toEqual([]);
    expect((await b.get(`/customers/${cust.id}`)).status).toBe(404);
    expect((await b.put(`/articles/${art.id}`, { name: 'gekapert', version: 1 })).status).toBe(404);
    expect((await b.get(`/activity?entityType=article&entityId=${art.id}`)).status).toBe(404);
    // Firma B hat eigene Standardwerte und eigene Nummern
    const firstInB = await b.post('/articles', { name: 'Erster in B' });
    expect(firstInB.body).toMatchObject({ number: 'A-000001' });

    const db = createPrismaClient(process.env.DATABASE_URL);
    const inB = await withTenant(
      db,
      { accountId: s.accountId, userId: null, companyId: firmB.id },
      (tx) => tx.article.findMany(),
    );
    expect(inB.map((a) => a.name)).toEqual(['Erster in B']);
    const noCompany = await withTenant(db, { accountId: s.accountId, userId: null }, (tx) =>
      tx.article.count(),
    );
    expect(noCompany).toBe(0);
    await expect(
      withTenant(db, { accountId: s.accountId, userId: null, companyId: firmB.id }, (tx) =>
        tx.article.create({
          data: {
            id: uuidv7(),
            accountId: s.accountId,
            companyId: s.companyId,
            number: 'X',
            name: 'Einbruch',
            taxRateId: uuidv7(),
          },
        }),
      ),
    ).rejects.toThrow(/row-level security/i);
    await expect(
      withTenant(db, { accountId: s.accountId, userId: null, companyId: s.companyId }, (tx) =>
        tx.stockMovement.deleteMany(),
      ),
    ).rejects.toThrow();
    await db.$disconnect();
  });

  it('Suche zeigt Artikel nur aus zugänglichen Firmen', async () => {
    const s = await setup('Suchfirma A');
    const firmB = (await s.client.post('/admin/companies', { name: 'Suchfirma B', country: 'DE' }))
      .body;
    const b = new Client(app);
    b.cookie = s.client.cookie;
    b.companyId = firmB.id;
    await b.post('/articles', { name: 'Geheimköder Spezial' });
    const m = await inviteNewMember(app, s.client, {
      roleIds: [await roleIdByName(s.client, 'Mitarbeiter')],
      companyIds: [s.companyId],
    });
    const hits = (await m.client.get('/search?q=Geheimköder')).body.items;
    expect(hits).toEqual([]);
    expect(
      (await s.client.get('/search?q=Geheimköder')).body.items.map(
        (h: { title: string }) => h.title,
      ),
    ).toEqual(['Geheimköder Spezial']);
  });
});
