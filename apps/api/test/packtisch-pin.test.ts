import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type NestFastifyApplication } from '@nestjs/platform-fastify';
import { PLANS } from '@fangevo/licensing';
import { PASSWORD, asTenant, inviteNewMember, signUp, startApp } from './helpers';

/**
 * Touch-Packtisch: Gerät freigeben, PIN festlegen, PIN-Anmeldung mit Sperre,
 * eingeschränkte PIN-Sitzung, Widerruf, Problem melden, Mandantentrennung.
 */

let app: NestFastifyApplication;
beforeAll(async () => {
  app = await startApp();
});
afterAll(async () => app.close());

/** Browser am Lagerrechner: merkt sich Geräte- und Sitzungs-Cookie. */
class Kiosk {
  cookies = new Map<string, string>();
  companyId: string | undefined;
  async req(method: string, url: string, body?: unknown, headers: Record<string, string> = {}) {
    const h: Record<string, string> = { ...headers };
    if (this.cookies.size) h.cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    if (method !== 'GET') h['x-fangevo-csrf'] = '1';
    if (this.companyId) h['x-company-id'] = this.companyId;
    const r = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: method as 'GET',
        url: `/api/v1${url}`,
        payload: body as object,
        headers: h,
      });
    this.take(r.headers['set-cookie']);
    return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : undefined };
  }
  take(set: string | string[] | number | undefined) {
    for (const c of ([] as unknown[]).concat(set ?? []) as string[]) {
      const [kv] = c.split(';');
      const i = kv!.indexOf('=');
      const k = kv!.slice(0, i);
      const v = kv!.slice(i + 1);
      if (v) this.cookies.set(k, v);
      else this.cookies.delete(k);
    }
  }
  get = (u: string) => this.req('GET', u);
  post = (u: string, b: unknown = {}) => this.req('POST', u, b);
}

async function setup() {
  const s = await signUp(app, 'Packtisch GmbH');
  s.client.companyId = s.companyId;
  await asTenant(s.accountId, (tx) =>
    tx.entitlement.update({
      where: { accountId: s.accountId },
      data: { plan: 'professional', modules: [...PLANS.professional.modules] },
    }),
  );
  const md = (await s.client.get('/company/master-data')).body;
  const hl = md.warehouses.find((w: { isDefault: boolean }) => w.isDefault).id as string;
  const st = await s.client.post('/packing/stations', { name: 'Platz 1', warehouseId: hl });
  expect(st.status).toBe(201);
  const me = (await s.client.get('/auth/session')).body.user.id as string;
  return { ...s, hl, stationId: st.body.id as string, ownerId: me };
}

/** Lagerleiter gibt im Browser des Lagerrechners das Gerät frei (volle Anmeldung). */
async function registerKiosk(s: Awaited<ReturnType<typeof setup>>) {
  const kiosk = new Kiosk();
  kiosk.cookies.set('fe_session', s.client.cookie!.split('=')[1]!);
  kiosk.companyId = s.companyId;
  const r = await kiosk.post('/packing/devices', { stationId: s.stationId, name: 'Lager-PC 1' });
  expect(r.status).toBe(201);
  expect(kiosk.cookies.get('fe_packing_device')).toBeTruthy();
  // Lagerleiter meldet sich am Gerät ab; das Geräte-Cookie bleibt
  kiosk.cookies.delete('fe_session');
  kiosk.companyId = undefined;
  return { kiosk, deviceId: r.body.id as string };
}

describe('PIN festlegen', () => {
  it('eigene PIN nur mit Passwort, zu einfache PINs abgelehnt, PIN wird nie ausgegeben', async () => {
    const s = await setup();
    expect(
      (await s.client.put('/packing/pins/me', { pin: '1991', password: 'falsch' })).status,
    ).toBe(422);
    for (const pin of ['1111', '1234', '9876', '12', 'abcd'])
      expect((await s.client.put('/packing/pins/me', { pin, password: PASSWORD })).status).toBe(
        422,
      );
    expect((await s.client.get('/packing/pins/me')).body).toEqual({ hasPin: false });
    expect(
      (await s.client.put('/packing/pins/me', { pin: '1991', password: PASSWORD })).status,
    ).toBe(204);
    const r = await s.client.get('/packing/pins/me');
    expect(r.body).toEqual({ hasPin: true });
  });
});

