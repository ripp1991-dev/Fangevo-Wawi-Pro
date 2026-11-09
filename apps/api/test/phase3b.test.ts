import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type NestFastifyApplication } from '@nestjs/platform-fastify';
import { type Tx, withTenant } from '@fangevo/database';
import { PLANS } from '@fangevo/licensing';
import {
  type Client,
  asTenant,
  inviteNewMember,
  mails,
  ownerDb,
  roleIdByName,
  signUp,
  startApp,
} from './helpers';

let app: NestFastifyApplication;
beforeAll(async () => {
  app = await startApp();
});
afterAll(async () => app.close());

/** Konto mit aktiver Firma, Hauptlager und vollständigen Firmenangaben für Rechnungen. */
async function setup(opts: { invoiceReady?: boolean; plan?: 'business' } = {}) {
  const s = await signUp(app, 'Handel GmbH');
  s.client.companyId = s.companyId;
  if (opts.plan) {
    await asTenant(s.accountId, (tx) =>
      tx.entitlement.update({
        where: { accountId: s.accountId },
        data: { plan: opts.plan, modules: [...PLANS[opts.plan!].modules] },
      }),
    );
  }
  if (opts.invoiceReady !== false) await makeInvoiceReady(s.client, s.companyId);
  const md = (await s.client.get('/company/master-data')).body;
  const hl = md.warehouses.find((w: { isDefault: boolean }) => w.isDefault).id as string;
  return { ...s, md, hl };
}

async function makeInvoiceReady(client: Client, companyId: string) {
  const company = (await client.get('/admin/companies?pageSize=100')).body.items.find(
    (x: { id: string }) => x.id === companyId,
  );
  const r = await client.put(`/admin/companies/${companyId}`, {
    name: company.name,
    legalName: 'Handel GmbH',
    street: 'Hafenstraße 5',
    postalCode: '25813',
    city: 'Husum',
    country: 'DE',
    version: company.version,
  });
  expect(r.status).toBe(200);
  expect(
    (
      await client.put('/company/settings', {
        allowNegativeStock: false,
        taxNumber: '15/123/45678',
        iban: 'DE89 3704 0044 0532 0130 00',
        bic: 'COBADEFFXXX',
        bankName: 'Testbank',
      })
    ).status,
  ).toBe(204);
}

async function article(client: Client, body: Record<string, unknown>) {
  const r = await client.post('/articles', { salePriceNet: '10', ...body });
  expect(r.status).toBe(201);
  return r.body as { id: string; number: string };
}

async function customer(client: Client, body: Record<string, unknown> = {}) {
  const r = await client.post('/customers', {
    type: 'private',
    firstName: 'Erika',
    lastName: 'Muster',
    email: 'erika@example.test',
    addresses: [{ kind: 'billing', street: 'Deichweg 1', postalCode: '25813', city: 'Husum' }],
    ...body,
  });
  expect(r.status).toBe(201);
  return r.body as { id: string; number: string };
}

async function receive(client: Client, articleId: string, warehouseId: string, quantity: string) {
  const r = await client.post('/inventory/bookings', {
    type: 'receipt',
    articleId,
    warehouseId,
    quantity,
  });
  expect(r.status).toBe(201);
}

async function stockOf(client: Client, articleId: string): Promise<string> {
  const rows = (await client.get(`/inventory/levels?articleId=${articleId}`)).body as {
    quantity: string;
  }[];
  return rows.reduce((s, r) => s + Number(r.quantity), 0).toString();
}

