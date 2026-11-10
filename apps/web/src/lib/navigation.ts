import { type ComponentType } from 'react';
import {
  BadgeCheck,
  Boxes,
  Building2,
  FileUp,
  KeyRound,
  Store,
  ListChecks,
  PackageCheck,
  ScanLine,
  Undo2,
  ClipboardList,
  FileText,
  FileClock,
  LayoutDashboard,
  Package,
  Settings,
  Settings2,
  ShieldCheck,
  ShoppingCart,
  SlidersHorizontal,
  Truck,
  UserRound,
  Users,
} from 'lucide-react';
import { type Permission } from '@fangevo/shared';

export interface NavItem {
  /** Pfad, zugleich eindeutige ID für Einstellungen */
  to: string;
  label: string;
  group: 'main' | 'wawi' | 'admin';
  icon: ComponentType<{ className?: string }>;
  permission?: Permission;
  /** Lizenzmodul (ab Phase 3 relevant, z. B. "articles") */
  module?: string;
  keywords?: string;
}

/**
 * Zentrale Menü-Registrierung. Fachmodule ergänzen hier ihre Einträge (ab Phase 3).
 * Sichtbar ist ein Eintrag nur mit passendem Recht und gebuchtem Modul.
 */
export const NAV_ITEMS: NavItem[] = [
  {
    to: '/',
    label: 'Übersicht',
    group: 'main',
    icon: LayoutDashboard,
    keywords: 'dashboard start',
  },
  {
    to: '/orders',
    label: 'Aufträge',
    group: 'wawi',
    icon: ShoppingCart,
    permission: 'orders.read',
    module: 'orders',
    keywords: 'bestellungen verkauf versand',
  },
  {
    to: '/documents',
    label: 'Belege',
    group: 'wawi',
    icon: FileText,
    permission: 'documents.read',
    module: 'documents',
    keywords: 'rechnungen angebote lieferscheine gutschriften zahlungen',
  },
  {
    to: '/articles',
    label: 'Artikel',
    group: 'wawi',
    icon: Package,
    permission: 'articles.read',
    module: 'articles',
    keywords: 'produkte sortiment ean',
  },
  {
    to: '/customers',
    label: 'Kunden',
    group: 'wawi',
    icon: UserRound,
    permission: 'customers.read',
    module: 'customers',
    keywords: 'käufer debitoren',
  },
  {
    to: '/suppliers',
    label: 'Lieferanten',
    group: 'wawi',
    icon: Truck,
    permission: 'suppliers.read',
    module: 'suppliers',
    keywords: 'kreditoren einkauf',
  },
  {
    to: '/purchasing',
    label: 'Einkauf',
    group: 'wawi',
    icon: ClipboardList,
    permission: 'purchasing.read',
    module: 'purchasing',
    keywords: 'bestellvorschläge wareneingang lieferanten bestellen',
  },
  {
    to: '/picking',
    label: 'Kommissionierung',
    group: 'wawi',
    icon: ListChecks,
    permission: 'picking.execute',
    module: 'inventory',
    keywords: 'picklisten picken lager',
  },
  {
    to: '/packing',
    label: 'Packtisch',
    group: 'wawi',
    icon: PackageCheck,
    permission: 'packing.execute',
    module: 'packing',
    keywords: 'packen versand etikett sendungen',
  },
  {
    to: '/returns',
    label: 'Retouren',
    group: 'wawi',
    icon: Undo2,
    permission: 'returns.read',
    module: 'returns',
    keywords: 'rücksendung gutschrift',
  },
  {
    to: '/scan',
    label: 'Scannen (mobil)',
    group: 'wawi',
    icon: ScanLine,
    permission: 'inventory.read',
    module: 'inventory',
    keywords: 'barcode scanner handy lagerplatz',
  },
  {
    to: '/import',
    label: 'Import & Export',
    group: 'wawi',
    icon: FileUp,
    permission: 'import.execute',
    module: 'import',
    keywords: 'csv excel jtl datenübernahme export',
  },
  {
    to: '/channels',
    label: 'Verkaufskanäle',
    group: 'wawi',
    icon: Store,
    permission: 'channels.read',
    module: 'multichannel',
    keywords: 'shop marktplatz amazon ebay schnittstelle',
  },
  {
    to: '/inventory',
    label: 'Lager & Bestand',
    group: 'wawi',
    icon: Boxes,
    permission: 'inventory.read',
    module: 'inventory',
    keywords: 'bestand inventur umlagerung',
  },
  {
    to: '/admin/api-keys',
    label: 'API-Schlüssel',
    group: 'admin',
    icon: KeyRound,
    permission: 'api_keys.manage',
    module: 'api',
    keywords: 'schnittstelle token entwickler',
  },
  {
    to: '/admin/companies',
    label: 'Firmen',
    group: 'admin',
    icon: Building2,
    permission: 'companies.read',
    keywords: 'mandant filiale',
  },
  {
    to: '/company-settings',
    label: 'Firmeneinstellungen',
    group: 'admin',
    icon: Settings2,
    permission: 'company_settings.manage',
    keywords: 'steuer nummernkreis kundengruppe kategorie lager',
  },
  {
    to: '/admin/members',
    label: 'Benutzer',
    group: 'admin',
    icon: Users,
    permission: 'users.read',
    keywords: 'mitarbeiter team einladen',
  },
  {
    to: '/admin/roles',
    label: 'Rollen & Rechte',
    group: 'admin',
    icon: ShieldCheck,
    permission: 'roles.read',
    keywords: 'berechtigung',
  },
  {
    to: '/admin/custom-fields',
    label: 'Eigene Felder',
    group: 'admin',
    icon: SlidersHorizontal,
    permission: 'custom_fields.manage',
    keywords: 'zusatzfelder attribute',
  },
  {
    to: '/admin/audit',
    label: 'Audit-Log',
    group: 'admin',
    icon: FileClock,
    permission: 'audit.read',
    keywords: 'protokoll verlauf',
  },
  {
    to: '/admin/license',
    label: 'Lizenz',
    group: 'admin',
    icon: BadgeCheck,
    permission: 'license.read',
    keywords: 'paket abo',
  },
  {
    to: '/admin/account',
    label: 'Account',
    group: 'admin',
    icon: Settings,
    permission: 'account.manage',
    keywords: 'einstellungen',
  },
];

export const NAV_GROUPS = {
  main: undefined,
  wawi: 'Warenwirtschaft',
  admin: 'Administration',
} as const;

export interface NavPreference {
  hidden: string[];
  order: string[];
  favorites: string[];
}

export function allowedItems(perms: Set<string>, modules: Set<string>): NavItem[] {
  return NAV_ITEMS.filter(
    (i) => (!i.permission || perms.has(i.permission)) && (!i.module || modules.has(i.module)),
  );
}

/** Persönliche Reihenfolge anwenden (innerhalb der Gruppen). */
export function applyOrder(items: NavItem[], order: string[]): NavItem[] {
  const pos = (to: string) => {
    const i = order.indexOf(to);
    return i === -1 ? 1000 + NAV_ITEMS.findIndex((n) => n.to === to) : i;
  };
  return [...items].sort((a, b) => pos(a.to) - pos(b.to));
}
