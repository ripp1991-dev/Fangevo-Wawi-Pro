/**
 * End-to-End-Test Phase 4 (Logistik) im echten Browser:
 * Paket Business (Plattform-Werkzeug) → Testdaten per API → Pickliste erstellen und abschließen →
 * Packtisch: Auftrag und Artikel scannen, Etikett, Abschluss → Retoure anlegen und Eingang buchen →
 * Mobile Scan-Seite.
 * Voraussetzungen wie core-flow.mjs (siehe TESTING.md).
 */
import { chromium } from 'playwright';
import { mkdirSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

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
const owner = `p4-${id}@example.test`;
const pw = 'sehr-sicheres-passwort-1';
const browser = await chromium.launch(
  process.env.E2E_CHROMIUM_PATH ? { executablePath: process.env.E2E_CHROMIUM_PATH } : {},
);
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'de-DE' });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
const shot = (n) => page.screenshot({ path: `${shots}/p4-${n}.png` });

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

// Paket Business (Pack, Versand, Retouren) über das Plattform-Werkzeug
const session = await api('GET', '/auth/session');
execSync(
  `pnpm --silent --filter @fangevo/database license:set -- --account ${session.account.id} --plan business`,
  {
    stdio: 'inherit',
  },
);

// Testdaten
const md = await api('GET', '/company/master-data');
const hl = md.warehouses.find((w) => w.isDefault).id;
const loc = await api('POST', `/company/warehouses/${hl}/locations`, { code: 'A-01' });
const article = await api('POST', '/articles', {
  name: 'Spinnrute Pro',
  gtin: '4006381333931',
  salePriceNet: '49.90',
});
await api('POST', '/inventory/bookings', {
  type: 'receipt',
  articleId: article.id,
  warehouseId: hl,
  locationId: loc.id,
  quantity: '10',
});
const customer = await api('POST', '/customers', {
  type: 'private',
  firstName: 'Erika',
  lastName: 'Muster',
  addresses: [{ kind: 'billing', street: 'Deichweg 1', postalCode: '25813', city: 'Husum' }],
});
const order = await api('POST', '/orders', {
  customerId: customer.id,
  lines: [{ articleId: article.id, quantity: '2' }],
});
await page.reload();

// 1. Pickliste
await page.getByRole('link', { name: 'Kommissionierung', exact: true }).click();
await page.getByRole('tab', { name: 'Neue Pickliste' }).click();
await page.getByRole('cell', { name: order.number, exact: true }).waitFor();
await page.getByLabel(`${order.number} auswählen`).check();
await page.getByRole('button', { name: /Pickliste erstellen/ }).click();
await page.getByRole('heading', { name: 'Pickliste PL-000001' }).waitFor();
await shot('01-pickliste');
await page.getByRole('button', { name: 'Gepickt' }).click();
await page.getByRole('button', { name: 'Abschließen' }).click();
await page.getByText('Alle Aufträge sind bereit zum Packen.').waitFor();
await page.keyboard.press('Escape');

// 2. Packtisch
await page.getByRole('link', { name: 'Packtisch', exact: true }).click();
await page.getByLabel('Auftrag scannen (Auftragsnummer)').fill(order.number);
await page.keyboard.press('Enter');
await page.getByText(`Auftrag ${order.number} geladen`).waitFor();
await page.getByLabel('Artikel scannen').fill('9999999999999');
await page.keyboard.press('Enter');
await page.getByText(/gehört nicht zu diesem Auftrag/).waitFor();
for (let i = 0; i < 2; i++) {
  await page.getByLabel('Artikel scannen').fill('4006381333931');
  await page.keyboard.press('Enter');
  await page.getByText('Spinnrute Pro gepackt').waitFor();
}
await page.getByLabel('Versandart').selectOption('own_label');
await page.getByLabel('Paket 1: Gewicht (kg)').fill('2,4');
await shot('02-packtisch');
await page.getByRole('button', { name: 'Packen abschließen' }).click();
await page.getByText('Versendet – Sendung SE-000001').waitFor();
await page.getByRole('button', { name: 'Etikett drucken' }).waitFor();
await shot('03-versendet');
const levels = await api('GET', `/inventory/levels?articleId=${article.id}`);
if (levels.reduce((s, l) => s + Number(l.quantity), 0) !== 8)
  throw new Error('Bestand nach Versand falsch');

// 3. Retoure
await page.getByRole('link', { name: 'Retouren', exact: true }).click();
await page.getByRole('button', { name: 'Retoure anlegen' }).click();
await page.getByLabel('Auftragsnummer').fill(order.number);
await page.getByRole('button', { name: 'Suchen', exact: true }).click();
await page.getByLabel('Menge Spinnrute Pro').fill('1');
await page.getByLabel('Grund').fill('Zu lang');
await page.getByRole('button', { name: 'Anlegen', exact: true }).click();
await page.getByRole('heading', { name: 'Retoure RT-000001' }).waitFor();
await page.getByLabel('Einlagern auf Lagerplatz').selectOption({ label: 'A-01' });
await page.getByRole('button', { name: 'Wareneingang buchen' }).click();
await page.getByText('Eingegangen', { exact: true }).first().waitFor();
await shot('04-retoure');
await page.keyboard.press('Escape');

// 4. Mobile Scan-Seite
const mobile = await browser.newContext({
  ...(await import('playwright')).devices['Pixel 7'],
  storageState: await ctx.storageState(),
  locale: 'de-DE',
});
const m = await mobile.newPage();
m.on('pageerror', (e) => errors.push(e.message));
await m.goto(`${BASE}/scan`);
await m.getByLabel('Barcode, Artikelnummer oder Lagerplatz').fill('4006381333931');
await m.keyboard.press('Enter');
await m.getByText('Spinnrute Pro', { exact: true }).waitFor();
await m.getByText(/Bestand gesamt/).waitFor();
await m.screenshot({ path: `${shots}/p4-05-scan-mobil.png` });
await mobile.close();

const unexpected = errors.filter((e) => !/status of (401|404|409|422)/.test(e));
if (unexpected.length) throw new Error('Browserfehler: ' + JSON.stringify(unexpected));
console.warn('E2E Phase 4: OK');
await browser.close();