describe('Aufträge', () => {
  it('Preise und Summen serverseitig, Reservierung, Fehlmengen nach Anlage-Reihenfolge, Versand bucht ab', async () => {
    const { client, hl } = await setup();
    const a = await article(client, { name: 'Wathose' });
    await receive(client, a.id, hl, '5');
    const k = await customer(client);

    const o1 = await client.post('/orders', {
      customerId: k.id,
      lines: [{ articleId: a.id, quantity: '3', unitPriceNet: '999' }],
      shippingNet: '4.90',
    });
    expect(o1.status).toBe(201);
    // Ein vorgegebener Preis wird übernommen (Recht orders.manage), Summen rechnet der Server
    expect(o1.body.lines[0].unitPriceNet).toBe('999');
    const o = (
      await client.post('/orders', {
        customerId: k.id,
        lines: [{ articleId: a.id, quantity: '3' }],
        shippingNet: '4.90',
      })
    ).body;
    expect(o.number).toBe('AU-000002');
    expect(o.status).toBe('new');
    expect(o.lines[0]).toMatchObject({ unitPriceNet: '10', taxRate: '19', lineNet: '30' });
    expect(o.totalNet).toBe('34.9');
    expect(o.totalTax).toBe('6.63');
    expect(o.totalGross).toBe('41.53');
    expect(o.customerSnapshot.billing.city).toBe('Husum');

    // Auftrag 1 (älter) hat Vorrang: für Auftrag 2 sind nur 2 verfügbar
    expect(o1.body.shortages).toEqual([]);
    expect(o.shortages).toMatchObject([{ number: a.number, needed: '3', available: '2' }]);
    const blocked = await client.post(`/orders/${o.id}/status`, { to: 'in_progress' });
    expect(blocked.status).toBe(201);
    const picking = await client.post(`/orders/${o.id}/status`, { to: 'picking' });
    expect(picking.status).toBe(409);
    expect((await client.post(`/orders/${o.id}/ship`, {})).status).toBe(409);

    // Ungültiger Sprung
    expect((await client.post(`/orders/${o1.body.id}/status`, { to: 'shipped' })).status).toBe(409);

    // Auftrag 1 versenden: Bestand 5 → 2, Reservierung frei
    const shipped = await client.post(`/orders/${o1.body.id}/ship`, {});
    expect(shipped.status).toBe(201);
    expect(shipped.body.status).toBe('shipped');
    expect(shipped.body.shippedAt).toBeTruthy();
    expect(await stockOf(client, a.id)).toBe('2');
    const mv = (await client.get(`/inventory/movements?articleId=${a.id}`)).body.items[0];
    expect(mv).toMatchObject({ type: 'issue', quantity: '-3', referenceType: 'sales_order' });
    expect(shipped.body.history.map((h: { toStatus: string }) => h.toStatus)).toEqual([
      'new',
      'shipped',
    ]);

    // Auftrag 2 bleibt unterdeckt (2 verfügbar, 3 benötigt)
    expect((await client.get(`/orders/${o.id}`)).body.shortages[0].available).toBe('2');
    // Storno gibt Reservierung frei
    expect((await client.post(`/orders/${o.id}/cancel`, { reason: '' })).status).toBe(422);
    const c = await client.post(`/orders/${o.id}/cancel`, { reason: 'Kunde storniert' });
    expect(c.body.status).toBe('cancelled');
    expect(c.body.shortages).toEqual([]);
    expect(
      (
        await client.put(`/orders/${o.id}`, {
          customerId: k.id,
          lines: [{ articleId: a.id, quantity: '1' }],
          version: c.body.version,
        })
      ).status,
    ).toBe(409);
  });

  it('Kundengruppen- und Staffelpreise, Gruppenrabatt, Varianten erben Preise', async () => {
    const { client, md } = await setup();
    const b2b = md.customerGroups.find((g: { name: string }) => g.name === 'Geschäftskunden');
    const end = md.customerGroups.find((g: { name: string }) => g.name === 'Endkunden');
    const a = await article(client, {
      name: 'Rute',
      salePriceNet: '20',
      prices: [
        { minQuantity: '10', priceNet: '18' },
        { customerGroupId: b2b.id, minQuantity: '1', priceNet: '15' },
      ],
    });
    const priv = await customer(client);
    const biz = await customer(client, {
      type: 'business',
      companyName: 'Angelsport Nord GmbH',
      customerGroupId: b2b.id,
    });
    const line = async (customerId: string, quantity: string) =>
      (await client.post('/orders', { customerId, lines: [{ articleId: a.id, quantity }] })).body
        .lines[0];
    expect((await line(priv.id, '1')).unitPriceNet).toBe('20');
    expect((await line(priv.id, '10')).unitPriceNet).toBe('18');
    expect((await line(biz.id, '1')).unitPriceNet).toBe('15');

    // Gruppenrabatt gilt nur ohne gruppenspezifischen Preis
    expect(
      (
        await client.put(`/company/customer-groups/${end.id}`, {
          name: 'Endkunden',
          priceDisplay: 'gross',
          discountPercent: '5',
          isDefault: true,
        })
      ).status,
    ).toBe(204);
    const l = await line(priv.id, '1');
    expect(l).toMatchObject({ unitPriceNet: '20', discountPercent: '5', lineNet: '19' });

    // Vaterartikel ist nicht bestellbar, Variante erbt den Preis
    const parent = await article(client, {
      name: 'Wathose',
      kind: 'parent',
      salePriceNet: '99',
      variantAttributes: [{ name: 'Größe', values: ['M'] }],
    });
    await client.post(`/articles/${parent.id}/variants/generate`);
    const variant = (await client.get(`/articles/${parent.id}`)).body.variants[0];
    const bad = await client.post('/orders', {
      customerId: biz.id,
      lines: [{ articleId: parent.id, quantity: '1' }],
    });
    expect(bad.status).toBe(422);
    expect(bad.body.detail).toContain('Vaterartikel');
    expect((await line(biz.id, '1')).unitPriceNet).toBe('15');
    const v = await client.post('/orders', {
      customerId: biz.id,
      lines: [{ articleId: variant.id, quantity: '1' }],
    });
    expect(v.status).toBe(201);
    expect(Number(v.body.lines[0].unitPriceNet)).toBeGreaterThan(0);
  });

  it('Sets reservieren und buchen ihre Komponenten; gesperrte Kunden; Freitextpositionen', async () => {
    const { client, hl, md } = await setup();
    const hook = await article(client, { name: 'Haken' });
    const line = await article(client, { name: 'Schnur' });
    const set = await article(client, {
      name: 'Starterset',
      kind: 'set',
      setComponents: [
        { articleId: hook.id, quantity: '10' },
        { articleId: line.id, quantity: '1' },
      ],
    });
    await receive(client, hook.id, hl, '25');
    await receive(client, line.id, hl, '5');
    const k = await customer(client);
    const seven = md.taxRates.find((t: { rate: string }) => t.rate === '7');
    const o = (
      await client.post('/orders', {
        customerId: k.id,
        lines: [
          { articleId: set.id, quantity: '2' },
          { name: 'Gravur', quantity: '1', unitPriceNet: '5', taxRateId: seven.id },
        ],
      })
    ).body;
    expect(o.lines[1]).toMatchObject({ name: 'Gravur', taxRate: '7', lineNet: '5' });
    expect(o.shortages).toEqual([]);
    expect((await client.post(`/orders/${o.id}/ship`, {})).status).toBe(201);
    expect(await stockOf(client, hook.id)).toBe('5');
    expect(await stockOf(client, line.id)).toBe('3');

    const blocked = await customer(client, { blocked: true, blockedReason: 'Zahlungsverzug' });
    const r = await client.post('/orders', {
      customerId: blocked.id,
      lines: [{ articleId: hook.id, quantity: '1' }],
    });
    expect(r.status).toBe(409);
    expect(r.body.detail).toContain('Zahlungsverzug');
  });

  it('gleichzeitiger doppelter Versand bucht nur einmal ab', async () => {
    const { client, hl } = await setup();
    const a = await article(client, { name: 'Köder' });
    await receive(client, a.id, hl, '10');
    const k = await customer(client);
    const o = (
      await client.post('/orders', {
        customerId: k.id,
        lines: [{ articleId: a.id, quantity: '4' }],
      })
    ).body;
    const res = await Promise.all([
      client.post(`/orders/${o.id}/ship`, {}),
      client.post(`/orders/${o.id}/ship`, {}),
    ]);
    expect(res.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await stockOf(client, a.id)).toBe('6');
  });
});

