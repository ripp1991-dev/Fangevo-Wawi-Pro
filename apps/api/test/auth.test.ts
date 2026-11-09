import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Client, PASSWORD, lastTokenFor, mails, signUp, startApp, totp, uniqueEmail } from './helpers';

let app: NestFastifyApplication;
beforeAll(async () => {
  app = await startApp();
});
afterAll(async () => app.close());

describe('Registrierung und E-Mail-Bestätigung', () => {
  it('legt Account, Firma, Inhaber und Testlizenz an', async () => {
    const { client } = await signUp(app, 'Meine GmbH');
    const s = await client.get('/auth/session');
    expect(s.status).toBe(200);
    expect(s.body.account.name).toBe('Meine GmbH');
    expect(s.body.account.isOwner).toBe(true);
    expect(s.body.account.license.status).toBe('TRIAL');
    expect(s.body.account.companies).toHaveLength(1);
    expect(s.body.account.permissions).toContain('users.manage');
  });

  it('Login ohne bestätigte E-Mail wird abgelehnt', async () => {
    const c = new Client(app);
    const email = uniqueEmail();
    await c.post('/auth/register', { name: 'X', email, password: PASSWORD, accountName: 'X' });
    const r = await c.post('/auth/login', { email, password: PASSWORD });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('EMAIL_NOT_VERIFIED');
  });

  it('doppelte Registrierung verrät nicht, dass die Adresse existiert', async () => {
    const { email } = await signUp(app);
    const c = new Client(app);
    const r = await c.post('/auth/register', { name: 'Y', email, password: PASSWORD, accountName: 'Y' });
    expect(r.status).toBe(202);
    expect(r.body).toEqual({ status: 'verification_sent' });
  });

  it('Bestätigungslink ist nur einmal gültig', async () => {
    const c = new Client(app);
    const email = uniqueEmail();
    await c.post('/auth/register', { name: 'Z', email, password: PASSWORD, accountName: 'Z' });
    const token = lastTokenFor(app, email);
    expect((await c.post('/auth/verify-email', { token })).status).toBe(200);
    const again = await c.post('/auth/verify-email', { token });
    expect(again.status).toBe(400);
    expect(again.body.code).toBe('TOKEN_INVALID');
  });

  it('validiert Eingaben mit verständlichen Fehlern', async () => {
    const r = await new Client(app).post('/auth/register', { name: '', email: 'kaputt', password: 'kurz', accountName: 'A' });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('VALIDATION_FAILED');
    expect(r.body.errors.map((e: { path: string }) => e.path).sort()).toEqual(['email', 'name', 'password']);
  });
});

describe('Login und Sitzung', () => {
  it('falsches Passwort und unbekannte E-Mail liefern denselben Fehler', async () => {
    const { email } = await signUp(app);
    const c = new Client(app);
    const wrong = await c.post('/auth/login', { email, password: 'falsches-passwort' });
    const unknown = await c.post('/auth/login', { email: uniqueEmail(), password: 'falsches-passwort' });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body).toEqual(unknown.body);
  });

  it('Sitzungscookie ist HttpOnly und SameSite', async () => {
    const { email } = await signUp(app);
    const r = await app.getHttpAdapter().getInstance().inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { 'x-fangevo-csrf': '1' },
      payload: { email, password: PASSWORD },
    });
    const cookie = String(r.headers['set-cookie']);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
  });

  it('Logout beendet die Sitzung serverseitig', async () => {
    const { client } = await signUp(app);
    const old = client.cookie;
    expect((await client.post('/auth/logout')).status).toBe(204);
    client.cookie = old;
    expect((await client.get('/auth/session')).status).toBe(401);
  });

  it('schreibende Anfragen ohne CSRF-Header werden abgelehnt', async () => {
    const { client } = await signUp(app);
    const r = await client.req('POST', '/admin/companies', { name: 'X', country: 'DE' }, { csrf: false });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('CSRF_HEADER_MISSING');
  });

  it('ohne Anmeldung kein Zugriff auf Administration', async () => {
    const r = await new Client(app).get('/admin/companies');
    expect(r.status).toBe(401);
  });

  it('gefälschtes Sitzungstoken wird abgelehnt', async () => {
    const c = new Client(app);
    c.cookie = 'fe_session=ausgedacht';
    const r = await c.get('/auth/session');
    expect(r.status).toBe(401);
    expect(r.body.code).toBe('SESSION_EXPIRED');
  });

  it('eigene Sitzungen auflisten und einzeln beenden', async () => {
    const { client, email } = await signUp(app);
    const second = new Client(app);
    await second.post('/auth/login', { email, password: PASSWORD });
    const list = await client.get('/auth/sessions');
    expect(list.body.length).toBe(2);
    const other = list.body.find((s: { current: boolean }) => !s.current);
    expect((await client.del(`/auth/sessions/${other.id}`)).status).toBe(204);
    expect((await second.get('/auth/session')).status).toBe(401);
  });
});

