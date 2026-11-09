import { z } from 'zod';
import { decimalString, money, positiveQuantity } from './master-data';

// ───── Aufträge ─────
export const ORDER_STATUSES = {
  new: 'Neu',
  unchecked: 'Ungeprüft',
  in_progress: 'In Bearbeitung',
  awaiting_payment: 'Wartet auf Zahlung',
  awaiting_stock: 'Wartet auf Bestand',
  picking: 'Kommissionierung',
  packing: 'Verpackung',
  ready_to_ship: 'Versandbereit',
  shipped: 'Versendet',
  completed: 'Abgeschlossen',
  cancelled: 'Storniert',
} as const;
export type OrderStatus = keyof typeof ORDER_STATUSES;

/**
 * Erlaubte Statuswechsel (Playbook 9: keine unkontrollierten Statusänderungen).
 * "shipped" wird nur über die Aktion „Versenden“ erreicht (bucht den Bestand ab).
 * "cancelled" nur über „Stornieren“ (gibt Reservierungen frei).
 */
export const ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  new: ['unchecked', 'in_progress', 'awaiting_payment'],
  unchecked: ['in_progress', 'awaiting_payment'],
  in_progress: ['awaiting_payment', 'awaiting_stock', 'picking', 'ready_to_ship'],
  awaiting_payment: ['in_progress', 'awaiting_stock', 'picking', 'ready_to_ship'],
  awaiting_stock: ['in_progress', 'picking', 'ready_to_ship'],
  picking: ['packing', 'ready_to_ship', 'in_progress'],
  packing: ['ready_to_ship', 'picking'],
  ready_to_ship: ['picking', 'packing'],
  shipped: ['completed'],
  completed: [],
  cancelled: [],
};
/** Status, in denen Positionen noch geändert werden dürfen. */
export const ORDER_EDITABLE: OrderStatus[] = [
  'new',
  'unchecked',
  'in_progress',
  'awaiting_payment',
  'awaiting_stock',
];
/** Status, in denen Bestand reserviert ist. */
export const ORDER_RESERVING: OrderStatus[] = [
  'in_progress',
  'awaiting_payment',
  'awaiting_stock',
  'picking',
  'packing',
  'ready_to_ship',
];
/** Status, aus denen versendet werden kann. */
export const ORDER_SHIPPABLE: OrderStatus[] = [
  'in_progress',
  'awaiting_payment',
  'awaiting_stock',
  'picking',
  'packing',
  'ready_to_ship',
];

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from]?.includes(to) ?? false;
}

const uuid = z.uuid();
const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));

export const orderLineInputSchema = z
  .object({
    articleId: uuid.optional().nullable(),
    /** Nur für Freitextpositionen (ohne Artikel) */
    name: optText(250),
    quantity: positiveQuantity,
    /** Leer = Preis wird automatisch ermittelt (Kundengruppe, Staffel, Verkaufspreis) */
    unitPriceNet: money.optional().nullable(),
    discountPercent: decimalString({ min: 0, scale: 2, label: 'Rabatt' })
      .refine((v) => Number(v) <= 100, { message: 'Rabatt höchstens 100 %' })
      .optional()
      .nullable(),
    /** Nur Freitext: Steuersatz-ID */
    taxRateId: uuid.optional().nullable(),
  })
  .refine((l) => !!l.articleId || !!l.name, {
    message: 'Artikel oder Bezeichnung nötig',
    path: ['name'],
  });

export const orderInputSchema = z.object({
  customerId: uuid,
  warehouseId: uuid.optional().nullable(),
  externalNumber: optText(80),
  paymentMethod: optText(80),
  shippingMethod: optText(80),
  shippingNet: money.default('0'),
  notes: optText(5000),
  lines: z.array(orderLineInputSchema).min(1, 'Mindestens eine Position').max(500),
});
export type OrderInput = z.infer<typeof orderInputSchema>;

export const orderTransitionSchema = z.object({
  to: z.enum(Object.keys(ORDER_STATUSES) as [OrderStatus, ...OrderStatus[]]),
  note: optText(500),
});

export const orderCancelSchema = z.object({
  reason: z.string().trim().min(1, 'Bitte einen Grund angeben').max(500),
});

// ───── Belege ─────
export const DOCUMENT_TYPES = {
  offer: 'Angebot',
  order_confirmation: 'Auftragsbestätigung',
  delivery_note: 'Lieferschein',
  invoice: 'Rechnung',
  credit_note: 'Gutschrift',
  cancellation: 'Stornorechnung',
  purchase_order: 'Bestellung',
} as const;
export type DocumentType = keyof typeof DOCUMENT_TYPES;

export const documentFromOrderSchema = z.object({
  type: z.enum(['offer', 'order_confirmation', 'delivery_note', 'invoice']),
  serviceDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .nullable(),
  notes: optText(2000),
});

export const creditNoteSchema = z.object({
  /** Leer = alle Positionen der Rechnung */
  lines: z
    .array(z.object({ index: z.number().int().min(0), quantity: positiveQuantity }))
    .max(500)
    .optional(),
  reason: z.string().trim().min(1, 'Bitte einen Grund angeben').max(500),
});

export const paymentInputSchema = z.object({
  amount: decimalString({ label: 'Betrag' }).refine((v) => Number(v) !== 0, {
    message: 'Betrag darf nicht 0 sein',
  }),
  paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Datum JJJJ-MM-TT'),
  method: optText(80),
  reference: optText(200),
});

export const sendDocumentSchema = z.object({
  to: z.string().trim().toLowerCase().pipe(z.email('Ungültige E-Mail-Adresse')),
  subject: z.string().trim().min(1).max(200).optional(),
  message: z.string().trim().max(5000).optional(),
});

// ───── Einkauf ─────
export const PURCHASE_STATUSES = {
  draft: 'Entwurf',
  ordered: 'Bestellt',
  partially_received: 'Teilweise geliefert',
  received: 'Geliefert',
  cancelled: 'Storniert',
} as const;
export type PurchaseStatus = keyof typeof PURCHASE_STATUSES;

export const purchaseOrderInputSchema = z.object({
  supplierId: uuid,
  warehouseId: uuid.optional().nullable(),
  expectedDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .nullable(),
  notes: optText(2000),
  lines: z
    .array(
      z.object({
        articleId: uuid,
        quantity: positiveQuantity,
        unitPriceNet: money.optional().nullable(),
      }),
    )
    .min(1, 'Mindestens eine Position')
    .max(500),
});

export const goodsReceiptSchema = z.object({
  lines: z
    .array(
      z.object({
        lineId: uuid,
        quantity: positiveQuantity,
        locationId: uuid.optional().nullable(),
        batch: optText(80),
        serialNumber: optText(120),
        bestBefore: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional()
          .nullable(),
      }),
    )
    .min(1)
    .max(500),
  note: optText(500),
});
