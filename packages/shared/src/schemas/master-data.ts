import { z } from 'zod';

/**
 * Geldbeträge und Mengen werden als Text übertragen ("12,50" oder "12.50"), nie als Gleitkommazahl.
 * Gespeichert wird numeric(19,4) in der Datenbank.
 */
export const decimalString = (opts: { min?: number; scale?: number; label?: string } = {}) =>
  z
    .union([z.string(), z.number()])
    .transform((v) => String(v).trim().replace(/\s/g, '').replace(',', '.'))
    .refine((v) => new RegExp(`^-?\\d{1,15}(\\.\\d{1,${opts.scale ?? 4}})?$`).test(v), {
      message: `${opts.label ?? 'Betrag'} ungültig (max. ${opts.scale ?? 4} Nachkommastellen)`,
    })
    .refine((v) => opts.min === undefined || Number(v) >= opts.min, {
      message: `${opts.label ?? 'Wert'} muss mindestens ${opts.min} sein`,
    });

export const money = decimalString({ min: 0, label: 'Preis' });
export const quantity = decimalString({ label: 'Menge' });
export const positiveQuantity = decimalString({ label: 'Menge' }).refine((v) => Number(v) > 0, {
  message: 'Menge muss größer als 0 sein',
});

const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));
const country = z
  .string()
  .trim()
  .length(2, 'Ländercode mit 2 Buchstaben, z. B. DE')
  .toUpperCase()
  .default('DE');
const uuid = z.uuid();

/** GTIN/EAN (8, 12, 13 oder 14 Stellen) mit Prüfziffer nach GS1. */
export function isValidGtin(code: string): boolean {
  if (!/^(\d{8}|\d{12,14})$/.test(code)) return false;
  const digits = code.split('').map(Number);
  const check = digits.pop()!;
  const sum = digits.reverse().reduce((s, d, i) => s + d * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}

// ───── Firmeneinstellungen ─────
export const taxRateInputSchema = z.object({
  name: z.string().trim().min(1, 'Bezeichnung fehlt').max(60),
  rate: decimalString({ min: 0, scale: 2, label: 'Steuersatz' }).refine((v) => Number(v) <= 100, {
    message: 'Steuersatz höchstens 100 %',
  }),
  isDefault: z.boolean().default(false),
});

export const customerGroupInputSchema = z.object({
  name: z.string().trim().min(1, 'Name fehlt').max(80),
  priceDisplay: z.enum(['gross', 'net']).default('gross'),
  discountPercent: decimalString({ min: 0, scale: 2, label: 'Rabatt' })
    .refine((v) => Number(v) <= 100, { message: 'Rabatt höchstens 100 %' })
    .default('0'),
  isDefault: z.boolean().default(false),
});

export const categoryInputSchema = z.object({
  name: z.string().trim().min(1, 'Name fehlt').max(120),
  parentId: uuid.optional().nullable(),
  position: z.number().int().min(0).max(100000).default(0),
});

export const manufacturerInputSchema = z.object({
  name: z.string().trim().min(1, 'Name fehlt').max(120),
});

export const NUMBER_SEQUENCE_KEYS = {
  article: 'Artikelnummer',
  customer: 'Kundennummer',
  supplier: 'Lieferantennummer',
} as const;
export type NumberSequenceKey = keyof typeof NUMBER_SEQUENCE_KEYS;

export const numberSequenceInputSchema = z.object({
  prefix: z
    .string()
    .trim()
    .max(20)
    .regex(/^[A-Za-z0-9\-_/.]*$/, 'Nur Buchstaben, Ziffern und - _ / .')
    .default(''),
  nextValue: z.number().int().min(1).max(999_999_999),
  padding: z.number().int().min(1).max(12),
});

export const companySettingsInputSchema = z.object({ allowNegativeStock: z.boolean() });

// ───── Artikel ─────
export const ARTICLE_KINDS = {
  standard: 'Standardartikel',
  parent: 'Vaterartikel (Varianten)',
  variant: 'Variante',
  set: 'Set / Stückliste',
} as const;

export const articlePriceSchema = z.object({
  customerGroupId: uuid.optional().nullable(),
  minQuantity: positiveQuantity.default('1'),
  priceNet: money,
});

export const articleInputSchema = z.object({
  number: z
    .string()
    .trim()
    .max(60)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null)),
  kind: z.enum(['standard', 'parent', 'set']).default('standard'),
  name: z.string().trim().min(1, 'Bezeichnung fehlt').max(250),
  shortDescription: optText(500),
  description: optText(20000),
  gtin: z
    .string()
    .trim()
    .max(14)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || isValidGtin(v), {
      message: 'GTIN/EAN ungültig (Prüfziffer stimmt nicht)',
    }),
  manufacturerId: uuid.optional().nullable(),
  brand: optText(120),
  categoryId: uuid.optional().nullable(),
  unit: z.string().trim().min(1).max(20).default('Stück'),
  taxRateId: uuid.optional().nullable(),
  /** Preise optional: nicht geschickt = unverändert lassen (wichtig für Personen ohne Preisrecht). */
  purchasePriceNet: money.optional(),
  salePriceNet: money.optional(),
  weightKg: decimalString({ min: 0, label: 'Gewicht' }).optional().nullable(),
  minStock: decimalString({ min: 0, label: 'Mindestbestand' }).default('0'),
  stockTracked: z.boolean().default(true),
  trackBatches: z.boolean().default(false),
  trackSerials: z.boolean().default(false),
  trackBestBefore: z.boolean().default(false),
  active: z.boolean().default(true),
  prices: z.array(articlePriceSchema).max(100).optional(),
  setComponents: z
    .array(z.object({ articleId: uuid, quantity: positiveQuantity }))
    .max(200)
    .default([]),
  /** Nur Vaterartikel: Merkmale in fester Reihenfolge, z. B. [{"name":"Größe","values":["S","M"]}] */
  variantAttributes: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(40),
        values: z.array(z.string().trim().min(1).max(40)).min(1).max(50),
      }),
    )
    .min(1)
    .max(5)
    .optional()
    .nullable(),
  customFields: z.record(z.string().max(40), z.unknown()).optional(),
});
export type ArticleInput = z.infer<typeof articleInputSchema>;

