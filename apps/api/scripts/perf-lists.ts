/**
 * Lasttest der Listen-Schnittstelle (nur Testdatenbank *_test).
 * Legt einen Test-Account mit 100.000 Firmen an (direkt in der DB, ohne Lizenzlimit)
 * und misst typische Abfragen über die echte API (inkl. RLS, Rechteprüfung, JSON).
 *
 *   pnpm --filter @fangevo/api perf:lists
 */
import { performance } from 'node:perf_hooks';
import { withTenant } from '@fangevo/database';
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

const N = Number(process.env.PERF_ROWS ?? 100_000);
const app = await startApp();
const { client, accountId } = await signUp(app, 'Lasttest GmbH');
await client.post('/custom-fields', {
  entityType: 'company',
  key: 'region',
  label: 'Region',
  type: 'select',
  options: [
    { value: 'nord', label: 'Nord' },
    { value: 'sued', label: 'Süd' },
    { value: 'west', label: 'West' },
  ],
});
const t0 = performance.now();
await withTenant(
  ownerDb(),
  { accountId, userId: null },
  (tx) =>
    tx.$executeRawUnsafe(`
    INSERT INTO companies (id, account_id, name, city, country, postal_code, custom_fields, updated_at)
    SELECT gen_random_uuid(), '${accountId}', 'Firma ' || lpad(i::text, 6, '0'),
           (ARRAY['Husum','Hamburg','Kiel','Wien','Zürich'])[1 + i % 5],
           (ARRAY['DE','DE','DE','AT','CH'])[1 + i % 5], lpad((i % 99999)::text, 5, '0'),
           jsonb_build_object('region', (ARRAY['nord','sued','west'])[1 + i % 3]), now()
    FROM generate_series(1, ${N}) AS i`),
  { timeout: 120_000 },
);
await ownerDb().$executeRawUnsafe('ANALYZE companies');
console.warn(`${N} Firmen angelegt in ${Math.round(performance.now() - t0)} ms`);

async function measure(label: string, c: Client, url: string, runs = 5): Promise<void> {
  const times: number[] = [];
  let total = 0;
  for (let i = 0; i < runs; i++) {
    const s = performance.now();
    const r = await c.get(url);
    times.push(performance.now() - s);
    if (r.status !== 200) throw new Error(`${label}: ${r.status} ${JSON.stringify(r.body)}`);
    total = r.body.total;
  }
  times.sort((a, b) => a - b);
  console.warn(
    `${label.padEnd(42)} Median ${Math.round(times[Math.floor(runs / 2)]!)} ms · Max ${Math.round(times.at(-1)!)} ms · Treffer ${total}`,
  );
}

const f = (x: unknown) => encodeURIComponent(JSON.stringify(x));
await measure('Erste Seite, nach Name', client, '/admin/companies?pageSize=50&sort=name:asc');
await measure(
  'Seite 1000, nach Name',
  client,
  '/admin/companies?pageSize=50&page=1000&sort=name:asc',
);
await measure(
  'Sortiert nach Ort absteigend',
  client,
  '/admin/companies?pageSize=50&sort=city:desc',
);
await measure('Suche "Firma 0999"', client, '/admin/companies?pageSize=50&q=Firma%200999');
await measure(
  'Filter Land = AT',
  client,
  `/admin/companies?pageSize=50&filters=${f([{ field: 'country', op: 'eq', value: 'AT' }])}`,
);
await measure(
  'Filter eigenes Feld Region = nord',
  client,
  `/admin/companies?pageSize=50&filters=${f([{ field: 'cf.region', op: 'eq', value: 'nord' }])}`,
);
await measure('Export-Seite (1000 Zeilen)', client, '/admin/companies?pageSize=1000&sort=name:asc');
await app.close();
await ownerDb().$disconnect();