describe('PIN-Anmeldung am freigegebenen Gerät', () => {
  it('zeigt Packplatz und Personen mit PIN, meldet mit richtiger PIN an', async () => {
    const s = await setup();
    await s.client.put('/packing/pins/me', { pin: '1991', password: PASSWORD });
    const { kiosk } = await registerKiosk(s);

    const info = await kiosk.get('/packing/pin/device');
    expect(info.status).toBe(200);
    expect(info.body.station).toMatchObject({ id: s.stationId, name: 'Platz 1' });
    expect(info.body.packers).toEqual([{ userId: s.ownerId, name: 'Inhaber Test' }]);

    expect(
      (await kiosk.post('/packing/pin/login', { userId: s.ownerId, pin: '1992' })).status,
    ).toBe(401);
    const ok = await kiosk.post('/packing/pin/login', { userId: s.ownerId, pin: '1991' });
    expect(ok.status).toBe(200);
    expect(ok.body.companyId).toBe(s.companyId);
    const sess = await kiosk.get('/auth/session');
    expect(sess.body.scope).toEqual({ kind: 'packing', companyId: s.companyId });
    expect(sess.body.account.companies).toEqual([{ id: s.companyId, name: expect.any(String) }]);
    const cur = await kiosk.get('/packing/devices/current');
    expect(cur.status).toBe(200);
    expect(cur.body.station.id).toBe(s.stationId);
  });

  it('PIN-Sitzung erreicht nur den Packtisch und nur die Firma des Geräts', async () => {
    const s = await setup();
    await s.client.put('/packing/pins/me', { pin: '1991', password: PASSWORD });
    const { kiosk } = await registerKiosk(s);
    await kiosk.post('/packing/pin/login', { userId: s.ownerId, pin: '1991' });

    // ohne X-Company-Id: Firma des Geräts wird gesetzt
    expect((await kiosk.get('/packing/queue?stage=all')).status).toBe(200);
    expect((await kiosk.get(`/packing/queue?stationId=${s.stationId}`)).status).toBe(200);
    // alles andere: gesperrt (auch für den Inhaber mit allen Rechten)
    for (const url of ['/articles', '/orders', '/customers', '/admin/members', '/packing/devices'])
      expect((await kiosk.get(url)).status).toBe(403);
    expect((await kiosk.post('/packing/stations', { name: 'X' })).status).toBe(403);
    expect(
      (await kiosk.post('/packing/devices', { stationId: s.stationId, name: 'X' })).status,
    ).toBe(403);
    // andere Firma im selben Account: abgelehnt
    const other = (await s.client.post('/admin/companies', { name: 'Filiale', country: 'DE' }))
      .body;
    kiosk.companyId = other.id;
    expect((await kiosk.get('/packing/queue')).status).toBe(403);
    kiosk.companyId = undefined;
    // Abmelden beendet die PIN-Sitzung, das Gerät bleibt freigegeben
    expect((await kiosk.post('/auth/logout')).status).toBe(204);
    expect((await kiosk.get('/packing/queue')).status).toBe(401);
    expect((await kiosk.get('/packing/pin/device')).status).toBe(200);
  });

  it('sperrt die PIN nach 5 Fehlversuchen, auch die richtige PIN', async () => {
    const s = await setup();
    await s.client.put('/packing/pins/me', { pin: '1991', password: PASSWORD });
    const { kiosk } = await registerKiosk(s);
    const codes: number[] = [];
    for (let i = 0; i < 5; i++)
      codes.push(
        (await kiosk.post('/packing/pin/login', { userId: s.ownerId, pin: '2468' })).status,
      );
    expect(codes).toEqual([401, 401, 401, 401, 429]);
    expect(
      (await kiosk.post('/packing/pin/login', { userId: s.ownerId, pin: '1991' })).status,
    ).toBe(429);
    // Neue PIN setzen hebt die Sperre auf
    await s.client.put('/packing/pins/me', { pin: '1991', password: PASSWORD });
    expect(
      (await kiosk.post('/packing/pin/login', { userId: s.ownerId, pin: '1991' })).status,
    ).toBe(200);
  });

  it('ohne, mit gefälschtem oder widerrufenem Gerät keine Anmeldung; Widerruf beendet Sitzungen', async () => {
    const s = await setup();
    await s.client.put('/packing/pins/me', { pin: '1991', password: PASSWORD });
    const none = new Kiosk();
    expect((await none.get('/packing/pin/device')).status).toBe(401);
    expect((await none.post('/packing/pin/login', { userId: s.ownerId, pin: '1991' })).status).toBe(
      401,
    );

    const { kiosk, deviceId } = await registerKiosk(s);
    const real = kiosk.cookies.get('fe_packing_device')!;
    const fake = new Kiosk();
    fake.cookies.set('fe_packing_device', real.replace(/\.[^.]+$/, '.' + 'x'.repeat(43)));
    expect((await fake.get('/packing/pin/device')).status).toBe(401);

    await kiosk.post('/packing/pin/login', { userId: s.ownerId, pin: '1991' });
    expect((await kiosk.get('/packing/queue')).status).toBe(200);
    expect((await s.client.post(`/packing/devices/${deviceId}/revoke`)).status).toBe(204);
    expect((await kiosk.get('/packing/queue')).status).toBe(401);
    expect((await kiosk.get('/packing/pin/device')).status).toBe(401);
    const list = (await s.client.get('/packing/devices')).body;
    expect(list[0]).toMatchObject({ id: deviceId, stationName: 'Platz 1' });
    expect(list[0].revokedAt).toBeTruthy();
    expect(JSON.stringify(list)).not.toContain('token');
  });

  it('Personen ohne Recht „Packen“ erscheinen nicht und können sich nicht anmelden', async () => {
    const s = await setup();
    const member = await inviteNewMember(app, s.client, { allCompanies: true });
    // Mitglied ohne Rollen: kein packing.execute
    expect(
      (await s.client.put(`/packing/pins/${member.membershipId}`, { pin: '2580' })).status,
    ).toBe(204);
    const { kiosk } = await registerKiosk(s);
    const info = await kiosk.get('/packing/pin/device');
    expect(info.body.packers).toEqual([]);
    const memberUser = (await member.client.get('/auth/session')).body.user.id;
    expect(
      (await kiosk.post('/packing/pin/login', { userId: memberUser, pin: '2580' })).status,
    ).toBe(403);
    // mit dem Recht „Packen“: erscheint und kann sich anmelden
    expect(
      (
        await s.client.put(`/admin/members/${member.membershipId}/access`, {
          roleIds: [],
          permissions: ['packing.execute'],
          allCompanies: true,
          companyIds: [],
        })
      ).status,
    ).toBeLessThan(300);
    const again = await kiosk.get('/packing/pin/device');
    expect(again.body.packers.map((p: { name: string }) => p.name)).toContain('Mitarbeiter Test');
    expect(
      (await kiosk.post('/packing/pin/login', { userId: memberUser, pin: '2580' })).status,
    ).toBe(200);
  });
});

