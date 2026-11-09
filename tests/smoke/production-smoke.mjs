/**
 * Rauchtest nach einer Bereitstellung (Phase 8, siehe OPERATIONS.md).
 *
 *   SMOKE_BASE=https://wawi.example.de node tests/smoke/production-smoke.mjs
 *
 * Prüft ohne Anmeldung: Erreichbarkeit, Gesundheitsstatus, Sicherheits-Header, Login-Seite ohne
 * Browser- oder CSP-Fehler. Mit SMOKE_MAILPIT=http://host:8025 (Testsystem mit Mailpit) zusätzlich
 * Registrierung, E-Mail-Bestätigung, Anmeldung und die wichtigsten Seiten.
 * Legt in Produktion keine Daten an, solange SMOKE_MAILPIT nicht gesetzt ist.
 */
import { chromium } from 'playwright';

const BASE = process.env.SMOKE_BASE ?? 'http://localhost:8080';
const MAILPIT = process.env.SMOKE_MAILPIT;
const fail = (m) => {
  throw new Error(m);
};

// 1. API und Header
const health = await fetch(`${BASE}/health`);
if (!health.ok) fail(`/health antwortet mit ${health.status}`);
const h = await health.json();
if (!h.checks?.database || !h.checks?.redis) fail('Datenbank oder Redis nicht erreichbar');
const page0 = await fetch(`${BASE}/login`);
for (const name of ['content-security-policy', 'x-content-type-options', 'x-frame-options'])
  if (!page0.headers.get(name)) fail(`Header ${name} fehlt`);
if (
  BASE.startsWith('https://') &&
  !(await fetch(`${BASE}/api/v1/auth/session`)).headers.get('strict-transport-security')
)
  console.warn('Hinweis: kein Strict-Transport-Security-Header (am TLS-Proxy setzen)');
console.warn('✓ Erreichbar, gesund, Sicherheits-Header gesetzt');

// 2. Browser
const browser = await chromium.launch(
  process.env.E2E_CHROMIUM_PATH ? { executablePath: process.env.E2E_CHROMIUM_PATH } : {},
);
const page = await browser.newPage({ locale: 'de-DE' });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.goto(`${BASE}/login`);
await page.getByRole('button', { name: 'Anmelden' }).waitFor();
console.warn('✓ Anmeldeseite lädt');

if (MAILPIT) {
  const id = Date.now().toString(36);
  const email = `smoke-${id}@example.test`;
  const pw = 'sehr-sicheres-passwort-1';
  await page.goto(`${BASE}/register`);
  await page.getByLabel('Ihr Name').fill('Rauch Test');
  await page.getByLabel('Firmenname').fill(`Rauchtest ${id}`);
  await page.getByLabel('E-Mail-Adresse').fill(email);
  await page.getByLabel('Passwort').fill(pw);
  await page.getByRole('button', { name: 'Account erstellen' }).click();
  await page.getByText('E-Mail versendet').waitFor();
  let token;
  for (let i = 0; i < 50 && !token; i++) {
    const list = await (
      await fetch(`${MAILPIT}/api/v1/search?query=to:${encodeURIComponent(email)}`)
    ).json();
    if (list.messages?.length) {
      const msg = await (await fetch(`${MAILPIT}/api/v1/message/${list.messages[0].ID}`)).json();
      token = msg.Text.match(/verify-email\?token=([^\s]+)/)?.[1];
    }
    if (!token) await new Promise((r) => setTimeout(r, 200));
  }
  if (!token) fail('keine Bestätigungs-Mail erhalten');
  await page.goto(`${BASE}/verify-email?token=${token}`);
  await page.getByText('Ihre E-Mail-Adresse ist bestätigt').waitFor();
  await page.goto(`${BASE}/login`);
  await page.getByLabel('E-Mail-Adresse').fill(email);
  await page.getByLabel('Passwort').fill(pw);
  await page.getByRole('button', { name: 'Anmelden' }).click();
  await page.getByRole('heading', { name: 'Hallo Rauch' }).waitFor();
  for (const [link, heading] of [
    ['Artikel', 'Artikel'],
    ['Aufträge', 'Aufträge'],
    ['Abo & Rechnungen', 'Abo & Rechnungen'],
    ['Marketplace', 'Marketplace'],
  ]) {
    await page.getByRole('link', { name: link, exact: true }).first().click();
    await page.getByRole('heading', { name: heading, level: 1 }).waitFor();
  }
  console.warn('✓ Registrierung, E-Mail, Anmeldung und Hauptseiten');
}

await browser.close();
const unexpected = errors.filter((e) => !/status of (401|403|404)/.test(e));
if (unexpected.length) fail('Browserfehler (z. B. CSP): ' + JSON.stringify(unexpected));
console.warn('Rauchtest: OK');
