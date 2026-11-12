import { z } from 'zod';

/** Datenarten, die FangEvo Import verarbeiten kann. */
export const IMPORT_ENTITIES = {
  articles: 'Artikel',
  customers: 'Kunden',
  suppliers: 'Lieferanten',
  stock: 'Bestände',
  prices: 'Preise (Staffel/Kundengruppe)',
  categories: 'Kategorien',
} as const;
export type ImportEntity = keyof typeof IMPORT_ENTITIES;

export interface ImportField {
  key: string;
  label: string;
  required?: boolean;
  /** Spaltennamen, die automatisch zugeordnet werden (klein, ohne Sonderzeichen verglichen) */
  aliases: string[];
  hint?: string;
}

/**
 * Felder je Datenart. Die Aliase decken übliche Exportspalten ab (z. B. aus JTL, Shopify, Excel-Listen);
 * es werden keine fremden Datenstrukturen übernommen, nur Spaltennamen erkannt.
 */
export const IMPORT_FIELDS: Record<ImportEntity, ImportField[]> = {
  articles: [
    {
      key: 'number',
      label: 'Artikelnummer',
      aliases: ['artikelnummer', 'artnr', 'sku', 'artikelnr', 'cartnr', 'itemnumber'],
    },
    {
      key: 'name',
      label: 'Bezeichnung',
      required: true,
      aliases: ['bezeichnung', 'name', 'artikelname', 'title', 'cname'],
    },
    {
      key: 'shortDescription',
      label: 'Kurzbeschreibung',
      aliases: ['kurzbeschreibung', 'shortdescription', 'ckurzbeschreibung'],
    },
    {
      key: 'description',
      label: 'Beschreibung',
      aliases: ['beschreibung', 'description', 'cbeschreibung', 'bodyhtml'],
    },
    { key: 'gtin', label: 'EAN/GTIN', aliases: ['ean', 'gtin', 'barcode', 'cbarcode', 'ean13'] },
    {
      key: 'unit',
      label: 'Einheit',
      aliases: ['einheit', 'unit', 'ceinheit', 'verpackungseinheit'],
    },
    {
      key: 'salePriceNet',
      label: 'Verkaufspreis netto',
      aliases: ['vknetto', 'nettovk', 'verkaufspreisnetto', 'fvknetto', 'preisnetto', 'netprice'],
    },
    {
      key: 'purchasePriceNet',
      label: 'Einkaufspreis netto',
      aliases: ['eknetto', 'nettoek', 'einkaufspreisnetto', 'fekNetto'.toLowerCase(), 'ek', 'cost'],
    },
    {
      key: 'taxRate',
      label: 'Steuersatz (%)',
      aliases: ['steuersatz', 'mwst', 'ust', 'taxrate', 'fsteuersatz'],
      hint: 'z. B. 19 oder 7',
    },
    {
      key: 'category',
      label: 'Kategorie',
      aliases: ['kategorie', 'category', 'warengruppe', 'kategoriepfad'],
      hint: 'Pfad mit „>“, z. B. Angeln > Ruten',
    },
    {
      key: 'manufacturer',
      label: 'Hersteller',
      aliases: ['hersteller', 'manufacturer', 'vendor', 'chersteller'],
    },
    { key: 'brand', label: 'Marke', aliases: ['marke', 'brand'] },
    {
      key: 'weightKg',
      label: 'Gewicht (kg)',
      aliases: ['gewicht', 'weight', 'fgewicht', 'artikelgewicht'],
    },
    {
      key: 'minStock',
      label: 'Mindestbestand',
      aliases: ['mindestbestand', 'minstock', 'nmidestbestand', 'nmindestbestand'],
    },
    {
      key: 'active',
      label: 'Aktiv',
      aliases: ['aktiv', 'active', 'caktiv', 'status'],
      hint: 'ja/nein, 1/0, Y/N',
    },
    {
      key: 'stockTracked',
      label: 'Bestand führen',
      aliases: ['lagerartikel', 'bestandfuehren', 'bestandsfuehrungaktiv', 'clagerartikel'],
    },
  ],
  customers: [
    {
      key: 'number',
      label: 'Kundennummer',
      aliases: ['kundennummer', 'kundennr', 'customernumber', 'ckundennr'],
    },
    { key: 'type', label: 'Art (privat/geschäftlich)', aliases: ['art', 'typ', 'kundenart'] },
    { key: 'companyName', label: 'Firma', aliases: ['firma', 'company', 'cfirma', 'firmenname'] },
    { key: 'salutation', label: 'Anrede', aliases: ['anrede', 'salutation', 'canrede'] },
    { key: 'firstName', label: 'Vorname', aliases: ['vorname', 'firstname', 'cvorname'] },
    { key: 'lastName', label: 'Nachname', aliases: ['nachname', 'name', 'lastname', 'cname'] },
    { key: 'email', label: 'E-Mail', aliases: ['email', 'mail', 'cmail'] },
    { key: 'phone', label: 'Telefon', aliases: ['telefon', 'phone', 'ctel'] },
    { key: 'vatId', label: 'USt-IdNr.', aliases: ['ustid', 'ustidnr', 'vatid', 'cust'] },
    { key: 'customerGroup', label: 'Kundengruppe', aliases: ['kundengruppe', 'customergroup'] },
    {
      key: 'paymentTermsDays',
      label: 'Zahlungsziel (Tage)',
      aliases: ['zahlungsziel', 'paymentterms'],
    },
    {
      key: 'street',
      label: 'Straße',
      aliases: ['strasse', 'straße', 'street', 'cstrasse', 'address1'],
    },
    { key: 'postalCode', label: 'PLZ', aliases: ['plz', 'postalcode', 'zip', 'cplz'] },
    { key: 'city', label: 'Ort', aliases: ['ort', 'stadt', 'city', 'cort'] },
    { key: 'country', label: 'Land (ISO)', aliases: ['land', 'country', 'clandiso', 'landiso'] },
    { key: 'notes', label: 'Notizen', aliases: ['notiz', 'notizen', 'notes', 'bemerkung'] },
  ],
  suppliers: [
    {
      key: 'number',
      label: 'Lieferantennummer',
      aliases: ['lieferantennummer', 'lieferantennr', 'suppliernumber'],
    },
    {
      key: 'name',
      label: 'Name',
      required: true,
      aliases: ['name', 'firma', 'lieferant', 'cfirma'],
    },
    { key: 'email', label: 'E-Mail', aliases: ['email', 'mail'] },
    { key: 'phone', label: 'Telefon', aliases: ['telefon', 'phone'] },
    { key: 'website', label: 'Website', aliases: ['website', 'www', 'homepage'] },
    { key: 'vatId', label: 'USt-IdNr.', aliases: ['ustid', 'ustidnr', 'vatid'] },
    {
      key: 'customerNumber',
      label: 'Unsere Kundennummer',
      aliases: ['kundennummer', 'unserekundennummer', 'customernumber'],
    },
    {
      key: 'paymentTermsDays',
      label: 'Zahlungsziel (Tage)',
      aliases: ['zahlungsziel', 'paymentterms'],
    },
    {
      key: 'defaultDeliveryDays',
      label: 'Lieferzeit (Tage)',
      aliases: ['lieferzeit', 'deliverydays'],
    },
    { key: 'street', label: 'Straße', aliases: ['strasse', 'straße', 'street'] },
    { key: 'postalCode', label: 'PLZ', aliases: ['plz', 'zip', 'postalcode'] },
    { key: 'city', label: 'Ort', aliases: ['ort', 'city', 'stadt'] },
    { key: 'country', label: 'Land (ISO)', aliases: ['land', 'country'] },
  ],
  stock: [
    {
      key: 'article',
      label: 'Artikelnummer oder EAN',
      required: true,
      aliases: ['artikelnummer', 'artnr', 'sku', 'ean', 'gtin', 'cartnr'],
    },
    {
      key: 'warehouse',
      label: 'Lager (Kürzel)',
      aliases: ['lager', 'warehouse', 'lagerkuerzel', 'cwarenlager'],
    },
    { key: 'location', label: 'Lagerplatz', aliases: ['lagerplatz', 'location', 'platz', 'cname'] },
    {
      key: 'quantity',
      label: 'Menge',
      required: true,
      aliases: ['menge', 'bestand', 'lagerbestandeigen', 'quantity', 'fbestand', 'stock'],
    },
    { key: 'batch', label: 'Charge', aliases: ['charge', 'batch', 'ccharge'] },
    {
      key: 'serialNumber',
      label: 'Seriennummer',
      aliases: ['seriennummer', 'serial', 'cseriennr'],
    },
    { key: 'bestBefore', label: 'MHD', aliases: ['mhd', 'bestbefore', 'dmhd'] },
  ],
  prices: [
    {
      key: 'article',
      label: 'Artikelnummer oder EAN',
      required: true,
      aliases: ['artikelnummer', 'artnr', 'sku', 'ean'],
    },
    {
      key: 'customerGroup',
      label: 'Kundengruppe (leer = alle)',
      aliases: ['kundengruppe', 'customergroup'],
    },
    {
      key: 'minQuantity',
      label: 'Ab Menge',
      aliases: ['abmenge', 'staffel', 'minquantity', 'nanzahlab'],
    },
    {
      key: 'priceNet',
      label: 'Preis netto',
      required: true,
      aliases: ['preisnetto', 'preis', 'pricenet', 'fnettopreis', 'fvknetto'],
    },
  ],
  categories: [
    {
      key: 'path',
      label: 'Kategoriepfad',
      required: true,
      aliases: ['kategorie', 'pfad', 'path', 'category', 'kategoriepfad'],
      hint: 'z. B. Angeln > Ruten > Spinnruten',
    },
  ],
};

