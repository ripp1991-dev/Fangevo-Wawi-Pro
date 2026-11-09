/**
 * Lasttest Warenwirtschaft (nur Testdatenbank *_test).
 * Legt eine Firma mit 100.000 Artikeln (mit Bestand), 20.000 Kunden und 50.000 Aufträgen
 * (je 3 Positionen) direkt in der DB an und misst typische Abfragen und Vorgänge über die
 * echte API (inkl. RLS, Rechte- und Lizenzprüfung, JSON).
 *
 *   pnpm --filter @fangevo/api perf:wawi
 */
import { performance } from 'node:perf_hooks';
import { withTenant } from '@fangevo/database';
import { PLANS } from '@fangevo/licensing';
import { type Client, ownerDb, signUp, startApp } from '../test/helpers';

process.env.NODE_ENV = 'test';
process.env.MAIL_TRANSPORT = 'memory';
process.env.RATE_LIMIT_DISABLED = 'true';
process.env.DATABASE_URL ??= 'postgresql://fangevo_app:fangevo_app_dev@localhost:5432/fangevo_test';
process.env.TEST_DATABASE_MIGRATE_URL ??=
  'postgresql://fangevo_owner:fangevo_owner_dev@localhost:5432/fangevo_test';
process.env.REDIS_URL ??= 'redis://localhost:6379/15';
process.env.APP_ENCRYPTION_KEY ??= Buffer.alloc(32, 1).toString('base64');
if (!new URL(process.env.DATABASE_URL).pathname.endsWith('_test'))
  throw new Error('Nur gegen Testdatenbanken');

const ARTICLES = Number(process.env.PERF_ARTICLES ?? 100_000);
const CUSTOMERS = Number(process.env.PERF_CUSTOMERS ?? 20_000);
const ORDERS = Number(process.env.PERF_ORDERS ?? 50_000);

const app = await startApp();
const { client, accountId, companyId } = await signUp(app, 'Lasttest Handel GmbH');
client.companyId = companyId;
const md = (await client.get('/company/master-data')).body;
const tax = md.taxRates.find((t: { isDefault: boolean }) => t.isDefault).id as string;
const hl = md.warehouses.find((w: { isDefault: boolean }) => w.isDefault).id as string;
const ctx = { accountId, userId: null, companyId };

