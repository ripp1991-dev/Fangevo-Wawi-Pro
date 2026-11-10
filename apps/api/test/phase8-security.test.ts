import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type NestFastifyApplication } from '@nestjs/platform-fastify';
import { PLANS } from '@fangevo/licensing';
import { createPrismaClient, type PrismaClient } from '@fangevo/database';
import { Client, asTenant, signUp, startApp } from './helpers';

/**
 * Phase 8: Sicherheits- und Robustheitsprüfungen über die gesamte API und das Datenbankschema.
 * Die Prüfungen sind generisch: Neue Endpunkte und Tabellen werden automatisch mitgeprüft.
 */

let app: NestFastifyApplication;
let db: PrismaClient;
let routes: { method: string; path: string }[] = [];

/** Tabellen mit account_id, die bewusst global sind (nur IDs/Verzeichnis, Zugriff nur serverseitig). */
const GLOBAL_TABLES = new Set([
  'sessions',
  'outbox_pending',
  'job_queue',
  'api_key_index',
  'workflow_schedule',
  'platform_accounts',
  'support_ticket_index',
]);

/** Endpunkte, die ohne Anmeldung erfolgreich antworten dürfen. */
const PUBLIC_OK = new Set([
  'GET /health',
  'POST /api/v1/auth/register',
  'POST /api/v1/auth/forgot-password',
  'POST /api/v1/auth/logout',
  'GET /api/v1/auth/invitations/{token}',
]);

beforeAll(async () => {
  app = await startApp();
  db = createPrismaClient(process.env.TEST_DATABASE_MIGRATE_URL);
  const r = await app
    .getHttpAdapter()
    .getInstance()
    .inject({ method: 'GET', url: '/api/openapi.json' });
  const doc = JSON.parse(r.body) as { paths: Record<string, Record<string, unknown>> };
  routes = Object.entries(doc.paths).flatMap(([path, ops]) =>
    Object.keys(ops).map((m) => ({ method: m.toUpperCase(), path })),
  );
});
afterAll(async () => {
  await db.$disconnect();
  await app.close();
});

const fill = (path: string) =>
  path.replace(/\{([^}]+)\}/g, (_, name: string) =>
    /id$/i.test(name) ? '00000000-0000-7000-8000-000000000000' : 'x',
  );

async function call(method: string, path: string, headers: Record<string, string> = {}) {
  const r = await app
    .getHttpAdapter()
    .getInstance()
    .inject({
      method: method as 'GET',
      url: fill(path),
      headers: { 'x-fangevo-csrf': '1', ...headers },
      payload: method === 'GET' || method === 'DELETE' ? undefined : {},
    });
  return r;
}

describe('Datenbank: Mandantentrennung im Schema', () => {
  it('jede Tabelle mit account_id hat erzwungene Row-Level Security und eine Richtlinie', async () => {
    const rows = await db.$queryRaw<
      { table: string; rls: boolean; force: boolean; policies: number }[]
    >`
      SELECT c.relname AS table, c.relrowsecurity AS rls, c.relforcerowsecurity AS force,
             (SELECT count(*)::int FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = c.relname) AS policies
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
      WHERE c.relkind = 'r'
        AND EXISTS (SELECT 1 FROM information_schema.columns k
                    WHERE k.table_schema = 'public' AND k.table_name = c.relname AND k.column_name = 'account_id')`;
    expect(rows.length).toBeGreaterThan(60);
    const bad = rows
      .filter((r) => !GLOBAL_TABLES.has(r.table))
      .filter((r) => !r.rls || !r.force || r.policies === 0)
      .map((r) => r.table);
    expect(bad).toEqual([]);
  });

  it('jede firmenbezogene Tabelle prüft zusätzlich die Firma', async () => {
    const rows = await db.$queryRaw<{ table: string; quals: string }[]>`
      SELECT c.relname AS table, coalesce(string_agg(p.qual, ' '), '') AS quals
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
      LEFT JOIN pg_policies p ON p.schemaname = 'public' AND p.tablename = c.relname
      WHERE c.relkind = 'r'
        AND EXISTS (SELECT 1 FROM information_schema.columns k
                    WHERE k.table_schema = 'public' AND k.table_name = c.relname AND k.column_name = 'company_id')
        AND EXISTS (SELECT 1 FROM information_schema.columns k
                    WHERE k.table_schema = 'public' AND k.table_name = c.relname AND k.column_name = 'account_id')
      GROUP BY c.relname`;
    // Tabellen, in denen company_id optional ist (Account-weite Einträge), sind ausgenommen
    const optional = new Set([
      'audit_logs',
      'outbox_events',
      'job_queue',
      'api_key_index',
      'notifications',
      'workflow_schedule',
      'saved_views',
      'dashboards',
      'custom_field_definitions',
      // Zugriffsmatrix (welche Person darf welche Firma) – Account-Ebene, nur Administration
      'company_access',
      // Suchindex über alle Firmen; der SearchService filtert nach den Firmenrechten der Person
      'search_documents',
    ]);
    const bad = rows
      .filter((r) => !optional.has(r.table) && !GLOBAL_TABLES.has(r.table))
      .filter((r) => !r.quals.includes('app_current_company'))
      .map((r) => r.table);
    expect(bad).toEqual([]);
  });

  it('die Anwendungsrolle kann RLS nicht umgehen', async () => {
    const [r] = await db.$queryRaw<{ super: boolean; bypass: boolean }[]>`
      SELECT rolsuper AS super, rolbypassrls AS bypass FROM pg_roles WHERE rolname = 'fangevo_app'`;
    expect(r).toEqual({ super: false, bypass: false });
  });
});