/** Normalisiert Spaltennamen für den Vergleich mit Aliasen. */
export function normalizeHeader(h: string): string {
  return h
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]/g, '');
}

/** Schlägt zu jeder Spalte ein Feld vor (Index der Spalte → Feldschlüssel). */
export function suggestMapping(entity: ImportEntity, headers: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  const used = new Set<number>();
  for (const f of IMPORT_FIELDS[entity]) {
    const keys = [
      normalizeHeader(f.key),
      normalizeHeader(f.label),
      ...f.aliases.map(normalizeHeader),
    ];
    const idx = headers.findIndex((h, i) => !used.has(i) && keys.includes(normalizeHeader(h)));
    if (idx >= 0) {
      out[f.key] = idx;
      used.add(idx);
    }
  }
  return out;
}

export const IMPORT_MODES = {
  create: 'Nur neu anlegen (vorhandene Nummern überspringen)',
  update: 'Nur vorhandene ändern (per Nummer)',
  upsert: 'Anlegen oder ändern (per Nummer)',
} as const;
export type ImportMode = keyof typeof IMPORT_MODES;

export const STOCK_MODES = {
  set: 'Bestand setzen (Inventur, Differenz wird gebucht)',
  add: 'Bestand hinzufügen (Zugang)',
} as const;

