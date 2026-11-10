import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  API_PORT: z.coerce.number().int().default(3000),
  WEB_ORIGIN: z.string().url().default('http://localhost:5173'),
  APP_ENCRYPTION_KEY: z
    .string()
    .refine(
      (v) => Buffer.from(v, 'base64').length === 32,
      'APP_ENCRYPTION_KEY muss 32 Byte (base64) lang sein',
    ),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_FROM: z.string().default('FangEvo Wawi Pro <no-reply@fangevo.local>'),
  MAIL_TRANSPORT: z.enum(['smtp', 'log', 'memory']).optional(),
  SESSION_TTL_HOURS: z.coerce
    .number()
    .int()
    .min(1)
    .default(24 * 7),
  SESSION_IDLE_HOURS: z.coerce.number().int().min(1).default(12),
  RATE_LIMIT_DISABLED: z.stringbool().default(false),
  /** Ereignis-Verteiler im API-Prozess starten (Entwicklung). In Produktion läuft er als eigener Worker. */
  EVENT_DISPATCH_INLINE: z.stringbool().optional(),
  /** Webhooks an private/interne Adressen erlauben (nur Entwicklung/Tests) */
  WEBHOOK_ALLOW_PRIVATE: z.stringbool().optional(),
  LOG_LEVEL: z.string().default('info'),
  /**
   * FangEvo-Mitarbeiter mit Zugang zur Plattform-Verwaltung (Komma-getrennt). Einträge mit
   * führendem @ gelten für die ganze Domain (z. B. @fangevo.de). Zwei-Faktor ist zusätzlich Pflicht.
   */
  PLATFORM_ADMIN_EMAILS: z.string().default(''),
  /** Postfach des Supports für neue Tickets und Antworten */
  SUPPORT_EMAIL: z.string().email().optional(),
  /** Absender (FangEvo) auf Plattform-Rechnungen. Pflicht in Produktion, bevor Rechnungen erstellt werden. */
  PLATFORM_ISSUER_NAME: z.string().optional(),
  PLATFORM_ISSUER_STREET: z.string().optional(),
  PLATFORM_ISSUER_POSTAL_CODE: z.string().optional(),
  PLATFORM_ISSUER_CITY: z.string().optional(),
  PLATFORM_ISSUER_COUNTRY: z.string().length(2).default('DE'),
  PLATFORM_ISSUER_EMAIL: z.string().optional(),
  PLATFORM_ISSUER_VAT_ID: z.string().optional(),
  PLATFORM_ISSUER_TAX_NUMBER: z.string().optional(),
  PLATFORM_ISSUER_MANAGING_DIRECTOR: z.string().optional(),
  PLATFORM_ISSUER_REGISTER_COURT: z.string().optional(),
  PLATFORM_ISSUER_REGISTER_NUMBER: z.string().optional(),
  PLATFORM_ISSUER_BANK_NAME: z.string().optional(),
  PLATFORM_ISSUER_IBAN: z.string().optional(),
  PLATFORM_ISSUER_BIC: z.string().optional(),
});

export type AppConfig = z.infer<typeof schema> & {
  mailTransport: 'smtp' | 'log' | 'memory';
  isProd: boolean;
  webhookAllowPrivate: boolean;
  dispatchInline: boolean;
  platformAdmins: Set<string>;
  isPlatformAdmin: (email: string) => boolean;
};

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
  if (c.NODE_ENV === 'production' && !c.SMTP_HOST) {
    throw new Error(
      'In Produktion muss SMTP_HOST gesetzt sein (sonst kommen keine Bestätigungs- und Reset-Mails an)',
    );
  }
  if (c.NODE_ENV === 'production' && c.RATE_LIMIT_DISABLED) {
    throw new Error('Rate-Limits dürfen in Produktion nicht deaktiviert werden');
  }
  const admins = new Set(
    c.PLATFORM_ADMIN_EMAILS.split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
  return {
    ...c,
    mailTransport: c.MAIL_TRANSPORT ?? (c.SMTP_HOST ? 'smtp' : 'log'),
    dispatchInline: c.EVENT_DISPATCH_INLINE ?? c.NODE_ENV === 'development',
    isProd: c.NODE_ENV === 'production',
    webhookAllowPrivate: c.WEBHOOK_ALLOW_PRIVATE ?? c.NODE_ENV !== 'production',
    platformAdmins: admins,
    isPlatformAdmin: (email: string) => {
      const e = email.trim().toLowerCase();
      return admins.has(e) || admins.has(e.slice(e.lastIndexOf('@')));
    },
  };
}

export const APP_CONFIG = Symbol('APP_CONFIG');
