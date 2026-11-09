/**
 * Bringt die Testdatenbank auf den aktuellen Migrationsstand (nicht-destruktiv, löscht keine Daten).
 * Läuft nur gegen Datenbanken, deren Name auf "_test" endet.
 * Tests verwenden eindeutige Testdaten und sind daher wiederholbar, ohne die Datenbank zu leeren.
 */
import { execSync } from 'node:child_process';

const url = process.env.TEST_DATABASE_MIGRATE_URL ?? 'postgresql://fangevo_owner:fangevo_owner_dev@localhost:5432/fangevo_test';
const dbName = new URL(url).pathname.slice(1);
if (!dbName.endsWith('_test')) {
  console.error(`Abbruch: "${dbName}" ist keine Testdatenbank.`);
  process.exit(1);
}
execSync('npx prisma migrate deploy', {
  stdio: 'inherit',
  env: { ...process.env, DATABASE_URL: url, DATABASE_MIGRATE_URL: url },
});
