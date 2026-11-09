/**
 * End-to-End-Test Phase 6 (Automatisierung) im echten Browser:
 * Paket Professional → Regel „Wenn Bestellung ab 100 €, dann Versandart Spedition“ anlegen →
 * Auftrag anlegen → Regel greift (Protokoll) → Webhook an lokalen Empfänger, signierte Zustellung.
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
const owner = `p6-${id}@example.test`;
const pw = 'sehr-sicheres-passwort-1';
const browser = await chromium.launch(
  process.env.E2E_CHROMIUM_PATH ? { executablePath: process.env.E2E_CHROMIUM_PATH } : {},
);
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'de-DE' });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
const shot = (n) => page.screenshot({ path: `${shots}/p6-${n}.png` });

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
const { createServer } = await import('node:http');
const { createHmac } = await import('node:crypto');
const hits = [];
const receiver = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    hits.push({ headers: req.headers, body });
    res.end('ok');
  });
});
await new Promise((r) => receiver.listen(0, '127.0.0.1', r));
const hookUrl = `http://127.0.0.1:${receiver.address().port}/fangevo`;
const waitFor = async (fn, what) => {
  for (let i = 0; i < 60; i++) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('Zeitüberschreitung: ' + what);
};

// 1. Regel über die Oberfläche
await page.getByRole('link', { name: 'Automatisierung', exact: true }).click();
await page.getByRole('button', { name: 'Regel anlegen' }).click();
await page.getByLabel('Name').fill('Große Bestellungen per Spedition');
await page.getByRole('checkbox', { name: /^Aktiv/ }).check();
await page.getByRole('button', { name: 'Bedingung' }).click();
await page.getByLabel('Feld').selectOption('order.totalGross');
await page.getByLabel('Vergleich').selectOption('gte');
await page.getByLabel('Wert').fill('100');
await page.getByLabel('Aktion 1').selectOption('set_shipping_method');
await page.getByLabel('Versandart').fill('Spedition');
await shot('01-regel');
await page.getByRole('button', { name: 'Speichern' }).click();
await page.getByRole('cell', { name: /Große Bestellungen per Spedition/ }).waitFor();

// 2. Webhook über die Oberfläche
await page.getByRole('tab', { name: 'Webhooks' }).click();
await page.getByRole('button', { name: 'Webhook anlegen' }).click();
await page.getByLabel('Name').fill('Testempfänger');
await page.getByLabel('Adresse (URL)').fill(hookUrl);
await page.getByRole('button', { name: 'Speichern' }).click();
const secret = (await page.locator('code', { hasText: 'whsec_' }).textContent()).trim();
await shot('02-webhook');

// 3. Auftrag anlegen → Regel und Webhook greifen im Hintergrund
const customer = await api('POST', '/customers', {
  type: 'private',
  lastName: 'Muster',
  addresses: [{ kind: 'billing', street: 'Deichweg 1', postalCode: '25813', city: 'Husum' }],
});
const article = await api('POST', '/articles', {
  name: 'Boot',
  salePriceNet: '500',
  stockTracked: false,
});
const order = await api('POST', '/orders', {
  customerId: customer.id,
  lines: [{ articleId: article.id, quantity: '1' }],
});
await waitFor(
  async () => (await api('GET', `/orders/${order.id}`)).shippingMethod === 'Spedition',
  'Regel hat die Versandart nicht gesetzt',
);
const hit = await waitFor(
  () => hits.find((h) => h.headers['x-fangevo-event'] === 'order.created'),
  'kein Webhook empfangen',
);
const expected =
  'sha256=' +
  createHmac('sha256', secret)
    .update(`${hit.headers['x-fangevo-timestamp']}.${hit.body}`)
    .digest('hex');
if (hit.headers['x-fangevo-signature'] !== expected) throw new Error('Signatur stimmt nicht');

await page.getByRole('tab', { name: 'Regeln' }).click();
await page.getByRole('cell', { name: /Große Bestellungen per Spedition/ }).click();
await page.getByRole('tab', { name: /Protokoll/ }).click();
await page.getByText('Ausgeführt', { exact: true }).first().waitFor();
await page.getByText(/Versandart „Spedition“ gesetzt/).waitFor();
await shot('03-protokoll');
receiver.close();

const unexpected = errors.filter((e) => !/status of (401|404|409|422)/.test(e));
if (unexpected.length) throw new Error('Browserfehler: ' + JSON.stringify(unexpected));
console.warn('E2E Phase 6: OK');
await browser.close();
