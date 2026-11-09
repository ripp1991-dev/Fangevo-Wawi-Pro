/**
 * PFLICHT-TESTS Mandantentrennung (Playbook 5.2, 21, 25).
 * Zwei unabhängige Accounts A und B. Weder über die API noch direkt in der Datenbank
 * darf A Daten von B sehen oder ändern.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type NestFastifyApplication } from '@nestjs/platform-fastify';
import { createPrismaClient, uuidv7, withTenant } from '@fangevo/database';
import { type Client, signUp, startApp } from './helpers';

let app: NestFastifyApplication;
let a: Awaited<ReturnType<typeof signUp>>;
let b: Awaited<ReturnType<typeof signUp>>;

beforeAll(async () => {
  app = await startApp();
  a = await signUp(app, 'Firma A');
  b = await signUp(app, 'Firma B');
});
afterAll(async () => app.close());

describe('API-Ebene', () => {
  it('Firmenliste enthält nur eigene Firmen', async () => {
    const r = await a.client.get('/admin/companies');
    expect(r.status).toBe(200);
    expect(r.body.items.map((c: { id: string }) => c.id)).toEqual([a.companyId]);
  });

  it('fremde Firma ist nicht lesbar, änderbar oder archivierbar', async () => {
    expect((await a.client.get(`/admin/companies/${b.companyId}`)).status).toBe(404);
    expect(
      (
        await a.client.put(`/admin/companies/${b.companyId}`, {
          name: 'gekapert',
          country: 'DE',
          version: 1,
        })
      ).status,
    ).toBe(404);
    expect((await a.client.post(`/admin/companies/${b.companyId}/archive`)).status).toBe(404);
    const still = await b.client.get(`/admin/companies/${b.companyId}`);
    expect(still.body.name).toBe('Firma B');
    expect(still.body.archivedAt).toBeNull();
  });

  it('fremde Firma kann nicht als Firmenkontext gesetzt werden', async () => {
    const r = await a.client.req('GET', '/context/company', undefined, {
      headers: { 'x-company-id': b.companyId },
    });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('COMPANY_ACCESS_DENIED');
    const ok = await a.client.req('GET', '/context/company', undefined, {
      headers: { 'x-company-id': a.companyId },
    });
    expect(ok.status).toBe(200);
  });

  it('Mitglieder, Rollen, Einladungen und Audit-Log sind getrennt', async () => {
    const bMembers = await b.client.get('/admin/members');
    const bMemberId = bMembers.body[0].id;
    const bRoles = await b.client.get('/admin/roles');
    const bRoleId = bRoles.body[0].id;

    const aMembers = await a.client.get('/admin/members');
    expect(aMembers.body.every((m: { user: { email: string } }) => m.user.email !== b.email)).toBe(
      true,
    );

    expect(
      (
        await a.client.put(`/admin/members/${bMemberId}/access`, {
          roleIds: [],
          permissions: [],
          allCompanies: false,
          companyIds: [],
        })
      ).status,
    ).toBe(404);
    expect((await a.client.post(`/admin/members/${bMemberId}/disable`)).status).toBe(404);
    expect(
      (await a.client.put(`/admin/roles/${bRoleId}`, { name: 'x', permissions: [] })).status,
    ).toBe(404);
    expect((await a.client.del(`/admin/roles/${bRoleId}`)).status).toBe(404);

    // Fremde Rolle oder Firma kann auch nicht in eine eigene Einladung "eingeschmuggelt" werden
    const inv = await a.client.post('/admin/members/invitations', {
      email: 'x@example.test',
      roleIds: [bRoleId],
      allCompanies: false,
      companyIds: [],
    });
    expect(inv.status).toBe(422);
    const inv2 = await a.client.post('/admin/members/invitations', {
      email: 'y@example.test',
      roleIds: [],
      allCompanies: false,
      companyIds: [b.companyId],
    });
    expect([403, 422]).toContain(inv2.status);

    const audit = await a.client.get('/admin/audit');
    expect(audit.status).toBe(200);
    expect(audit.body.items.length).toBeGreaterThan(0);
  });

  it('Wechsel in einen fremden Account ist nicht möglich', async () => {
    const r = await a.client.post('/auth/switch-account', { accountId: b.accountId });
    expect(r.status).toBe(403);
    const s = await a.client.get('/auth/session');
    expect(s.body.accounts.map((x: { id: string }) => x.id)).toEqual([a.accountId]);
  });
});

describe('Datenbank-Ebene (Row-Level Security)', () => {
  const app_ = () => createPrismaClient(process.env.DATABASE_URL);

  it('ohne Mandantenkontext sind Mandantentabellen leer', async () => {
    const db = app_();
    expect(await db.company.count()).toBe(0);
    expect(await db.membership.count()).toBe(0);
    expect(await db.auditLog.count()).toBe(0);
    await db.$disconnect();
  });

  it('mit Kontext A sind nur Daten von A sichtbar', async () => {
    const db = app_();
    const rows = await withTenant(db, { accountId: a.accountId, userId: null }, (tx) =>
      tx.company.findMany(),
    );
    expect(rows.map((r) => r.accountId)).toEqual([a.accountId]);
    const byId = await withTenant(db, { accountId: a.accountId, userId: null }, (tx) =>
      tx.company.findUnique({ where: { id: b.companyId } }),
    );
    expect(byId).toBeNull();
    await db.$disconnect();
  });

  it('Schreiben in einen fremden Mandanten wird von der Datenbank abgelehnt', async () => {
    const db = app_();
    await expect(
      withTenant(db, { accountId: a.accountId, userId: null }, (tx) =>
        tx.company.create({ data: { id: uuidv7(), accountId: b.accountId, name: 'Einbruch' } }),
      ),
    ).rejects.toThrow(/row-level security/i);
    const changed = await withTenant(db, { accountId: a.accountId, userId: null }, (tx) =>
      tx.company.updateMany({ where: { id: b.companyId }, data: { name: 'gekapert' } }),
    );
    expect(changed.count).toBe(0);
    await db.$disconnect();
  });

  it('Kontext gilt nur innerhalb der Transaktion', async () => {
    const db = app_();
    await withTenant(db, { accountId: a.accountId, userId: null }, (tx) => tx.company.count());
    expect(await db.company.count()).toBe(0);
    await db.$disconnect();
  });

  it('ungültiger Kontext wird abgelehnt', async () => {
    const db = app_();
    await expect(
      withTenant(db, { accountId: "x' OR 1=1 --", userId: null }, (tx) => tx.company.count()),
    ).rejects.toThrow('Ungültiger Mandantenkontext');
    await db.$disconnect();
  });

  it('Audit-Log ist unveränderlich', async () => {
    const db = app_();
    await expect(
      withTenant(db, { accountId: a.accountId, userId: null }, (tx) =>
        tx.auditLog.updateMany({ data: { action: 'gefälscht' } }),
      ),
    ).rejects.toThrow();
    await expect(
      withTenant(db, { accountId: a.accountId, userId: null }, (tx) => tx.auditLog.deleteMany()),
    ).rejects.toThrow();
    await db.$disconnect();
  });

  it('die Laufzeit-Rolle hat kein BYPASSRLS', async () => {
    const db = app_();
    const r = await db.$queryRaw<
      { rolbypassrls: boolean; rolsuper: boolean }[]
    >`SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = current_user`;
    expect(r[0]).toEqual({ rolbypassrls: false, rolsuper: false });
    await db.$disconnect();
  });
});

describe('Phase 2: neue Daten sind ebenfalls getrennt', () => {
  it('Suche, Ansichten, eigene Felder, Dashboards, Benachrichtigungen, Einstellungen', async () => {
    // B legt überall Daten an
    const field = await b.client.post('/custom-fields', {
      entityType: 'company',
      key: 'geheim',
      label: 'Geheim',
      type: 'text',
    });
    const view = await b.client.post('/views', {
      tableKey: 'companies',
      name: 'B-Ansicht',
      state: {},
      shared: true,
    });
    await b.client.put('/admin/preferences/nav', {
      hidden: ['/admin/audit'],
      order: [],
      favorites: [],
    });
    await b.client.post('/dashboards', { name: 'B-Seite', widgets: [] });
    await b.client.post('/admin/companies', { name: 'Firma B Zwei', country: 'DE' });
    const bNotes = await b.client.get('/notifications');

    // A sieht davon nichts
    const hits = (await a.client.get('/search?q=Firma%20B')).body.items as {
      entityId: string;
      title: string;
    }[];
    expect(hits.every((h) => !h.title.startsWith('Firma B') && h.entityId !== b.companyId)).toBe(
      true,
    );
    expect(
      (await a.client.get('/views?table=companies')).body.map((v: { name: string }) => v.name),
    ).not.toContain('B-Ansicht');
    expect(
      (
        await a.client.put(`/views/${view.body.id}`, {
          tableKey: 'companies',
          name: 'x',
          state: {},
        })
      ).status,
    ).toBe(404);
    expect((await a.client.del(`/views/${view.body.id}`)).status).toBe(404);
    expect(
      (await a.client.get('/custom-fields?entityType=company')).body.map(
        (d: { key: string }) => d.key,
      ),
    ).not.toContain('geheim');
    expect((await a.client.post(`/custom-fields/${field.body.id}/archive`)).status).toBe(404);
    expect((await a.client.get('/preferences/nav')).body.value).toBeNull();
    expect(
      (await a.client.get('/dashboards')).body.pages.map((p: { name: string }) => p.name),
    ).not.toContain('B-Seite');
    for (const n of bNotes.body.items)
      expect((await a.client.post(`/notifications/${n.id}/read`)).status).toBe(204);
    expect((await b.client.get('/notifications')).body.unread).toBe(bNotes.body.unread);
    // Fremde Firma als Filter- oder Verweisziel hilft nicht
    const filtered = await a.client.get(
      `/admin/companies?filters=${encodeURIComponent(JSON.stringify([{ field: 'name', op: 'contains', value: 'Firma B' }]))}`,
    );
    expect(filtered.body.items).toEqual([]);
    expect(
      (await a.client.get(`/activity?entityType=company&entityId=${b.companyId}`)).status,
    ).toBe(404);
  });

  it('Datenbank: neue Tabellen ohne Kontext leer; Benachrichtigungen nur für den eigenen Benutzer', async () => {
    const db = createPrismaClient(process.env.DATABASE_URL);
    expect(await db.searchDocument.count()).toBe(0);
    expect(await db.notification.count()).toBe(0);
    expect(await db.dashboard.count()).toBe(0);
    expect(await db.savedView.count()).toBe(0);
    expect(await db.customFieldDefinition.count()).toBe(0);
    expect(await db.outboxEvent.count()).toBe(0);
    const someoneElse = '00000000-0000-7000-8000-000000000000';
    const visible = await withTenant(db, { accountId: b.accountId, userId: someoneElse }, (tx) =>
      tx.notification.count(),
    );
    expect(visible).toBe(0);
    await expect(
      withTenant(db, { accountId: a.accountId, userId: null }, (tx) =>
        tx.outboxEvent.updateMany({ data: { type: 'x' } }),
      ),
    ).rejects.toThrow();
    await db.$disconnect();
  });
});

export type { Client };
