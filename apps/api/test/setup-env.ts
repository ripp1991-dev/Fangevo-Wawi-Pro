process.env.NODE_ENV = 'test';
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://fangevo_app:fangevo_app_dev@localhost:5432/fangevo_test';
process.env.TEST_DATABASE_MIGRATE_URL ??=
  'postgresql://fangevo_owner:fangevo_owner_dev@localhost:5432/fangevo_test';
process.env.REDIS_URL = process.env.TEST_REDIS_URL ?? 'redis://localhost:6379/15';
process.env.MAIL_TRANSPORT = 'memory';
process.env.RATE_LIMIT_DISABLED ??= 'true';
process.env.WEB_ORIGIN = 'http://localhost:5173';
process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 1).toString('base64');
