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
    permissions: ['companies.read'] as Permission[],
  },
} as const;