describe('Passwort', () => {
  it('Zurücksetzen per E-Mail beendet alle Sitzungen', async () => {
    const { client, email } = await signUp(app);
    const anon = new Client(app);
    expect((await anon.post('/auth/password/forgot', { email })).status).toBe(202);
    const token = lastTokenFor(app, email);
    expect((await anon.post('/auth/password/reset', { token, password: 'ein-ganz-neues-passwort' })).status).toBe(200);
    expect((await client.get('/auth/session')).status).toBe(401);
    expect((await anon.post('/auth/login', { email, password: PASSWORD })).status).toBe(401);
    expect((await anon.post('/auth/login', { email, password: 'ein-ganz-neues-passwort' })).status).toBe(200);
    expect((await anon.post('/auth/password/reset', { token, password: 'noch-ein-passwort-1' })).status).toBe(400);
  });

  it('"Passwort vergessen" verrät nicht, ob es die Adresse gibt', async () => {
    const before = mails(app).length;
    const r = await new Client(app).post('/auth/password/forgot', { email: uniqueEmail() });
    expect(r.status).toBe(202);
    expect(mails(app).length).toBe(before);
  });

  it('Ändern verlangt das aktuelle Passwort und beendet andere Sitzungen', async () => {
    const { client, email } = await signUp(app);
    const other = new Client(app);
    await other.post('/auth/login', { email, password: PASSWORD });
    expect((await client.post('/auth/password/change', { currentPassword: 'falsch', newPassword: 'neues-passwort-123' })).status).toBe(400);
    expect((await client.post('/auth/password/change', { currentPassword: PASSWORD, newPassword: 'neues-passwort-123' })).status).toBe(200);
    expect((await client.get('/auth/session')).status).toBe(200);
    expect((await other.get('/auth/session')).status).toBe(401);
  });
});

describe('Zwei-Faktor-Authentifizierung', () => {
  it('Einrichtung, Login mit Code und Wiederherstellungscode (einmalig)', async () => {
    const { client, email } = await signUp(app);
    const setup = await client.post('/auth/mfa/setup');
    expect(setup.status).toBe(200);
    expect(setup.body.qrDataUrl).toMatch(/^data:image\/png;base64,/);
    expect((await client.post('/auth/mfa/enable', { code: '000000' })).status).toBe(400);
    const enable = await client.post('/auth/mfa/enable', { code: totp(setup.body.secret) });
    expect(enable.status).toBe(200);
    expect(enable.body.recoveryCodes).toHaveLength(10);

    // Neuer Login: Passwort allein reicht nicht
    const c = new Client(app);
    const l = await c.post('/auth/login', { email, password: PASSWORD });
    expect(l.body).toEqual({ mfaRequired: true });
    const blocked = await c.get('/admin/companies');
    expect(blocked.status).toBe(401);
    expect(blocked.body.code).toBe('MFA_REQUIRED');
    expect((await c.post('/auth/mfa/verify', { code: '123456' })).status).toBe(401);
    expect((await c.post('/auth/mfa/verify', { code: totp(setup.body.secret) })).status).toBe(200);
    expect((await c.get('/admin/companies')).status).toBe(200);

    // Wiederherstellungscode funktioniert genau einmal
    const code = enable.body.recoveryCodes[0];
    const c2 = new Client(app);
    await c2.post('/auth/login', { email, password: PASSWORD });
    expect((await c2.post('/auth/mfa/verify', { code })).status).toBe(200);
    const c3 = new Client(app);
    await c3.post('/auth/login', { email, password: PASSWORD });
    expect((await c3.post('/auth/mfa/verify', { code })).status).toBe(401);

    // Deaktivieren nur mit Passwort
    expect((await client.post('/auth/mfa/disable', { password: 'falsch' })).status).toBe(400);
    expect((await client.post('/auth/mfa/disable', { password: PASSWORD })).status).toBe(200);
    const c4 = new Client(app);
    expect((await c4.post('/auth/login', { email, password: PASSWORD })).body).toEqual({ mfaRequired: false });
  });
});