describe('Belege', () => {
  it('Rechnung: Entwurf ohne Nummer, Pflichtangaben, lückenlose Nummer, PDF mit Prüfsumme, Zahlungen', async () => {
    const { client, hl, accountId, companyId } = await setup({ invoiceReady: false });
    const a = await article(client, { name: 'Kescher' });
    await receive(client, a.id, hl, '10');
    const k = await customer(client);
    const o = (
      await client.post('/orders', {
        customerId: k.id,
        lines: [{ articleId: a.id, quantity: '2' }],
      })
    ).body;

    const draft = await client.post(`/documents/from-order/${o.id}`, { type: 'invoice' });
    expect(draft.status).toBe(201);
    expect(draft.body).toMatchObject({ status: 'draft', number: null, totalGross: '23.8' });
    expect((await client.post(`/documents/from-order/${o.id}`, { type: 'invoice' })).status).toBe(
      409,
    );
    const preview = await client.get(`/documents/${draft.body.id}/pdf`);
    expect(preview.status).toBe(200);
    expect(preview.raw.subarray(0, 5).toString()).toBe('%PDF-');

    // Ohne Steuernummer/Anschrift der Firma kein Festschreiben – und keine Nummer verbraucht
    const missing = await client.post(`/documents/${draft.body.id}/finalize`);
    expect(missing.status).toBe(422);
    expect(missing.body.detail).toContain('Steuernummer');
    await makeInvoiceReady(client, companyId);
    const fin = await client.post(`/documents/${draft.body.id}/finalize`);
    expect(fin.status).toBe(201);
    expect(fin.body).toMatchObject({
      number: 'RE-000001',
      status: 'finalized',
      paymentStatus: 'unpaid',
    });
    expect(fin.body.dueDate).toBeTruthy();

    const pdf = await client.get(`/documents/${fin.body.id}/pdf`);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(createHash('sha256').update(pdf.raw).digest('hex')).toBe(fin.body.pdfSha256);

    // GoBD: festgeschriebene Belege und PDFs sind in der Datenbank geschützt
    const asCompany = <T>(fn: (tx: Tx) => Promise<T>) =>
      withTenant(ownerDb(), { accountId, userId: null, companyId }, fn);
    await expect(
      asCompany((tx) =>
        tx.document.update({ where: { id: fin.body.id }, data: { totalGross: '1' } }),
      ),
    ).rejects.toThrow(/festgeschrieben|finalized/i);
    await expect(
      asCompany((tx) => tx.documentFile.deleteMany({ where: { documentId: fin.body.id } })),
    ).rejects.toThrow();
    expect((await client.del(`/documents/${fin.body.id}`)).status).toBe(409);
    expect((await client.post(`/documents/${fin.body.id}/finalize`)).status).toBe(409);

    // Zahlungen
    const p1 = await client.post(`/documents/${fin.body.id}/payments`, {
      amount: '10',
      paidOn: '2026-11-09',
      method: 'Überweisung',
    });
    expect(p1.body).toMatchObject({ paymentStatus: 'partially_paid', openAmount: '13.8' });
    const p2 = await client.post(`/documents/${fin.body.id}/payments`, {
      amount: '13.80',
      paidOn: '2026-11-09',
    });
    expect(p2.body.paymentStatus).toBe('paid');

    // Versand per E-Mail mit PDF-Anhang
    const sent = await client.post(`/documents/${fin.body.id}/send`, { to: 'kunde@example.test' });
    expect(sent.status).toBe(201);
    expect(sent.body.sentAt).toBeTruthy();
    const mail = mails(app).find((m) => m.to === 'kunde@example.test');
    expect(mail?.attachments?.[0]?.filename).toBe('Rechnung-RE-000001.pdf');

    // Umsatz
    const stats = (await client.get('/documents/stats')).body;
    expect(stats.today.net).toBe('20');
  });

  it('Gutschrift und Stornorechnung; danach neue Rechnung möglich; Entwürfe löschbar', async () => {
    const { client, hl } = await setup();
    const a = await article(client, { name: 'Pose' });
    await receive(client, a.id, hl, '10');
    const k = await customer(client);
    const o = (
      await client.post('/orders', {
        customerId: k.id,
        lines: [{ articleId: a.id, quantity: '4' }],
      })
    ).body;
    const offer = (await client.post(`/documents/from-order/${o.id}`, { type: 'offer' })).body;
    expect((await client.del(`/documents/${offer.id}`)).status).toBe(200);

    const inv = (await client.post(`/documents/from-order/${o.id}`, { type: 'invoice' })).body;
    const fin = (await client.post(`/documents/${inv.id}/finalize`)).body;
    expect((await client.post(`/orders/${o.id}/cancel`, { reason: 'x' })).status).toBe(409);

    const cn = await client.post(`/documents/${fin.id}/credit-note`, {
      lines: [{ index: 0, quantity: '1' }],
      reason: 'Beschädigt',
    });
    expect(cn.status).toBe(201);
    expect(cn.body).toMatchObject({ type: 'credit_note', totalNet: '10', totalGross: '11.9' });
    expect((await client.post(`/documents/${cn.body.id}/finalize`)).body.number).toBe('GU-000001');
    expect(
      (
        await client.post(`/documents/${fin.id}/credit-note`, {
          lines: [{ index: 0, quantity: '5' }],
          reason: 'zu viel',
        })
      ).status,
    ).toBe(422);

    const st = await client.post(`/documents/${fin.id}/cancel`, { reason: 'Falsche Adresse' });
    expect(st.status).toBe(201);
    expect(st.body).toMatchObject({ type: 'cancellation', number: 'ST-000001', totalNet: '-40' });
    expect((await client.get(`/documents/${fin.id}`)).body.paymentStatus).toBe('cancelled');
    expect((await client.post(`/documents/${fin.id}/cancel`, { reason: 'nochmal' })).status).toBe(
      409,
    );
    // Umsatz heute: 40 − 10 (Gutschrift) − 40 (Storno) = −10
    expect((await client.get('/documents/stats')).body.today.net).toBe('-10');

    const again = await client.post(`/documents/from-order/${o.id}`, { type: 'invoice' });
    expect(again.status).toBe(201);
    expect((await client.post(`/documents/${again.body.id}/finalize`)).body.number).toBe(
      'RE-000002',
    );
  });
});

