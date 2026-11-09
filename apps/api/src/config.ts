import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  API_PORT: z.coerce.number().int().default(3000),
  WEB_ORIGIN: z.string().url().default('http://localhost:5173'),
  APP_ENCRYPTION_KEY: z
    .string()
    .refine((v) => Buffer.from(v, 'base64').length === 32, 'APP_ENCRYPTION_KEY muss 32 Byte (base64) lang sein'),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_FROM: z.string().default('FangEvo Wawi Pro <no-reply@fangevo.local>'),
  MAIL_TRANSPORT: z.enum(['smtp', 'log', 'memory']).optional(),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).default(24 * 7),
  SESSION_IDLE_HOURS: z.coerce.number().int().min(1).default(12),
  RATE_LIMIT_DISABLED: z.stringbool().default(false),
  LOG_LEVEL: z.string().default('info'),
});

export type AppConfig = z.infer<typeof schema> & { mailTransport: 'smtp' | 'log' | 'memory'; isProd: boolean };

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Ungültige Konfiguration:\n${msg}`);
  }
  const c = parsed.data;
  if (c.NODE_ENV === 'production' && c.MAIL_TRANSPORT && c.MAIL_TRANSPORT !== 'smtp') {
    throw new Error('In Produktion ist nur MAIL_TRANSPORT=smtp erlaubt');
  }
  if (c.NODE_ENV === 'production' && c.RATE_LIMIT_DISABLED) {
    throw new Error('Rate-Limits dürfen in Produktion nicht deaktiviert werden');
  }
  return {
    ...c,
    mailTransport: c.MAIL_TRANSPORT ?? (c.SMTP_HOST ? 'smtp' : 'log'),
    isProd: c.NODE_ENV === 'production',
  };
}

export const APP_CONFIG = Symbol('APP_CONFIG');
