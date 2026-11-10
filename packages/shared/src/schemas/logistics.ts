import { z } from 'zod';
import { decimalString, positiveQuantity } from './master-data';

const uuid = z.uuid();
const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));

// ───── Barcodes ─────
export const barcodeInputSchema = z.object({
  code: z.string().trim().min(3, 'Barcode zu kurz').max(64),
});

// ───── Picklisten ─────
export const PICK_LIST_STATUSES = {
  open: 'Offen',
  in_progress: 'In Arbeit',
  done: 'Erledigt',
  cancelled: 'Storniert',
} as const;
export type PickListStatus = keyof typeof PICK_LIST_STATUSES;

export const pickListCreateSchema = z.object({
  orderIds: z.array(uuid).min(1, 'Mindestens ein Auftrag').max(200),
});

export const pickConfirmSchema = z.object({
  lineId: uuid,
  quantity: positiveQuantity,
  /** Gescannter Lagerplatz (optional, zur Kontrolle) */
  locationId: uuid.optional().nullable(),
  batch: optText(80),
});

// ───── Packtisch und Versand ─────
export const CARRIERS = {
  manual: 'Manuell (eigene Trackingnummer)',
  own_label: 'Eigenes Adressetikett (PDF)',
} as const;
export type Carrier = keyof typeof CARRIERS;

export const packingStationInputSchema = z.object({
  name: z.string().trim().min(1, 'Name fehlt').max(80),
  defaultCarrier: z.enum(Object.keys(CARRIERS) as [Carrier, ...Carrier[]]).default('manual'),
  autoInvoice: z.boolean().default(false),
  autoDeliveryNote: z.boolean().default(true),
});

export const parcelSchema = z.object({
  weightKg: decimalString({ min: 0, label: 'Gewicht' }),
  lengthCm: z.number().int().min(0).max(1000).optional().nullable(),
  widthCm: z.number().int().min(0).max(1000).optional().nullable(),
  heightCm: z.number().int().min(0).max(1000).optional().nullable(),
});

/** Abschluss am Packtisch: gescannte Positionen (inkl. Charge/SN), Pakete, Versandart. */
export const packCompleteSchema = z.object({
  stationId: uuid.optional().nullable(),
  carrier: z.enum(Object.keys(CARRIERS) as [Carrier, ...Carrier[]]),
  trackingNumber: optText(80),
  parcels: z.array(parcelSchema).min(1, 'Mindestens ein Paket').max(50),
  items: z
    .array(
      z.object({
        orderLineId: uuid,
        articleId: uuid,
        quantity: positiveQuantity,
        batch: optText(80),
        serialNumber: optText(120),
        locationId: uuid.optional().nullable(),
      }),
    )
    .min(1)
    .max(2000),
});
export type PackComplete = z.infer<typeof packCompleteSchema>;

// ───── Retouren ─────
export const RETURN_STATUSES = {
  open: 'Angemeldet',
  received: 'Eingegangen',
  cancelled: 'Storniert',
} as const;
export type ReturnStatus = keyof typeof RETURN_STATUSES;

export const RETURN_CONDITIONS = {
  resell: 'Wieder verkaufbar (zurück ins Lager)',
  damaged: 'Beschädigt (nicht einlagern)',
  scrap: 'Entsorgen',
} as const;
export type ReturnCondition = keyof typeof RETURN_CONDITIONS;

export const returnCreateSchema = z.object({
  orderId: uuid,
  reason: optText(500),
  notes: optText(2000),
  lines: z
    .array(z.object({ orderLineId: uuid, quantity: positiveQuantity }))
    .min(1, 'Mindestens eine Position')
    .max(500),
});

export const returnReceiveSchema = z.object({
  lines: z
    .array(
      z.object({
        lineId: uuid,
        condition: z.enum(
          Object.keys(RETURN_CONDITIONS) as [ReturnCondition, ...ReturnCondition[]],
        ),
        locationId: uuid.optional().nullable(),
        batch: optText(80),
        serialNumber: optText(120),
      }),
    )
    .min(1)
    .max(500),
  createCreditNote: z.boolean().default(false),
});
