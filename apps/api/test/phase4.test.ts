import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type NestFastifyApplication } from '@nestjs/platform-fastify';
import { PLANS } from '@fangevo/licensing';
import { type Client, asTenant, signUp, startApp } from './helpers';

let app: NestFastifyApplication;
beforeAll(async () => {
  app = await startApp();
});
afterAll(async () => app.close());

async function setup(opts: { plan?: 'business' | 'professional'; invoiceReady?: boolean } = {}) {
  const s = await signUp(app, 'Logistik GmbH');
  s.client.companyId = s.companyId;
  if (opts.plan)
    await asTenant(s.accountId, (tx) =>
      tx.entitlement.update({
        where: { accountId: s.accountId },
        data: { plan: opts.plan, modules: [...PLANS[opts.plan!].modules] },
      }),
    );
  if (opts.invoiceReady) {
    const company = (await s.client.get('/admin/companies?pageSize=10')).body.items[0];
    await s.client.put(`/admin/companies/${s.companyId}`, {
      name: company.name,
      street: 'Hafenstraße 5',
      postalCode: '25813',
      city: 'Husum',
      country: 'DE',
      version: company.version,
    });
    await s.client.put('/company/settings', {
      allowNegativeStock: false,
      taxNumber: '15/123/45678',
    });
  }
  const md = (await s.client.get('/company/master-data')).body;
  const hl = md.warehouses.find((w: { isDefault: boolean }) => w.isDefault).id as string;
  return { ...s, md, hl };
}

async function article(client: Client, body: Record<string, unknown>) {
  const r = await client.post('/articles', { salePriceNet: '10', ...body });
  expect(r.status).toBe(201);
  return r.body as { id: string; number: string };
}

async function customer(client: Client) {
  const r = await client.post('/customers', {
    type: 'private',
    firstName: 'Erika',
    lastName: 'Muster',
    addresses: [{ kind: 'billing', street: 'Deichweg 1', postalCode: '25813', city: 'Husum' }],
  });
  return r.body as { id: string };
}

async function location(client: Client, warehouseId: string, code: string): Promise<string> {
  const r = await client.post(`/company/warehouses/${warehouseId}/locations`, { code });
  expect(r.status).toBe(201);
  return r.body.id;
}

const book = (client: Client, body: Record<string, unknown>) =>
  client.post('/inventory/bookings', { type: 'receipt', ...body });

async function levels(client: Client, articleId: string) {
  return (await client.get(`/inventory/levels?articleId=${articleId}`)).body as {
    batch: string | null;
    serialNumber: string | null;
    quantity: string;
  }[];
}

const order = async (
  client: Client,
  customerId: string,
  lines: { articleId: string; quantity: string }[],
) => {
  const r = await client.post('/orders', { customerId, lines });
  expect(r.status).toBe(201);
  return r.body as { id: string; number: string; lines: { id: string }[] };
};