describe('Trennung', () => {
  it('PINs, Geräte und Packplätze anderer Accounts sind nicht erreichbar', async () => {
    const a = await setup();
    const b = await setup();
    const member = await inviteNewMember(app, a.client, { allCompanies: true });
    expect(
      (await b.client.put(`/packing/pins/${member.membershipId}`, { pin: '2580' })).status,
    ).toBe(404);
    expect((await b.client.del(`/packing/pins/${member.membershipId}`)).status).toBe(404);
    expect(
      (await b.client.post('/packing/devices', { stationId: a.stationId, name: 'X' })).status,
    ).toBe(422);
    const { deviceId, kiosk } = await registerKiosk(a);
    expect((await b.client.post(`/packing/devices/${deviceId}/revoke`)).status).toBe(404);
    expect((await b.client.get('/packing/devices')).body).toEqual([]);
    // Geräte-Cookie mit fremdem Account umgeschrieben: abgelehnt
    const parts = kiosk.cookies.get('fe_packing_device')!.split('.');
    const forged = new Kiosk();
    forged.cookies.set(
      'fe_packing_device',
      [b.accountId, b.companyId, ...parts.slice(2)].join('.'),
    );
    expect((await forged.get('/packing/pin/device')).status).toBe(401);
    // PIN von Account A gilt nicht für Benutzer aus Account B
    await b.client.put('/packing/pins/me', { pin: '1991', password: PASSWORD });
    expect(
      (await kiosk.post('/packing/pin/login', { userId: b.ownerId, pin: '1991' })).status,
    ).toBe(401);
  });
});

