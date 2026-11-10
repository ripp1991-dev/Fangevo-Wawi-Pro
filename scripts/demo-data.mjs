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
      ...Object.fromEntries(Object.entries(extra).filter(([k]) => k !== 'attempt')),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const sc = r.headers.get('set-cookie');
  if (sc && sc.includes('fe_session=')) cookie = sc.split(';')[0];
  const text = await r.text();
  // Anfrage-Limit der API: warten und erneut versuchen (nicht bei der Registrierung, die ist stündlich begrenzt)
  if (r.status === 429 && path !== '/auth/register' && (extra.attempt ?? 0) < 30) {
    await sleep(Math.max(1, Number(r.headers.get('retry-after') ?? 2)) * 1000);
    return call(method, path, body, { ...extra, attempt: (extra.attempt ?? 0) + 1 });
  }
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
  Fruchtgummi: await cat('Fruchtgummi & Weingummi', sweets),
  Bonbons: await cat('Bonbons & Pastillen', sweets),
  Gebäck: await cat('Kekse & Gebäck', sweets),
  Chips: await cat('Chips & Snacks'),
};
const cold = await cat('Kühlware');
cats.Eis = await cat('Eis', cold);
cats.Getränke = await cat('Getränke');
const food = await cat('Lebensmittel');
cats.HotDog = await cat('Hot Dogs', food);
cats.Marmelade = await cat('Marmelade & Aufstrich', food);

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
// Optional: echtes Sortiment aus einem Shopify-Bericht „Gesamtumsatz nach Produkt“ (CSV).
// Es werden nur Produktdaten gelesen (Titel, Hersteller, Stückzahl, Umsatz), keine Kundendaten.
const weights = {};
const makers = {};
if (process.env.PRODUCTS_CSV) {
  const { readFileSync } = await import('node:fs');
  const rows = readFileSync(process.env.PRODUCTS_CSV, 'utf8')
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) =>
      [...line.matchAll(/("([^"]*(?:""[^"]*)*)"|[^,]*)(,|$)/g)]
        .map((m) => (m[2] ?? m[1]).replace(/""/g, '"'))
        .slice(0, -1),
    );
  const head = rows.shift();
  const col = (n) => head.indexOf(n);
  const SKIP = /pfand|versand|gutschein|trinkgeld|geschenkkarte|spende|tip/i;
  // Reihenfolge zählt: die erste passende Regel gewinnt
  const RULES = [
    ['HotDog', /hot-?dog|würstchen/i],
    ['Marmelade', /den gamle fabrik|marmelade|konfitüre|aufstrich/i],
    [
      'Getränke',
      /cider|\bbier\b|limo|\bcola\b|soda|saft|wasser|vol\.|sirup|drink|0,\d+ ?l\b|1,5l|energy|faxe|cocio/i,
    ],
    ['Eis', /\beis\b(?!tee)|ice ?cream|wassereis|magnum|cornetto/i],
    [
      'Lakritz',
      /lakritz|lakrids|lakrits|licorice|liquorice|salmiak|piratos|matador|skipper|ga-jol|salt pastill|djungelvr|super flyers|pingvin (double )?salt/i,
    ],
    [
      'Schokolade',
      /schoko|choklad|chocolate|marabou|toblerone|anthon berg|marzipan|praline|riegel|kinder|daim|freia|fazer|dumle|toms|guld ?barre|maltesers|kakao/i,
    ],
    ['Chips', /speckkrusten|svaer|\bkims\b|pretzel/i],
    [
      'Bonbons',
      /läkerol|polo mint|bolche|bonbon|pastill|pebermix|fudge|karamel|caramel|marshmallow/i,
    ],
    ['Gebäck', /karen volf|keks|cookie|kage|waffel|gebäck/i],
    [
      'Chips',
      /chips|kims|speckkrusten|svaer|pretzel|snack|nuss|nüsse|nuts|popcorn|pub mix|crisps|cracker/i,
    ],
  ];
  const catOf = (t) => RULES.find(([, re]) => re.test(t))?.[0] ?? 'Fruchtgummi';
  const real = rows
    .map((r) => ({
      title: r[col('Produkttitel')]?.trim(),
      vendor: r[col('Produktanbieter')]?.trim() || null,
      units: Number(r[col('Netto verkaufte Artikel')]),
      gross: Number(r[col('Bruttoumsatz')]),
    }))
    .filter((p) => p.title && p.units > 0 && p.gross > 0 && !SKIP.test(p.title))
    .sort((a, b) => b.units - a.units)
    .slice(0, Number(process.env.PRODUCTS_LIMIT ?? 150));
  ARTICLES.length = 0;
  for (const [i, p] of real.entries()) {
    const number = `NFS-${String(i + 1).padStart(4, '0')}`;
    ARTICLES.push([
      number,
      p.title.slice(0, 200),
      catOf(p.title),
      (p.gross / p.units).toFixed(2),
      Math.max(24, Math.ceil(p.units / 6)),
      p.vendor,
    ]);
    weights[number] = p.units;
  }
  // Kühlware-Testartikel, falls das Sortiment kein Eis enthält (für den Kühlware-Packplatz)
  if (!ARTICLES.some((a) => a[2] === 'Eis'))
    for (const [n, name, price] of [
      ['EIS-01', 'Vanilleeis 500ml (Testartikel)', '3.49'],
      ['EIS-02', 'Wassereis Mix 10er (Testartikel)', '2.99'],
      ['EIS-03', 'Eis am Stiel Schoko 4er (Testartikel)', '3.99'],
    ])
      ARTICLES.push([n, name, 'Eis', price, 40, null]);
  for (const v of new Set(ARTICLES.map((a) => a[5]).filter(Boolean)))
    makers[v] = (await call('POST', '/company/manufacturers', { name: v.slice(0, 120) })).id;
}
const rate = (r) => md.taxRates.find((t) => Number(t.rate) === r)?.id;
const arts = {};
let eanBase = 400000000100;
for (const [number, name, c, price, stock, vendor] of ARTICLES) {
  const a = await call('POST', '/articles', {
    number,
    name,
    gtin: ean(String(eanBase++)),
    categoryId: cats[c],
    salePriceNet: price,
    ...(vendor && makers[vendor] ? { manufacturerId: makers[vendor] } : {}),
    ...(rate(c === 'Getränke' ? 19 : 7) ? { taxRateId: rate(c === 'Getränke' ? 19 : 7) } : {}),
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
const catOfNumber = Object.fromEntries(ARTICLES.map((a) => [a[0], a[2]]));
const sellable = numbers.filter((n) => catOfNumber[n] !== 'Eis');
const coldNumbers = numbers.filter((n) => catOfNumber[n] === 'Eis');
const totalWeight = sellable.reduce((s, n) => s + (weights[n] ?? 1), 0);
/** Artikel nach echter Verkaufshäufigkeit (ohne Bericht: gleich verteilt) */
const pickArticle = () => {
  let x = rnd() * totalWeight;
  for (const n of sellable) if ((x -= weights[n] ?? 1) <= 0) return n;
  return sellable[0];
};
const orders = [];
for (let i = 1; i <= 36; i++) {
  const channel = i % 9 === 0 ? 'Kaufland.at' : pick(channelBag);
  const [postalCode, city, country] = channel === 'Kaufland.at' ? CITY[5] : pick(CITY.slice(0, 5));
  const first = pick(FIRST);
  const last = pick(LAST);
  const lines = [...new Set(Array.from({ length: 1 + Math.floor(rnd() * 3) }, pickArticle))];
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
  ['Shopify', coldNumbers.slice(0, 2)],
  ['Amazon', coldNumbers.slice(1, 2)],
  ['Kaufland.de', coldNumbers.slice(0, 1)],
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
const top = [...sellable].sort((a, b) => (weights[b] ?? 0) - (weights[a] ?? 0));
for (const lines of [
  [
    [top[0], 6],
    [top[2], 6],
  ],
  [
    [top[1], 12],
    [top[3], 6],
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
