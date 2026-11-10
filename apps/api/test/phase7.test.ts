import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type NestFastifyApplication } from '@nestjs/platform-fastify';
import { withTenant } from '@fangevo/database';
import { BillingService } from '../src/modules/billing/billing.service';
import {
  Client,
  PASSWORD,
  inviteNewMember,
  lastTokenFor,
  mails,
  ownerDb,
  roleIdByName,
  signUp,
  startApp,
  totp,
} from './helpers';

let app: NestFastifyApplication;
beforeAll(async () => {
  app = await startApp();
});
afterAll(async () => {
  await app.close();
});

const DAY = 86_400_000;
const details = {
  billingName: 'Angelsport Muster GmbH',
  billingStreet: 'Hafenweg 1',
  billingPostalCode: '25813',
  billingCity: 'Husum',
  billingCountry: 'DE',
  billingEmail: 'rechnung@example.test',
};

async function customer(name = 'Abo GmbH') {
  const s = await signUp(app, name);
  s.client.companyId = s.companyId;
  return s;
}

async function active(client: Client, plan = 'business', interval = 'month') {
  expect((await client.put('/billing/details', details)).status).toBe(200);
  const r = await client.post('/billing/activate', { plan, interval });
  expect(r.status).toBe(201);
  return r.body as { currentPeriodEnd: string };
}

const run = (accountId: string, at: Date) => app.get(BillingService).processAccount(accountId, at);
const license = async (c: Client) => (await c.get('/admin/license')).body;
const licensed = async (c: Client, m: string) =>
  ((await license(c)).modules as { key: string; licensed: boolean }[]).find((x) => x.key === m)!
    .licensed;