describe('Problem melden', () => {
  it('stellt den Auftrag zurück, er verschwindet aus der Packliste, Grund steht im Verlauf', async () => {
    const s = await setup();
    const a = (await s.client.post('/articles', { name: 'Wobbler', salePriceNet: '5' })).body;
    await s.client.post('/inventory/bookings', {
      type: 'receipt',
      articleId: a.id,
      warehouseId: s.hl,
      quantity: '5',
    });
    const k = (
      await s.client.post('/customers', {
        type: 'private',
        firstName: 'Erika',
        lastName: 'Muster',
        addresses: [{ kind: 'billing', street: 'Deichweg 1', postalCode: '25813', city: 'Husum' }],
      })
    ).body;
    const o = (
      await s.client.post('/orders', {
        customerId: k.id,
        lines: [{ articleId: a.id, quantity: '1' }],
      })
    ).body;
    const pl = (await s.client.post('/pick-lists', { orderIds: [o.id] })).body;
    const full = (await s.client.get(`/pick-lists/${pl.id}`)).body;
    for (const l of full.lines)
      await s.client.post(`/pick-lists/${pl.id}/confirm`, { lineId: l.id, quantity: l.quantity });
    await s.client.post(`/pick-lists/${pl.id}/complete`);
    expect((await s.client.get(`/orders/${o.id}`)).body.status).toBe('packing');
    const q = await s.client.get(`/packing/queue?stationId=${s.stationId}`);
    expect(q.body.items.map((i: { id: string }) => i.id)).toContain(o.id);

    // über die PIN-Sitzung am Gerät
    await s.client.put('/packing/pins/me', { pin: '1991', password: PASSWORD });
    const { kiosk } = await registerKiosk(s);
    await kiosk.post('/packing/pin/login', { userId: s.ownerId, pin: '1991' });
    expect((await kiosk.post(`/packing/orders/${o.id}/problem`, { reason: 'bogus' })).status).toBe(
      422,
    );
    const r = await kiosk.post(`/packing/orders/${o.id}/problem`, {
      reason: 'missing',
      note: 'Fach leer',
      stationId: s.stationId,
    });
    expect(r.status).toBe(201);
    const after = (await s.client.get(`/orders/${o.id}`)).body;
    expect(after.status).toBe('in_progress');
    expect(JSON.stringify(after.history)).toContain(
      'Problem am Packtisch (Platz 1): Artikel fehlt – Fach leer',
    );
    const q2 = await kiosk.get(`/packing/queue?stationId=${s.stationId}`);
    expect(q2.body.items.map((i: { id: string }) => i.id)).not.toContain(o.id);
    // versendete Aufträge: kein Problem mehr meldbar
    await s.client.post(`/orders/${o.id}/ship`, {});
    expect((await kiosk.post(`/packing/orders/${o.id}/problem`, { reason: 'other' })).status).toBe(
      409,
    );
  });
});