const t0 = performance.now();
await withTenant(
  ownerDb(),
  ctx,
  async (tx) => {
    await tx.entitlement.update({
      where: { accountId },
      data: { plan: 'business', modules: [...PLANS.business.modules] },
    });
    await tx.$executeRawUnsafe(`
      INSERT INTO articles (id, account_id, company_id, number, name, tax_rate_id, purchase_price_net, sale_price_net, min_stock, gtin, updated_at)
      SELECT gen_random_uuid(), '${accountId}', '${companyId}', 'A-' || lpad(i::text, 6, '0'),
             (ARRAY['Spinnrute','Kescher','Wobbler','Angelschnur','Rolle','Haken'])[1 + i % 6] || ' Modell ' || i,
             '${tax}', (i % 50) + 1, (i % 50) * 2 + 5, CASE WHEN i % 10 = 0 THEN 20 ELSE 0 END,
             NULL, now()
      FROM generate_series(1, ${ARTICLES}) AS i`);
    // Nur Datenaufbau: aktuelle Statistik und Hash-Joins, damit große Einfügungen nicht ausarten
    await tx.$executeRawUnsafe('SET LOCAL enable_nestloop = off');
    await tx.$executeRawUnsafe('ANALYZE articles');
    await tx.$executeRawUnsafe(`
      INSERT INTO stock_levels (id, account_id, company_id, article_id, warehouse_id, quantity, reserved, updated_at)
      SELECT gen_random_uuid(), account_id, company_id, id, '${hl}', (abs(hashtext(number)::bigint) % 100), 0, now()
      FROM articles WHERE company_id = '${companyId}'`);
    await tx.$executeRawUnsafe(`
      INSERT INTO customers (id, account_id, company_id, number, type, first_name, last_name, email, updated_at)
      SELECT gen_random_uuid(), '${accountId}', '${companyId}', 'K-' || lpad(i::text, 6, '0'), 'private',
             'Vorname' || i, 'Nachname' || i, 'kunde' || i || '@example.test', now()
      FROM generate_series(1, ${CUSTOMERS}) AS i`);
    await tx.$executeRawUnsafe('ANALYZE customers');
    await tx.$executeRawUnsafe(`
      WITH c AS (
        SELECT id, number, first_name || ' ' || last_name AS name, row_number() OVER (ORDER BY number) AS rn
        FROM customers WHERE company_id = '${companyId}'
      )
      INSERT INTO sales_orders (id, account_id, company_id, number, status, customer_id, customer_snapshot, warehouse_id,
                                order_date, total_net, total_tax, total_gross, shipped_at, updated_at)
      SELECT gen_random_uuid(), '${accountId}', '${companyId}', 'AU-' || lpad(i::text, 6, '0'),
             (ARRAY['shipped','shipped','shipped','completed','new','in_progress'])[1 + i % 6],
             c.id, jsonb_build_object('number', c.number, 'displayName', c.name),
             '${hl}', now() - (i % 365) * interval '1 day', 100, 19, 119,
             CASE WHEN i % 6 < 4 THEN now() - (i % 60) * interval '1 day' END, now()
      FROM generate_series(1, ${ORDERS}) AS i JOIN c ON c.rn = 1 + i % ${CUSTOMERS}`);
    await tx.$executeRawUnsafe('ANALYZE sales_orders');
    // Artikel über eine nummerierte Liste zuordnen (Hash-Join statt Unterabfrage je Zeile)
    await tx.$executeRawUnsafe(`
      WITH a AS (
        SELECT id, number, name, row_number() OVER (ORDER BY number) AS rn
        FROM articles WHERE company_id = '${companyId}'
      ), l AS (
        SELECT o.id AS order_id, o.account_id, o.company_id, p,
               1 + (abs(hashtext(o.number)::bigint) + p * 7919) % ${ARTICLES} AS rn
        FROM sales_orders o CROSS JOIN generate_series(1, 3) AS p
        WHERE o.company_id = '${companyId}'
      )
      INSERT INTO sales_order_lines (id, account_id, company_id, order_id, position, article_id, article_number, name, quantity,
                                     unit_price_net, tax_rate, line_net, line_tax, line_gross)
      SELECT gen_random_uuid(), l.account_id, l.company_id, l.order_id, l.p, a.id, a.number, a.name, 1 + l.p, 10, 19, 10, 1.9, 11.9
      FROM l JOIN a ON a.rn = l.rn`);
    await tx.$executeRawUnsafe('ANALYZE sales_order_lines');
    await tx.$executeRawUnsafe('RESET enable_nestloop');
    await tx.$executeRawUnsafe(`
      INSERT INTO stock_reservations (id, account_id, company_id, article_id, warehouse_id, order_id, order_line_id, quantity)
      SELECT gen_random_uuid(), l.account_id, l.company_id, l.article_id, o.warehouse_id, o.id, l.id, l.quantity
      FROM sales_order_lines l JOIN sales_orders o ON o.id = l.order_id
      WHERE o.company_id = '${companyId}' AND o.status IN ('new','in_progress')`);
  },
  { timeout: 600_000 },
);
for (const t of [
  'articles',
  'stock_levels',
  'customers',
  'sales_orders',
  'sales_order_lines',
  'stock_reservations',
])
  await ownerDb().$executeRawUnsafe(`ANALYZE ${t}`);
console.warn(
  `${ARTICLES} Artikel, ${CUSTOMERS} Kunden, ${ORDERS} Aufträge angelegt in ${Math.round(performance.now() - t0)} ms`,
);

