import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type NestFastifyApplication } from '@nestjs/platform-fastify';
import {
  Client,
  PASSWORD,
  asTenant,
  inviteNewMember,
  lastTokenFor,
  signUp,
  startApp,
  uniqueEmail,
} from './helpers';

let app: NestFastifyApplication;
beforeAll(async () => {
  app = await startApp();
});
afterAll(async () => app.close());

async function roleId(c: Client, name: string): Promise<string> {
  const r = await c.get('/admin/roles');
  return r.body.find((x: { name: string }) => x.name === name).id;
}

describe('Firmen und Firmenlizenz', () => {
  it('3 Firmen inklusive, die 4. wird abgelehnt', async () => {
    const { client } = await signUp(app);
    expect((await client.post('/admin/companies', { name: 'Zwei', country: 'DE' })).status).toBe(
      201,
    );
    expect((await client.post('/admin/companies', { name: 'Drei', country: 'AT' })).status).toBe(
      201,
    );
    const fourth = await client.post('/admin/companies', { name: 'Vier', country: 'DE' });
    expect(fourth.status).toBe(403);
    expect(fourth.body.code).toBe('LICENSE_LIMIT_REACHED');
  });

  it('Archivieren gibt eine Firmenlizenz frei, Wiederherstellen prüft das Limit', async () => {
    const { client, companyId } = await signUp(app);
    const two = (await client.post('/admin/companies', { name: 'Zwei', country: 'DE' })).body;
    await client.post('/admin/companies', { name: 'Drei', country: 'DE' });
    expect((await client.post(`/admin/companies/${two.id}/archive`)).status).toBe(201);
    expect((await client.post('/admin/companies', { name: 'Vier', country: 'DE' })).status).toBe(
      201,
    );
    const restore = await client.post(`/admin/companies/${two.id}/restore`);
    expect(restore.body.code).toBe('LICENSE_LIMIT_REACHED');
    // Archivierte Firmen erscheinen nur auf Wunsch
    expect((await client.get('/admin/companies')).body.items).toHaveLength(3);
    expect((await client.get('/admin/companies?archived=true')).body.total).toBe(4);
    expect(companyId).toBeTruthy();
  });

  it('die letzte aktive Firma kann nicht archiviert werden', async () => {
    const { client, companyId } = await signUp(app);
    const r = await client.post(`/admin/companies/${companyId}/archive`);
    expect(r.status).toBe(409);
  });

  it('gleichzeitige Bearbeitung wird erkannt (optimistische Sperre)', async () => {
    const { client, companyId } = await signUp(app);
    const c = (await client.get(`/admin/companies/${companyId}`)).body;
    expect(
      (
        await client.put(`/admin/companies/${companyId}`, {
          name: 'Neu A',
          country: 'DE',
          version: c.version,
        })
      ).status,
    ).toBe(200);
    const stale = await client.put(`/admin/companies/${companyId}`, {
      name: 'Neu B',
      country: 'DE',
      version: c.version,
    });
    expect(stale.status).toBe(409);
    expect((await client.get(`/admin/companies/${companyId}`)).body.name).toBe('Neu A');
  });

  it('Änderungen landen im Audit-Log', async () => {
    const { client, companyId } = await signUp(app);
    const c = (await client.get(`/admin/companies/${companyId}`)).body;
    await client.put(`/admin/companies/${companyId}`, {
      name: 'Umbenannt',
      city: 'Husum',
      country: 'DE',
      version: c.version,
    });
    const audit = await client.get('/admin/audit?action=company.');
    const entry = audit.body.items.find((x: { action: string }) => x.action === 'company.updated');
    expect(entry.data.name).toEqual({ from: c.name, to: 'Umbenannt' });
    expect(entry.user.email).toBeTruthy();
  });
});