describe('Einkauf', () => {
  it('nur mit Lizenz (ab Business)', async () => {
    const { client } = await setup();
    const r = await client.get('/purchase-orders');
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('MODULE_NOT_LICENSED');
  });

  it('Vorschlag, Bestellung, Teil-Wareneingang, Überlieferung abgelehnt, PDF', async () => {
    const { client, hl } = await setup({ plan: 'business' });
    const sup = (await client.post('/suppliers', { name: 'Großhandel Nord' })).body;
    const a = await article(client, { name: 'Blinker', minStock: '10', purchasePriceNet: '2' });
    expect(
      (
        await client.put(`/suppliers/${sup.id}/articles`, {
          articleId: a.id,
          supplierSku: 'GN-77',
          purchasePriceNet: '1.5',
          minOrderQuantity: '12',
          isPreferred: true,
        })
      ).status,
    ).toBeLessThan(300);
    const sug = (await client.get('/purchase-orders/suggestions')).body;
    expect(sug.find((s: { articleId: string }) => s.articleId === a.id)).toMatchObject({
      suggested: '12',
      supplierId: sup.id,
      supplierSku: 'GN-77',
    });

    const po = await client.post('/purchase-orders', {
      supplierId: sup.id,
      lines: [{ articleId: a.id, quantity: '10' }],
    });
    expect(po.status).toBe(201);
    expect(po.body).toMatchObject({ number: 'BE-000001', status: 'draft', totalNet: '15' });
    expect(po.body.lines[0]).toMatchObject({ supplierSku: 'GN-77', unitPriceNet: '1.5' });
    // offene Bestellmenge zählt: kein Vorschlag mehr
    expect(
      (await client.get('/purchase-orders/suggestions')).body.find(
        (s: { articleId: string }) => s.articleId === a.id,
      ),
    ).toBeUndefined();

    const lineId = po.body.lines[0].id;
    expect(
      (
        await client.post(`/purchase-orders/${po.body.id}/receipts`, {
          lines: [{ lineId, quantity: '1' }],
        })
      ).status,
    ).toBe(409);
    const sent = await client.post(`/purchase-orders/${po.body.id}/send`, {
      to: 'nord@example.test',
    });
    expect(sent.body.status).toBe('ordered');
    const pdf = await client.get(`/purchase-orders/${po.body.id}/pdf`);
    expect(pdf.raw.subarray(0, 5).toString()).toBe('%PDF-');

    const r1 = await client.post(`/purchase-orders/${po.body.id}/receipts`, {
      lines: [{ lineId, quantity: '4' }],
    });
    expect(r1.body.status).toBe('partially_received');
    expect(await stockOf(client, a.id)).toBe('4');
    expect(
      (
        await client.post(`/purchase-orders/${po.body.id}/receipts`, {
          lines: [{ lineId, quantity: '7' }],
        })
      ).status,
    ).toBe(422);
    const r2 = await client.post(`/purchase-orders/${po.body.id}/receipts`, {
      lines: [{ lineId, quantity: '6' }],
    });
    expect(r2.body.status).toBe('received');
    expect(r2.body.receipts).toHaveLength(2);
    expect(await stockOf(client, a.id)).toBe('10');
    expect((await client.post(`/purchase-orders/${po.body.id}/cancel`)).status).toBe(409);
  });
});