async function measure(label: string, c: Client, url: string, runs = 5): Promise<void> {
  const times: number[] = [];
  for (let i = 0; i < runs; i++) {
    const s = performance.now();
    const r = await c.get(url);
    times.push(performance.now() - s);
    if (r.status !== 200) throw new Error(`${label}: ${r.status} ${JSON.stringify(r.body)}`);
  }
  times.sort((a, b) => a - b);
  console.warn(
    `${label.padEnd(44)} Median ${Math.round(times[Math.floor(runs / 2)]!)} ms · Max ${Math.round(times.at(-1)!)} ms`,
  );
}

async function step(label: string, fn: () => Promise<{ status: number; body: { id: string } }>) {
  const s = performance.now();
  const r = await fn();
  if (r.status >= 300) throw new Error(`${label}: ${r.status} ${JSON.stringify(r.body)}`);
  console.warn(`${label.padEnd(44)} ${Math.round(performance.now() - s)} ms`);
  return r.body;
}

const f = (x: unknown) => encodeURIComponent(JSON.stringify(x));
await measure('Artikel: erste Seite', client, '/articles?pageSize=50');
await measure(
  'Artikel: Suche "Wobbler Modell 4711"',
  client,
  '/articles?pageSize=50&q=Wobbler%20Modell%204711',
);
await measure(
  'Artikel: Seite 1000 nach Name',
  client,
  '/articles?pageSize=50&page=1000&sort=name:asc',
);
await measure('Kunden: Suche "Nachname1234"', client, '/customers?pageSize=50&q=Nachname1234');
await measure('Aufträge: erste Seite (neueste)', client, '/orders?pageSize=50');
await measure(
  'Aufträge: Filter Status = Neu',
  client,
  `/orders?pageSize=50&filters=${f([{ field: 'status', op: 'eq', value: 'new' }])}`,
);
await measure('Aufträge: Suche Nummer', client, '/orders?pageSize=50&q=AU-012345');
await measure('Kennzahlen Aufträge (offen, Topseller)', client, '/orders/stats');
await measure('Kennzahlen Umsatz', client, '/documents/stats');
await measure('Unter Mindestbestand', client, '/inventory/low-stock');
await measure('Bestellvorschläge', client, '/purchase-orders/suggestions');

// Vorgänge über die API: Auftrag anlegen, versenden, Rechnung erstellen und festschreiben (PDF)
const company = (await client.get('/admin/companies?pageSize=5')).body.items[0];
await client.put(`/admin/companies/${companyId}`, {
  name: company.name,
  street: 'Hafenstraße 5',
  postalCode: '25813',
  city: 'Husum',
  country: 'DE',
  version: company.version,
});
await client.put('/company/settings', { allowNegativeStock: false, taxNumber: '15/123/45678' });
// Die per SQL angelegten Aufträge belegen AU-000001 … – Nummernkreis dahinter fortsetzen
await client.put('/company/number-sequences/order', {
  prefix: 'AU-',
  nextValue: ORDERS + 1,
  padding: 6,
});
const cust = (
  await client.post('/customers', {
    type: 'private',
    number: 'K-PERF-1',
    firstName: 'Erika',
    lastName: 'Muster',
    addresses: [{ kind: 'billing', street: 'Deichweg 1', postalCode: '25813', city: 'Husum' }],
  })
).body;
const art = (await client.get('/articles?pageSize=1&q=A-000042')).body.items[0];
const order = await step('Auftrag anlegen (inkl. Reservierung)', () =>
  client.post('/orders', { customerId: cust.id, lines: [{ articleId: art.id, quantity: '1' }] }),
);
await step('Auftrag versenden (Bestand abbuchen)', () =>
  client.post(`/orders/${order.id}/ship`, {}),
);
const doc = await step('Rechnung erstellen', () =>
  client.post(`/documents/from-order/${order.id}`, { type: 'invoice' }),
);
await step('Rechnung festschreiben (inkl. PDF)', () =>
  client.post(`/documents/${doc.id}/finalize`),
);
await app.close();
await ownerDb().$disconnect();
