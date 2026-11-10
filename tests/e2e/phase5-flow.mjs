/**
 * End-to-End-Test Phase 5 (Import, API, Verkaufskanäle) im echten Browser:
 * Paket Professional (Plattform-Werkzeug) → Artikel-Import aus CSV (Vorschlag, Prüflauf, Ausführung) →
 * API-Schlüssel anlegen → Verkaufskanal anlegen → Bestellung per API übergeben → Auftrag sichtbar.
 *
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
const owner = `p5-${id}@example.test`;
const pw = 'sehr-sicheres-passwort-1';
const browser = await chromium.launch(
  process.env.E2E_CHROMIUM_PATH ? { executablePath: process.env.E2E_CHROMIUM_PATH } : {},
);
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'de-DE' });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
const shot = (n) => page.screenshot({ path: `${shots}/p5-${n}.png` });

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

// Paket Professional (Import, API, Kanäle) über das Plattform-Werkzeug
const session = await api('GET', '/auth/session');
execSync(
  `pnpm --silent --filter @fangevo/database license:set -- --account ${session.account.id} --plan professional`,
  {
    stdio: 'inherit',
  },
);

await page.reload();
const { writeFileSync } = await import('node:fs');
const csvPath = `${shots}/p5-artikel.csv`;
writeFileSync(
  csvPath,
  'Artikelnummer;Bezeichnung;VK Netto;MwSt;Kategorie;EAN\nI-100;Spinnrute Import;49,90;19;Angeln > Ruten;4006381333931\nI-200;Kescher Import;19,90;19;Angeln > Zubehör;\nI-300;Fehlerhaft;abc;19;;\n',
);

// 1. Import
await page.getByRole('link', { name: 'Import & Export', exact: true }).click();
await page.getByLabel('Datei (CSV oder Excel .xlsx, höchstens 10 MB)').setInputFiles(csvPath);
await page.getByText('Spalten zuordnen').waitFor();
await shot('01-zuordnung');
await page.getByRole('button', { name: 'Prüflauf starten' }).click();
await page.getByText(/2 neu · 0 ändern/).waitFor();
await page.getByText(/Zeile 4:/).waitFor();
await page.getByRole('button', { name: /Import ausführen/ }).click();
await page.getByText('Fertig', { exact: true }).waitFor({ timeout: 30000 });
await page.getByText(/2 erfolgreich/).waitFor();
await shot('02-import-fertig');
const arts = await api('GET', '/articles?q=Import');
if (arts.total !== 2) throw new Error('Import hat nicht 2 Artikel angelegt');
await api('POST', '/inventory/bookings', {
  type: 'receipt',
  articleId: arts.items.find((a) => a.number === 'I-100').id,
  warehouseId: (await api('GET', '/company/master-data')).warehouses[0].id,
  quantity: '5',
});

// 2. API-Schlüssel
await page.getByRole('link', { name: 'API-Schlüssel', exact: true }).click();
await page.getByRole('button', { name: 'Schlüssel anlegen' }).click();
await page.getByLabel('Name').fill('Webshop');
for (const l of [
  'Verkaufskanäle ansehen',
  'Aufträge ansehen',
  'Aufträge anlegen, bearbeiten, Status ändern und versenden',
  'Lagerbestände ansehen',
])
  await page.getByLabel(l).check();
await page.getByRole('button', { name: 'Anlegen', exact: true }).click();
const token = (await page.locator('code', { hasText: 'fe_live_' }).textContent()).trim();
await shot('03-api-schluessel');

// 3. Verkaufskanal
await page.getByRole('link', { name: 'Verkaufskanäle', exact: true }).click();
await page.getByRole('button', { name: 'Kanal anlegen' }).click();
await page.getByLabel('Name').fill('Mein Webshop');
await page.getByRole('button', { name: 'Speichern' }).click();
await page.getByRole('cell', { name: /Mein Webshop/ }).waitFor();
const channel = (await api('GET', '/channels')).items[0];

// 4. Shop übergibt eine Bestellung mit dem Schlüssel (ohne Cookie)
const shop = await fetch(`http://localhost:3000/api/v1/channels/${channel.id}/orders`, {
  method: 'POST',
  headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  body: JSON.stringify({
    externalId: 'WEB-4711',
    customer: { email: 'kunde@example.test', firstName: 'Erika', lastName: 'Muster' },
    billingAddress: { street: 'Deichweg 1', postalCode: '25813', city: 'Husum', country: 'DE' },
    lines: [{ sku: '4006381333931', quantity: 1 }],
  }),
});
if (shop.status !== 201)
  throw new Error('Shop-Bestellung: ' + shop.status + ' ' + (await shop.text()));
await page.getByRole('cell', { name: /Mein Webshop/ }).click();
await page.getByText(/WEB-4711 als AU-000001 übernommen/).waitFor();
await shot('04-kanal');
await page.keyboard.press('Escape');
await page.getByRole('link', { name: 'Aufträge', exact: true }).click();
await page.getByRole('cell', { name: 'AU-000001' }).waitFor();

const unexpected = errors.filter((e) => !/status of (401|404|409|422)/.test(e));
if (unexpected.length) throw new Error('Browserfehler: ' + JSON.stringify(unexpected));
console.warn('E2E Phase 5: OK');
await browser.close();
