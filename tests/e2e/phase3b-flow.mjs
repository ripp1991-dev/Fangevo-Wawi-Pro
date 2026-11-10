/**
 * End-to-End-Test Phase 3b (Aufträge und Belege) im echten Browser:
 * Beleg-Angaben in den Firmeneinstellungen → Testdaten per API → Auftrag über die Oberfläche →
 * Versand (Bestand sinkt) → Rechnung erstellen, festschreiben, PDF prüfen, Zahlung erfassen →
 * Widget „Umsatz“.
 * Voraussetzungen wie core-flow.mjs (siehe TESTING.md).
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
const owner = `p3b-${id}@example.test`;
const pw = 'sehr-sicheres-passwort-1';
const browser = await chromium.launch(
  process.env.E2E_CHROMIUM_PATH ? { executablePath: process.env.E2E_CHROMIUM_PATH } : {},
);
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'de-DE' });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
const shot = (n) => page.screenshot({ path: `${shots}/p3b-${n}.png` });

// Konto anlegen und anmelden
await page.goto(`${BASE}/register`);
await page.getByLabel('Ihr Name').fill('Ole Fischer');
await page.getByLabel('Firmenname').fill('Angelsport Fischer GmbH');
await page.getByLabel('E-Mail-Adresse').fill(owner);
await page.getByLabel('Passwort').fill(pw);
await page.getByRole('button', { name: 'Account erstellen' }).click();
await page.getByText('E-Mail versendet').waitFor();
await page.goto(
  `${BASE}/verify-email?token=${encodeURIComponent(await tokenFor(owner, '/verify-email'))}`,
);
await page.getByText('Ihre E-Mail-Adresse ist bestätigt').waitFor();
await page.goto(`${BASE}/login`);
await page.getByLabel('E-Mail-Adresse').fill(owner);
await page.getByLabel('Passwort').fill(pw);
await page.getByRole('button', { name: 'Anmelden' }).click();
await page.getByRole('heading', { name: 'Hallo Ole' }).waitFor();

const companyId = await page.evaluate(() => {
  const k = Object.keys(localStorage).find((x) => x.startsWith('fe-company:'));
  return k ? localStorage.getItem(k) : null;
});
const api = async (method, path, data) => {
  const r = await page.request.fetch(`${BASE}/api/v1${path}`, {
    method,
    data,
    headers: { 'x-fangevo-csrf': '1', 'x-company-id': companyId },
  });
  if (!r.ok()) throw new Error(`${method} ${path}: ${r.status()} ${await r.text()}`);
  return r.headers()['content-type']?.includes('json') ? r.json() : r.body();
};

// 1. Beleg-Angaben über die Oberfläche, Firmenanschrift per API
await page.getByRole('link', { name: 'Firmeneinstellungen', exact: true }).click();
await page.getByText('Angaben auf Belegen').waitFor();
await page.getByLabel('Steuernummer').fill('15/123/45678');
await page.getByLabel('IBAN').fill('DE89 3704 0044 0532 0130 00');
await page.getByLabel('Bank').fill('Förde Sparkasse');
await page.getByLabel('IBAN').press('Tab');
await page.getByRole('button', { name: 'Speichern' }).last().click();
await page.getByText('Gespeichert').waitFor();
await shot('01-beleg-angaben');
const companies = await api('GET', '/admin/companies?pageSize=10');
const company = companies.items.find((c) => c.id === companyId);
await api('PUT', `/admin/companies/${companyId}`, {
  name: company.name,
  legalName: 'Angelsport Fischer GmbH',
  street: 'Hafenstraße 5',
  postalCode: '25813',
  city: 'Husum',
  country: 'DE',
  version: company.version,
});

// 2. Testdaten per API
const article = await api('POST', '/articles', {
  name: 'Spinnrute Pro 2,40 m',
  salePriceNet: '49.90',
});
const md = await api('GET', '/company/master-data');
const hl = md.warehouses.find((w) => w.isDefault).id;
await api('POST', '/inventory/bookings', {
  type: 'receipt',
  articleId: article.id,
  warehouseId: hl,
  quantity: '10',
});
await api('POST', '/customers', {
  type: 'business',
  companyName: 'Angelverein Nordsee e. V.',
  email: 'kasse@angelverein-nordsee.example',
  addresses: [{ kind: 'billing', street: 'Deichweg 3', postalCode: '25813', city: 'Husum' }],
});

// 3. Auftrag über die Oberfläche
await page.getByRole('link', { name: 'Aufträge', exact: true }).click();
await page.getByRole('button', { name: 'Auftrag anlegen' }).click();
await page.getByLabel('Kunde *').fill('Angelverein');
await page.getByRole('button', { name: /Angelverein Nordsee/ }).click();
await page.getByLabel('Artikel hinzufügen').fill('Spinnrute');
await page.getByRole('button', { name: /Spinnrute Pro/ }).click();
await page.getByLabel('Menge').first().fill('2');
await page.getByLabel('Versandkosten netto').fill('4,90');
await page.getByLabel('Versandart').fill('DHL Paket');
await shot('02-auftrag-erfassen');
await page.getByRole('button', { name: 'Speichern' }).click();
await page.getByRole('heading', { name: 'Auftrag AU-000001' }).waitFor();
await page.getByText('104,70 €').first().waitFor(); // 2 × 49,90 + 4,90 netto
await shot('03-auftrag');

// 4. Versand bucht Bestand ab
await page.getByRole('button', { name: /Versenden/ }).click();
await page.getByText('Versendet', { exact: true }).first().waitFor();
const levels = await api('GET', `/inventory/levels?articleId=${article.id}`);
if (levels.reduce((s, l) => s + Number(l.quantity), 0) !== 8)
  throw new Error('Bestand nach Versand falsch: ' + JSON.stringify(levels));

// 5. Rechnung: erstellen, festschreiben, PDF, Zahlung
await page.getByRole('tab', { name: 'Belege' }).click();
await page.getByRole('button', { name: 'Rechnung', exact: true }).click();
await page.getByRole('heading', { name: 'Rechnung (Entwurf)' }).waitFor();
await page.getByRole('button', { name: 'Festschreiben' }).click();
await page.getByRole('heading', { name: 'Rechnung RE-000001' }).waitFor();
await shot('04-rechnung');
const docs = await api('GET', '/documents?pageSize=10');
const pdf = await api('GET', `/documents/${docs.items[0].id}/pdf`);
if (pdf.subarray(0, 5).toString() !== '%PDF-') throw new Error('kein PDF');
await page.getByRole('button', { name: 'Zahlung erfassen' }).click();
await page.getByRole('button', { name: 'Speichern' }).last().click();
await page.getByText('Bezahlt', { exact: true }).first().waitFor();
await shot('05-rechnung-bezahlt');
await page.keyboard.press('Escape');
await page.keyboard.press('Escape');

// 6. Belegliste und Umsatz-Widget
await page.getByRole('link', { name: 'Belege', exact: true }).click();
await page.locator('td', { hasText: 'RE-000001' }).waitFor();
await shot('06-belege');
await page.getByRole('link', { name: 'Übersicht', exact: true }).click();
await page.getByRole('button', { name: 'Bearbeiten' }).click();
await page.getByRole('button', { name: 'Widget' }).click();
await page.getByRole('button', { name: /^Umsatz/ }).click();
await page.getByRole('button', { name: 'Fertig' }).click();
await page.getByRole('region', { name: 'Umsatz' }).getByText('104,70 €').first().waitFor();
await shot('07-dashboard-umsatz');

const unexpected = errors.filter((e) => !/status of (401|409|422)/.test(e));
if (unexpected.length) throw new Error('Browserfehler: ' + JSON.stringify(unexpected));
console.warn('E2E Phase 3b: OK');
await browser.close();
