/**
 * End-to-End-Test Phase 3a (Warenwirtschaft: Stammdaten und Lager) im echten Browser:
 * Firmeneinstellungen (Kategorie, Lagerplatz, Steuersatz) → Artikel anlegen (7 %, Bruttoanzeige) →
 * Testdaten per API → Wareneingang, Abgang mit zu wenig Bestand (Fehler), Inventur →
 * Kunde mit Adresse → Lieferant mit Artikelzuordnung → Suche → Widget „Unter Mindestbestand“.
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
const owner = `p3-${id}@example.test`;
const pw = 'sehr-sicheres-passwort-1';
const browser = await chromium.launch(
  process.env.E2E_CHROMIUM_PATH ? { executablePath: process.env.E2E_CHROMIUM_PATH } : {},
);
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'de-DE' });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
const shot = (n) => page.screenshot({ path: `${shots}/p3-${n}.png` });

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

// 1. Firmeneinstellungen
await page.getByRole('link', { name: 'Firmeneinstellungen', exact: true }).click();
await page.getByText('Regelsteuersatz').waitFor();
await page.getByLabel('Neue Kategorie').fill('Ruten');
await page.getByRole('button', { name: 'Anlegen' }).nth(3).click();
await page.locator('li', { hasText: 'Ruten' }).first().waitFor();
await page.getByLabel('Neuer Lagerplatz in Hauptlager').fill('R1-F1');
await page.getByLabel('Neuer Lagerplatz in Hauptlager').press('Enter');
await page.getByText('Lagerplätze: R1-F1').waitFor();
await shot('01-firmeneinstellungen');

// 2. Artikel über die Oberfläche
await page.getByRole('link', { name: 'Artikel', exact: true }).click();
await page.getByRole('button', { name: 'Artikel anlegen' }).click();
await page.getByLabel('Bezeichnung *').fill('Spinnrute Pro 2,40 m');
await page.getByLabel('EAN/GTIN').fill('4006381333931');
await page.getByLabel('Kategorie').selectOption({ label: 'Ruten' });
await page.getByLabel('Mindestbestand').fill('5');
await page.getByRole('tab', { name: 'Preise' }).click();
await page.getByLabel('Steuersatz').selectOption({ label: 'Ermäßigter Steuersatz (7 %)' });
await page.getByLabel('Einkaufspreis netto (€)').fill('21,50');
await page.getByLabel('Verkaufspreis netto (€)').fill('49,90');
await page.getByText('brutto 53,39').waitFor();
await shot('02-artikel-preise');
await page.getByRole('button', { name: 'Speichern' }).click();
await page.getByRole('heading', { name: /A-000001 · Spinnrute Pro/ }).waitFor();
await page
  .getByRole('button', { name: 'Schließen' })
  .last()
  .click()
  .catch(() => {});
await page.keyboard.press('Escape');

// 3. Weitere Testdaten per API (gleiche Sitzung)
const companyId = await page.evaluate(() => {
  const k = Object.keys(localStorage).find((x) => x.startsWith('fe-company:'));
  return k ? localStorage.getItem(k) : null;
});
const api = (method, path, data) =>
  page.request.fetch(`${BASE}/api/v1${path}`, {
    method,
    data,
    headers: { 'x-fangevo-csrf': '1', 'x-company-id': companyId },
  });
for (const [name, price] of [
  ['Kescher faltbar', '18.9'],
  ['Wobbler Barsch 7 cm', '6.5'],
  ['Angelschnur 0,25 mm 300 m', '9.9'],
]) {
  const r = await api('POST', '/articles', { name, salePriceNet: price, minStock: '20' });
  if (!r.ok()) throw new Error('Artikel per API: ' + (await r.text()));
}
await page.reload();
await page.locator('td', { hasText: 'Wobbler Barsch' }).waitFor();
await shot('03-artikelliste');

// 4. Lager: Zugang, zu großer Abgang, Inventur
await page.getByRole('link', { name: 'Lager & Bestand', exact: true }).click();
await page.getByRole('button', { name: 'Zugang' }).click();
await page.getByLabel('Artikel', { exact: true }).fill('Spinnrute');
await page.getByRole('button', { name: /A-000001 · Spinnrute Pro/ }).click();
await page.getByLabel('Lagerplatz', { exact: true }).selectOption({ label: 'R1-F1' });
await page.getByLabel('Menge', { exact: true }).fill('12');
await page.getByLabel('Notiz', { exact: true }).fill('Lieferschein 4711');
await page.getByRole('button', { name: 'Buchen', exact: true }).click();
await page.getByText('Gebucht. Neuer Bestand 12.').waitFor();
await page.getByRole('button', { name: 'Fertig' }).click();
await page.getByRole('button', { name: 'Abgang' }).click();
await page.getByLabel('Artikel', { exact: true }).fill('Spinnrute');
await page.getByRole('button', { name: /A-000001 · Spinnrute Pro/ }).click();
await page.getByLabel('Lagerplatz', { exact: true }).selectOption({ label: 'R1-F1' });
await page.getByLabel('Menge', { exact: true }).fill('20');
await page.getByRole('button', { name: 'Buchen', exact: true }).click();
await page.getByText(/Nicht genug Bestand. Verfügbar: 12/).waitFor();
await shot('04-abgang-zu-wenig-bestand');
await page.getByRole('button', { name: 'Fertig' }).click();
await page.getByRole('button', { name: 'Inventur' }).click();
await page.getByLabel('Artikel', { exact: true }).fill('Spinnrute');
await page.getByRole('button', { name: /A-000001 · Spinnrute Pro/ }).click();
await page.getByLabel('Lagerplatz', { exact: true }).selectOption({ label: 'R1-F1' });
await page.getByLabel('Gezählter Bestand').fill('11');
await page.getByRole('button', { name: 'Buchen', exact: true }).click();
await page.getByText('Korrigiert um -1. Neuer Bestand 11.').waitFor();
await page.getByRole('button', { name: 'Fertig' }).click();
await page.getByRole('tab', { name: 'Journal' }).click();
await page.getByText('Korrektur / Inventur').first().waitFor();
await shot('05-lagerjournal');

// 5. Kunde mit Adresse
await page.getByRole('link', { name: 'Kunden', exact: true }).click();
await page.getByRole('button', { name: 'Kunde anlegen' }).click();
await page.getByLabel('Kundenart').selectOption('business');
await page.getByLabel('Firmenname *').fill('Angelverein Nordsee e. V.');
await page.getByLabel('E-Mail').fill('kasse@angelverein-nordsee.example');
await page.getByRole('tab', { name: /Adressen/ }).click();
await page.getByLabel('Straße').first().fill('Deichweg 3');
await page.getByLabel('PLZ').first().fill('25813');
await page.getByLabel('Ort').first().fill('Husum');
await page.getByRole('button', { name: 'Speichern' }).click();
await page.locator('td', { hasText: 'Angelverein Nordsee' }).waitFor();
await page.locator('td', { hasText: 'Husum' }).waitFor();
await shot('06-kunden');

// 6. Lieferant mit Artikelzuordnung
await page.getByRole('link', { name: 'Lieferanten', exact: true }).click();
await page.getByRole('button', { name: 'Lieferant anlegen' }).click();
await page.getByLabel('Name *').fill('Angelgroßhandel Kiel');
await page.getByRole('button', { name: 'Speichern' }).click();
await page.getByRole('tab', { name: /Artikel/ }).click();
await page.getByLabel('Artikel suchen').fill('Spinnrute');
await page.getByRole('button', { name: /A-000001 · Spinnrute Pro/ }).click();
await page.getByLabel('Lieferanten-Artikelnummer').fill('SR-240-PRO');
await page.getByLabel('Einkaufspreis netto (€) *').fill('19,80');
await page.getByLabel('Bevorzugter Lieferant für diesen Artikel').check();
await page.getByRole('button', { name: 'Zuordnen' }).click();
await page.getByText('SR-240-PRO').waitFor();
await shot('07-lieferant-artikel');
await page.keyboard.press('Escape');

// 7. Suche
await page.keyboard.press('Control+k');
await page.getByLabel('Suchbegriff').fill('Wobbl');
await page
  .getByRole('listbox', { name: 'Ergebnisse' })
  .getByRole('option', { name: /Wobbler Barsch/ })
  .waitFor();
await page.keyboard.press('Escape');

// 8. Dashboard-Widget „Unter Mindestbestand“
await page.getByRole('link', { name: 'Übersicht', exact: true }).click();
await page.getByRole('button', { name: 'Bearbeiten' }).click();
await page.getByRole('button', { name: 'Widget' }).click();
await page.getByRole('button', { name: /^Unter Mindestbestand/ }).click();
await page.getByRole('button', { name: 'Fertig' }).click();
await page
  .getByRole('region', { name: 'Unter Mindestbestand' })
  .getByText('Kescher faltbar')
  .waitFor();
await shot('08-dashboard-mindestbestand');

const unexpected = errors.filter((e) => !/status of (401|409|422)/.test(e));
if (unexpected.length) throw new Error('Browserfehler: ' + JSON.stringify(unexpected));
console.warn('E2E Phase 3a: OK');
await browser.close();