describe('API: Zugriff ohne Anmeldung', () => {
  it('kein geschützter Endpunkt antwortet ohne Anmeldung mit Daten, keiner mit Serverfehler', async () => {
    expect(routes.length).toBeGreaterThan(150);
    const leaks: string[] = [];
    const crashes: string[] = [];
    for (const r of routes) {
      const res = await call(r.method, r.path);
      const key = `${r.method} ${r.path}`;
      if (res.statusCode >= 500) crashes.push(`${key} → ${res.statusCode}`);
      if (res.statusCode < 300 && !PUBLIC_OK.has(key)) leaks.push(`${key} → ${res.statusCode}`);
    }
    expect(crashes).toEqual([]);
    expect(leaks).toEqual([]);
  });

  it('schreibende Anfragen ohne CSRF-Header werden abgewiesen', async () => {
    const { client } = await signUp(app, 'CSRF GmbH');
    const r = await client.req('POST', '/companies', { name: 'X', country: 'DE' }, { csrf: false });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('CSRF_HEADER_MISSING');
  });

  it('Sicherheits-Header und Sitzungs-Cookie', async () => {
    const h = (await call('GET', '/health')).headers;
    expect(h['x-content-type-options']).toBe('nosniff');
    expect(String(h['content-security-policy'])).toContain("frame-ancestors 'none'");
    expect(h['referrer-policy']).toBeTruthy();
    expect(h['x-powered-by']).toBeUndefined();
    const c = new Client(app);
    const s = await signUp(app, 'Cookie GmbH');
    const login = await c.post('/auth/login', {
      email: s.email,
      password: 'sehr-sicheres-passwort-123',
    });
    const cookie = String(login.headers['set-cookie']);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=(Lax|Strict)/i);
  });
});

describe('API: Robustheit mit Anmeldung', () => {
  it('kein Endpunkt liefert bei leeren oder unbekannten Eingaben einen Serverfehler', async () => {
    const s = await signUp(app, 'Robust GmbH');
    await asTenant(s.accountId, (tx) =>
      tx.entitlement.update({
        where: { accountId: s.accountId },
        data: { plan: 'enterprise', status: 'ACTIVE', modules: [...PLANS.enterprise.modules] },
      }),
    );
    const cookie = s.client.cookie!;
    const crashes: string[] = [];
    // Abmelden zuletzt, damit die Sitzung erhalten bleibt
    const ordered = [...routes].sort(
      (a, b) => Number(a.path.endsWith('/logout')) - Number(b.path.endsWith('/logout')),
    );
    for (const r of ordered) {
      if (r.path === '/health') continue;
      const res = await call(r.method, r.path, { cookie, 'x-company-id': s.companyId });
      if (res.statusCode >= 500)
        crashes.push(`${r.method} ${r.path} → ${res.statusCode} ${res.body.slice(0, 120)}`);
    }
    expect(crashes).toEqual([]);
  });

  it('Fehlerantworten enthalten keine internen Details', async () => {
    const r = await call('GET', '/api/v1/articles/keine-uuid');
    expect(r.headers['content-type']).toMatch(/problem\+json/);
    expect(r.body).not.toMatch(/at \w+ \(|node_modules|prisma|SELECT /i);
  });
});