export const importUploadSchema = z.object({
  entity: z.enum(Object.keys(IMPORT_ENTITIES) as [ImportEntity, ...ImportEntity[]]),
  fileName: z.string().trim().min(1).max(200),
  /** Dateiinhalt base64-kodiert (CSV oder XLSX), höchstens ca. 10 MB */
  contentBase64: z.string().min(1).max(14_000_000),
});

export const importConfigSchema = z.object({
  /** Feld → Spaltenindex */
  mapping: z.record(z.string().max(40), z.number().int().min(0).max(500)),
  /** Feld → Standardwert, wenn die Spalte leer ist oder fehlt */
  defaults: z.record(z.string().max(40), z.string().max(500)).default({}),
  mode: z.enum(['create', 'update', 'upsert']).default('upsert'),
  stockMode: z.enum(['set', 'add']).default('set'),
  /** Fehlende Kategorien/Hersteller automatisch anlegen */
  createMissing: z.boolean().default(true),
});
export type ImportConfig = z.infer<typeof importConfigSchema>;

export const importTemplateSchema = z.object({
  entity: z.enum(Object.keys(IMPORT_ENTITIES) as [ImportEntity, ...ImportEntity[]]),
  name: z.string().trim().min(1, 'Name fehlt').max(80),
  /** Zuordnung über Spaltennamen (damit die Vorlage für neue Dateien passt) */
  columns: z.record(z.string().max(40), z.string().max(200)),
  config: importConfigSchema.omit({ mapping: true }),
});