describe('Abo und Rechnungen', () => {
  it('Testphase → Rechnungsdaten → aktivieren: Rechnung mit PDF und E-Mail, Lizenz aktiv', async () => {
    const { client, accountId } = await customer();
    const o = (await client.get('/billing')).body;
    expect(o.subscription).toMatchObject({ plan: 'starter', status: 'trialing' });
    expect(o.billingComplete).toBe(false);
    expect((await client.post('/billing/activate', { plan: 'business' })).body.code).toBe(
      'BILLING_DETAILS_MISSING',
    );
    expect((await client.put('/billing/details', { ...details, billingEmail: 'x' })).status).toBe(
      422,
    );
    expect((await client.put('/billing/details', details)).status).toBe(200);
    expect((await client.post('/billing/activate', { plan: 'enterprise' })).body.code).toBe(
      'PLAN_NOT_SELF_SERVICE',
    );
    expect((await client.post('/billing/activate', { plan: 'business' })).status).toBe(201);
    expect((await client.post('/billing/activate', { plan: 'business' })).status).toBe(409);

    const b = (await client.get('/billing')).body;
    expect(b.subscription).toMatchObject({ plan: 'business', status: 'active', interval: 'month' });
    expect(b.invoices).toHaveLength(1);
    expect(b.invoices[0]).toMatchObject({
      totalNet: '299.00',
      totalTax: '56.81',
      totalGross: '355.81',
      status: 'open',
    });
    expect(b.invoices[0].number).toMatch(/^FE-\d{4}-\d{6}$/);
    const lic = await license(client);
    expect(lic).toMatchObject({ plan: 'business', status: 'ACTIVE', accessMode: 'full' });
    expect(await licensed(client, 'purchasing')).toBe(true);

    const pdf = await client.get(`/billing/invoices/${b.invoices[0].id}/pdf`);
    expect(pdf.status).toBe(200);
    expect(pdf.raw.subarray(0, 4).toString()).toBe('%PDF');
    const m = mails(app).find((x) => x.subject.includes(b.invoices[0].number));
    expect(m?.to).toBe('rechnung@example.test');
    expect(m?.attachments?.[0]?.filename).toBe(`${b.invoices[0].number}.pdf`);

    // Rechnungen sind unveränderlich und nicht löschbar
    const ctx = { accountId, userId: null };
    await expect(
      withTenant(ownerDb(), ctx, (tx) =>
        tx.platformInvoice.update({ where: { id: b.invoices[0].id }, data: { totalNet: '1' } }),
      ),
    ).rejects.toThrow();
    await expect(
      withTenant(ownerDb(), ctx, (tx) =>
        tx.platformInvoice.delete({ where: { id: b.invoices[0].id } }),
      ),
    ).rejects.toThrow();
  });

  it('Hochstufen sofort mit anteiliger Rechnung, Herabstufen zum Laufzeitende, Verlängerung', async () => {
    const { client, accountId } = await customer();
    const sub = await active(client, 'business');
    const up = await client.post('/billing/plan', { plan: 'professional', interval: 'month' });
    expect(up.body.effective).toBe('now');
    let b = (await client.get('/billing')).body;
    expect(b.invoices).toHaveLength(2);
    const prorated = Number(b.invoices[0].totalNet);
    expect(prorated).toBeGreaterThan(0);
    expect(prorated).toBeLessThanOrEqual(200);
    expect((await license(client)).plan).toBe('professional');

    const down = await client.post('/billing/plan', { plan: 'starter', interval: 'month' });
    expect(down.body.effective).toBe('period_end');
    expect((await license(client)).plan).toBe('professional');
    expect((await client.get('/billing')).body.subscription.scheduledPlan).toBe('starter');

    expect(
      await run(accountId, new Date(new Date(sub.currentPeriodEnd).getTime() + 3600_000)),
    ).toBe(true);
    b = (await client.get('/billing')).body;
    expect(b.subscription).toMatchObject({ plan: 'starter', scheduledPlan: null });
    expect(b.invoices).toHaveLength(3);
    expect(b.invoices[0].totalNet).toBe('199.00');
    expect((await license(client)).plan).toBe('starter');
    // zweiter Lauf zum selben Zeitpunkt ändert nichts (keine doppelte Rechnung)
    await run(accountId, new Date(new Date(sub.currentPeriodEnd).getTime() + 3600_000));
    expect((await client.get('/billing')).body.invoices).toHaveLength(3);
  });

  it('Zusatzmodul: 14 Tage testen, danach anteilig berechnet; Kündigung zum Laufzeitende', async () => {
    const { client, accountId } = await customer();
    const mp = (await client.get('/marketplace')).body;
    const p = mp.modules.find((m: { key: string }) => m.key === 'purchasing');
    expect(p).toMatchObject({ bookable: true, includedInPlan: false, trialAvailable: true });
    expect(mp.modules.find((m: { key: string }) => m.key === 'marketplace').includedInPlan).toBe(
      true,
    );
    expect(await licensed(client, 'purchasing')).toBe(false);
    expect((await client.get('/purchase-orders')).body.code).toBe('MODULE_NOT_LICENSED');

    const book = await client.post('/marketplace/purchasing/book');
    expect(book.body).toMatchObject({ status: 'trial', usable: true });
    expect(await licensed(client, 'purchasing')).toBe(true);
    expect((await client.get('/purchase-orders')).status).toBe(200);
    expect((await client.post('/marketplace/purchasing/book')).status).toBe(409);
    expect((await client.post('/marketplace/crm/book')).status).toBe(422);

    const sub = await active(client, 'starter');
    expect((await client.get('/billing')).body.invoices[0].totalNet).toBe('199.00');
    // Testende: Modul wird kostenpflichtig, anteilige Rechnung bis Laufzeitende
    await run(accountId, new Date(Date.now() + 15 * DAY));
    let b = (await client.get('/billing')).body;
    expect(b.addons[0]).toMatchObject({ module: 'purchasing', status: 'active' });
    expect(b.invoices).toHaveLength(2);
    expect(Number(b.invoices[0].totalNet)).toBeGreaterThan(0);
    expect(Number(b.invoices[0].totalNet)).toBeLessThan(49);

    const c = await client.post('/marketplace/purchasing/cancel');
    expect(c.body).toMatchObject({ status: 'canceled', usable: true });
    expect(new Date(c.body.endsAt).getTime()).toBe(new Date(sub.currentPeriodEnd).getTime());
    await run(accountId, new Date(new Date(sub.currentPeriodEnd).getTime() + 3600_000));
    b = (await client.get('/billing')).body;
    expect(b.invoices[0].totalNet).toBe('199.00');
    expect(await licensed(client, 'purchasing')).toBe(false);
  });

  it('Kündigung, Rücknahme, Ende → nur lesen; Zahlungsverzug erst nach 30 Tagen gesperrt', async () => {
    const { client, accountId } = await customer();
    const sub = await active(client, 'business');
    expect((await client.post('/billing/cancel')).status).toBe(201);
    expect(new Date((await license(client)).validUntil).getTime()).toBe(
      new Date(sub.currentPeriodEnd).getTime(),
    );
    expect((await client.post('/billing/reactivate')).status).toBe(201);
    expect((await license(client)).validUntil).toBeNull();
    await client.post('/billing/cancel');
    await run(accountId, new Date(new Date(sub.currentPeriodEnd).getTime() + 3600_000));
    expect((await license(client)).status).toBe('CANCELED');
    expect((await client.get('/articles')).status).toBe(200);
    expect((await client.post('/articles', { name: 'X' })).body.code).toBe('ACCOUNT_SUSPENDED');
    // Abo & Rechnungen bleiben nutzbar: neu aktivieren
    expect((await client.post('/billing/activate', { plan: 'starter' })).status).toBe(201);
    expect((await license(client)).status).toBe('ACTIVE');
    expect((await client.post('/articles', { name: 'Wieder da' })).status).toBe(201);

    // Zahlungsverzug
    await run(accountId, new Date(Date.now() + 16 * DAY));
    expect((await license(client)).status).toBe('PAST_DUE');
    expect((await license(client)).accessMode).toBe('full');
    await run(accountId, new Date(Date.now() + 46 * DAY));
    expect((await license(client)).status).toBe('SUSPENDED');
    expect((await client.post('/articles', { name: 'Y' })).body.code).toBe('ACCOUNT_SUSPENDED');
  });

  it('nur mit Recht billing.manage; Rechnungen anderer Accounts nicht abrufbar', async () => {
    const a = await customer('A GmbH');
    await active(a.client, 'starter');
    const inv = (await a.client.get('/billing')).body.invoices[0];
    const emp = await inviteNewMember(app, a.client, {
      roleIds: [await roleIdByName(a.client, 'Mitarbeiter')],
      allCompanies: true,
    });
    expect((await emp.client.get('/billing')).body.code).toBe('PERMISSION_DENIED');
    expect((await emp.client.post('/marketplace/import/book')).body.code).toBe('PERMISSION_DENIED');
    const b = await customer('B GmbH');
    expect((await b.client.get(`/billing/invoices/${inv.id}/pdf`)).status).toBe(404);
    expect((await b.client.get('/billing')).body.invoices).toHaveLength(0);
  });
});

