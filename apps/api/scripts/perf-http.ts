/**
 * Lasttest über echtes HTTP (Phase 8, nur Testdatenbank *_test).
 *
 * Mehrere Accounts arbeiten gleichzeitig (gemischte Last aus Listen, Details, Suche,
 * Benachrichtigungen und neuen Aufträgen). Gemessen werden Durchsatz und Antwortzeiten
 * (p50/p95/p99) je Vorgang. Zusätzlich wird unter Last geprüft, dass ein Account niemals
 * Aufträge eines anderen Accounts sieht.
 *
 *   pnpm --filter @fangevo/api perf:http
 *   PERF_USERS=100 PERF_SECONDS=60 PERF_ACCOUNTS=20 pnpm --filter @fangevo/api perf:http
 *
 * Beendet sich mit Fehlercode 1, wenn Fehler auftreten oder p95 die Grenzwerte überschreitet.
 */
import { performance } from 'node:perf_hooks';
import { withTenant } from '@fangevo/database';
import { PLANS } from '@fangevo/licensing';
import { ownerDb, signUp, startApp } from '../test/helpers';

process.env.NODE_ENV = 'test';
process.env.MAIL_TRANSPORT = 'memory';
process.env.RATE_LIMIT_DISABLED = 'true';
process.env.LOG_LEVEL = 'warn';
process.env.DATABASE_URL ??= 'postgresql://fangevo_app:fangevo_app_dev@localhost:5432/fangevo_test';
process.env.TEST_DATABASE_MIGRATE_URL ??=
  'postgresql://fangevo_owner:fangevo_owner_dev@localhost:5432/fangevo_test';
process.env.REDIS_URL ??= 'redis://localhost:6379/15';
process.env.APP_ENCRYPTION_KEY ??= Buffer.alloc(32, 1).toString('base64');
if (!new URL(process.env.DATABASE_URL).pathname.endsWith('_test'))
  throw new Error('Nur gegen Testdatenbanken');

const USERS = Number(process.env.PERF_USERS ?? 40);
const SECONDS = Number(process.env.PERF_SECONDS ?? 20);
const ACCOUNTS = Number(process.env.PERF_ACCOUNTS ?? 8);
const P95_READ_MS = Number(process.env.PERF_P95_READ_MS ?? 500);
const P95_WRITE_MS = Number(process.env.PERF_P95_WRITE_MS ?? 1500);

const app = await startApp();
await app.listen({ port: 0, host: '127.0.0.1' });
const base = `${await app.getUrl()}/api/v1`;

interface Tenant {
  headers: Record<string, string>;
  articles: string[];
  customers: string[];
  orders: string[];
}

console.warn(`Vorbereitung: ${ACCOUNTS} Accounts mit Artikeln, Kunden und Aufträgen …`);
const tenants: Tenant[] = [];
for (let i = 0; i < ACCOUNTS; i++) {
  const s = await signUp(app, `HTTP-Last ${i}`);
  await withTenant(ownerDb(), { accountId: s.accountId, userId: null }, (tx) =>
    tx.entitlement.update({
      where: { accountId: s.accountId },
      data: { plan: 'business', status: 'ACTIVE', modules: [...PLANS.business.modules] },
    }),
  );
  s.client.companyId = s.companyId;
  const t: Tenant = {
    headers: { cookie: s.client.cookie!, 'x-company-id': s.companyId, 'x-fangevo-csrf': '1' },
    articles: [],
    customers: [],
    orders: [],
  };
  for (let a = 0; a < 40; a++) {
    const r = await s.client.post('/articles', {
      name: `Rute ${a} Modell ${i}`,
      salePriceNet: String(10 + a),
      stockTracked: false,
    });
    t.articles.push(r.body.id);
  }
  for (let c = 0; c < 15; c++) {
    const r = await s.client.post('/customers', {
      type: 'private',
      lastName: `Kunde ${c}`,
      addresses: [
        { kind: 'billing', street: 'Weg 1', postalCode: '25813', city: 'Husum', country: 'DE' },
      ],
    });
    t.customers.push(r.body.id);
  }
  for (let o = 0; o < 20; o++) {
    const r = await s.client.post('/orders', {
      customerId: t.customers[o % t.customers.length],
      lines: [{ articleId: t.articles[o % t.articles.length], quantity: '2' }],
    });
    t.orders.push(r.body.id);
  }
  tenants.push(t);
}

const pick = <T>(a: T[]): T => a[Math.floor(Math.random() * a.length)]!;
type Op = {
  name: string;
  write?: boolean;
  weight: number;
  run: (t: Tenant, other: Tenant) => Promise<void>;
};

const lat = new Map<string, number[]>();
const errors: string[] = [];
let isolationChecks = 0;

