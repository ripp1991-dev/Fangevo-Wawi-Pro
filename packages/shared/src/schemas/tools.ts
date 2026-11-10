import { z } from 'zod';

// ───── Listen (Tabellen) ─────
export const FILTER_OPS = [
  'eq',
  'neq',
  'contains',
  'in',
  'gte',
  'lte',
  'empty',
  'notEmpty',
] as const;
export type FilterOp = (typeof FILTER_OPS)[number];

export const filterSchema = z.object({
  field: z.string().min(1).max(80),
  op: z.enum(FILTER_OPS),
  value: z
    .union([
      z.string(),
      z.number(),
      z.boolean(),
      z.array(z.union([z.string(), z.number()])).max(100),
      z.null(),
    ])
    .optional(),
});
export type ListFilter = z.infer<typeof filterSchema>;

/** Abfrageparameter jeder Liste: ?q=&sort=feld:asc&filters=<JSON>&page=&pageSize= */
export const listQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  sort: z
    .string()
    .regex(/^[a-zA-Z0-9_.]+:(asc|desc)$/)
    .optional(),
  filters: z
    .string()
    .max(5000)
    .optional()
    .transform((v, ctx) => {
      if (!v) return [] as ListFilter[];
      try {
        return z.array(filterSchema).max(20).parse(JSON.parse(v));
      } catch {
        ctx.addIssue({ code: 'custom', message: 'Ungültige Filter' });
        return z.NEVER;
      }
    }),
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(1000).default(50),
  archived: z.enum(['true', 'false']).optional(),
});
export type ListQuery = z.infer<typeof listQuerySchema>;

export interface ListResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

// ───── Gespeicherte Ansichten ─────
export const tableStateSchema = z.object({
  columnOrder: z.array(z.string().max(80)).max(100).default([]),
  hidden: z.array(z.string().max(80)).max(100).default([]),
  widths: z.record(z.string().max(80), z.number().int().min(40).max(1200)).default({}),
  sort: z.string().max(100).nullable().default(null),
  filters: z.array(filterSchema).max(20).default([]),
  groupBy: z.string().max(80).nullable().default(null),
  q: z.string().max(200).default(''),
});
export type TableState = z.infer<typeof tableStateSchema>;

export const TABLE_KEYS = [
  'companies',
  'members',
  'audit',
  'articles',
  'customers',
  'suppliers',
  'stock',
  'movements',
  'orders',
  'documents',
  'purchase_orders',
  'pick_lists',
  'shipments',
  'returns',
  'imports',
  'channels',
] as const;
export const savedViewInputSchema = z.object({
  tableKey: z.enum(TABLE_KEYS),
  name: z.string().trim().min(1, 'Name fehlt').max(60),
  state: tableStateSchema,
  shared: z.boolean().default(false),
});

// ───── Eigene Felder ─────
export const CUSTOM_FIELD_TYPES = [
  'text',
  'number',
  'date',
  'boolean',
  'select',
  'multiselect',
  'reference',
] as const;
export type CustomFieldType = (typeof CUSTOM_FIELD_TYPES)[number];
export const CUSTOM_FIELD_ENTITIES = {
  company: 'Firma',
  article: 'Artikel',
  customer: 'Kunde',
  supplier: 'Lieferant',
} as const;
export type CustomFieldEntity = keyof typeof CUSTOM_FIELD_ENTITIES;
export const REFERENCE_TARGETS = { company: 'Firma', member: 'Benutzer' } as const;

const optionSchema = z.object({
  value: z.string().trim().min(1).max(60),
  label: z.string().trim().min(1).max(80),
});

export const customFieldCreateSchema = z
  .object({
    entityType: z.enum(Object.keys(CUSTOM_FIELD_ENTITIES) as [CustomFieldEntity]),
    key: z
      .string()
      .trim()
      .regex(
        /^[a-z][a-z0-9_]{1,39}$/,
        'Nur Kleinbuchstaben, Ziffern und _ (2–40 Zeichen, Buchstabe am Anfang)',
      ),
    label: z.string().trim().min(1, 'Bezeichnung fehlt').max(80),
    type: z.enum(CUSTOM_FIELD_TYPES),
    options: z.array(optionSchema).max(100).optional(),
    required: z.boolean().default(false),
    position: z.number().int().min(0).max(1000).default(0),
    referenceEntity: z.enum(Object.keys(REFERENCE_TARGETS) as ['company', 'member']).optional(),
  })
  .superRefine((v, ctx) => {
    if ((v.type === 'select' || v.type === 'multiselect') && !v.options?.length)
      ctx.addIssue({
        code: 'custom',
        path: ['options'],
        message: 'Mindestens eine Auswahlmöglichkeit nötig',
      });
    if (v.type === 'reference' && !v.referenceEntity)
      ctx.addIssue({
        code: 'custom',
        path: ['referenceEntity'],
        message: 'Ziel des Verweises fehlt',
      });
  });

/** Typ und Schlüssel sind nach dem Anlegen fest, damit gespeicherte Werte gültig bleiben. */
export const customFieldUpdateSchema = z.object({
  label: z.string().trim().min(1).max(80),
  options: z.array(optionSchema).max(100).optional(),
  required: z.boolean(),
  position: z.number().int().min(0).max(1000),
});

// ───── Einstellungen ─────
export const navPreferenceSchema = z.object({
  hidden: z.array(z.string().max(80)).max(100).default([]),
  order: z.array(z.string().max(80)).max(100).default([]),
  favorites: z.array(z.string().max(80)).max(20).default([]),
});
export const PREFERENCE_SCHEMAS = { nav: navPreferenceSchema } as const;
export type PreferenceKey = keyof typeof PREFERENCE_SCHEMAS;

export const notificationPreferencesSchema = z.record(z.string(), z.boolean());
