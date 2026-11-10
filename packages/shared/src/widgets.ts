import { z } from 'zod';
import { type Permission } from './permissions';

/**
 * Dashboard-Widgets. Jedes Widget nennt das benötigte Recht und seine Einstellungen.
 * Widgets mit Fachdaten (Umsatz, Bestände …) kommen mit den Fachmodulen ab Phase 3.
 */
export const WIDGETS = {
  quicklinks: {
    title: 'Schnellzugriffe',
    description: 'Häufige Aufgaben mit einem Klick',
    permission: null,
    minW: 3,
    minH: 2,
    defaultW: 6,
    defaultH: 2,
    config: z.object({}),
  },
  activity: {
    title: 'Letzte Aktivitäten',
    description: 'Wer hat wann was geändert',
    permission: 'audit.read',
    minW: 3,
    minH: 3,
    defaultW: 6,
    defaultH: 4,
    config: z.object({ limit: z.number().int().min(3).max(30).default(8) }),
  },
  notifications: {
    title: 'Benachrichtigungen',
    description: 'Ungelesene Benachrichtigungen',
    permission: null,
    minW: 3,
    minH: 3,
    defaultW: 4,
    defaultH: 4,
    config: z.object({}),
  },
  license: {
    title: 'Lizenz & Nutzung',
    description: 'Paket, Laufzeit und Auslastung',
    permission: 'license.read',
    minW: 3,
    minH: 3,
    defaultW: 4,
    defaultH: 3,
    config: z.object({}),
  },
  team: {
    title: 'Team',
    description: 'Benutzer und offene Einladungen',
    permission: 'users.read',
    minW: 3,
    minH: 3,
    defaultW: 4,
    defaultH: 3,
    config: z.object({}),
  },
  companies: {
    title: 'Firmen',
    description: 'Ihre aktiven Firmen',
    permission: 'companies.read',
    minW: 3,
    minH: 3,
    defaultW: 4,
    defaultH: 3,
    config: z.object({}),
  },
  low_stock: {
    title: 'Unter Mindestbestand',
    description: 'Artikel, die nachbestellt werden sollten (aktive Firma)',
    permission: 'inventory.read',
    minW: 3,
    minH: 3,
    defaultW: 6,
    defaultH: 4,
    config: z.object({}),
  },
  note: {
    title: 'Notiz',
    description: 'Persönlicher Notizzettel',
    permission: null,
    minW: 2,
    minH: 2,
    defaultW: 4,
    defaultH: 3,
    config: z.object({ text: z.string().max(4000).default('') }),
  },
} as const satisfies Record<
  string,
  {
    title: string;
    description: string;
    permission: Permission | null;
    minW: number;
    minH: number;
    defaultW: number;
    defaultH: number;
    config: z.ZodType;
  }
>;

export type WidgetType = keyof typeof WIDGETS;
export const WIDGET_TYPES = Object.keys(WIDGETS) as WidgetType[];
export const GRID_COLUMNS = 12;

export const widgetInstanceSchema = z
  .object({
    id: z.string().min(1).max(40),
    type: z.enum(WIDGET_TYPES as [WidgetType, ...WidgetType[]]),
    x: z
      .number()
      .int()
      .min(0)
      .max(GRID_COLUMNS - 1),
    y: z.number().int().min(0).max(1000),
    w: z.number().int().min(1).max(GRID_COLUMNS),
    h: z.number().int().min(1).max(20),
    config: z.record(z.string(), z.unknown()).default({}),
  })
  .transform((v, ctx) => {
    const def = WIDGETS[v.type];
    const cfg = def.config.safeParse(v.config);
    if (!cfg.success) {
      ctx.addIssue({
        code: 'custom',
        message: `Ungültige Einstellungen für Widget ${v.type}`,
        path: ['config'],
      });
      return z.NEVER;
    }
    return {
      ...v,
      w: Math.min(Math.max(v.w, def.minW), GRID_COLUMNS),
      h: Math.max(v.h, def.minH),
      x: Math.min(v.x, GRID_COLUMNS - 1),
      config: cfg.data as Record<string, unknown>,
    };
  });
export type WidgetInstance = z.infer<typeof widgetInstanceSchema>;

export const dashboardInputSchema = z.object({
  name: z.string().trim().min(1, 'Name fehlt').max(60),
  widgets: z.array(widgetInstanceSchema).max(30),
});
export type DashboardInput = z.infer<typeof dashboardInputSchema>;

/** Standard-Dashboard, wenn weder Benutzer noch Account eines festgelegt haben. */
export const DEFAULT_DASHBOARD: {
  name: string;
  widgets: Omit<WidgetInstance, 'config'>[] & { config: Record<string, unknown> }[];
} = {
  name: 'Übersicht',
  widgets: [
    { id: 'w1', type: 'quicklinks', x: 0, y: 0, w: 8, h: 2, config: {} },
    { id: 'w2', type: 'notifications', x: 8, y: 0, w: 4, h: 4, config: {} },
    { id: 'w3', type: 'activity', x: 0, y: 2, w: 8, h: 4, config: { limit: 8 } },
    { id: 'w4', type: 'license', x: 8, y: 4, w: 4, h: 3, config: {} },
  ],
};
