/**
 * Modul- und Paketkatalog.
 *
 * `available: false` bedeutet: Das Modul ist geplant, aber noch NICHT implementiert.
 * Es kann zwar lizenziert werden (für Planung/Vertrieb), die Oberfläche zeigt es
 * aber als "in Entwicklung" an. Siehe Playbook-Regel: keine Dummy-Funktionen als fertig ausgeben.
 */
export const MODULES = {
  core: { name: 'FangEvo Core', phase: 1, available: true },
  dashboard: { name: 'Dashboard', phase: 2, available: true },
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
  marketplace: { name: 'Marketplace', phase: 7, available: true },
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
  // Marketplace (Modulübersicht und Zubuchen) ist in jedem Paket enthalten
  'marketplace',
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

/**
 * Marketplace-Angaben je Modul (Phase 7). Preise für Zusatzmodule sind VORLÄUFIG
 * und müssen von FangEvo kalkuliert werden. `null` = nicht einzeln buchbar (nur im Paket).
 */
export const MODULE_DETAILS: Record<
  ModuleKey,
  { description: string; addonMonthlyEur: number | null; version: string }
> = {
  core: {
    description: 'Accounts, Firmen, Benutzer, Rollen, Sicherheit, Audit-Log',
    addonMonthlyEur: null,
    version: '1.0',
  },
  dashboard: {
    description: 'Anpassbare Startseite, Tabellen, Suche, Benachrichtigungen',
    addonMonthlyEur: null,
    version: '1.0',
  },
  articles: {
    description: 'Artikel mit Preisen, Varianten, Sets, Barcodes',
    addonMonthlyEur: null,
    version: '1.1',
  },
  customers: {
    description: 'Kunden mit Adressen, Gruppen, Sperren',
    addonMonthlyEur: null,
    version: '1.0',
  },
  suppliers: {
    description: 'Lieferanten mit Bezugsquellen',
    addonMonthlyEur: null,
    version: '1.0',
  },
  orders: {
    description: 'Aufträge mit Preisermittlung, Reservierung, Versand',
    addonMonthlyEur: null,
    version: '1.1',
  },
  inventory: {
    description: 'Lager mit Chargen, Seriennummern, Picklisten, mobilem Scanner',
    addonMonthlyEur: null,
    version: '1.1',
  },
  documents: {
    description: 'Belege mit PDF, E-Mail-Versand, Zahlungen',
    addonMonthlyEur: null,
    version: '1.0',
  },
  purchasing: {
    description: 'Bestellvorschläge, Bestellungen, Wareneingang',
    addonMonthlyEur: 49,
    version: '1.0',
  },
  packing: {
    description: 'FangEvo Pack: Packtisch mit Scan-Prüfung',
    addonMonthlyEur: 49,
    version: '1.0',
  },
  shipping: { description: 'Sendungen und Etiketten', addonMonthlyEur: 29, version: '1.0' },
  returns: {
    description: 'Retouren mit Einlagerung und Gutschrift',
    addonMonthlyEur: 29,
    version: '1.0',
  },
  import: {
    description: 'FangEvo Import: CSV/Excel mit Prüflauf, Export',
    addonMonthlyEur: 39,
    version: '1.0',
  },
  multichannel: {
    description: 'Verkaufskanäle (eigener Shop über API; Marktplätze folgen)',
    addonMonthlyEur: 79,
    version: '1.0',
  },
  finance: { description: 'Finanzen (in Planung)', addonMonthlyEur: null, version: '0' },
  api: {
    description: 'Öffentliche API mit Schlüsseln und Webhooks',
    addonMonthlyEur: 49,
    version: '1.0',
  },
  automation: {
    description: 'Regeln „Wenn – dann“, zeitgesteuerte Prüfungen',
    addonMonthlyEur: 79,
    version: '1.0',
  },
  crm: { description: 'CRM (in Planung)', addonMonthlyEur: null, version: '0' },
  analytics: { description: 'Analytics (in Planung)', addonMonthlyEur: null, version: '0' },
  marketplace: { description: 'Marketplace', addonMonthlyEur: null, version: '1.0' },
};

/** Jahrespreis = 10 Monatspreise (2 Monate gratis) – VORLÄUFIG. */
export const YEARLY_MONTHS = 10;
