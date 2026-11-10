import { z } from 'zod';

// ───── Webhooks ─────

/** Ereignisse, die an Webhooks gesendet werden können (Playbook 20). */
export const WEBHOOK_EVENTS = {
  'order.created': 'Neue Bestellung / neuer Auftrag',
  'order.updated': 'Auftrag geändert',
  'order.status_changed': 'Auftragsstatus geändert',
  'order.shipped': 'Auftrag versendet',
  'order.cancelled': 'Auftrag storniert',
  'shipment.created': 'Sendung erstellt (Versand abgeschlossen)',
  'shipment.tracking_set': 'Trackingnummer eingetragen',
  'article.created': 'Artikel angelegt',
  'article.updated': 'Artikel geändert',
  'stock.received': 'Bestand: Zugang',
  'stock.issued': 'Bestand: Abgang',
  'stock.corrected': 'Bestand: Inventur/Korrektur',
  'stock.transferred': 'Bestand: Umlagerung',
  'customer.created': 'Kunde angelegt',
  'customer.updated': 'Kunde geändert',
  'return.created': 'Retoure angemeldet',
  'return.received': 'Retoure eingegangen',
  'document.finalized': 'Beleg festgeschrieben (z. B. Rechnung)',
  'document.payment_added': 'Zahlung erfasst',
} as const;
export type WebhookEvent = keyof typeof WEBHOOK_EVENTS;

export const webhookInputSchema = z.object({
  name: z.string().trim().min(1, 'Name fehlt').max(80),
  url: z
    .string()
    .trim()
    .max(500)
    .url('Ungültige Adresse')
    .refine((u) => /^https?:\/\//i.test(u), 'Nur http(s)-Adressen'),
  events: z
    .array(z.enum(Object.keys(WEBHOOK_EVENTS) as [WebhookEvent, ...WebhookEvent[]]))
    .min(1, 'Mindestens ein Ereignis')
    .max(50),
  active: z.boolean().default(true),
});

// ───── Regeln (Workflows) ─────

export const WORKFLOW_TRIGGERS = {
  'order.created': 'Neue Bestellung eingegangen',
  'order.status_changed': 'Auftragsstatus geändert',
  'order.shipped': 'Auftrag versendet',
  'return.received': 'Retoure eingegangen',
  'stock.low': 'Bestand unter Mindestbestand gefallen',
  schedule: 'Zeitgesteuert (stündlich/täglich)',
} as const;
export type WorkflowTrigger = keyof typeof WORKFLOW_TRIGGERS;

export const SCHEDULE_CHECKS = {
  orders_waiting: 'Aufträge warten zu lange in einem Status',
  purchase_overdue: 'Lieferantenbestellung überfällig (Liefertermin vorbei)',
  low_stock: 'Artikel unter Mindestbestand',
} as const;
export type ScheduleCheck = keyof typeof SCHEDULE_CHECKS;

/** Felder für Bedingungen je Kontextart. */
export const CONDITION_FIELDS = {
  order: {
    'order.totalGross': { label: 'Warenwert brutto', kind: 'number' },
    'order.totalNet': { label: 'Warenwert netto', kind: 'number' },
    'order.status': { label: 'Status', kind: 'string' },
    'order.customerCountry': { label: 'Land des Kunden (ISO)', kind: 'string' },
    'order.customerType': { label: 'Kundenart (private/business)', kind: 'string' },
    'order.customerGroup': { label: 'Kundengruppe', kind: 'string' },
    'order.paymentMethod': { label: 'Zahlungsart', kind: 'string' },
    'order.shippingMethod': { label: 'Versandart', kind: 'string' },
    'order.channel': { label: 'Verkaufskanal', kind: 'string' },
    'order.itemCount': { label: 'Anzahl Positionen', kind: 'number' },
    'order.hoursInStatus': { label: 'Stunden im aktuellen Status', kind: 'number' },
  },
  article: {
    'article.number': { label: 'Artikelnummer', kind: 'string' },
    'article.stock': { label: 'Bestand', kind: 'number' },
    'article.minStock': { label: 'Mindestbestand', kind: 'number' },
  },
  purchase: {
    'purchase.supplier': { label: 'Lieferant', kind: 'string' },
    'purchase.daysOverdue': { label: 'Tage überfällig', kind: 'number' },
    'purchase.totalNet': { label: 'Bestellwert netto', kind: 'number' },
  },
} as const;

export const CONDITION_OPS = {
  eq: 'ist gleich',
  neq: 'ist nicht',
  gt: 'größer als',
  gte: 'mindestens',
  lt: 'kleiner als',
  lte: 'höchstens',
  contains: 'enthält',
  in: 'ist eines von (Komma-getrennt)',
} as const;
export type ConditionOp = keyof typeof CONDITION_OPS;

export const WORKFLOW_ACTIONS = {
  set_order_status: 'Auftragsstatus setzen',
  set_shipping_method: 'Versandart setzen',
  notify: 'Mitarbeiter benachrichtigen',
  send_email: 'E-Mail senden',
  webhook: 'An Webhook senden',
} as const;
export type WorkflowActionType = keyof typeof WORKFLOW_ACTIONS;

const text = (max: number) => z.string().trim().max(max);

export const workflowActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('set_order_status'), status: z.string().max(40) }),
  z.object({ type: z.literal('set_shipping_method'), value: text(80).min(1) }),
  z.object({
    type: z.literal('notify'),
    /** Alle Personen mit diesem Recht werden benachrichtigt */
    permission: z.string().max(60).default('orders.read'),
    title: text(120).min(1),
    message: text(1000).default(''),
  }),
  z.object({
    type: z.literal('send_email'),
    to: z.string().trim().toLowerCase().pipe(z.email('Ungültige E-Mail-Adresse')),
    subject: text(200).min(1),
    message: text(5000).min(1),
  }),
  z.object({ type: z.literal('webhook'), webhookId: z.uuid() }),
]);
export type WorkflowAction = z.infer<typeof workflowActionSchema>;

