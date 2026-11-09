import { z } from 'zod';

// ───── Abo & Rechnungen (Kundenportal) ─────

export const PLAN_KEYS = ['starter', 'business', 'professional', 'enterprise'] as const;
export const BILLING_INTERVALS = {
  month: 'monatlich',
  year: 'jährlich (2 Monate gratis)',
} as const;

export const SUBSCRIPTION_STATUS = {
  trialing: 'Testphase',
  active: 'Aktiv',
  past_due: 'Zahlung offen',
  canceled: 'Beendet',
} as const;

export const ADDON_STATUS = {
  trial: 'Testversion',
  active: 'Gebucht',
  canceled: 'Gekündigt',
} as const;

export const PLATFORM_INVOICE_STATUS = {
  open: 'Offen',
  paid: 'Bezahlt',
  void: 'Storniert',
} as const;

const opt = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional();

export const billingDetailsSchema = z.object({
  billingName: z.string().trim().min(1, 'Name fehlt').max(200),
  billingStreet: z.string().trim().min(1, 'Straße fehlt').max(200),
  billingPostalCode: z.string().trim().min(1, 'PLZ fehlt').max(20),
  billingCity: z.string().trim().min(1, 'Ort fehlt').max(100),
  billingCountry: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/, 'Ländercode mit 2 Buchstaben'),
  billingVatId: opt(30),
  billingEmail: z.string().trim().toLowerCase().pipe(z.email('Ungültige E-Mail-Adresse')),
});

export const planChangeSchema = z.object({
  plan: z.enum(PLAN_KEYS),
  interval: z.enum(['month', 'year']).default('month'),
});

// ───── Support ─────

export const SUPPORT_CATEGORIES = {
  question: 'Frage zur Bedienung',
  bug: 'Fehler melden',
  billing: 'Abo und Rechnungen',
  feature: 'Wunsch / Idee',
} as const;

export const SUPPORT_PRIORITIES = {
  low: 'Niedrig',
  normal: 'Normal',
  high: 'Hoch',
  urgent: 'Dringend (Betrieb steht)',
} as const;

export const SUPPORT_STATUS = {
  waiting_support: 'Wartet auf Support',
  waiting_customer: 'Wartet auf Ihre Antwort',
  closed: 'Erledigt',
} as const;

type Key<T> = [keyof T & string, ...(keyof T & string)[]];

export const supportTicketSchema = z.object({
  subject: z.string().trim().min(3, 'Betreff fehlt').max(200),
  category: z.enum(Object.keys(SUPPORT_CATEGORIES) as Key<typeof SUPPORT_CATEGORIES>),
  priority: z
    .enum(Object.keys(SUPPORT_PRIORITIES) as Key<typeof SUPPORT_PRIORITIES>)
    .default('normal'),
  message: z.string().trim().min(1, 'Nachricht fehlt').max(10_000),
});

export const supportMessageSchema = z.object({
  message: z.string().trim().min(1, 'Nachricht fehlt').max(10_000),
});

// ───── Plattform-Verwaltung (nur FangEvo) ─────

export const platformLicenseSchema = z.object({
  plan: z.enum(PLAN_KEYS).optional(),
  interval: z.enum(['month', 'year']).optional(),
  /** Zusätzliche Firmen über das Paket hinaus */
  extraCompanies: z.number().int().min(0).max(1000).optional(),
  /** Testphase verlängern (Tage ab heute) */
  extendTrialDays: z.number().int().min(1).max(365).optional(),
  /** Sperren (nur lesen) oder entsperren */
  suspended: z.boolean().optional(),
  /** Abo ohne Rechnung aktivieren (z. B. Pilotkunde, individuelle Abrechnung) */
  activateWithoutInvoice: z.boolean().optional(),
  note: z.string().trim().max(500).optional(),
});

export const platformSupportReplySchema = z.object({
  message: z.string().trim().min(1, 'Nachricht fehlt').max(10_000),
  status: z.enum(['waiting_customer', 'waiting_support', 'closed']).default('waiting_customer'),
});
