import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Redis } from 'ioredis';

/** Bringt die Testdatenbank auf den aktuellen Migrationsstand (nur *_test) und leert die Test-Redis-DB. */
export default async function setup(): Promise<void> {
  execSync('pnpm --filter @fangevo/database test:migrate', {
    stdio: 'pipe',
    // fileURLToPath statt .pathname: funktioniert auch unter Windows und mit Leerzeichen im Pfad
    cwd: fileURLToPath(new URL('../../..', import.meta.url)),
  });
  const redis = new Redis(process.env.TEST_REDIS_URL ?? 'redis://localhost:6379/15');
  await redis.flushdb();
  redis.disconnect();
}
