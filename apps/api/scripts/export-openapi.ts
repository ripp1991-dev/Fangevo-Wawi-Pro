/** Schreibt die OpenAPI-Beschreibung nach docs/api/openapi.json (ohne laufende Datenbank-Abfragen). */
import { writeFileSync } from 'node:fs';
import { loadConfig } from '../src/config';
import { createApp } from '../src/bootstrap';

const app = await createApp(
  loadConfig({ ...process.env, NODE_ENV: 'test', RATE_LIMIT_DISABLED: 'true' }),
);
await app.init();
const res = await app
  .getHttpAdapter()
  .getInstance()
  .inject({ method: 'GET', url: '/api/openapi.json' });
writeFileSync(
  new URL('../../../docs/api/openapi.json', import.meta.url),
  JSON.stringify(JSON.parse(res.body), null, 2) + '\n',
);
await app.close();
