import { execSync } from 'node:child_process';
import { Redis } from 'ioredis';

/** Bringt die Testdatenbank auf den aktuellen Migrationsstand (nur *_test) und leert die Test-Redis-DB. */
export default async function setup(): Promise<void> {
  execSync('pnpm --filter @fangevo/database test:migrate', { stdio: 'pipe', cwd: new URL('../../..', import.meta.url).pathname });
  const redis = new Redis(process.env.TEST_REDIS_URL ?? 'redis://localhost:6379/15');
  await redis.flushdb();
  redis.disconnect();
}
