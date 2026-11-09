import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type NestFastifyApplication } from '@nestjs/platform-fastify';
import {
  Client,
  PASSWORD,
  asTenant,
  drainEvents,
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

const notifications = async (c: Client) =>
  (await c.get('/notifications')).body as {
    items: { id: string; type: string; title: string; readAt: string | null }[];
    unread: number;
  };

describe('Ereignisse und Benachrichtigungen', () => {
  it('Änderung erzeugt Ereignis; Verteiler benachrichtigt Berechtigte, nicht den Auslöser', async () => {
    const owner = await signUp(app);
    const admin = await inviteNewMember(app, owner.client, {
      roleIds: [await roleIdByName(owner.client, 'Administrator')],
      allCompanies: true,
    });
    const staff = await inviteNewMember(app, owner.client, {
      roleIds: [await roleIdByName(owner.client, 'Mitarbeiter')],
      companyIds: [owner.companyId],
    });
    await drainEvents(app);
    expect((await notifications(owner.client)).items.some((n) => n.type === 'member.joined')).toBe(
      true,
    );

    await owner.client.post('/admin/companies', { name: 'Neue Filiale', country: 'DE' });
    const pending = await ownerDb().outboxPending.count({ where: { accountId: owner.accountId } });
    expect(pending).toBeGreaterThan(0);
    await drainEvents(app);
    expect(await ownerDb().outboxPending.count({ where: { accountId: owner.accountId } })).toBe(0);

    const a = await notifications(admin.client);
    expect(a.items.find((n) => n.type === 'company.created')?.title).toBe(
      'Firma „Neue Filiale“ wurde angelegt',
    );
    expect(
      (await notifications(owner.client)).items.some((n) => n.type === 'company.created'),
    ).toBe(false);
    expect(
      (await notifications(staff.client)).items.some((n) => n.type === 'company.created'),
    ).toBe(false);
  });

  it('erneute Zustellung erzeugt keine Doppelten (idempotent)', async () => {
    const owner = await signUp(app);
    const admin = await inviteNewMember(app, owner.client, {
      roleIds: [await roleIdByName(owner.client, 'Administrator')],
      allCompanies: true,
    });
    await owner.client.post('/admin/companies', { name: 'Doppelt', country: 'DE' });
    await drainEvents(app);
    const before = (await notifications(admin.client)).items.length;
    const ev = await asTenant(owner.accountId, (tx) =>
      tx.outboxEvent.findFirstOrThrow({
        where: { type: 'company.created' },
        orderBy: { id: 'desc' },
      }),
    );
    await ownerDb().outboxPending.create({ data: { eventId: ev.id, accountId: owner.accountId } });
    await drainEvents(app);
    expect((await notifications(admin.client)).items.length).toBe(before);
  });

  it('betroffene Person erfährt von geänderten Rechten; lesen und alle lesen', async () => {
    const owner = await signUp(app);
    const m = await inviteNewMember(app, owner.client, {
      roleIds: [],
      companyIds: [owner.companyId],
    });
    await owner.client.put(`/admin/members/${m.membershipId}/access`, {
      roleIds: [],
      permissions: ['users.read'],
      allCompanies: false,
      companyIds: [owner.companyId],
    });
    await drainEvents(app);
    const n = await notifications(m.client);
    const changed = n.items.find((x) => x.type === 'member.access_changed');
    expect(changed?.title).toBe('Ihre Rechte wurden geändert');
    expect(n.unread).toBeGreaterThan(0);
    expect((await m.client.post(`/notifications/${changed!.id}/read`)).status).toBe(204);
    expect((await m.client.post('/notifications/read-all')).status).toBe(204);
    expect((await notifications(m.client)).unread).toBe(0);
  });

  it('abgeschaltete Benachrichtigungsart wird nicht zugestellt', async () => {
    const owner = await signUp(app);
    const admin = await inviteNewMember(app, owner.client, {
      roleIds: [await roleIdByName(owner.client, 'Administrator')],
      allCompanies: true,
    });
    expect(
      (await admin.client.put('/notifications/preferences', { 'company.created': false })).status,
    ).toBe(204);
    const prefs = (await admin.client.get('/notifications/preferences')).body;
    expect(prefs.find((p: { type: string }) => p.type === 'company.created').inApp).toBe(false);
    await owner.client.post('/admin/companies', { name: 'Stumm', country: 'DE' });
    await drainEvents(app);
    expect(
      (await notifications(admin.client)).items.some((n) => n.type === 'company.created'),
    ).toBe(false);
  });

  it('Hinweis vor Ende der Testphase (für Inhaber, nur einmal)', async () => {
    const owner = await signUp(app);
    await asTenant(owner.accountId, (tx) =>
      tx.entitlement.update({
        where: { accountId: owner.accountId },
        data: { trialEndsAt: new Date(Date.now() + 2 * 86_400_000) },
      }),
    );
    await notifications(owner.client);
    const n = await notifications(owner.client);
    expect(n.items.filter((x) => x.type === 'license.trial_ending')).toHaveLength(1);
  });

  it('Anmeldung von neuem Gerät: E-Mail und Benachrichtigung', async () => {
    const { email } = await signUp(app);
    const c = new Client(app);
    const r = await c.req(
      'POST',
      '/auth/login',
      { email, password: PASSWORD },
      { headers: { 'user-agent': 'Fremder Browser 1.0' } },
    );
    expect(r.status).toBe(200);
    expect(mails(app).some((m) => m.to === email && m.subject.includes('Neue Anmeldung'))).toBe(
      true,
    );
    await drainEvents(app);
    const n = await notifications(c);
    expect(n.items.some((x) => x.type === 'security.new_device')).toBe(true);
  });
});

describe('Eigene Felder', () => {
  it('anlegen, prüfen, speichern, filtern, archivieren (Werte bleiben)', async () => {
    const owner = await signUp(app);
    const f = await owner.client.post('/custom-fields', {
      entityType: 'company',
      key: 'region',
      label: 'Region',
      type: 'select',
      options: [
        { value: 'nord', label: 'Nord' },
        { value: 'sued', label: 'Süd' },
      ],
      required: true,
    });
    expect(f.status).toBe(201);
    await owner.client.post('/custom-fields', {
      entityType: 'company',
      key: 'mitarbeiter',
      label: 'Mitarbeiterzahl',
      type: 'number',
    });
    await owner.client.post('/custom-fields', {
      entityType: 'company',
      key: 'mutter',
      label: 'Mutterfirma',
      type: 'reference',
      referenceEntity: 'company',
    });

    const missing = await owner.client.post('/admin/companies', {
      name: 'Ohne Region',
      country: 'DE',
    });
    expect(missing.status).toBe(422);
    expect(missing.body.errors[0].path).toBe('customFields.region');
    expect(
      (
        await owner.client.post('/admin/companies', {
          name: 'X',
          country: 'DE',
          customFields: { region: 'ost' },
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await owner.client.post('/admin/companies', {
          name: 'X',
          country: 'DE',
          customFields: { region: 'nord', gibtsnicht: 1 },
        })
      ).status,
    ).toBe(422);

    const ok = await owner.client.post('/admin/companies', {
      name: 'Nordfiliale',
      country: 'DE',
      customFields: { region: 'nord', mitarbeiter: '12,5', mutter: owner.companyId },
    });
    expect(ok.status).toBe(201);
    expect(ok.body.customFields).toEqual({
      region: 'nord',
      mitarbeiter: 12.5,
      mutter: owner.companyId,
    });

    const filtered = await owner.client.get(
      `/admin/companies?filters=${encodeURIComponent(JSON.stringify([{ field: 'cf.region', op: 'eq', value: 'nord' }]))}`,
    );
    expect(filtered.body.items.map((c: { name: string }) => c.name)).toEqual(['Nordfiliale']);

    await owner.client.post(`/custom-fields/${f.body.id}/archive`);
    const c = (await owner.client.get(`/admin/companies/${ok.body.id}`)).body;
    expect(c.customFields.region).toBe('nord');
    expect(
      (
        await owner.client.put(`/admin/companies/${ok.body.id}`, {
          name: 'Nordfiliale 2',
          country: 'DE',
          version: c.version,
        })
      ).status,
    ).toBe(200);
    expect(
      (await owner.client.get('/custom-fields?entityType=company')).body.map(
        (d: { key: string }) => d.key,
      ),
    ).toEqual(['mitarbeiter', 'mutter']);
  });

  it('Systemrolle Administrator erhält neue Rechte automatisch und darf sie weitergeben', async () => {
    const owner = await signUp(app);
    const adminRole = await roleIdByName(owner.client, 'Administrator');
    const admin = await inviteNewMember(app, owner.client, {
      roleIds: [adminRole],
      allCompanies: true,
    });
    expect((await admin.client.get('/auth/session')).body.account.permissions).toContain(
      'custom_fields.manage',
    );
    expect(
      (
        await admin.client.post('/custom-fields', {
          entityType: 'company',
          key: 'kanal',
          label: 'Kanal',
          type: 'text',
        })
      ).status,
    ).toBe(201);
    const inv = await admin.client.post('/admin/members/invitations', {
      email: `weiter-${Date.now()}@example.test`,
      roleIds: [adminRole],
      allCompanies: true,
      companyIds: [],
    });
    expect(inv.status).toBe(201);
  });

  it('nur mit Recht anlegbar; Verweise nur auf eigene Datensätze', async () => {
    const a = await signUp(app);
    const b = await signUp(app);
    const m = await inviteNewMember(app, a.client, {
      roleIds: [await roleIdByName(a.client, 'Mitarbeiter')],
      companyIds: [a.companyId],
    });
    expect(
      (
        await m.client.post('/custom-fields', {
          entityType: 'company',
          key: 'x',
          label: 'X',
          type: 'text',
        })
      ).status,
    ).toBe(403);
    expect((await m.client.get('/custom-fields?entityType=company')).status).toBe(200);
    await a.client.post('/custom-fields', {
      entityType: 'company',
      key: 'partner',
      label: 'Partner',
      type: 'reference',
      referenceEntity: 'company',
    });
    const r = await a.client.post('/admin/companies', {
      name: 'Y',
      country: 'DE',
      customFields: { partner: b.companyId },
    });
    expect(r.status).toBe(422);
    expect(r.body.errors[0].message).toBe('Verweisziel nicht gefunden');
  });
});

describe('Listen', () => {
  it('sortiert, filtert, blättert und lehnt unbekannte Felder ab', async () => {
    const { client } = await signUp(app, 'Alpha');
    await client.post('/admin/companies', { name: 'Beta', city: 'Husum', country: 'DE' });
    await client.post('/admin/companies', { name: 'Gamma', city: 'Wien', country: 'AT' });
    const sorted = await client.get('/admin/companies?sort=name:desc&pageSize=2');
    expect(sorted.body.items.map((c: { name: string }) => c.name)).toEqual(['Gamma', 'Beta']);
    expect(sorted.body.total).toBe(3);
    expect(
      (await client.get('/admin/companies?sort=name:desc&pageSize=2&page=2')).body.items.map(
        (c: { name: string }) => c.name,
      ),
    ).toEqual(['Alpha']);
    const at = await client.get(
      `/admin/companies?filters=${encodeURIComponent(JSON.stringify([{ field: 'country', op: 'eq', value: 'at' }]))}`,
    );
    expect(at.body.items.map((c: { name: string }) => c.name)).toEqual(['Gamma']);
    expect(
      (await client.get('/admin/companies?q=hus')).body.items.map((c: { name: string }) => c.name),
    ).toEqual(['Beta']);
    expect(
      (
        await client.get(
          `/admin/companies?filters=${encodeURIComponent(JSON.stringify([{ field: 'accountId', op: 'eq', value: 'x' }]))}`,
        )
      ).status,
    ).toBe(422);
  });
});

describe('Globale Suche', () => {
  it('findet nach Wortanfang und mit Tippfehler, beachtet Rechte und Firmenzugriff', async () => {
    const owner = await signUp(app, 'Fischhandel Petersen');
    const hidden = (
      await owner.client.post('/admin/companies', { name: 'Geheime Werkstatt', country: 'DE' })
    ).body;
    const find = async (c: Client, q: string) =>
      (
        (await c.get(`/search?q=${encodeURIComponent(q)}`)).body.items as {
          entityType: string;
          title: string;
        }[]
      ).map((h) => h.title);
    expect(await find(owner.client, 'fisch')).toContain('Fischhandel Petersen');
    expect(await find(owner.client, 'Fishhandel')).toContain('Fischhandel Petersen');
    expect(await find(owner.client, 'Administrator')).toContain('Administrator');
    expect(await find(owner.client, 'Inhaber Test')).toContain('Inhaber Test');

    const m = await inviteNewMember(app, owner.client, {
      roleIds: [await roleIdByName(owner.client, 'Mitarbeiter')],
      companyIds: [owner.companyId],
    });
    expect(await find(m.client, 'Werkstatt')).toEqual([]);
    expect(await find(m.client, 'Inhaber')).toEqual([]);
    expect(await find(m.client, 'Fischhandel')).toContain('Fischhandel Petersen');

    await owner.client.post(`/admin/companies/${hidden.id}/archive`);
    expect(await find(owner.client, 'Werkstatt')).toEqual([]);
  });

  it('Sonderzeichen in der Suche sind harmlos', async () => {
    const { client } = await signUp(app);
    for (const q of ["' OR 1=1 --", 'a & | ! :*', '%', '()'])
      expect((await client.get(`/search?q=${encodeURIComponent(q)}`)).status).toBe(200);
  });
});

describe('Gespeicherte Ansichten', () => {
  it('persönlich oder freigegeben; ändern nur durch Ersteller', async () => {
    const owner = await signUp(app);
    const m = await inviteNewMember(app, owner.client, {
      roleIds: [await roleIdByName(owner.client, 'Mitarbeiter')],
      companyIds: [owner.companyId],
    });
    const state = {
      columnOrder: [],
      hidden: ['vatId'],
      widths: {},
      sort: 'name:asc',
      filters: [],
      groupBy: null,
      q: '',
    };
    const priv = (
      await owner.client.post('/views', { tableKey: 'companies', name: 'Meine', state })
    ).body;
    const shared = (
      await owner.client.post('/views', {
        tableKey: 'companies',
        name: 'Für alle',
        state,
        shared: true,
      })
    ).body;
    const seen = (await m.client.get('/views?table=companies')).body.map(
      (v: { name: string }) => v.name,
    );
    expect(seen).toEqual(['Für alle']);
    expect(
      (
        await m.client.put(`/views/${shared.id}`, {
          tableKey: 'companies',
          name: 'Gekapert',
          state,
        })
      ).status,
    ).toBe(404);
    expect((await m.client.del(`/views/${priv.id}`)).status).toBe(404);
    expect((await owner.client.del(`/views/${priv.id}`)).status).toBe(204);
  });
});

describe('Einstellungen (Menü)', () => {
  it('Account-Standard und persönliche Anpassung', async () => {
    const owner = await signUp(app);
    const m = await inviteNewMember(app, owner.client, {
      roleIds: [await roleIdByName(owner.client, 'Mitarbeiter')],
      companyIds: [owner.companyId],
    });
    expect(
      (
        await owner.client.put('/admin/preferences/nav', {
          hidden: ['/admin/audit'],
          order: [],
          favorites: [],
        })
      ).status,
    ).toBe(204);
    expect((await m.client.put('/admin/preferences/nav', { hidden: [] })).status).toBe(403);
    expect((await m.client.get('/preferences/nav')).body.value.hidden).toEqual(['/admin/audit']);
    await m.client.put('/preferences/nav', {
      hidden: [],
      order: [],
      favorites: ['/admin/companies'],
    });
    expect((await m.client.get('/preferences/nav')).body.value.favorites).toEqual([
      '/admin/companies',
    ]);
    await m.client.put('/preferences/nav/reset');
    expect((await m.client.get('/preferences/nav')).body.value.hidden).toEqual(['/admin/audit']);
    expect((await m.client.put('/preferences/nav', { hidden: 'kaputt' })).status).toBe(422);
    expect((await m.client.get('/preferences/gibtsnicht')).status).toBe(404);
  });
});

describe('Dashboard', () => {
  it('Standard, persönliche Kopie, Rechte je Widget, Vorlage für alle, zurücksetzen', async () => {
    const owner = await signUp(app);
    const m = await inviteNewMember(app, owner.client, {
      roleIds: [await roleIdByName(owner.client, 'Mitarbeiter')],
      companyIds: [owner.companyId],
    });

    const d = (await owner.client.get('/dashboards')).body;
    expect(d.source).toBe('builtin');
    expect(d.pages[0].widgets.map((w: { type: string }) => w.type)).toContain('activity');
    // Mitarbeiter ohne audit.read sieht das Aktivitäten-Widget nicht
    expect(
      (await m.client.get('/dashboards')).body.pages[0].widgets.map(
        (w: { type: string }) => w.type,
      ),
    ).not.toContain('activity');

    const widgets = [
      { id: 'a', type: 'note', x: 0, y: 0, w: 4, h: 3, config: { text: 'privat' } },
      { id: 'b', type: 'companies', x: 4, y: 0, w: 4, h: 3, config: {} },
    ];
    const saved = await owner.client.put(`/dashboards/${d.pages[0].id}`, {
      name: 'Mein Start',
      widgets,
    });
    expect(saved.status).toBe(200);
    const mine = (await owner.client.get('/dashboards')).body;
    expect(mine.source).toBe('personal');
    expect(mine.pages[0].name).toBe('Mein Start');

    expect(
      (
        await owner.client.put(`/dashboards/${mine.pages[0].id}`, {
          name: 'X',
          widgets: [{ id: 'z', type: 'gibtsnicht', x: 0, y: 0, w: 1, h: 1 }],
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await owner.client.put(`/dashboards/${mine.pages[0].id}`, {
          name: 'X',
          widgets: [{ id: 'z', type: 'activity', x: 0, y: 0, w: 4, h: 4, config: { limit: 9999 } }],
        })
      ).status,
    ).toBe(422);

    expect((await m.client.post('/admin/dashboards/template')).status).toBe(403);
    expect((await owner.client.post('/admin/dashboards/template')).status).toBe(204);
    const forMember = (await m.client.get('/dashboards')).body;
    expect(forMember.source).toBe('account');
    const note = forMember.pages[0].widgets.find((w: { type: string }) => w.type === 'note');
    expect(note.config.text).toBe('');

    const page2 = await owner.client.post('/dashboards', { name: 'Seite 2', widgets: [] });
    expect(page2.status).toBe(201);
    expect((await owner.client.post('/dashboards/reset')).status).toBe(204);
    expect((await owner.client.get('/dashboards')).body.source).toBe('account');
  });
});

describe('Aktivitäten', () => {
  it('Verlauf je Datensatz mit Leserecht; Gesamtverlauf nur mit audit.read', async () => {
    const owner = await signUp(app);
    const second = (await owner.client.post('/admin/companies', { name: 'Zweite', country: 'DE' }))
      .body;
    await owner.client.put(`/admin/companies/${owner.companyId}`, {
      name: 'Umbenannt',
      country: 'DE',
      version: 1,
    });
    const h = await owner.client.get(`/activity?entityType=company&entityId=${owner.companyId}`);
    expect(h.body.items.map((i: { action: string }) => i.action)).toEqual(['company.updated']);
    expect(h.body.items[0].actor).toBe('Inhaber Test');

    const m = await inviteNewMember(app, owner.client, {
      roleIds: [await roleIdByName(owner.client, 'Mitarbeiter')],
      companyIds: [owner.companyId],
    });
    expect(
      (await m.client.get(`/activity?entityType=company&entityId=${owner.companyId}`)).status,
    ).toBe(200);
    expect((await m.client.get(`/activity?entityType=company&entityId=${second.id}`)).status).toBe(
      403,
    );
    expect((await m.client.get('/activity')).status).toBe(403);
    expect((await owner.client.get('/activity')).body.items.length).toBeGreaterThan(0);
  });
});
