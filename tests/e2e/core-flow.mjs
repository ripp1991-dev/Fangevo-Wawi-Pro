/**
 * End-to-End-Test des Phase-1-Kernprozesses im echten Browser:
 * Registrieren → E-Mail bestätigen → Anmelden → Firma anlegen → Mitarbeiter einladen →
 * Einladung als neue Person annehmen (mobil) → Rechte prüfen → Dunkelmodus.
 *
 * Voraussetzungen: API läuft mit MAIL_TRANSPORT=log und schreibt ihr Log nach E2E_API_LOG,
 * Web-App läuft unter E2E_BASE. Details: TESTING.md
 */
import { chromium } from 'playwright';
import { mkdirSync, readFileSync } from 'node:fs';

const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
const API_LOG = process.env.E2E_API_LOG ?? '/tmp/fangevo-api.log';
const shots = process.env.E2E_SCREENSHOTS ?? new URL('./screenshots', import.meta.url).pathname;
mkdirSync(shots, { recursive: true });
/** Token aus der (ins Log geschriebenen) E-Mail lesen; wartet bis zu 5 Sekunden. */
const tokenFor = async (email, path) => {
  for (let i = 0; i < 50; i++) {
    const log = readFileSync(API_LOG, 'utf8');
    const re = new RegExp(
      `E-Mail an ${email.replace(/[.]/g, '\\.')}[^\\n]*?${path}\\?token=([^\\s\\\\"]+)`,
      'g',
    );
    let m, last;
    while ((m = re.exec(log))) last = m[1];
    if (last) return decodeURIComponent(last);
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`kein Token für ${email} ${path}`);
};
const id = Date.now().toString(36);
const owner = `inhaber-${id}@example.test`,
  staff = `lager-${id}@example.test`,
  pw = 'sehr-sicheres-passwort-1';
const browser = await chromium.launch(
  process.env.E2E_CHROMIUM_PATH ? { executablePath: process.env.E2E_CHROMIUM_PATH } : {},
);
const ctx = await browser.newContext({
  viewport: { width: 1360, height: 860 },
  deviceScaleFactor: 1,
  locale: 'de-DE',
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

await page.goto(BASE + '/');
await page.waitForURL('**/login');
await page.screenshot({ path: `${shots}/01-login.png` });
await page.getByRole('link', { name: 'Kostenlos testen', exact: true }).click();
await page.getByLabel('Ihr Name').fill('Tom Muster');
await page.getByLabel('Firmenname').fill('FangEvo Demo GmbH');
await page.getByLabel('E-Mail-Adresse').fill(owner);
await page.getByLabel('Passwort').fill('kurz');
await page.getByRole('button', { name: 'Account erstellen' }).click();
await page.getByText('mindestens 12 Zeichen').first().waitFor();
await page.screenshot({ path: `${shots}/02-register-validation.png` });
await page.getByLabel('Passwort').fill(pw);
await page.getByRole('button', { name: 'Account erstellen' }).click();
await page.getByText('E-Mail versendet').waitFor();
await page.waitForTimeout(500);
await page.goto(
  `${BASE}/verify-email?token=${encodeURIComponent(await tokenFor(owner, '/verify-email'))}`,
);
await page.getByText('Ihre E-Mail-Adresse ist bestätigt').waitFor();
await page.getByRole('button', { name: 'Zur Anmeldung' }).click();
await page.getByLabel('E-Mail-Adresse').fill(owner);
await page.getByLabel('Passwort').fill(pw);
await page.getByRole('button', { name: 'Anmelden' }).click();
await page.getByRole('heading', { name: 'Hallo Tom' }).waitFor({ timeout: 10000 });
await page.screenshot({ path: `${shots}/03-dashboard.png` });

// Firma anlegen
await page.getByRole('link', { name: 'Firmen', exact: true }).click();
await page.getByRole('button', { name: 'Firma anlegen' }).click();
await page.getByLabel('Anzeigename').fill('FangEvo Outlet');
await page.getByLabel('Ort', { exact: true }).fill('Husum');
await page.getByLabel('PLZ', { exact: true }).fill('25813');
await page.getByRole('button', { name: 'Speichern' }).click();
await page.locator('td', { hasText: 'FangEvo Outlet' }).waitFor();
await page.screenshot({ path: `${shots}/04-companies.png` });

// Mitarbeiter einladen
await page.getByRole('link', { name: 'Benutzer', exact: true }).click();
await page.getByRole('button', { name: 'Einladen' }).click();
await page.getByLabel('E-Mail-Adresse').fill(staff);
if (!(await page.getByLabel('Mitarbeiter').isChecked()))
  throw new Error('Mitarbeiter-Rolle nicht vorausgewählt');
await page.screenshot({ path: `${shots}/05-invite.png` });
await page.getByRole('button', { name: 'Einladung senden' }).click();
await page.getByText('Offene Einladungen').waitFor();
await page.screenshot({ path: `${shots}/06-members.png` });

// Rollen
await page.getByRole('link', { name: 'Rollen & Rechte', exact: true }).click();
await page.getByText('Administrator').first().waitFor();
await page.screenshot({ path: `${shots}/07-roles.png` });
await page.getByRole('link', { name: 'Audit-Log', exact: true }).click();
await page.getByText('Person eingeladen').waitFor();
await page.screenshot({ path: `${shots}/08-audit.png` });
await page.getByRole('link', { name: 'Lizenz', exact: true }).click();
await page.getByText('Paket Starter').waitFor();
await page.screenshot({ path: `${shots}/09-license.png` });
await page.getByRole('link', { name: 'Profil & Sicherheit', exact: true }).click();
await page.getByRole('button', { name: 'Einrichten' }).click();
await page.getByAltText('QR-Code für die Authenticator-App').waitFor();
await page.screenshot({ path: `${shots}/10-security-mfa.png` });

// Einladung als neue Person annehmen (zweiter Browser)
const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'de-DE' });
const p2 = await ctx2.newPage();
p2.on('pageerror', (e) => errors.push('p2 ' + e.message));
await p2.goto(
  `${BASE}/accept-invitation?token=${encodeURIComponent(await tokenFor(staff, '/accept-invitation'))}`,
);
await p2.getByText('Einladung zu FangEvo Demo GmbH').waitFor();
await p2.getByLabel('Ihr Name').fill('Lea Lager');
await p2.getByLabel('Passwort festlegen').fill(pw);
await p2.getByRole('button', { name: 'Zugang erstellen und beitreten' }).click();
await p2.getByRole('heading', { name: 'Hallo Lea' }).waitFor();
await p2.screenshot({ path: `${shots}/11-mobile-staff-dashboard.png` });
await p2.goto(BASE + '/admin/members');
await p2.getByText('Keine Berechtigung').waitFor();
const sess = await (await p2.request.get(BASE + '/api/v1/auth/session')).json();
if (JSON.stringify(sess.account.permissions) !== '["companies.read"]')
  throw new Error('falsche Rechte ' + JSON.stringify(sess.account.permissions));
await p2.screenshot({ path: `${shots}/12-mobile-no-permission.png` });

// Dark mode Owner
await page.goto(BASE + '/admin/members');
await page.getByRole('button', { name: 'Dunkles Design' }).click();
await page.locator('td', { hasText: 'Lea Lager' }).waitFor();
await page.screenshot({ path: `${shots}/13-members-dark.png` });
const unexpected = errors.filter((e) => !/status of (401|422)/.test(e));
if (unexpected.length) throw new Error('Browserfehler: ' + JSON.stringify(unexpected));
console.warn('E2E Kernprozess: OK');
await browser.close();