export const EXPORT_ENTITIES = {
  articles: 'Artikel',
  customers: 'Kunden',
  suppliers: 'Lieferanten',
  stock: 'Bestände',
} as const;
export type ExportEntity = keyof typeof EXPORT_ENTITIES;

// ───── Öffentliche API ─────
export const API_KEY_PREFIX = 'fe_live_';

export const apiKeyInputSchema = z.object({
  name: z.string().trim().min(1, 'Name fehlt').max(80),
  permissions: z.array(z.string().max(60)).min(1, 'Mindestens ein Recht').max(60),
  expiresAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Datum JJJJ-MM-TT')
    .optional()
    .nullable(),
});

// ───── Verkaufskanäle ─────
export const CHANNEL_TYPES = {
  api: 'Eigener Shop über API',
} as const;
export type ChannelType = keyof typeof CHANNEL_TYPES;

/** Geplante Anbindungen: erst nach Zugangsdaten und Sandbox-Test verfügbar (Playbook 15). */
export const PLANNED_CHANNELS = [
  'Amazon',
  'eBay',
  'Kaufland',
  'OTTO',
  'Shopify',
  'WooCommerce',
  'Shopware',
  'Etsy',
  'TikTok Shop',
] as const;

export const channelInputSchema = z.object({
  type: z.enum(Object.keys(CHANNEL_TYPES) as [ChannelType, ...ChannelType[]]).default('api'),
  name: z.string().trim().min(1, 'Name fehlt').max(80),
  warehouseId: z.uuid().optional().nullable(),
  active: z.boolean().default(true),
  /** Nur gelistete Artikel an den Kanal geben (sonst alle aktiven Artikel) */
  listedOnly: z.boolean().default(false),
});

export const channelListingSchema = z.object({
  active: z.boolean().default(true),
  priceNet: z
    .union([z.string(), z.number()])
    .transform((v) => String(v).trim().replace(',', '.'))
    .refine((v) => v === '' || /^\d{1,15}(\.\d{1,4})?$/.test(v), 'Preis ungültig')
    .optional()
    .nullable(),
});

const optT = (max: number) => z.string().trim().max(max).optional().nullable();

/** Bestellung, die ein Shop über die API übergibt. */
export const channelOrderSchema = z.object({
  externalId: z.string().trim().min(1).max(80),
  customer: z.object({
    externalId: optT(80),
    email: z.string().trim().toLowerCase().pipe(z.email('Ungültige E-Mail-Adresse')),
    companyName: optT(200),
    firstName: optT(120),
    lastName: optT(120),
    phone: optT(60),
    vatId: optT(32),
  }),
  billingAddress: z.object({
    name: optT(200),
    street: z.string().trim().min(1).max(200),
    postalCode: z.string().trim().min(1).max(20),
    city: z.string().trim().min(1).max(120),
    country: z.string().trim().length(2).toUpperCase().default('DE'),
  }),
  shippingAddress: z
    .object({
      name: optT(200),
      street: z.string().trim().min(1).max(200),
      postalCode: z.string().trim().min(1).max(20),
      city: z.string().trim().min(1).max(120),
      country: z.string().trim().length(2).toUpperCase().default('DE'),
    })
    .optional()
    .nullable(),
  lines: z
    .array(
      z.object({
        /** Artikelnummer, EAN oder zusätzlicher Barcode */
        sku: z.string().trim().min(1).max(80),
        quantity: z.union([z.string(), z.number()]).transform((v) => String(v)),
        unitPriceNet: z
          .union([z.string(), z.number()])
          .transform((v) => String(v))
          .optional()
          .nullable(),
      }),
    )
    .min(1)
    .max(500),
  shippingNet: z
    .union([z.string(), z.number()])
    .transform((v) => String(v))
    .default('0'),
  paymentMethod: optT(80),
  shippingMethod: optT(80),
  notes: optT(5000),
});
export type ChannelOrder = z.infer<typeof channelOrderSchema>;