export const workflowConditionSchema = z.object({
  field: z.string().max(60),
  op: z.enum(Object.keys(CONDITION_OPS) as [ConditionOp, ...ConditionOp[]]),
  value: z.string().max(500),
});

export const workflowDefinitionSchema = z
  .object({
    trigger: z.object({
      type: z.enum(Object.keys(WORKFLOW_TRIGGERS) as [WorkflowTrigger, ...WorkflowTrigger[]]),
      /** Nur bei Statuswechsel: Zielstatus (leer = jeder) */
      toStatus: z.string().max(40).optional().nullable(),
      schedule: z
        .object({
          every: z.enum(['hour', 'day']),
          /** Uhrzeit (Europe/Berlin) bei täglich */
          hour: z.number().int().min(0).max(23).default(7),
          check: z.enum(Object.keys(SCHEDULE_CHECKS) as [ScheduleCheck, ...ScheduleCheck[]]),
          /** orders_waiting: Status und Stunden */
          status: z.string().max(40).optional().nullable(),
          hours: z
            .number()
            .int()
            .min(1)
            .max(24 * 60)
            .optional()
            .nullable(),
        })
        .optional()
        .nullable(),
    }),
    match: z.enum(['all', 'any']).default('all'),
    conditions: z.array(workflowConditionSchema).max(20).default([]),
    actions: z.array(workflowActionSchema).min(1, 'Mindestens eine Aktion').max(10),
  })
  .refine((d) => d.trigger.type !== 'schedule' || !!d.trigger.schedule, {
    message: 'Zeitplan fehlt',
    path: ['trigger', 'schedule'],
  });
export type WorkflowDefinition = z.infer<typeof workflowDefinitionSchema>;

export const workflowInputSchema = z.object({
  name: z.string().trim().min(1, 'Name fehlt').max(120),
  active: z.boolean().default(false),
  definition: workflowDefinitionSchema,
});

export const workflowTestSchema = z.object({
  /** Auftrag, Artikel oder Bestellung, gegen die getestet wird */
  entityId: z.uuid(),
});

/** Kontextart eines Auslösers (für Bedingungsfelder). */
export function triggerContext(t: WorkflowDefinition['trigger']): keyof typeof CONDITION_FIELDS {
  if (t.type === 'stock.low') return 'article';
  if (t.type === 'schedule')
    return t.schedule?.check === 'low_stock'
      ? 'article'
      : t.schedule?.check === 'purchase_overdue'
        ? 'purchase'
        : 'order';
  return 'order';
}
