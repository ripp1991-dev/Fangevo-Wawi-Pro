/**
 * Zentraler Rechtekatalog. Jedes Recht gehört zu genau einem Modul.
 * Neue Module ergänzen hier ihre Rechte. Das Frontend nutzt denselben Katalog
 * für die Rollenverwaltung, die Prüfung erfolgt aber immer serverseitig.
 */
export const PERMISSIONS = {
  'companies.read': { module: 'core', label: 'Firmen ansehen' },
  'companies.manage': { module: 'core', label: 'Firmen anlegen, bearbeiten und archivieren' },
  'users.read': { module: 'core', label: 'Benutzer ansehen' },
  'users.manage': { module: 'core', label: 'Benutzer einladen, sperren und Rechte vergeben' },
  'roles.read': { module: 'core', label: 'Rollen ansehen' },
  'roles.manage': { module: 'core', label: 'Rollen anlegen, bearbeiten und löschen' },
  'audit.read': { module: 'core', label: 'Audit-Log ansehen' },
  'license.read': { module: 'core', label: 'Lizenz und Limits ansehen' },
  'account.manage': {
    module: 'core',
    label: 'Account-Einstellungen und Standard-Ansichten bearbeiten',
  },
  'custom_fields.manage': { module: 'core', label: 'Eigene Felder anlegen und bearbeiten' },
  'company_settings.manage': {
    module: 'core',
    label: 'Firmeneinstellungen: Steuersätze, Nummernkreise, Kundengruppen, Kategorien, Lager',
  },
  'articles.read': { module: 'articles', label: 'Artikel ansehen' },
  'articles.manage': { module: 'articles', label: 'Artikel anlegen, bearbeiten und archivieren' },
  'articles.prices': { module: 'articles', label: 'Einkaufspreise sehen und Preise ändern' },
  'customers.read': { module: 'customers', label: 'Kunden ansehen' },
  'customers.manage': { module: 'customers', label: 'Kunden anlegen, bearbeiten und sperren' },
  'suppliers.read': { module: 'suppliers', label: 'Lieferanten ansehen' },
  'suppliers.manage': {
    module: 'suppliers',
    label: 'Lieferanten und Lieferanten-Artikel bearbeiten',
  },
  'inventory.read': { module: 'inventory', label: 'Lagerbestände ansehen' },
  'inventory.manage': {
    module: 'inventory',
    label: 'Bestände buchen (Zugang, Abgang, Umlagerung, Korrektur)',
  },
  'orders.read': { module: 'orders', label: 'Aufträge ansehen' },
  'orders.manage': {
    module: 'orders',
    label: 'Aufträge anlegen, bearbeiten, Status ändern und versenden',
  },
  'documents.read': { module: 'documents', label: 'Belege ansehen und herunterladen' },
  'documents.manage': {
    module: 'documents',
    label: 'Belege erstellen, festschreiben, versenden und Zahlungen erfassen',
  },
  'purchasing.read': { module: 'purchasing', label: 'Einkauf ansehen' },
  'purchasing.manage': {
    module: 'purchasing',
    label: 'Bestellungen anlegen, versenden und Wareneingang buchen',
  },
  'picking.execute': {
    module: 'inventory',
    label: 'Picklisten erstellen und kommissionieren',
  },
  'packing.execute': { module: 'packing', label: 'Am Packtisch packen und Sendungen erstellen' },
  'shipping.manage': {
    module: 'shipping',
    label: 'Packplätze und Versandarten einrichten, Sendungen ansehen',
  },
  'returns.read': { module: 'returns', label: 'Retouren ansehen' },
  'returns.manage': {
    module: 'returns',
    label: 'Retouren anlegen, Wareneingang buchen und Gutschriften auslösen',
  },
  'import.execute': {
    module: 'import',
    label: 'Daten importieren und exportieren (FangEvo Import)',
  },
  'api_keys.manage': { module: 'api', label: 'API-Schlüssel anlegen und sperren' },
  'channels.read': { module: 'multichannel', label: 'Verkaufskanäle ansehen' },
  'channels.manage': {
    module: 'multichannel',
    label: 'Verkaufskanäle einrichten und Artikel je Kanal pflegen',
  },
  'webhooks.manage': { module: 'api', label: 'Webhooks einrichten und Zustellungen ansehen' },
  'workflows.read': { module: 'automation', label: 'Regeln und Ausführungsprotokoll ansehen' },
  'workflows.manage': { module: 'automation', label: 'Regeln anlegen, ändern und aktivieren' },
} as const satisfies Record<string, { module: string; label: string }>;

export type Permission = keyof typeof PERMISSIONS;

export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

export function isPermission(value: string): value is Permission {
  return Object.prototype.hasOwnProperty.call(PERMISSIONS, value);
}

export function permissionModule(permission: Permission): string {
  return PERMISSIONS[permission].module;
}

/**
 * Systemrollen, die bei jedem neuen Account angelegt werden. Ihre Rechte werden zur Laufzeit
 * aus dieser Definition gelesen, damit neue Rechte automatisch bei allen Accounts wirken.
 */
export const SYSTEM_ROLES = {
  administrator: {
    name: 'Administrator',
    description: 'Voller Zugriff auf die Administration',
    permissions: ALL_PERMISSIONS,
  },
  employee: {
    name: 'Mitarbeiter',
    description: 'Grundzugriff ohne Administrationsrechte',
    permissions: [
      'companies.read',
      'articles.read',
      'customers.read',
      'suppliers.read',
      'inventory.read',
      'orders.read',
      'documents.read',
      'purchasing.read',
      'returns.read',
    ] as Permission[],
  },
} as const;
