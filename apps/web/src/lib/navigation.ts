import { type ComponentType } from 'react';
import {
  BadgeCheck,
  Building2,
  FileClock,
  LayoutDashboard,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Users,
} from 'lucide-react';
import { type Permission } from '@fangevo/shared';

export interface NavItem {
  /** Pfad, zugleich eindeutige ID für Einstellungen */
  to: string;
  label: string;
  group: 'main' | 'admin';
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
    to: '/admin/companies',
    label: 'Firmen',
    group: 'admin',
    icon: Building2,
    permission: 'companies.read',
    keywords: 'mandant filiale',
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

export const NAV_GROUPS = { main: undefined, admin: 'Administration' } as const;

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
