/**
 * End-to-End-Test Phase 7 (Kommerzialisierung) im echten Browser:
 * Kunde: Zusatzmodul im Marketplace testen → Rechnungsdaten → Abo Business starten (Rechnung)
 * → Support-Anfrage. FangEvo-Mitarbeiter (2FA): Account finden → Rechnung als bezahlt markieren
 * → Anfrage beantworten. Kunde sieht die Antwort.
 *
 * Voraussetzungen wie core-flow.mjs (siehe TESTING.md), zusätzlich muss die API mit
 * PLATFORM_ADMIN_EMAILS=@platform.example.test laufen.
 */
import { chromium } from 'playwright';
import { createHmac } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';

const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
const API_LOG = process.env.E2E_API_LOG ?? '/tmp/fangevo-api.log';
const shots = process.env.E2E_SCREENSHOTS ?? new URL('./screenshots', import.meta.url).pathname;
mkdirSync(shots, { recursive: true });

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

/** TOTP nach RFC 6238 (30 s, 6 Stellen, SHA-1) – nur für den Test. */
function totp(secret) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const ch of secret.replace(/=+$/, '').toUpperCase())
    bits += alphabet.indexOf(ch).toString(2).padStart(5, '0');
  const key = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const h = createHmac('sha1', key).update(counter).digest();
  const o = h[h.length - 1] & 0xf;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

const id = Date.now().toString(36);
const owner = `p7-${id}@example.test`;
const staff = `support-${id}@platform.example.test`;
const pw = 'sehr-sicheres-passwort-1';
const subject = `Wie buche ich den Wareneingang? (${id})`;
const browser = await chromium.launch(
  process.env.E2E_CHROMIUM_PATH ? { executablePath: process.env.E2E_CHROMIUM_PATH } : {},
);
const errors = [];

async function newUser(email, name, account) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'de-DE' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(`${BASE}/register`);
  await page.getByLabel('Ihr Name').fill(name);
  await page.getByLabel('Firmenname').fill(account);
  await page.getByLabel('E-Mail-Adresse').fill(email);
  await page.getByLabel('Passwort').fill(pw);
  await page.getByRole('button', { name: 'Account erstellen' }).click();
  await page.getByText('E-Mail versendet').waitFor();
  await page.goto(
    `${BASE}/verify-email?token=${encodeURIComponent(await tokenFor(email, '/verify-email'))}`,
  );
  await page.getByText('Ihre E-Mail-Adresse ist bestätigt').waitFor();
  await page.goto(`${BASE}/login`);
  await page.getByLabel('E-Mail-Adresse').fill(email);
  await page.getByLabel('Passwort').fill(pw);
  await page.getByRole('button', { name: 'Anmelden' }).click();
  await page.getByRole('heading', { name: `Hallo ${name.split(' ')[0]}` }).waitFor();
  const api = async (method, path, data) => {
    const r = await page.request.fetch(`${BASE}/api/v1${path}`, {
      method,
      data,
      headers: { 'x-fangevo-csrf': '1' },
    });
    if (!r.ok()) throw new Error(`${method} ${path}: ${r.status()} ${await r.text()}`);
    return r.headers()['content-type']?.includes('json') ? r.json() : r.body();
  };
  return { page, api };
}

// ───── Kunde ─────
const k = await newUser(owner, 'Ole Fischer', `Angelsport Fischer ${id}`);
const shot = (p, n) => p.screenshot({ path: `${shots}/p7-${n}.png` });

// 1. Marketplace: Einkauf 14 Tage testen
await k.page.getByRole('link', { name: 'Marketplace' }).click();
await k.page.getByRole('heading', { name: 'Marketplace', level: 1 }).waitFor();
const einkauf = k.page.getByRole('region', { name: 'Einkauf', exact: true });
await einkauf.getByRole('button', { name: '14 Tage testen' }).click();
await einkauf.getByText('Testversion').waitFor();
await k.page.getByRole('link', { name: 'Einkauf' }).waitFor();
await shot(k.page, '01-marketplace');