async function req(t: Tenant, method: string, path: string, body?: unknown) {
  const r = await fetch(base + path, {
    method,
    headers: { ...t.headers, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  return { status: r.status, body: text ? (JSON.parse(text) as Record<string, unknown>) : {} };
}
const expectOk = (name: string, s: number) => {
  if (s >= 300) errors.push(`${name}: HTTP ${s}`);
};

const OPS: Op[] = [
  {
    name: 'Artikelliste',
    weight: 20,
    run: async (t) =>
      expectOk('Artikelliste', (await req(t, 'GET', '/articles?pageSize=50')).status),
  },
  {
    name: 'Artikelsuche',
    weight: 10,
    run: async (t) =>
      expectOk('Artikelsuche', (await req(t, 'GET', '/articles?q=Rute%201')).status),
  },
  {
    name: 'Auftragsliste',
    weight: 20,
    run: async (t) =>
      expectOk('Auftragsliste', (await req(t, 'GET', '/orders?pageSize=50')).status),
  },
  {
    name: 'Auftrag',
    weight: 15,
    run: async (t) =>
      expectOk('Auftrag', (await req(t, 'GET', `/orders/${pick(t.orders)}`)).status),
  },
  {
    name: 'Kundenliste',
    weight: 10,
    run: async (t) =>
      expectOk('Kundenliste', (await req(t, 'GET', '/customers?pageSize=50')).status),
  },
  {
    name: 'Globale Suche',
    weight: 8,
    run: async (t) => expectOk('Globale Suche', (await req(t, 'GET', '/search?q=Kunde')).status),
  },
  {
    name: 'Benachrichtigungen',
    weight: 7,
    run: async (t) =>
      expectOk('Benachrichtigungen', (await req(t, 'GET', '/notifications')).status),
  },
  {
    name: 'Auftrag anlegen',
    write: true,
    weight: 8,
    run: async (t) => {
      const r = await req(t, 'POST', '/orders', {
        customerId: pick(t.customers),
        lines: [{ articleId: pick(t.articles), quantity: '1' }],
      });
      expectOk('Auftrag anlegen', r.status);
      if (r.status < 300) t.orders.push(r.body.id as string);
    },
  },
  {
    name: 'Fremder Auftrag (muss 404 sein)',
    weight: 2,
    run: async (t, other) => {
      if (other === t) return;
      const r = await req(t, 'GET', `/orders/${pick(other.orders)}`);
      isolationChecks++;
      if (r.status !== 404) errors.push(`MANDANTENTRENNUNG VERLETZT: HTTP ${r.status}`);
    },
  },
];
const total = OPS.reduce((s, o) => s + o.weight, 0);
const choose = () => {
  let x = Math.random() * total;
  for (const o of OPS) if ((x -= o.weight) < 0) return o;
  return OPS[0]!;
};

console.warn(`Last: ${USERS} gleichzeitige Benutzer, ${SECONDS} s …`);
const end = performance.now() + SECONDS * 1000;
const started = performance.now();
let count = 0;
await Promise.all(
  Array.from({ length: USERS }, async (_, u) => {
    const t = tenants[u % tenants.length]!;
    while (performance.now() < end) {
      const op = choose();
      const t0 = performance.now();
      try {
        await op.run(t, pick(tenants));
      } catch (e) {
        errors.push(`${op.name}: ${String(e)}`);
      }
      const ms = performance.now() - t0;
      (lat.get(op.name) ?? lat.set(op.name, []).get(op.name)!).push(ms);
      count++;
    }
  }),
);
const elapsed = (performance.now() - started) / 1000;

const q = (a: number[], p: number) => {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] ?? 0;
};
const rows = OPS.map((o) => {
  const a = lat.get(o.name) ?? [];
  return { o, n: a.length, p50: q(a, 50), p95: q(a, 95), p99: q(a, 99) };
});
console.warn(
  `\n${'Vorgang'.padEnd(34)}${'Anzahl'.padStart(8)}${'p50 ms'.padStart(9)}${'p95 ms'.padStart(9)}${'p99 ms'.padStart(9)}`,
);
for (const r of rows)
  console.warn(
    `${r.o.name.padEnd(34)}${String(r.n).padStart(8)}${r.p50.toFixed(0).padStart(9)}${r.p95.toFixed(0).padStart(9)}${r.p99.toFixed(0).padStart(9)}`,
  );
console.warn(
  `\nGesamt: ${count} Anfragen in ${elapsed.toFixed(1)} s = ${(count / elapsed).toFixed(0)} Anfragen/s, Fehler: ${errors.length}, Trennungsprüfungen: ${isolationChecks}`,
);

const slow = rows.filter((r) => r.n && r.p95 > (r.o.write ? P95_WRITE_MS : P95_READ_MS));
await app.close();
if (errors.length) {
  console.error('Fehler:', [...new Set(errors)].slice(0, 10));
  process.exit(1);
}
if (slow.length) {
  console.error(
    'Zu langsam (p95):',
    slow.map((r) => `${r.o.name} ${r.p95.toFixed(0)} ms`),
  );
  process.exit(1);
}
console.warn('Lasttest HTTP: OK');
process.exit(0);