describe('Lager mit Chargen und Seriennummern', () => {
  it('Bestand je Charge, Versand nach frühestem MHD; Seriennummern eindeutig', async () => {
    const { client, hl } = await setup();
    const a = await article(client, {
      name: 'Köder Bio',
      trackBatches: true,
      trackBestBefore: true,
    });
    expect(
      (
        await book(client, {
          articleId: a.id,
          warehouseId: hl,
          quantity: '5',
          batch: 'A',
          bestBefore: '2027-01-01',
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await book(client, {
          articleId: a.id,
          warehouseId: hl,
          quantity: '5',
          batch: 'B',
          bestBefore: '2026-12-01',
        })
      ).status,
    ).toBe(201);
    expect((await levels(client, a.id)).length).toBe(2);
    const k = await customer(client);
    const o = await order(client, k.id, [{ articleId: a.id, quantity: '7' }]);
    expect((await client.post(`/orders/${o.id}/ship`, {})).status).toBe(201);
    const after = await levels(client, a.id);
    expect(after.find((l) => l.batch === 'A')?.quantity).toBe('3');
    expect(after.find((l) => l.batch === 'B')).toBeUndefined();

    // Umlagerung einer Charge ist jetzt möglich
    const r1 = await location(client, hl, 'R1');
    expect(
      (
        await client.post('/inventory/transfers', {
          articleId: a.id,
          fromWarehouseId: hl,
          toWarehouseId: hl,
          toLocationId: r1,
          quantity: '1',
          batch: 'A',
        })
      ).status,
    ).toBe(201);

    const sn = await article(client, { name: 'Echolot', trackSerials: true });
    expect(
      (
        await book(client, {
          articleId: sn.id,
          warehouseId: hl,
          quantity: '1',
          serialNumber: 'SN-1',
        })
      ).status,
    ).toBe(201);
    const dup = await book(client, {
      articleId: sn.id,
      warehouseId: hl,
      quantity: '1',
      serialNumber: 'SN-1',
    });
    expect(dup.status).toBe(409);
    expect(dup.body.detail).toContain('SN-1');
    const o2 = await order(client, k.id, [{ articleId: sn.id, quantity: '1' }]);
    const direct = await client.post(`/orders/${o2.id}/ship`, {});
    expect(direct.status).toBe(409);
    expect(direct.body.detail).toContain('Packtisch');
  });
});

describe('Scannen und Barcodes', () => {
  it('löst GTIN, Zusatz-Barcode und Lagerplatz auf', async () => {
    const { client, hl } = await setup();
    const a = await article(client, { name: 'Rolle', gtin: '4006381333931' });
    const loc = await location(client, hl, 'A-01-02');
    await book(client, { articleId: a.id, warehouseId: hl, locationId: loc, quantity: '4' });
    expect((await client.post(`/articles/${a.id}/barcodes`, { code: 'LIEF-777' })).status).toBe(
      201,
    );
    expect((await client.post(`/articles/${a.id}/barcodes`, { code: 'LIEF-777' })).status).toBe(
      409,
    );
    const byGtin = (await client.get('/scan?code=4006381333931')).body;
    expect(byGtin).toMatchObject({ type: 'article', article: { number: a.number } });
    expect(byGtin.levels[0]).toMatchObject({ locationCode: 'A-01-02', quantity: '4' });
    expect((await client.get('/scan?code=LIEF-777')).body.article.id).toBe(a.id);
    const byLoc = (await client.get('/scan?code=a-01-02')).body;
    expect(byLoc).toMatchObject({ type: 'location', location: { code: 'A-01-02' } });
    expect(byLoc.levels[0].article.id).toBe(a.id);
    expect((await client.get('/scan?code=GIBTSNICHT')).status).toBe(404);
  });
});

describe('Picklisten', () => {
  it('fasst Aufträge zusammen, schlägt Platz und Charge vor, setzt Status', async () => {
    const { client, hl } = await setup();
    const a = await article(client, { name: 'Haken', trackBatches: true });
    const b = await article(client, { name: 'Schnur' });
    const l1 = await location(client, hl, 'B-01');
    const l2 = await location(client, hl, 'A-01');
    await book(client, {
      articleId: a.id,
      warehouseId: hl,
      locationId: l1,
      quantity: '3',
      batch: 'X',
      bestBefore: '2027-05-01',
    });
    await book(client, {
      articleId: a.id,
      warehouseId: hl,
      locationId: l2,
      quantity: '3',
      batch: 'Y',
      bestBefore: '2026-12-24',
    });
    await book(client, { articleId: b.id, warehouseId: hl, locationId: l1, quantity: '10' });
    const k = await customer(client);
    const o1 = await order(client, k.id, [{ articleId: a.id, quantity: '4' }]);
    const o2 = await order(client, k.id, [{ articleId: b.id, quantity: '2' }]);
    const pl = await client.post('/pick-lists', { orderIds: [o1.id, o2.id] });
    expect(pl.status).toBe(201);
    expect(pl.body.number).toBe('PL-000001');
    // Rundgang nach Platz: A-01 (Charge Y, frühestes MHD) zuerst
    expect(
      pl.body.lines.map((l: { locationCode: string; batch: string | null; quantity: string }) => [
        l.locationCode,
        l.batch,
        l.quantity,
      ]),
    ).toEqual([
      ['A-01', 'Y', '3'],
      ['B-01', 'X', '1'],
      ['B-01', null, '2'],
    ]);
    expect((await client.get(`/orders/${o1.id}`)).body.status).toBe('picking');
    expect((await client.post('/pick-lists', { orderIds: [o1.id] })).status).toBe(409);
    for (const l of pl.body.lines.slice(0, 2))
      await client.post(`/pick-lists/${pl.body.id}/confirm`, {
        lineId: l.id,
        quantity: l.quantity,
      });
    expect(
      (
        await client.post(`/pick-lists/${pl.body.id}/confirm`, {
          lineId: pl.body.lines[2].id,
          quantity: '5',
        })
      ).status,
    ).toBe(422);
    const done = await client.post(`/pick-lists/${pl.body.id}/complete`);
    expect(done.body).toMatchObject({ status: 'done', incompleteOrders: 1 });
    expect((await client.get(`/orders/${o1.id}`)).body.status).toBe('packing');
    expect((await client.get(`/orders/${o2.id}`)).body.status).toBe('picking');

    // Stornierte Pickliste setzt den Auftrag zurück
    const o3 = await order(client, k.id, [{ articleId: b.id, quantity: '1' }]);
    const pl2 = (await client.post('/pick-lists', { orderIds: [o3.id] })).body;
    expect((await client.post(`/pick-lists/${pl2.id}/cancel`)).body.status).toBe('cancelled');
    expect((await client.get(`/orders/${o3.id}`)).body.status).toBe('in_progress');
  });
});

describe('Packtisch und Versand', () => {
  it('nur mit Lizenz (ab Business)', async () => {
    const { client } = await setup();
    expect((await client.get('/packing/stations')).body.code).toBe('MODULE_NOT_LICENSED');
    expect((await client.get('/returns')).body.code).toBe('MODULE_NOT_LICENSED');
  });

  it('prüft Vollständigkeit und Seriennummern, versendet, erstellt Etikett und Belege', async () => {
    const { client, hl } = await setup({ plan: 'business', invoiceReady: true });
    const st = await client.post('/packing/stations', {
      name: 'Packtisch 1',
      defaultCarrier: 'own_label',
      autoInvoice: true,
      autoDeliveryNote: true,
    });
    expect(st.status).toBe(201);
    const a = await article(client, { name: 'Pose', gtin: '4006381333931' });
    const sn = await article(client, { name: 'Funkbissanzeiger', trackSerials: true });
    await book(client, { articleId: a.id, warehouseId: hl, quantity: '5' });
    for (const s of ['F-1', 'F-2'])
      await book(client, { articleId: sn.id, warehouseId: hl, quantity: '1', serialNumber: s });
    const k = await customer(client);
    const o = await order(client, k.id, [
      { articleId: a.id, quantity: '2' },
      { articleId: sn.id, quantity: '1' },
    ]);
    const prep = (await client.get(`/packing/orders?code=${o.number}`)).body;
    expect(prep.order.shippable).toBe(true);
    expect(prep.items.find((i: { articleId: string }) => i.articleId === a.id).barcodes).toContain(
      '4006381333931',
    );
    const base = { stationId: st.body.id, carrier: 'own_label', parcels: [{ weightKg: '1,2' }] };
    const lineA = o.lines[0]!.id;
    const lineS = o.lines[1]!.id;
    const missing = await client.post(`/packing/orders/${o.id}/complete`, {
      ...base,
      items: [{ orderLineId: lineA, articleId: a.id, quantity: '1' }],
    });
    expect(missing.status).toBe(422);
    expect(missing.body.errors.map((e: { message: string }) => e.message).join(' ')).toContain(
      '1 von 2',
    );
    const noSerial = await client.post(`/packing/orders/${o.id}/complete`, {
      ...base,
      items: [
        { orderLineId: lineA, articleId: a.id, quantity: '2' },
        { orderLineId: lineS, articleId: sn.id, quantity: '1' },
      ],
    });
    expect(noSerial.status).toBe(422);
    const ok = await client.post(`/packing/orders/${o.id}/complete`, {
      ...base,
      items: [
        { orderLineId: lineA, articleId: a.id, quantity: '2' },
        { orderLineId: lineS, articleId: sn.id, quantity: '1', serialNumber: 'F-2' },
      ],
    });
    expect(ok.status).toBe(201);
    expect(ok.body.shipment).toMatchObject({
      number: 'SE-000001',
      carrier: 'own_label',
      hasLabel: true,
    });
    expect(
      ok.body.documents.map((d: { type: string; number: string }) => [d.type, d.number]),
    ).toEqual([
      ['delivery_note', 'LS-000001'],
      ['invoice', 'RE-000001'],
    ]);
    expect((await client.get(`/orders/${o.id}`)).body.status).toBe('shipped');
    const snLevels = await levels(client, sn.id);
    expect(snLevels.map((l) => l.serialNumber)).toEqual(['F-1']);
    const label = await client.get(`/packing/shipments/${ok.body.shipment.id}/label`);
    expect(label.raw.subarray(0, 5).toString()).toBe('%PDF-');
    expect(
      (
        await client.put(`/packing/shipments/${ok.body.shipment.id}/tracking`, {
          trackingNumber: '00340434',
        })
      ).body.trackingNumber,
    ).toBe('00340434');
    // Zweites Packen nicht möglich
    expect(
      (await client.post(`/packing/orders/${o.id}/complete`, { ...base, items: [] })).status,
    ).toBe(422);
  });

  it('ohne vollständige Firmenangaben bleibt die Rechnung Entwurf, der Versand ist gebucht', async () => {
    const { client, hl } = await setup({ plan: 'business' });
    const st = (
      await client.post('/packing/stations', {
        name: 'P',
        autoInvoice: true,
        autoDeliveryNote: false,
      })
    ).body;
    const a = await article(client, { name: 'Kescher' });
    await book(client, { articleId: a.id, warehouseId: hl, quantity: '1' });
    const k = await customer(client);
    const o = await order(client, k.id, [{ articleId: a.id, quantity: '1' }]);
    const r = await client.post(`/packing/orders/${o.id}/complete`, {
      stationId: st.id,
      carrier: 'manual',
      trackingNumber: 'T-1',
      parcels: [{ weightKg: '0.5' }],
      items: [{ orderLineId: o.lines[0]!.id, articleId: a.id, quantity: '1' }],
    });
    expect(r.status).toBe(201);
    expect(r.body.documents[0]).toMatchObject({ type: 'invoice', number: null });
    expect(r.body.warnings[0]).toContain('Pflichtangaben');
    expect((await client.get(`/orders/${o.id}`)).body.status).toBe('shipped');
  });
});

describe('Retouren', () => {
  it('Anmeldung, Eingang mit Einlagerung und Gutschrift', async () => {
    const { client, hl } = await setup({ plan: 'business', invoiceReady: true });
    const a = await article(client, { name: 'Wathose' });
    const loc = await location(client, hl, 'RET');
    await book(client, { articleId: a.id, warehouseId: hl, quantity: '3' });
    const k = await customer(client);
    const o = await order(client, k.id, [{ articleId: a.id, quantity: '2' }]);
    expect(
      (
        await client.post('/returns', {
          orderId: o.id,
          lines: [{ orderLineId: o.lines[0]!.id, quantity: '1' }],
        })
      ).status,
    ).toBe(409);
    await client.post(`/orders/${o.id}/ship`, {});
    const inv = (await client.post(`/documents/from-order/${o.id}`, { type: 'invoice' })).body;
    await client.post(`/documents/${inv.id}/finalize`);
    expect(
      (
        await client.post('/returns', {
          orderId: o.id,
          lines: [{ orderLineId: o.lines[0]!.id, quantity: '3' }],
        })
      ).status,
    ).toBe(422);
    const r = await client.post('/returns', {
      orderId: o.id,
      reason: 'Passt nicht',
      lines: [{ orderLineId: o.lines[0]!.id, quantity: '1' }],
    });
    expect(r.status).toBe(201);
    expect(r.body.number).toBe('RT-000001');
    expect((await client.get(`/returns/returnable/${o.id}`)).body[0].returnable).toBe('1');
    const rec = await client.post(`/returns/${r.body.id}/receive`, {
      lines: [{ lineId: r.body.lines[0].id, condition: 'resell', locationId: loc }],
      createCreditNote: true,
    });
    expect(rec.status).toBe(201);
    expect(rec.body.status).toBe('received');
    expect(rec.body.creditNoteId).toBeTruthy();
    const cn = (await client.get(`/documents/${rec.body.creditNoteId}`)).body;
    expect(cn).toMatchObject({ type: 'credit_note', totalNet: '10' });
    const mv = (await client.get(`/inventory/movements?articleId=${a.id}`)).body.items[0];
    expect(mv).toMatchObject({ type: 'return', quantity: '1', referenceType: 'return' });
    expect(
      (
        await client.post(`/returns/${r.body.id}/receive`, {
          lines: [{ lineId: r.body.lines[0].id, condition: 'scrap' }],
        })
      ).status,
    ).toBe(409);
  });
});

describe('Packregeln nach Kanal und Kategorie', () => {
  /** Setzt den Verkaufskanal eines Auftrags direkt (wie bei einer Bestellung über den Kanal). */
  const setChannel = (
    s: { accountId: string; companyId: string },
    orderId: string,
    channelId: string | null,
  ) =>
    asTenant(s.accountId, async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.company_id', ${s.companyId}, true)`;
      await tx.salesOrder.update({ where: { id: orderId }, data: { channelId } });
    });

  async function world() {
    const s = await setup({ plan: 'professional' });
    const { client, hl } = s;
    const shopify = (await client.post('/channels', { name: 'Shopify', type: 'api' })).body.id;
    const amazon = (await client.post('/channels', { name: 'Amazon', type: 'api' })).body.id;
    const cat = async (name: string, parentId?: string) => {
      const r = await client.post('/company/categories', { name, parentId });
      expect(r.status).toBe(201);
      return r.body.id as string;
    };
    const sweets = await cat('Süßwaren');
    const choc = await cat('Schokolade', sweets);
    const cold = await cat('Kühlware');
    const schoko = await article(client, { name: 'Tafel', categoryId: choc });
    const eis = await article(client, { name: 'Eis', categoryId: cold });
    for (const a of [schoko, eis])
      await book(client, { articleId: a.id, warehouseId: hl, quantity: '20' });
    const k = await customer(client);
    const mk = async (channelId: string | null, ids: string[]) => {
      const o = await order(
        client,
        k.id,
        ids.map((articleId) => ({ articleId, quantity: '1' })),
      );
      await setChannel(s, o.id, channelId);
      return o;
    };
    const A = await mk(shopify, [schoko.id]); // Shopify, nur Schokolade
    const B = await mk(amazon, [eis.id]); // Amazon, nur Kühlware
    const C = await mk(amazon, [schoko.id, eis.id]); // Amazon, gemischt
    const D = await mk(null, [schoko.id]); // ohne Kanal
    const station = async (name: string, rules: Record<string, unknown>) => {
      const r = await client.post('/packing/stations', { name, rules });
      expect(r.status).toBe(201);
      return r.body.id as string;
    };
    const ids = (r: { body: { items: { number: string }[] } }) =>
      r.body.items.map((i) => i.number).sort();
    return { ...s, shopify, amazon, sweets, cold, schoko, A, B, C, D, station, ids };
  }

  it('filtert die Warteschlange nach Kanal und Kategorie (inkl. Unterkategorien, gemischte Aufträge)', async () => {
    const w = await world();
    const { client, A, B, C, D, ids } = w;
    const all = await client.get('/packing/queue?stage=all');
    expect(all.status).toBe(200);
    expect(ids(all)).toEqual([A, B, C, D].map((o) => o.number).sort());
    expect(
      all.body.channels.map((c: { name: string; count: number }) => [c.name, c.count]),
    ).toEqual([
      ['Amazon', 2],
      ['Ohne Kanal', 1],
      ['Shopify', 1],
    ]);
    expect(ids(await client.get('/packing/queue?stage=all&channelId=none'))).toEqual([D.number]);
    // Stufe „packing“: neue Aufträge sind noch nicht packbereit
    expect((await client.get('/packing/queue')).body.items).toEqual([]);

    const amazonOnly = await w.station('Amazon', { channelIds: [w.amazon] });
    expect(ids(await client.get(`/packing/queue?stage=all&stationId=${amazonOnly}`))).toEqual(
      [B, C].map((o) => o.number).sort(),
    );
    const cold = await w.station('Kühl', { categoryIds: [w.cold] });
    expect(ids(await client.get(`/packing/queue?stage=all&stationId=${cold}`))).toEqual([B.number]);
    const rest = await w.station('Rest', { excludeCategoryIds: [w.cold] });
    expect(ids(await client.get(`/packing/queue?stage=all&stationId=${rest}`))).toEqual(
      [A, C, D].map((o) => o.number).sort(),
    );
    // Oberkategorie schließt Unterkategorien ein
    const sweets = await w.station('Süß', { categoryIds: [w.sweets] });
    expect(ids(await client.get(`/packing/queue?stage=all&stationId=${sweets}`))).toEqual(
      [A, D].map((o) => o.number).sort(),
    );
    // Kanal außerhalb der Regeln: abgelehnt; „auch andere Kanäle“ nur ohne Festlegung
    expect(
      (await client.get(`/packing/queue?stage=all&stationId=${amazonOnly}&channelId=${w.shopify}`))
        .status,
    ).toBe(422);
    expect(
      ids(await client.get(`/packing/queue?stage=all&stationId=${amazonOnly}&allChannels=true`)),
    ).toHaveLength(4);
    const locked = await w.station('Fest', { channelIds: [w.amazon], locked: true });
    expect(
      (await client.get(`/packing/queue?stage=all&stationId=${locked}&allChannels=true`)).status,
    ).toBe(409);
  });

  it('Auftragsübersicht: Statusbaum zählt je Status und Kanal, Liste filtert nach Kanal', async () => {
    const w = await world();
    const { client, A, B, C, D } = w;
    const tree = (await client.get('/orders/tree')).body;
    expect(tree.statuses).toEqual([{ status: 'new', count: 4 }]);
    const open = Object.fromEntries(
      tree.channels.map((c: { name: string; open: number }) => [c.name, c.open]),
    );
    expect(open).toEqual({ Amazon: 2, Shopify: 1, 'Ohne Kanal': 1 });
    const list = async (filters: unknown[]) =>
      (
        await client.get(`/orders?filters=${encodeURIComponent(JSON.stringify(filters))}`)
      ).body.items
        .map((o: { number: string }) => o.number)
        .sort();
    expect(await list([{ field: 'channelId', op: 'eq', value: w.amazon }])).toEqual(
      [B, C].map((o) => o.number).sort(),
    );
    expect(await list([{ field: 'channelId', op: 'empty' }])).toEqual([D.number]);
    const row = (await client.get('/orders')).body.items.find((o: { id: string }) => o.id === A.id);
    expect(row.channelName).toBe('Shopify');
  });

  it('prüft Regeln beim Laden und sperrt fremde Aufträge, wenn eingestellt', async () => {
    const w = await world();
    const { client, A } = w;
    const warn = await w.station('Amazon warnt', { channelIds: [w.amazon] });
    const block = await w.station('Amazon sperrt', { channelIds: [w.amazon], mismatch: 'block' });
    const prep = (await client.get(`/packing/orders?code=${A.number}&stationId=${warn}`)).body;
    expect(prep.order).toMatchObject({ channelId: w.shopify, channelName: 'Shopify' });
    expect(prep.rule).toMatchObject({ ok: false, mismatch: 'warn' });
    expect(prep.rule.message).toContain('Shopify');
    const body = {
      carrier: 'manual',
      parcels: [{ weightKg: '1' }],
      items: [{ orderLineId: A.lines[0]!.id, articleId: w.schoko.id, quantity: '1' }],
    };
    const blocked = await client.post(`/packing/orders/${A.id}/complete`, {
      ...body,
      stationId: block,
    });
    expect(blocked.status).toBe(409);
    expect((await client.get(`/orders/${A.id}`)).body.status).not.toBe('shipped');
    const ok = await client.post(`/packing/orders/${A.id}/complete`, { ...body, stationId: warn });
    expect(ok.status).toBe(201);
  });

  it('prüft Kanäle und Kategorien beim Speichern, Regeln bleiben bei Änderungen erhalten', async () => {
    const w = await world();
    const { client } = w;
    const bad = (rules: Record<string, unknown>) =>
      client.post('/packing/stations', { name: `X${Math.random()}`, rules });
    expect((await bad({ channelIds: [crypto.randomUUID()] })).status).toBe(422);
    expect((await bad({ categoryIds: [crypto.randomUUID()] })).status).toBe(422);
    expect((await bad({ categoryIds: [w.cold], excludeCategoryIds: [w.cold] })).status).toBe(422);
    expect((await bad({ channelIds: ['none'] })).status).toBe(201);
    // Alte Packplätze ohne Regeln: alles erlaubt
    const plain = (await client.post('/packing/stations', { name: 'Alt' })).body;
    expect(plain.settings.rules).toMatchObject({ channelIds: [], mismatch: 'warn' });
    expect(plain.settings.autoPrint).toBe(false);
    const printing = await client.post('/packing/stations', { name: 'Druck', autoPrint: true });
    expect(printing.body.settings.autoPrint).toBe(true);
  });

  it('Packplatz im Lager: Warteschlange nur aus diesem Lager, fremde Lager sind gesperrt', async () => {
    const w = await world();
    const { client, hl, schoko, A, B, C, D, ids } = w;
    const wh2 = await client.post('/company/warehouses', { code: 'NORD', name: 'Lager Nord' });
    expect(wh2.status).toBe(201);
    await book(client, { articleId: schoko.id, warehouseId: wh2.body.id, quantity: '5' });
    const k = await customer(client);
    const n = await client.post('/orders', {
      customerId: k.id,
      warehouseId: wh2.body.id,
      lines: [{ articleId: schoko.id, quantity: '1' }],
    });
    expect(n.status).toBe(201);

    const make = async (name: string, warehouseId: string | null) => {
      const r = await client.post('/packing/stations', { name, warehouseId });
      expect(r.status).toBe(201);
      expect(r.body.warehouseId).toBe(warehouseId);
      return r.body.id as string;
    };
    const main = await make('Haupt', hl);
    const nord = await make('Nord', wh2.body.id);
    const any = await make('Überall', null);
    const q = (st: string) => client.get(`/packing/queue?stage=all&stationId=${st}`);
    expect(ids(await q(main))).toEqual([A, B, C, D].map((o) => o.number).sort());
    expect(ids(await q(nord))).toEqual([n.body.number]);
    expect(ids(await q(any))).toHaveLength(5);

    // Auftrag aus dem anderen Lager: immer gesperrt (auch wenn die Regeln nur warnen)
    const prep = await client.get(`/packing/orders?code=${A.number}&stationId=${nord}`);
    expect(prep.status).toBe(200);
    expect(prep.body.rule).toMatchObject({ ok: false, mismatch: 'block' });
    expect(prep.body.rule.message).toContain('Lager');
    const body = {
      carrier: 'manual',
      parcels: [{ weightKg: '1' }],
      items: [{ orderLineId: A.lines[0]!.id, articleId: schoko.id, quantity: '1' }],
    };
    const wrong = await client.post(`/packing/orders/${A.id}/complete`, {
      ...body,
      stationId: nord,
    });
    expect(wrong.status).toBe(409);
    expect((await client.get(`/orders/${A.id}`)).body.status).not.toBe('shipped');
    const right = await client.post(`/packing/orders/${A.id}/complete`, {
      ...body,
      stationId: main,
    });
    expect(right.status).toBe(201);

    // Lager bleibt beim Ändern erhalten; archivierte oder unbekannte Lager sind nicht wählbar
    const upd = await client.put(`/packing/stations/${nord}`, {
      name: 'Nord 1',
      warehouseId: wh2.body.id,
    });
    expect(upd.body.warehouseId).toBe(wh2.body.id);
    expect(
      (await client.post('/packing/stations', { name: 'X', warehouseId: crypto.randomUUID() }))
        .status,
    ).toBe(422);
    const old = await client.post('/company/warehouses', { code: 'ALT', name: 'Altlager' });
    expect((await client.post(`/company/warehouses/${old.body.id}/archive`)).status).toBeLessThan(
      300,
    );
    expect(
      (await client.post('/packing/stations', { name: 'Y', warehouseId: old.body.id })).status,
    ).toBe(422);
  });

  it('Lager anderer Firmen und Accounts sind für Packplätze nicht nutzbar', async () => {
    const w = await world();
    const other = await setup({ plan: 'professional' });
    expect(
      (await other.client.post('/packing/stations', { name: 'Fremd', warehouseId: w.hl })).status,
    ).toBe(422);
    const two = (await w.client.post('/admin/companies', { name: 'Filiale', country: 'DE' })).body;
    w.client.companyId = two.id;
    expect(
      (await w.client.post('/packing/stations', { name: 'Fremd', warehouseId: w.hl })).status,
    ).toBe(422);
  });

  it('Kanäle und Kategorien anderer Firmen sind nicht nutzbar, Aufträge nicht sichtbar', async () => {
    const w = await world();
    const other = await setup({ plan: 'professional' });
    expect(
      (
        await other.client.post('/packing/stations', {
          name: 'Fremd',
          rules: { channelIds: [w.amazon] },
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await other.client.post('/packing/stations', {
          name: 'Fremd2',
          rules: { categoryIds: [w.cold] },
        })
      ).status,
    ).toBe(422);
    expect((await other.client.get('/packing/queue?stage=all')).body.items).toEqual([]);
    const mine = await w.station('Meins', {});
    expect((await other.client.get(`/packing/queue?stationId=${mine}`)).status).toBe(422);
    // Zweite Firma im selben Account
    const two = (await w.client.post('/admin/companies', { name: 'Filiale', country: 'DE' })).body;
    w.client.companyId = two.id;
    expect((await w.client.get('/packing/queue?stage=all')).body.items).toEqual([]);
    expect(
      (await w.client.post('/packing/stations', { name: 'F', rules: { channelIds: [w.amazon] } }))
        .status,
    ).toBe(422);
  });
});

describe('Trennung', () => {
  it('Picklisten, Retouren und Etiketten anderer Firmen sind unsichtbar', async () => {
    const one = await setup({ plan: 'business' });
    const a = await article(one.client, { name: 'Rolle' });
    await book(one.client, { articleId: a.id, warehouseId: one.hl, quantity: '5' });
    const k = await customer(one.client);
    const o = await order(one.client, k.id, [{ articleId: a.id, quantity: '1' }]);
    const pl = (await one.client.post('/pick-lists', { orderIds: [o.id] })).body;
    const ship = (
      await one.client.post(`/packing/orders/${o.id}/complete`, {
        carrier: 'own_label',
        parcels: [{ weightKg: '1' }],
        items: [{ orderLineId: o.lines[0]!.id, articleId: a.id, quantity: '1' }],
      })
    ).body;
    const ret = (
      await one.client.post('/returns', {
        orderId: o.id,
        lines: [{ orderLineId: o.lines[0]!.id, quantity: '1' }],
      })
    ).body;
    const two = (await one.client.post('/admin/companies', { name: 'Filiale', country: 'DE' }))
      .body;
    one.client.companyId = two.id;
    expect((await one.client.get(`/pick-lists/${pl.id}`)).status).toBe(404);
    expect((await one.client.get(`/returns/${ret.id}`)).status).toBe(404);
    expect((await one.client.get(`/packing/shipments/${ship.shipment.id}/label`)).status).toBe(404);
    expect((await one.client.get(`/scan?code=${a.number}`)).status).toBe(404);
    expect((await one.client.get(`/packing/orders?code=${o.number}`)).status).toBe(404);
    const other = await setup({ plan: 'business' });
    expect((await other.client.get(`/returns/${ret.id}`)).status).toBe(404);
    expect((await other.client.post(`/pick-lists/${pl.id}/complete`)).status).toBe(404);
  });
});