// 2. Abo & Rechnungen: Rechnungsdaten, Abo Business starten
await k.page.getByRole('link', { name: 'Abo & Rechnungen' }).click();
await k.page.getByText('Testphase', { exact: true }).waitFor();
await k.page.getByRole('button', { name: 'Bearbeiten' }).click();
await k.page.getByLabel('Straße und Hausnummer').fill('Hafenweg 1');
await k.page.getByLabel('PLZ').fill('25813');
await k.page.getByLabel('Ort').fill('Husum');
await k.page.getByLabel('E-Mail für Rechnungen').fill(owner);
await k.page.getByRole('button', { name: 'Speichern' }).click();
await k.page.getByText('Hafenweg 1').waitFor();
await k.page.getByRole('button', { name: 'Abo kostenpflichtig starten' }).click();
await k.page.getByRole('button', { name: /^Business/ }).click();
await k.page.getByRole('button', { name: 'Kostenpflichtig bestellen' }).click();
await k.page.getByText('Ihr Abo ist aktiv').waitFor();
await k.page.getByRole('cell', { name: /^FE-\d{4}-\d{6}$/ }).waitFor();
await k.page.getByText('355,81 €').waitFor();
await shot(k.page, '02-abo');
const billing = await k.api('GET', '/billing');
const invoice = billing.invoices[0];
const pdf = await k.api('GET', `/billing/invoices/${invoice.id}/pdf`);
if (pdf.subarray(0, 4).toString() !== '%PDF') throw new Error('Rechnung ist kein PDF');
const license = await k.api('GET', '/admin/license');
if (license.plan !== 'business' || license.status !== 'ACTIVE')
  throw new Error('Lizenz nicht aktiv: ' + JSON.stringify(license));

// 3. Support-Anfrage
await k.page.getByRole('link', { name: 'Support' }).click();
await k.page.getByRole('button', { name: 'Neue Anfrage' }).click();
await k.page.getByLabel('Betreff').fill(subject);
await k.page
  .getByRole('textbox', { name: 'Nachricht' })
  .fill('Hallo, wo finde ich den Wareneingang für Bestellungen?');
await k.page.getByRole('button', { name: 'Absenden' }).click();
await k.page.getByText('Wartet auf Support').first().waitFor();

// ───── FangEvo-Mitarbeiter ─────
const s = await newUser(staff, 'Svea Support', 'FangEvo Intern');
const setup = await s.api('POST', '/auth/mfa/setup');
await s.api('POST', '/auth/mfa/enable', { code: totp(setup.secret) });
await s.page.reload();
await s.page.getByRole('link', { name: 'Plattform-Verwaltung' }).click();
await s.page.getByRole('heading', { name: 'Plattform-Verwaltung' }).waitFor();
await s.page.getByLabel('Accounts suchen').fill(`Angelsport Fischer ${id}`);
await s.page.getByRole('button', { name: `Angelsport Fischer ${id}` }).click();
await s.page.getByText('Lizenz: business').waitFor();
await s.page.getByRole('button', { name: 'Bezahlt' }).click();
await s.page.getByRole('button', { name: 'Bezahlt' }).waitFor({ state: 'detached' });
await s.page.getByText('Bezahlt', { exact: true }).waitFor();
await shot(s.page, '03-plattform');

await s.page.getByRole('tab', { name: 'Support-Postfach' }).click();
await s.page.getByRole('button', { name: new RegExp(`${id}\\)$`) }).click();
await s.page
  .getByRole('textbox', { name: 'Antwort' })
  .fill('Unter Einkauf → Bestellungen → Wareneingang buchen.');
await s.page.getByRole('button', { name: 'Senden' }).click();
await s.page.getByText('FangEvo Support (Svea Support)').waitFor();
await shot(s.page, '04-support-antwort');

// Kunde sieht Antwort und bezahlte Rechnung
await k.page.reload();
await k.page.getByRole('button', { name: subject }).click();
await k.page.getByText('Unter Einkauf → Bestellungen → Wareneingang buchen.').waitFor();
await k.page.getByText('Wartet auf Ihre Antwort').first().waitFor();
const after = await k.api('GET', '/billing');
if (after.invoices[0].status !== 'paid') throw new Error('Rechnung nicht als bezahlt markiert');

// Kunde hat keinen Zugang zur Plattform-Verwaltung
const denied = await k.page.request.get(`${BASE}/api/v1/platform/accounts`);
if (denied.status() !== 403) throw new Error('Plattform-Verwaltung für Kunden erreichbar');

const unexpected = errors.filter((e) => !/status of (401|403|404|409|422)/.test(e));
if (unexpected.length) throw new Error('Browserfehler: ' + JSON.stringify(unexpected));
console.warn('E2E Phase 7: OK');
await browser.close();
