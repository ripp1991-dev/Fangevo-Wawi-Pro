#!/usr/bin/env node
/**
 * Demo-/Testdaten für eine FangEvo-Testumgebung (NIE gegen Produktion mit echten Kunden ausführen).
 *
 * Legt über die normale API an: Konto (E-Mail-Bestätigung über Mailpit), Firmenangaben, Lieferanten,
 * Kategorien, Artikel mit Bestand, Verkaufskanäle mit API-Schlüssel, Aufträge in allen Bearbeitungs-
 * ständen (über die Kanal-Schnittstelle wie ein echter Shop), Packplätze mit Packregeln, eine Pickliste,
 * versendete Aufträge mit Lieferschein/Rechnung und eine Retoure.
 *
 *   FANGEVO_BASE=http://localhost:8080 MAILPIT=http://localhost:8025 \
 *   LICENSE_CMD="<Befehl, {account} wird ersetzt>" node scripts/demo-data.mjs ./DEMO-LOGIN.txt
 *
 * LICENSE_CMD setzt das Paket Professional (Plattform-Werkzeug license:set), z. B. lokal:
 *   pnpm --filter @fangevo/database license:set -- --account {account} --plan professional
 */
import { execSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const BASE = `${process.env.FANGEVO_BASE ?? 'http://localhost:5173'}/api/v1`;
const MAIL = `${process.env.MAILPIT ?? 'http://localhost:8025'}/api/v1`;
const LICENSE_CMD = process.env.LICENSE_CMD;
const loginFile = process.argv[2] ?? 'DEMO-LOGIN.txt';
if (!LICENSE_CMD) throw new Error('LICENSE_CMD fehlt (siehe Kopfkommentar)');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Fester Startwert, damit die Daten bei jedem Lauf gleich aussehen
let seed = 20261110;
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
const pick = (a) => a[Math.floor(rnd() * a.length)];

const email = `test-${Date.now().toString(36)}@fangevo.local`;
const password = `Test-${randomBytes(9).toString('base64url')}`;
let cookie = '';
let companyId = '';

async function call(method, path, body, extra = {}) {
  const r = await fetch(BASE + path, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      'x-fangevo-csrf': '1',
      ...(cookie ? { cookie } : {}),
      ...(companyId ? { 'x-company-id': companyId } : {}),
      ...extra,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const sc = r.headers.get('set-cookie');
  if (sc && sc.includes('fe_session=')) cookie = sc.split(';')[0];
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

/** Gültige EAN-13 aus 12 Ziffern */
const ean = (n12) => {
  const d = [...n12].map(Number);
  const s = d.reduce((a, x, i) => a + x * (i % 2 ? 3 : 1), 0);
  return n12 + ((10 - (s % 10)) % 10);
};

// ───── 1) Konto ─────
await call('POST', '/auth/register', {
  name: 'Test Packer',
  email,
  password,
  accountName: 'FangEvo Testumgebung',
});
let token = null;
for (let i = 0; i < 60 && !token; i++) {
  const list = await (await fetch(`${MAIL}/messages`)).json();
  const m = list.messages?.find((x) => x.To?.some((t) => t.Address === email));
  if (m) {
    const full = await (await fetch(`${MAIL}/message/${m.ID}`)).json();
    token = /verify-email\?token=([^\s"<]+)/.exec(full.Text ?? full.HTML ?? '')?.[1] ?? null;
  }
  if (!token) await sleep(250);
}
if (!token) throw new Error('Keine Bestätigungs-Mail in Mailpit gefunden');
await call('POST', '/auth/verify-email', { token: decodeURIComponent(token) });
await call('POST', '/auth/login', { email, password });
let session = await call('GET', '/auth/session');
companyId = session.account.companies[0].id;
execSync(LICENSE_CMD.replace('{account}', session.account.id), { stdio: 'inherit' });

// ───── 2) Firmenangaben (Pflicht für Rechnungen) ─────
const company = (await call('GET', '/admin/companies?pageSize=10')).items[0];
await call('PUT', `/admin/companies/${companyId}`, {
  name: company.name,
  legalName: 'FangEvo Test GmbH',
  street: 'Dorfstraße 1',
  postalCode: '25842',
  city: 'Langenhorn',
  country: 'DE',
  version: company.version,
});
await call('PUT', '/company/settings', {
  allowNegativeStock: false,
  taxNumber: '15/000/00000',
  managingDirector: 'Test Geschäftsführung',
  bankName: 'Testbank',
  iban: 'DE02120300000000202051',
});

// ───── 3) Stammdaten ─────
const md = await call('GET', '/company/master-data');
const wh = md.warehouses.find((w) => w.isDefault).id;
const cat = async (name, parentId) =>
  (await call('POST', '/company/categories', { name, parentId })).id;
const sweets = await cat('Süßwaren');
const cats = {
  Schokolade: await cat('Schokolade', sweets),
  Lakritz: await cat('Lakritz', sweets),
  Fruchtgummi: await cat('Fruchtgummi', sweets),
  Chips: await cat('Chips & Snacks'),
};
const cold = await cat('Kühlware');
cats.Eis = await cat('Eis', cold);
cats.Getränke = await cat('Getränke');

const suppliers = {};
for (const [number, name] of [
  ['L-100', 'Nordic Candy Import (Test)'],
  ['L-200', 'Kühlkette Nord (Test)'],
  ['L-300', 'Getränke Handel Süd (Test)'],
])
  suppliers[number] = (await call('POST', '/suppliers', { number, name })).id;

const ARTICLES = [
  ['SCH-01', 'Zartbitter Schokolade 100g', 'Schokolade', '1.69', 120],
  ['SCH-02', 'Vollmilch Nuss 200g', 'Schokolade', '2.99', 80],
  ['SCH-03', 'Pralinen Geschenkbox 400g', 'Schokolade', '9.90', 25],
  ['SCH-04', 'Schokoriegel Karamell 50g', 'Schokolade', '0.99', 300],
  ['LAK-01', 'Salmiak Lakritz 150g', 'Lakritz', '2.49', 140],
  ['LAK-02', 'Süßes Lakritz Rollen 200g', 'Lakritz', '2.79', 90],
  ['LAK-03', 'Lakritz Mix 1kg', 'Lakritz', '11.90', 30],
  ['FRU-01', 'Fruchtgummi Bären 200g', 'Fruchtgummi', '1.49', 200],
  ['FRU-02', 'Saure Schlangen 250g', 'Fruchtgummi', '1.99', 160],
  ['FRU-03', 'Pick & Mix Tüte 500g', 'Fruchtgummi', '5.90', 60],
  ['CHI-01', 'Paprika Chips 175g', 'Chips', '1.79', 110],
  ['CHI-02', 'Salzstangen 250g', 'Chips', '1.19', 130],
  ['EIS-01', 'Vanilleeis 500ml', 'Eis', '3.49', 40],
  ['EIS-02', 'Wassereis Mix 10er', 'Eis', '2.99', 50],
  ['EIS-03', 'Eis am Stiel Schoko 4er', 'Eis', '3.99', 35],
  ['GET-01', 'Limonade Zitrone 0,33l', 'Getränke', '0.89', 480],
  ['GET-02', 'Cola 0,33l', 'Getränke', '0.89', 480],
  ['GET-03', 'Eistee Pfirsich 0,5l', 'Getränke', '1.19', 240],
];
const arts = {};
let eanBase = 400000000100;
for (const [number, name, c, price, stock] of ARTICLES) {
  const a = await call('POST', '/articles', {
    number,
    name,
    gtin: ean(String(eanBase++)),
    categoryId: cats[c],
    salePriceNet: price,
  });
  arts[number] = a;
  await call('POST', '/inventory/bookings', {
    type: 'receipt',
    articleId: a.id,
    warehouseId: wh,
    quantity: String(stock),
  });
}

// ───── 4) Verkaufskanäle (wie angebundene Shops/Marktplätze) ─────
const CHANNELS = ['Shopify', 'Amazon', 'eBay', 'Kaufland.de', 'Kaufland.at', 'Temu'];
const channels = {};
for (const name of CHANNELS) {
  channels[name] = (await call('POST', '/channels', { name, type: 'api' })).id;
  for (const a of Object.values(arts))
    await call('PUT', `/channels/${channels[name]}/listings/${a.id}`, { active: true });
}
const key = await call('POST', '/api-keys', {
  name: 'Testshop',
  permissions: ['channels.read', 'orders.manage', 'orders.read', 'inventory.read'],
});

// ───── 5) Aufträge ─────
const FIRST = ['Anna', 'Jonas', 'Mia', 'Lukas', 'Lea', 'Finn', 'Emma', 'Paul', 'Lina', 'Ben'];
const LAST = ['Petersen', 'Hansen', 'Jensen', 'Nielsen', 'Christiansen', 'Thomsen', 'Lorenzen'];
const CITY = [
  ['25813', 'Husum'],
  ['24937', 'Flensburg'],
  ['24103', 'Kiel'],
  ['25899', 'Niebüll'],
  ['20095', 'Hamburg'],
  ['1010', 'Wien', 'AT'],
];
const WEIGHT = { Shopify: 3, Amazon: 4, eBay: 2, 'Kaufland.de': 2, 'Kaufland.at': 1, Temu: 1 };
const channelBag = Object.entries(WEIGHT).flatMap(([c, w]) => Array(w).fill(c));
const numbers = Object.keys(arts);
const orders = [];
for (let i = 1; i <= 36; i++) {
  const channel = i % 9 === 0 ? 'Kaufland.at' : pick(channelBag);
  const [postalCode, city, country] = channel === 'Kaufland.at' ? CITY[5] : pick(CITY.slice(0, 5));
  const first = pick(FIRST);
  const last = pick(LAST);
  const lines = [
    ...new Set(Array.from({ length: 1 + Math.floor(rnd() * 3) }, () => pick(numbers))),
  ];
  const r = await call(
    'POST',
    `/channels/${channels[channel]}/orders`,
    {
      externalId: `${channel.replace(/\W/g, '').toUpperCase()}-${10000 + i}`,
      customer: {
        email: `${first}.${last}.${i}@kunde.test`.toLowerCase(),
        firstName: first,
        lastName: last,
      },
      billingAddress: {
        street: `${pick(['Hauptstraße', 'Dorfstraße', 'Deichweg', 'Bahnhofstraße'])} ${1 + (i % 40)}`,
        postalCode,
        city,
        country: country ?? 'DE',
      },
      lines: lines.map((sku) => ({ sku, quantity: 1 + Math.floor(rnd() * 3) })),
      shippingNet: '4.20',
      paymentMethod: pick(['PayPal', 'Kreditkarte', 'Rechnung', 'Marktplatz']),
    },
    { authorization: `Bearer ${key.token}`, cookie: '' },
  );
  orders.push({ id: r.order.id, channel });
}
// Reine Kühlware-Bestellungen (für den Kühlware-Packplatz), gleich versandbereit
const coldOrders = [];
for (const [i, [channel, skus]] of [
  ['Shopify', ['EIS-01', 'EIS-03']],
  ['Amazon', ['EIS-02']],
  ['Kaufland.de', ['EIS-01']],
].entries()) {
  const r = await call(
    'POST',
    `/channels/${channels[channel]}/orders`,
    {
      externalId: `KUEHL-${channel.replace(/\W/g, '').toUpperCase()}-${i + 1}`,
      customer: { email: `kuehl.${i}@kunde.test`, firstName: 'Eva', lastName: 'Frost' },
      billingAddress: { street: 'Kühlweg 1', postalCode: '25813', city: 'Husum', country: 'DE' },
      lines: skus.map((sku) => ({ sku, quantity: 2 })),
      paymentMethod: 'PayPal',
    },
    { authorization: `Bearer ${key.token}`, cookie: '' },
  );
  coldOrders.push(r.order.id);
}
// Manuelle Aufträge (Telefon/B2B, ohne Kanal)
const b2b = await call('POST', '/customers', {
  type: 'business',
  companyName: 'Kiosk am Hafen (Test)',
  addresses: [{ kind: 'billing', street: 'Hafenstraße 3', postalCode: '25813', city: 'Husum' }],
});
for (const lines of [
  [
    ['LAK-03', 5],
    ['FRU-03', 10],
  ],
  [
    ['GET-01', 48],
    ['GET-02', 48],
  ],
]) {
  const o = await call('POST', '/orders', {
    customerId: b2b.id,
    lines: lines.map(([n, q]) => ({ articleId: arts[n].id, quantity: String(q) })),
  });
  orders.push({ id: o.id, channel: null });
}

const status = (id, to) => call('POST', `/orders/${id}/status`, { to });
const ready = async (id) => {
  await status(id, 'in_progress');
  await status(id, 'ready_to_ship');
};
// Stände verteilen: 0–5 bleiben neu, 6–11 in Bearbeitung, 12–15 Pickliste, 16–29 versandbereit,
// 30–37 versendet mit Lieferschein/Rechnung
for (const [i, o] of orders.entries()) {
  if (i < 6) continue;
  if (i < 12) await status(o.id, 'in_progress');
  else if (i < 16)
    continue; // gleich auf Pickliste
  else if (i < 30) await ready(o.id);
  else {
    await ready(o.id);
    await call('POST', `/orders/${o.id}/ship`, { note: 'Testversand' });
    for (const type of ['delivery_note', 'invoice']) {
      const d = await call('POST', `/documents/from-order/${o.id}`, { type });
      await call('POST', `/documents/${d.id}/finalize`);
    }
  }
}
await call('POST', '/pick-lists', { orderIds: orders.slice(12, 16).map((o) => o.id) });
for (const id of coldOrders) await ready(id);

// Retoure für den ersten versendeten Auftrag
const shipped = await call('GET', `/orders/${orders[30].id}`);
const ret = await call('POST', '/returns', {
  orderId: shipped.id,
  reason: 'Falscher Artikel bestellt (Test)',
  lines: [{ orderLineId: shipped.lines[0].id, quantity: '1' }],
});

// ───── 6) Packplätze mit Packregeln ─────
const station = (name, rules) => call('POST', '/packing/stations', { name, rules });
await station('Platz 1 – Shopify', { channelIds: [channels.Shopify] });
await station('Platz 2 – Marktplätze (ohne Kühlware)', {
  channelIds: ['Amazon', 'eBay', 'Kaufland.de', 'Kaufland.at', 'Temu'].map((c) => channels[c]),
  excludeCategoryIds: [cold],
});
await station('Platz 3 – Kühlware', { categoryIds: [cold], mismatch: 'block' });
await station('Platz 4 – Rest/Gemischt', { excludeCategoryIds: [cold] });

writeFileSync(
  loginFile,
  [
    `FangEvo Testumgebung (${process.env.FANGEVO_BASE ?? 'http://localhost:5173'})`,
    `E-Mail:   ${email}`,
    `Passwort: ${password}`,
    '',
    'Nur Testdaten (ausgedachte Kunden). Diese Datei nicht weitergeben oder committen.',
    '',
  ].join('\n'),
);
process.stdout.write(
  `OK: ${ARTICLES.length} Artikel, ${CHANNELS.length} Kanäle, ${orders.length} Aufträge, Retoure ${ret.number}, 4 Packplätze. Login: ${loginFile}\n`,
);
