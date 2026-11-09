import { type NestFastifyApplication } from '@nestjs/platform-fastify';
import { randomUUID } from 'node:crypto';
import { authenticator } from 'otplib';
import { createPrismaClient, withTenant, type PrismaClient, type Tx } from '@fangevo/database';
import { loadConfig } from '../src/config';
import { createApp } from '../src/bootstrap';
import { MailService } from '../src/core/mail/mail.service';

export async function startApp(
  overrides: Record<string, string> = {},
): Promise<NestFastifyApplication> {
  const app = await createApp(loadConfig({ ...process.env, ...overrides }));
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}

export interface Res<T = any> {
  status: number;
  body: T;
}

/** Kleiner HTTP-Client mit Cookie-Speicher (simuliert einen Browser). */
export class Client {
  cookie: string | undefined;
  companyId: string | undefined;
  constructor(private readonly app: NestFastifyApplication) {}

  async req<T = any>(
    method: string,
    url: string,
    body?: unknown,
    opts: { csrf?: boolean; headers?: Record<string, string> } = {},
  ): Promise<Res<T>> {
    const headers: Record<string, string> = { ...(opts.headers ?? {}) };
    if (this.cookie) headers.cookie = this.cookie;
    if (opts.csrf !== false && method !== 'GET') headers['x-fangevo-csrf'] = '1';
    if (this.companyId) headers['x-company-id'] = this.companyId;
    const r = await this.app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: method as 'GET',
        url: url.startsWith('/health') ? url : `/api/v1${url}`,
        payload: body as object,
        headers,
      });
    const set = r.headers['set-cookie'];
    const first = Array.isArray(set) ? set[0] : set;
    if (first?.startsWith('fe_session=')) {
      const v = first.split(';')[0]!;
      this.cookie = v === 'fe_session=' ? undefined : v;
    }
    return { status: r.statusCode, body: (r.body ? safeJson(r.body) : undefined) as T };
  }
  get<T = any>(url: string) {
    return this.req<T>('GET', url);
  }
  post<T = any>(url: string, body?: unknown) {
    return this.req<T>('POST', url, body ?? {});
  }
  put<T = any>(url: string, body?: unknown) {
    return this.req<T>('PUT', url, body ?? {});
  }
  patch<T = any>(url: string, body?: unknown) {
    return this.req<T>('PATCH', url, body ?? {});
  }
  del<T = any>(url: string) {
    return this.req<T>('DELETE', url);
  }
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

export function mails(app: NestFastifyApplication) {
  return app.get(MailService).sent;
}

export function lastTokenFor(app: NestFastifyApplication, email: string): string {
  const m = [...mails(app)].reverse().find((x) => x.to === email);
  const match = m?.text.match(/token=([^\s]+)/);
  if (!match) throw new Error(`Keine Token-Mail für ${email}`);
  return decodeURIComponent(match[1]!);
}

export const PASSWORD = 'sehr-sicheres-passwort-123';

export function uniqueEmail(prefix = 'user'): string {
  return `${prefix}-${randomUUID().slice(0, 8)}@example.test`;
}

/** Registriert einen Account, bestätigt die E-Mail und meldet an. */
export async function signUp(
  app: NestFastifyApplication,
  accountName = 'Testfirma',
): Promise<{ client: Client; email: string; accountId: string; companyId: string }> {
  const client = new Client(app);
  const email = uniqueEmail('owner');
  const r = await client.post('/auth/register', {
    name: 'Inhaber Test',
    email,
    password: PASSWORD,
    accountName,
  });
  if (r.status !== 202) throw new Error(`register ${r.status} ${JSON.stringify(r.body)}`);
  await client.post('/auth/verify-email', { token: lastTokenFor(app, email) });
  const l = await client.post('/auth/login', { email, password: PASSWORD });
  if (l.status !== 200) throw new Error(`login ${l.status}`);
  const s = await client.get('/auth/session');
  return { client, email, accountId: s.body.account.id, companyId: s.body.account.companies[0].id };
}

/** Lädt eine Person ein und lässt sie die Einladung als neuer Benutzer annehmen. */
export async function inviteNewMember(
  app: NestFastifyApplication,
  admin: Client,
  input: { roleIds?: string[]; allCompanies?: boolean; companyIds?: string[] } = {},
): Promise<{ client: Client; email: string; membershipId: string }> {
  const email = uniqueEmail('member');
  const inv = await admin.post('/admin/members/invitations', {
    email,
    roleIds: [],
    allCompanies: false,
    companyIds: [],
    ...input,
  });
  if (inv.status !== 201) throw new Error(`invite ${inv.status} ${JSON.stringify(inv.body)}`);
  const client = new Client(app);
  const acc = await client.post('/auth/invitations/accept', {
    token: lastTokenFor(app, email),
    name: 'Mitarbeiter Test',
    password: PASSWORD,
  });
  if (acc.status !== 200) throw new Error(`accept ${acc.status} ${JSON.stringify(acc.body)}`);
  const members = await admin.get('/admin/members');
  const m = members.body.find((x: { user: { email: string } }) => x.user.email === email);
  return { client, email, membershipId: m.id };
}

export function totp(secret: string): string {
  return authenticator.generate(secret);
}

let owner: PrismaClient | undefined;
/** Direkter Datenbankzugriff als Eigentümer-Rolle (nur Tests). Unterliegt ebenfalls RLS (FORCE). */
export function ownerDb(): PrismaClient {
  owner ??= createPrismaClient(process.env.TEST_DATABASE_MIGRATE_URL);
  return owner;
}
export function asTenant<T>(accountId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withTenant(ownerDb(), { accountId, userId: null }, fn);
}

/** Stellt alle offenen Ereignisse zu (statt auf den Hintergrund-Worker zu warten). */
export async function drainEvents(app: NestFastifyApplication): Promise<void> {
  const { EventDispatcher } = await import('../src/core/events/dispatcher.service');
  const d = app.get(EventDispatcher);
  for (let i = 0; i < 50 && (await d.runOnce(200)) > 0; i++);
}

export async function roleIdByName(c: Client, name: string): Promise<string> {
  const r = await c.get('/admin/roles');
  return r.body.find((x: { name: string }) => x.name === name).id;
}
