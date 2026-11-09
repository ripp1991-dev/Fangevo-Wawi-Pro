/**
 * Modul- und Paketkatalog.
 *
 * `available: false` bedeutet: Das Modul ist geplant, aber noch NICHT implementiert.
 * Es kann zwar lizenziert werden (für Planung/Vertrieb), die Oberfläche zeigt es
 * aber als "in Entwicklung" an. Siehe Playbook-Regel: keine Dummy-Funktionen als fertig ausgeben.
 */
export const MODULES = {
  core: { name: 'FangEvo Core', phase: 1, available: true },
  dashboard: { name: 'Dashboard', phase: 2, available: false },
  articles: { name: 'Artikel', phase: 3, available: true },
  customers: { name: 'Kunden', phase: 3, available: true },
  suppliers: { name: 'Lieferanten', phase: 3, available: true },
  orders: { name: 'Aufträge', phase: 3, available: true },
  inventory: { name: 'Lager', phase: 3, available: true },
  documents: { name: 'Dokumente', phase: 3, available: true },
  purchasing: { name: 'Einkauf', phase: 3, available: true },
  packing: { name: 'FangEvo Pack', phase: 4, available: true },
  shipping: { name: 'Versand', phase: 4, available: true },
  returns: { name: 'Retouren', phase: 4, available: true },
  import: { name: 'FangEvo Import', phase: 5, available: true },
  multichannel: { name: 'Multichannel', phase: 5, available: true },
  finance: { name: 'Finanzen', phase: 5, available: false },
  api: { name: 'Öffentliche API', phase: 5, available: true },
  automation: { name: 'Automatisierung', phase: 6, available: true },
  crm: { name: 'CRM', phase: 6, available: false },
  analytics: { name: 'Analytics', phase: 6, available: false },
  marketplace: { name: 'Marketplace', phase: 7, available: false },
} as const;

export type ModuleKey = keyof typeof MODULES;
export const ALL_MODULES = Object.keys(MODULES) as ModuleKey[];

export function isModuleKey(v: string): v is ModuleKey {
  return Object.prototype.hasOwnProperty.call(MODULES, v);
}

const BASE: ModuleKey[] = [
  'core',
  'dashboard',
  'articles',
  'customers',
  'suppliers',
  'orders',
  'inventory',
  'documents',
];

/**
 * Pakete laut Playbook 6.1. Preise und Modulzuordnung sind VORLÄUFIG und müssen
 * kalkuliert werden. Benutzerlimits sind im Playbook nicht festgelegt (null = kein Limit).
 */
export const PLANS = {
  starter: {
    name: 'Starter',
    monthlyPriceEur: 199,
    modules: BASE,
    maxCompanies: 3,
    maxUsers: null,
    maxConnectors: null,
  },
  business: {
    name: 'Business',
    monthlyPriceEur: 299,
    modules: [...BASE, 'purchasing', 'packing', 'shipping', 'returns', 'import'] as ModuleKey[],
    maxCompanies: 3,
    maxUsers: null,
    maxConnectors: null,
  },
  professional: {
    name: 'Professional',
    monthlyPriceEur: 499,
    modules: [
      ...BASE,
      'purchasing',
      'packing',
      'shipping',
      'returns',
      'import',
      'multichannel',
      'finance',
      'api',
      'automation',
      'crm',
      'analytics',
    ] as ModuleKey[],
    maxCompanies: 3,
    maxUsers: null,
    maxConnectors: null,
  },
  enterprise: {
    name: 'Enterprise',
    monthlyPriceEur: null,
    modules: ALL_MODULES,
    maxCompanies: 3,
    maxUsers: null,
    maxConnectors: null,
  },
} as const satisfies Record<
  string,
  {
    name: string;
    monthlyPriceEur: number | null;
    modules: readonly ModuleKey[];
    maxCompanies: number;
    maxUsers: number | null;
    maxConnectors: number | null;
  }
>;

export type PlanKey = keyof typeof PLANS;
export const DEFAULT_TRIAL_DAYS = 14;
export const INCLUDED_COMPANIES = 3;