// ───── Kunden und Lieferanten ─────
export const addressInputSchema = z.object({
  id: uuid.optional(),
  kind: z.enum(['billing', 'shipping']),
  isDefault: z.boolean().default(false),
  name: optText(200),
  name2: optText(200),
  street: optText(200),
  postalCode: optText(20),
  city: optText(120),
  country,
});

export const contactInputSchema = z.object({
  id: uuid.optional(),
  name: z.string().trim().min(1, 'Name fehlt').max(200),
  role: optText(120),
  email: z
    .union([z.email(), z.literal('')])
    .optional()
    .nullable()
    .transform((v) => (v ? v : null)),
  phone: optText(60),
});

const email = z
  .union([z.string().trim().toLowerCase().pipe(z.email('Ungültige E-Mail-Adresse')), z.literal('')])
  .optional()
  .nullable()
  .transform((v) => (v ? v : null));

export const customerInputSchema = z
  .object({
    number: z
      .string()
      .trim()
      .max(40)
      .optional()
      .nullable()
      .transform((v) => (v ? v : null)),
    type: z.enum(['private', 'business']).default('private'),
    companyName: optText(200),
    salutation: optText(40),
    firstName: optText(120),
    lastName: optText(120),
    email,
    phone: optText(60),
    vatId: optText(32),
    customerGroupId: uuid.optional().nullable(),
    paymentTermsDays: z.number().int().min(0).max(365).default(14),
    blocked: z.boolean().default(false),
    blockedReason: optText(500),
    notes: optText(20000),
    addresses: z.array(addressInputSchema).max(50).default([]),
    contacts: z.array(contactInputSchema).max(50).default([]),
    customFields: z.record(z.string().max(40), z.unknown()).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.type === 'business' && !v.companyName)
      ctx.addIssue({ code: 'custom', path: ['companyName'], message: 'Firmenname fehlt' });
    if (v.type === 'private' && !v.lastName && !v.companyName)
      ctx.addIssue({ code: 'custom', path: ['lastName'], message: 'Nachname fehlt' });
  });
export type CustomerInput = z.infer<typeof customerInputSchema>;

export const supplierInputSchema = z.object({
  number: z
    .string()
    .trim()
    .max(40)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null)),
  name: z.string().trim().min(1, 'Name fehlt').max(200),
  email,
  phone: optText(60),
  website: optText(200),
  vatId: optText(32),
  customerNumber: optText(60),
  paymentTermsDays: z.number().int().min(0).max(365).default(30),
  defaultDeliveryDays: z.number().int().min(0).max(365).optional().nullable(),
  notes: optText(20000),
  addresses: z.array(addressInputSchema).max(50).default([]),
  contacts: z.array(contactInputSchema).max(50).default([]),
  customFields: z.record(z.string().max(40), z.unknown()).optional(),
});
export type SupplierInput = z.infer<typeof supplierInputSchema>;

export const supplierArticleInputSchema = z.object({
  articleId: uuid,
  supplierSku: optText(80),
  purchasePriceNet: money,
  deliveryDays: z.number().int().min(0).max(365).optional().nullable(),
  minOrderQuantity: positiveQuantity.default('1'),
  isPreferred: z.boolean().default(false),
});

// ───── Lager ─────
export const warehouseInputSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1, 'Kürzel fehlt')
    .max(20)
    .regex(/^[A-Za-z0-9\-_]+$/, 'Nur Buchstaben, Ziffern, - und _'),
  name: z.string().trim().min(1, 'Name fehlt').max(120),
  street: optText(200),
  postalCode: optText(20),
  city: optText(120),
  country,
  isDefault: z.boolean().default(false),
});

export const storageLocationInputSchema = z.object({
  code: z.string().trim().min(1, 'Lagerplatz fehlt').max(40),
  description: optText(200),
});

const trackingFields = {
  batch: optText(80),
  serialNumber: optText(120),
  bestBefore: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Datum JJJJ-MM-TT')
    .optional()
    .nullable(),
  note: optText(500),
};

/** Zugang oder Abgang (Menge immer positiv; die Art bestimmt das Vorzeichen). */
export const stockBookingSchema = z.object({
  type: z.enum(['receipt', 'issue']),
  articleId: uuid,
  warehouseId: uuid,
  locationId: uuid.optional().nullable(),
  quantity: positiveQuantity,
  ...trackingFields,
});

export const stockTransferSchema = z.object({
  articleId: uuid,
  fromWarehouseId: uuid,
  fromLocationId: uuid.optional().nullable(),
  toWarehouseId: uuid,
  toLocationId: uuid.optional().nullable(),
  quantity: positiveQuantity,
  note: optText(500),
});

/** Korrektur/Inventur: gezählter Bestand; gebucht wird die Differenz. */
export const stockCorrectionSchema = z.object({
  articleId: uuid,
  warehouseId: uuid,
  locationId: uuid.optional().nullable(),
  countedQuantity: decimalString({ label: 'Gezählte Menge' }),
  note: optText(500),
});
