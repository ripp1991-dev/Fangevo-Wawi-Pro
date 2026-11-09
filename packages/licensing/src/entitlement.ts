import { type ModuleKey } from './catalog';

export type EntitlementStatus = 'TRIAL' | 'ACTIVE' | 'PAST_DUE' | 'SUSPENDED' | 'CANCELED';

/** Lizenzstand eines Accounts, wie er aus der Datenbank gelesen wird. */
export interface EntitlementSnapshot {
  status: EntitlementStatus;
  plan: string;
  modules: string[];
  /** Zusätzlich gebuchte Firmen über die inkludierten hinaus sind hier bereits eingerechnet. */
  maxCompanies: number;
  maxUsers: number | null;
  maxConnectors: number | null;
  trialEndsAt: Date | null;
  validUntil: Date | null;
}

export type AccessMode = 'full' | 'read_only' | 'none';

/**
 * Bestimmt, wie ein Account die Software nutzen darf.
 * - Fehlgeschlagene Zahlung (PAST_DUE) sperrt nicht sofort (Playbook 6.3).
 * - SUSPENDED / CANCELED / abgelaufen: nur lesender Zugriff, damit Abrechnung und
 *   Datenexport möglich bleiben. Es werden niemals Daten gelöscht.
 */
export function accessMode(e: EntitlementSnapshot, now: Date = new Date()): AccessMode {
  if (e.status === 'SUSPENDED' || e.status === 'CANCELED') return 'read_only';
  if (e.status === 'TRIAL' && e.trialEndsAt && e.trialEndsAt < now) return 'read_only';
  if (e.validUntil && e.validUntil < now) return 'read_only';
  return 'full';
}

export function hasModule(e: EntitlementSnapshot, module: ModuleKey): boolean {
  if (module === 'core') return true;
  return e.modules.includes(module);
}

export type LimitKind = 'companies' | 'users' | 'connectors';

export function limitFor(e: EntitlementSnapshot, kind: LimitKind): number | null {
  switch (kind) {
    case 'companies':
      return e.maxCompanies;
    case 'users':
      return e.maxUsers;
    case 'connectors':
      return e.maxConnectors;
  }
}

/** true, wenn bei `currentCount` vorhandenen Einträgen noch einer hinzukommen darf. */
export function canAdd(e: EntitlementSnapshot, kind: LimitKind, currentCount: number): boolean {
  const limit = limitFor(e, kind);
  return limit === null || currentCount < limit;
}