let adminClient: Client | undefined;
/** FangEvo-Mitarbeiter (E-Mail freigegeben); Zwei-Faktor wird im ersten Test aktiviert. */
async function platformAdmin() {
  if (adminClient) return adminClient;
  const email = process.env.PLATFORM_ADMIN_EMAILS!;
  const client = new Client(app);
  await client.post('/auth/register', {
    name: 'FangEvo Support',
    email,
    password: PASSWORD,
    accountName: 'FangEvo',
  });
  await client.post('/auth/verify-email', { token: lastTokenFor(app, email) });
  expect((await client.post('/auth/login', { email, password: PASSWORD })).status).toBe(200);
  adminClient = client;
  return client;
}

describe('Support und Plattform-Verwaltung', () => {
  it('Plattform nur für freigegebene Mitarbeiter mit Zwei-Faktor; Support-Ticket mit Antwort', async () => {
    const kunde = await customer('Support Kunde');
    expect((await kunde.client.get('/platform/accounts')).status).toBe(403);

    const admin = await platformAdmin();
    expect((await admin.get('/platform/accounts')).body.code).toBe('MFA_REQUIRED');
    const setup = await admin.post('/auth/mfa/setup');
    expect((await admin.post('/auth/mfa/enable', { code: totp(setup.body.secret) })).status).toBe(
      200,
    );
    const list = (await admin.get(`/platform/accounts?q=Support Kunde`)).body;
    expect(list.items.map((a: { accountId: string }) => a.accountId)).toContain(kunde.accountId);

    // Support-Anfrage
    const t = await kunde.client.post('/support/tickets', {
      subject: 'Wie buche ich Wareneingang?',
      category: 'question',
      message: 'Hallo, wo finde ich den Wareneingang?',
    });
    expect(t.status).toBe(201);
    expect(t.body.number).toMatch(/^S-\d{6}$/);
    expect(
      mails(app).some((m) => m.to === 'support@fangevo.test' && m.subject.includes(t.body.number)),
    ).toBe(true);
    const inbox = (await admin.get('/platform/support')).body;
    expect(inbox.find((x: { ticketId: string }) => x.ticketId === t.body.id)).toMatchObject({
      accountName: 'Support Kunde',
      subject: 'Wie buche ich Wareneingang?',
    });
    const r = await admin.post(`/platform/support/${t.body.id}/reply`, {
      message: 'Unter Einkauf → Bestellungen → Wareneingang.',
    });
    expect(r.status).toBe(201);
    const detail = (await kunde.client.get(`/support/tickets/${t.body.id}`)).body;
    expect(detail.status).toBe('waiting_customer');
    expect(detail.messages).toHaveLength(2);
    expect(detail.messages[1]).toMatchObject({ fromSupport: true });
    expect(JSON.stringify((await kunde.client.get('/notifications')).body)).toContain(
      t.body.number,
    );
    expect(
      (await kunde.client.post(`/support/tickets/${t.body.id}/messages`, { message: 'Danke!' }))
        .status,
    ).toBe(201);
    expect((await kunde.client.post(`/support/tickets/${t.body.id}/close`)).body.status).toBe(
      'closed',
    );

    // Andere Accounts sehen das Ticket nicht
    const fremd = await customer('Fremd');
    expect((await fremd.client.get(`/support/tickets/${t.body.id}`)).status).toBe(404);
    expect((await fremd.client.get('/support/tickets')).body).toHaveLength(0);

    // Lizenz durch FangEvo ändern (ohne Rechnung) und sperren
    const lic = await admin.post(`/platform/accounts/${kunde.accountId}/license`, {
      plan: 'professional',
      activateWithoutInvoice: true,
      extraCompanies: 2,
    });
    expect(lic.status).toBe(201);
    expect(lic.body.entitlement).toMatchObject({
      plan: 'professional',
      status: 'ACTIVE',
      maxCompanies: 5,
    });
    expect(lic.body.invoices).toHaveLength(0);
    expect(await licensed(kunde.client, 'automation')).toBe(true);
    await admin.post(`/platform/accounts/${kunde.accountId}/license`, { suspended: true });
    expect((await kunde.client.post('/articles', { name: 'Z' })).body.code).toBe(
      'ACCOUNT_SUSPENDED',
    );
    await admin.post(`/platform/accounts/${kunde.accountId}/license`, { suspended: false });
    expect((await kunde.client.post('/articles', { name: 'Z' })).status).toBe(201);
    const ev = (await admin.get(`/platform/accounts/${kunde.accountId}`)).body.events;
    expect(ev[0].actor).toBe(`platform:${process.env.PLATFORM_ADMIN_EMAILS}`);
  });

  it('Zahlung als eingegangen markieren hebt den Zahlungsverzug auf', async () => {
    const admin = await platformAdmin();
    expect((await admin.get('/platform/me')).status).toBe(200);
    const { client, accountId } = await customer('Zahler GmbH');
    await active(client, 'starter');
    await run(accountId, new Date(Date.now() + 16 * DAY));
    expect((await license(client)).status).toBe('PAST_DUE');
    const inv = (await client.get('/billing')).body.invoices[0];
    const r = await admin.post(`/platform/accounts/${accountId}/invoices/${inv.id}/paid`);
    expect(r.status).toBe(201);
    expect(r.body.invoices[0]).toMatchObject({ status: 'paid' });
    expect((await license(client)).status).toBe('ACTIVE');
    expect(
      (await admin.post(`/platform/accounts/${accountId}/invoices/${inv.id}/paid`)).status,
    ).toBe(409);
  });
});
