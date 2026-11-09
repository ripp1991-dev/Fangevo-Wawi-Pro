/**
 * End-to-End-Test der Phase-2-Werkzeuge im echten Browser:
 * Dashboard anpassen (Widget hinzufügen, Notiz speichern) → eigenes Feld anlegen →
 * Firma mit eigenem Feld anlegen → Tabelle filtern, Ansicht speichern, exportieren →
 * Suche mit Strg+K → Verlauf → Einladung → Benachrichtigung → Menü-Favorit.
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
const owner = `p2-inhaber-${id}@example.test`;
const staff = `p2-team-${id}@example.test`;
const pw = 'sehr-sicheres-passwort-1';
const browser = await chromium.launch(
  process.env.E2E_CHROMIUM_PATH ? { executablePath: process.env.E2E_CHROMIUM_PATH } : {},
);
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  locale: 'de-DE',
  acceptDownloads: true,
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
const shot = (n) => page.screenshot({ path: `${shots}/p2-${n}.png` });

// Konto anlegen und anmelden
await page.goto(`${BASE}/register`);
await page.getByLabel('Ihr Name').fill('Petra Nordmann');
await page.getByLabel('Firmenname').fill('Nordsee Handel GmbH');
await page.getByLabel('E-Mail-Adresse').fill(owner);
await page.getByLabel('Passwort').fill(pw);
await page.getByRole('button', { name: 'Account erstellen' }).click();
await page.getByText('E-Mail versendet').waitFor();
await page.waitForTimeout(300);
await page.goto(
  `${BASE}/verify-email?token=${encodeURIComponent(await tokenFor(owner, '/verify-email'))}`,
);
await page.getByText('Ihre E-Mail-Adresse ist bestätigt').waitFor();
await page.goto(`${BASE}/login`);
await page.getByLabel('E-Mail-Adresse').fill(owner);
await page.getByLabel('Passwort').fill(pw);
await page.getByRole('button', { name: 'Anmelden' }).click();

// 1. Dashboard
await page.getByRole('heading', { name: 'Hallo Petra' }).waitFor();
await page.getByRole('region', { name: 'Letzte Aktivitäten' }).waitFor();
await shot('01-dashboard-standard');
await page.getByRole('button', { name: 'Bearbeiten' }).click();
await page.getByRole('button', { name: 'Widget' }).click();
await page.getByRole('button', { name: /^Notiz/ }).click();
await page.getByRole('button', { name: 'Fertig' }).click();
await page.getByRole('button', { name: 'Bearbeiten' }).waitFor();
await Promise.all([
  page.waitForResponse(
    (r) =>
      r.url().includes('/api/v1/dashboards/') &&
      r.request().method() === 'PUT' &&
      r.status() === 200,
  ),
  page.getByLabel('Notiztext').fill('Montag: Inventur Lager Husum'),
]);
await page.reload();
await page.getByLabel('Notiztext').waitFor();
if ((await page.getByLabel('Notiztext').inputValue()) !== 'Montag: Inventur Lager Husum')
  throw new Error('Notiz nicht gespeichert');
await shot('02-dashboard-angepasst');

// 2. Eigenes Feld
await page.getByRole('link', { name: 'Eigene Felder', exact: true }).click();
await page.getByRole('button', { name: 'Feld anlegen' }).first().click();
await page.getByLabel('Bezeichnung').fill('Region');
await page.getByLabel('Typ', { exact: true }).selectOption('select');
await page.getByLabel('Option 1').fill('Nord');
await page.getByRole('button', { name: 'Option hinzufügen' }).click();
await page.getByLabel('Option 2').fill('Süd');
await page.getByRole('button', { name: 'Speichern' }).click();
await page.locator('td', { hasText: 'Region' }).first().waitFor();
await shot('03-eigene-felder');

// 3. Firma mit eigenem Feld
await page.getByRole('link', { name: 'Firmen', exact: true }).click();
await page.getByRole('button', { name: 'Firma anlegen' }).click();
await page.getByLabel('Anzeigename *').fill('Nordlicht Filiale');
await page.getByLabel('Ort', { exact: true }).fill('Husum');
await page.getByLabel('Region', { exact: true }).selectOption('nord');
await page.getByRole('button', { name: 'Speichern' }).click();
await page.locator('td', { hasText: 'Nordlicht Filiale' }).waitFor();

// 4. Tabelle: filtern, Ansicht speichern, exportieren
await page.getByRole('button', { name: 'Filter' }).click();
await page.getByLabel('Feld', { exact: true }).selectOption('cf.region');
await page.getByLabel('Wert', { exact: true }).selectOption('nord');
await page.getByRole('button', { name: 'Anwenden' }).click();
await page.getByText('1 Eintrag').waitFor();
await shot('04-firmen-gefiltert');
await page.getByRole('button', { name: 'Ansichten' }).click();
await page.getByLabel('Name der Ansicht').fill('Nur Region Nord');
await page.getByLabel('Für alle im Account freigeben').check();
await page.getByRole('button', { name: 'Speichern', exact: true }).click();
await page.getByRole('button', { name: 'Nur Region Nord', exact: true }).first().waitFor();
await page.keyboard.press('Escape');
const [download] = await Promise.all([
  page.waitForEvent('download'),
  page.getByRole('button', { name: 'Export' }).click(),
]);
if (!download.suggestedFilename().startsWith('firmen-')) throw new Error('Export fehlgeschlagen');

// 5. Verlauf
await page.locator('td', { hasText: 'Nordlicht Filiale' }).click();
await page.getByRole('tab', { name: 'Verlauf' }).click();
await page.getByText('hat eine Firma angelegt').waitFor();
await shot('05-verlauf');
await page.getByRole('button', { name: 'Schließen' }).last().click();

// 6. Suche (Strg+K)
await page.keyboard.press('Control+k');
await page.getByLabel('Suchbegriff').fill('Nordlic');
await page
  .getByRole('listbox', { name: 'Ergebnisse' })
  .getByRole('option', { name: /Nordlicht Filiale/ })
  .waitFor();
await shot('06-suche');
await page.keyboard.press('Escape');

// 7. Einladung → Benachrichtigung
await page.getByRole('link', { name: 'Benutzer', exact: true }).click();
await page.getByRole('button', { name: 'Einladen' }).click();
await page.getByLabel('E-Mail-Adresse').fill(staff);
await page.getByRole('button', { name: 'Einladung senden' }).click();
await page.getByText('Offene Einladungen').waitFor();
const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'de-DE' });
const p2 = await ctx2.newPage();
await p2.goto(
  `${BASE}/accept-invitation?token=${encodeURIComponent(await tokenFor(staff, '/accept-invitation'))}`,
);
await p2.getByLabel('Ihr Name').fill('Tim Team');
await p2.getByLabel('Passwort festlegen').fill(pw);
await p2.getByRole('button', { name: 'Zugang erstellen und beitreten' }).click();
await p2.getByRole('heading', { name: 'Hallo Tim' }).waitFor();
await p2.screenshot({ path: `${shots}/p2-07-mobil-mitarbeiter.png` });
await page.waitForTimeout(2500);
await page.reload();
await page.getByRole('button', { name: /Benachrichtigungen, 1 ungelesen/ }).click();
await page.getByText('Tim Team ist dem Account beigetreten').waitFor();
await shot('08-benachrichtigung');
await page.keyboard.press('Escape');

// 8. Menü: Favorit
await page.getByRole('button', { name: 'Menü anpassen' }).click();
await page.getByRole('button', { name: 'Firmen als Favorit' }).click();
await page.getByRole('button', { name: 'Speichern' }).click();
await page.getByText('Favoriten').waitFor();
await shot('09-menue-favorit');

// Dunkelmodus Dashboard
await page.getByRole('link', { name: 'Übersicht', exact: true }).click();
await page.getByRole('button', { name: 'Dunkles Design' }).click();
await page.waitForTimeout(400);
await shot('10-dashboard-dunkel');

const unexpected = errors.filter((e) => !/status of (401|422)/.test(e));
if (unexpected.length) throw new Error('Browserfehler: ' + JSON.stringify(unexpected));
console.warn('E2E Phase 2: OK');
await browser.close();