describe('Trennung und Rechte', () => {
  it('Aufträge und Belege anderer Firmen und Accounts sind unsichtbar', async () => {
    const one = await setup({ plan: 'business' });
    const a = await article(one.client, { name: 'Rolle' });
    const k = await customer(one.client);
    const o = (
      await one.client.post('/orders', {
        customerId: k.id,
        lines: [{ articleId: a.id, quantity: '1' }],
      })
    ).body;
    const doc = (await one.client.post(`/documents/from-order/${o.id}`, { type: 'invoice' })).body;

    // Zweite Firma im selben Account
    const two = (await one.client.post('/admin/companies', { name: 'Filiale', country: 'DE' }))
      .body;
    one.client.companyId = two.id;
    expect((await one.client.get(`/orders/${o.id}`)).status).toBe(404);
    expect((await one.client.get('/orders')).body.total).toBe(0);
    expect((await one.client.get(`/documents/${doc.id}`)).status).toBe(404);
    expect((await one.client.get(`/documents/${doc.id}/pdf`)).status).toBe(404);
    expect((await one.client.get(`/activity?entityType=order&entityId=${o.id}`)).status).toBe(404);
    expect(
      (await one.client.post(`/documents/from-order/${o.id}`, { type: 'invoice' })).status,
    ).toBe(404);
    // Firmenfremder Kunde/Artikel kann nicht verwendet werden
    expect(
      (
        await one.client.post('/orders', {
          customerId: k.id,
          lines: [{ articleId: a.id, quantity: '1' }],
        })
      ).status,
    ).toBe(422);

    // Anderer Account
    const other = await setup();
    expect((await other.client.get(`/orders/${o.id}`)).status).toBe(404);
    expect((await other.client.post(`/orders/${o.id}/ship`, {})).status).toBe(404);
    expect((await other.client.get(`/documents/${doc.id}`)).status).toBe(404);
  });

  it('Mitarbeiter sehen Aufträge, dürfen aber nichts ändern', async () => {
    const { client, companyId } = await setup();
    const k = await customer(client);
    const a = await article(client, { name: 'Messer' });
    const o = (
      await client.post('/orders', {
        customerId: k.id,
        lines: [{ articleId: a.id, quantity: '1' }],
      })
    ).body;
    const m = await inviteNewMember(app, client, {
      roleIds: [await roleIdByName(client, 'Mitarbeiter')],
      companyIds: [companyId],
    });
    m.client.companyId = companyId;
    expect((await m.client.get('/orders')).body.total).toBe(1);
    expect((await m.client.get(`/orders/${o.id}`)).status).toBe(200);
    expect((await m.client.post(`/orders/${o.id}/ship`, {})).status).toBe(403);
    expect((await m.client.post(`/documents/from-order/${o.id}`, { type: 'invoice' })).status).toBe(
      403,
    );
  });
});

describe('Rechteweitergabe bei nicht gebuchten Modulen', () => {
  it('Rechte eines nicht gebuchten Moduls darf nur weitergeben, wer sie selbst hat', async () => {
    const { client, companyId } = await setup({ invoiceReady: false });
    const role = await client.post('/admin/roles', {
      name: 'Rollenpflege',
      permissions: ['roles.read', 'roles.manage', 'orders.read'],
    });
    expect(role.status).toBe(201);
    const m = await inviteNewMember(app, client, {
      roleIds: [role.body.id],
      companyIds: [companyId],
    });
    const denied = await m.client.post('/admin/roles', {
      name: 'Einkauf später',
      permissions: ['purchasing.manage'],
    });
    expect(denied.status).toBe(403);
    expect(
      (await m.client.post('/admin/roles', { name: 'Leser', permissions: ['orders.read'] })).status,
    ).toBe(201);
  });
});