describe('Benutzer, Einladungen und Rechte', () => {
  it('Einladung annehmen: neuer Benutzer erhält genau die vergebenen Rechte', async () => {
    const owner = await signUp(app);
    const employee = await roleId(owner.client, 'Mitarbeiter');
    const m = await inviteNewMember(app, owner.client, {
      roleIds: [employee],
      companyIds: [owner.companyId],
    });
    const s = await m.client.get('/auth/session');
    expect(s.body.account.id).toBe(owner.accountId);
    expect(s.body.account.permissions).toEqual(['companies.read']);
    expect((await m.client.get('/admin/companies')).status).toBe(200);
    const denied = await m.client.post('/admin/companies', { name: 'X', country: 'DE' });
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe('PERMISSION_DENIED');
    expect((await m.client.get('/admin/members')).status).toBe(403);
  });

  it('Einladungslink ist nur einmal verwendbar', async () => {
    const owner = await signUp(app);
    const email = uniqueEmail();
    await owner.client.post('/admin/members/invitations', { email, roleIds: [], companyIds: [] });
    const token = lastTokenFor(app, email);
    expect(
      (
        await new Client(app).post('/auth/invitations/accept', {
          token,
          name: 'A',
          password: PASSWORD,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await new Client(app).post('/auth/invitations/accept', {
          token,
          name: 'B',
          password: PASSWORD,
        })
      ).status,
    ).toBe(400);
  });

  it('bestehender Benutzer muss angemeldet sein, um eine Einladung anzunehmen', async () => {
    const a = await signUp(app, 'A');
    const b = await signUp(app, 'B');
    await a.client.post('/admin/members/invitations', {
      email: b.email,
      roleIds: [],
      companyIds: [],
    });
    const token = lastTokenFor(app, b.email);
    expect((await new Client(app).post('/auth/invitations/accept', { token })).status).toBe(401);
    expect((await b.client.post('/auth/invitations/accept', { token })).status).toBe(200);
    const s = await b.client.get('/auth/session');
    expect(s.body.accounts).toHaveLength(2);
    expect(s.body.account.id).toBe(a.accountId);
    expect((await b.client.post('/auth/switch-account', { accountId: b.accountId })).status).toBe(
      200,
    );
    expect((await b.client.get('/auth/session')).body.account.id).toBe(b.accountId);
  });

  it('Firmenzugriff ist auf zugewiesene Firmen beschränkt', async () => {
    const owner = await signUp(app);
    const second = (await owner.client.post('/admin/companies', { name: 'Zweite', country: 'DE' }))
      .body;
    const m = await inviteNewMember(app, owner.client, {
      roleIds: [await roleId(owner.client, 'Mitarbeiter')],
      companyIds: [owner.companyId],
    });
    const list = await m.client.get('/admin/companies');
    expect(list.body.items.map((c: { id: string }) => c.id)).toEqual([owner.companyId]);
    expect((await m.client.get(`/admin/companies/${second.id}`)).status).toBe(403);
    const ctx = await m.client.req('GET', '/context/company', undefined, {
      headers: { 'x-company-id': second.id },
    });
    expect(ctx.body.code).toBe('COMPANY_ACCESS_DENIED');
  });

  it('keine Rechteausweitung: nur eigene Rechte können vergeben werden', async () => {
    const owner = await signUp(app);
    const limited = (
      await owner.client.post('/admin/roles', {
        name: 'Personal',
        permissions: ['users.read', 'users.manage', 'roles.read', 'roles.manage', 'companies.read'],
      })
    ).body;
    const m = await inviteNewMember(app, owner.client, {
      roleIds: [limited.id],
      allCompanies: true,
    });
    // Rolle mit mehr Rechten anlegen: abgelehnt
    const r1 = await m.client.post('/admin/roles', { name: 'Hack', permissions: ['audit.read'] });
    expect(r1.status).toBe(403);
    // Sich selbst Einzelrechte geben: abgelehnt
    const r2 = await m.client.put(`/admin/members/${m.membershipId}/access`, {
      roleIds: [limited.id],
      permissions: ['account.manage'],
      allCompanies: true,
      companyIds: [],
    });
    expect(r2.status).toBe(403);
    // Administratorrolle vergeben: abgelehnt
    const admin = await roleId(owner.client, 'Administrator');
    const r3 = await m.client.post('/admin/members/invitations', {
      email: uniqueEmail(),
      roleIds: [admin],
      companyIds: [],
    });
    expect(r3.status).toBe(403);
    // Rechte im eigenen Umfang: erlaubt
    const r4 = await m.client.post('/admin/roles', { name: 'Leser', permissions: ['users.read'] });
    expect(r4.status).toBe(201);
  });

  it('Sperren beendet den Zugriff sofort, der letzte Inhaber ist geschützt', async () => {
    const owner = await signUp(app);
    const m = await inviteNewMember(app, owner.client, {
      roleIds: [await roleId(owner.client, 'Mitarbeiter')],
      companyIds: [owner.companyId],
    });
    expect((await owner.client.post(`/admin/members/${m.membershipId}/disable`)).status).toBe(204);
    expect((await m.client.get('/admin/companies')).status).toBe(401);
    const members = (await owner.client.get('/admin/members')).body;
    const self = members.find((x: { isOwner: boolean }) => x.isOwner);
    expect((await owner.client.post(`/admin/members/${self.id}/disable`)).status).toBe(409);
    expect((await owner.client.post(`/admin/members/${m.membershipId}/enable`)).status).toBe(204);
  });

  it('Einladung kann widerrufen werden', async () => {
    const owner = await signUp(app);
    const email = uniqueEmail();
    const inv = await owner.client.post('/admin/members/invitations', {
      email,
      roleIds: [],
      companyIds: [],
    });
    expect((await owner.client.get('/admin/members/invitations')).body).toHaveLength(1);
    expect((await owner.client.del(`/admin/members/invitations/${inv.body.id}`)).status).toBe(204);
    const r = await new Client(app).post('/auth/invitations/accept', {
      token: lastTokenFor(app, email),
      name: 'X',
      password: PASSWORD,
    });
    expect(r.status).toBe(400);
  });
});

describe('Rollen', () => {
  it('Systemrollen sind geschützt, eigene Rollen bearbeitbar', async () => {
    const { client } = await signUp(app);
    const admin = await roleId(client, 'Administrator');
    expect((await client.put(`/admin/roles/${admin}`, { name: 'X', permissions: [] })).status).toBe(
      409,
    );
    expect((await client.del(`/admin/roles/${admin}`)).status).toBe(409);
    const r = (
      await client.post('/admin/roles', { name: 'Lager', permissions: ['companies.read'] })
    ).body;
    expect(
      (
        await client.put(`/admin/roles/${r.id}`, {
          name: 'Lager+',
          permissions: ['companies.read', 'users.read'],
        })
      ).status,
    ).toBe(204);
    expect((await client.post('/admin/roles', { name: 'Lager+', permissions: [] })).status).toBe(
      409,
    );
    expect(
      (await client.post('/admin/roles', { name: 'Kaputt', permissions: ['gibt.es.nicht'] }))
        .status,
    ).toBe(422);
    expect((await client.del(`/admin/roles/${r.id}`)).status).toBe(204);
    expect((await client.get('/admin/roles/permissions')).body.length).toBeGreaterThan(5);
  });
});

describe('Lizenz-Kern', () => {
  it('zeigt Paket, Limits und Nutzung', async () => {
    const { client } = await signUp(app);
    const r = await client.get('/admin/license');
    expect(r.body.plan).toBe('starter');
    expect(r.body.priceIsPreliminary).toBe(true);
    expect(r.body.limits.companies).toBe(3);
    expect(r.body.usage).toEqual({ companies: 1, users: 1, openInvitations: 0 });
    expect(r.body.modules.find((m: { key: string }) => m.key === 'core')).toMatchObject({
      licensed: true,
      available: true,
    });
  });

  it('Benutzerlimit greift bei Einladungen', async () => {
    const owner = await signUp(app);
    await asTenant(owner.accountId, (tx) =>
      tx.entitlement.update({ where: { accountId: owner.accountId }, data: { maxUsers: 2 } }),
    );
    expect(
      (
        await owner.client.post('/admin/members/invitations', {
          email: uniqueEmail(),
          roleIds: [],
          companyIds: [],
        })
      ).status,
    ).toBe(201);
    const r = await owner.client.post('/admin/members/invitations', {
      email: uniqueEmail(),
      roleIds: [],
      companyIds: [],
    });
    expect(r.body.code).toBe('LICENSE_LIMIT_REACHED');
  });

  it('gesperrter Account: lesen und Logout ja, ändern nein, keine Daten gelöscht', async () => {
    const owner = await signUp(app);
    await asTenant(owner.accountId, (tx) =>
      tx.entitlement.update({
        where: { accountId: owner.accountId },
        data: { status: 'SUSPENDED' },
      }),
    );
    expect((await owner.client.get('/admin/companies')).body.items).toHaveLength(1);
    const w = await owner.client.post('/admin/companies', { name: 'X', country: 'DE' });
    expect(w.status).toBe(403);
    expect(w.body.code).toBe('ACCOUNT_SUSPENDED');
    expect((await owner.client.get('/auth/session')).body.account.accessMode).toBe('read_only');
    expect((await owner.client.post('/auth/logout')).status).toBe(204);
  });

  it('abgelaufener Testzeitraum führt zu Nur-Lesen', async () => {
    const owner = await signUp(app);
    await asTenant(owner.accountId, (tx) =>
      tx.entitlement.update({
        where: { accountId: owner.accountId },
        data: { trialEndsAt: new Date(Date.now() - 1000) },
      }),
    );
    expect(
      (await owner.client.post('/admin/companies', { name: 'X', country: 'DE' })).body.code,
    ).toBe('ACCOUNT_SUSPENDED');
  });
});

describe('Rate-Limit gegen Passwort-Raten', () => {
  it('blockiert nach 10 Fehlversuchen je E-Mail', async () => {
    const limited = await startApp({ RATE_LIMIT_DISABLED: 'false' });
    try {
      const c = new Client(limited);
      const email = uniqueEmail();
      const codes: number[] = [];
      for (let i = 0; i < 11; i++)
        codes.push((await c.post('/auth/login', { email, password: 'falsches-passwort' })).status);
      expect(codes.slice(0, 10).every((s) => s === 401)).toBe(true);
      expect(codes[10]).toBe(429);
    } finally {
      await limited.close();
    }
  });
});
