import {
  MODULES,
  MODULE_DETAILS,
  PLANS,
  YEARLY_MONTHS,
  isModuleKey,
  type ModuleKey,
  type PlanKey,
} from './catalog';
import { type EntitlementStatus } from './entitlement';

/**
 * Abo-Regeln (Phase 7). Reine Funktionen ohne Datenbank, damit sie in API, Plattform-Werkzeug
 * und Tests gleich wirken. Beträge in ganzen Cent (keine Gleitkommazahlen).
 */

export type BillingInterval = 'month' | 'year';
export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'canceled';
export type AddonStatus = 'trial' | 'active' | 'canceled';

/** Tage Zahlungsverzug, ab denen der Account in den Lesemodus geht (Playbook 6.3: nicht sofort sperren). */
export const SUSPEND_AFTER_OVERDUE_DAYS = 30;
/** Zahlungsziel von Plattform-Rechnungen. */
export const INVOICE_DUE_DAYS = 14;
export const ADDON_TRIAL_DAYS = 14;

export interface SubscriptionState {
  plan: string;
  interval: string;
  status: string;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  suspendedAt: Date | null;
  extraCompanies: number;
}

export interface AddonState {
  module: string;
  status: string;
  trialEndsAt: Date | null;
  endsAt: Date | null;
}

export function isPlanKey(v: string): v is PlanKey {
  return Object.prototype.hasOwnProperty.call(PLANS, v);
}

/** Paketpreis je Abrechnungszeitraum in Cent; null = individuell (Enterprise). */
export function planPriceCents(plan: string, interval: BillingInterval): number | null {
  if (!isPlanKey(plan)) return null;
  const m = PLANS[plan].monthlyPriceEur;
  if (m === null) return null;
  return m * 100 * (interval === 'year' ? YEARLY_MONTHS : 1);
}

/** Preis eines Zusatzmoduls je Abrechnungszeitraum in Cent; null = nicht einzeln buchbar. */
export function addonPriceCents(module: string, interval: BillingInterval): number | null {
  if (!isModuleKey(module)) return null;
  const m = MODULE_DETAILS[module].addonMonthlyEur;
  if (m === null) return null;
  return m * 100 * (interval === 'year' ? YEARLY_MONTHS : 1);
}

/** Kann das Modul zum Paket zugebucht werden? */
export function addonBookable(plan: string, module: string): boolean {
  if (!isModuleKey(module) || !isPlanKey(plan)) return false;
  if (!MODULES[module].available) return false;
  if ((PLANS[plan].modules as readonly ModuleKey[]).includes(module)) return false;
  return MODULE_DETAILS[module].addonMonthlyEur !== null;
}

export function addInterval(d: Date, interval: BillingInterval): Date {
  const r = new Date(d);
  if (interval === 'year') r.setUTCFullYear(r.getUTCFullYear() + 1);
  else r.setUTCMonth(r.getUTCMonth() + 1);
  return r;
}

const DAY = 86_400_000;

/**
 * Anteiliger Betrag für den Rest eines Zeitraums, auf ganze Tage gerechnet.
 * Ganzzahlige Rechnung: cents * restTage / gesamtTage, kaufmännisch gerundet.
 */
export function prorateCents(cents: number, now: Date, periodStart: Date, periodEnd: Date): number {
  const total = Math.max(1, Math.round((periodEnd.getTime() - periodStart.getTime()) / DAY));
  const rest = Math.min(total, Math.max(0, Math.ceil((periodEnd.getTime() - now.getTime()) / DAY)));
  return Math.floor((cents * rest * 2 + total) / (2 * total));
}

const EU = new Set([
  'AT',
  'BE',
  'BG',
  'CY',
  'CZ',
  'DE',
  'DK',
  'EE',
  'ES',
  'FI',
  'FR',
  'GR',
  'HR',
  'HU',
  'IE',
  'IT',
  'LT',
  'LU',
  'LV',
  'MT',
  'NL',
  'PL',
  'PT',
  'RO',
  'SE',
  'SI',
  'SK',
]);

/**
 * Umsatzsteuer für Leistungen von FangEvo (Sitz Deutschland) an Geschäftskunden.
 * VORLÄUFIG – muss vom Steuerberater bestätigt werden:
 * - Deutschland: 19 %
 * - EU mit USt-IdNr.: 0 %, Steuerschuldnerschaft des Leistungsempfängers (Reverse Charge)
 * - EU ohne USt-IdNr.: 19 % (vereinfachend; ggf. OSS mit Satz des Ziellandes)
 * - außerhalb der EU: 0 %, nicht im Inland steuerbar
 */
export function platformTax(
  country: string,
  vatId: string | null,
): { rate: number; note: string | null } {
  const c = country.toUpperCase();
  if (c === 'DE') return { rate: 19, note: null };
  if (EU.has(c)) {
    if (vatId && vatId.trim())
      return { rate: 0, note: 'Steuerschuldnerschaft des Leistungsempfängers (Reverse Charge).' };
    return { rate: 19, note: null };
  }
  return { rate: 0, note: 'Nicht im Inland steuerbare Leistung.' };
}

/** Ist ein Zusatzmodul zum Zeitpunkt `now` nutzbar? */
export function addonGrantsAccess(a: AddonState, now: Date): boolean {
  if (a.status === 'active') return true;
  if (a.status === 'trial') return !!a.trialEndsAt && a.trialEndsAt > now;
  if (a.status === 'canceled') return !!a.endsAt && a.endsAt > now;
  return false;
}

export interface ComputedEntitlement {
  plan: string;
  status: EntitlementStatus;
  modules: string[];
  maxCompanies: number;
  maxUsers: number | null;
  maxConnectors: number | null;
  validUntil: Date | null;
}

/**
 * Lizenz aus Abo und Zusatzmodulen. Das Abo ist die Quelle, die Lizenz wird daraus berechnet.
 * `overdueDays`: Tage seit Fälligkeit der ältesten offenen Rechnung (0 = keine überfällig).
 */
export function computeEntitlement(
  sub: SubscriptionState,
  addons: AddonState[],
  now: Date,
  overdueDays = 0,
): ComputedEntitlement {
  const plan = isPlanKey(sub.plan) ? PLANS[sub.plan] : PLANS.starter;
  const modules = new Set<string>(plan.modules);
  for (const a of addons)
    if (isModuleKey(a.module) && addonGrantsAccess(a, now)) modules.add(a.module);
  let status: EntitlementStatus;
  if (sub.suspendedAt) status = 'SUSPENDED';
  else if (sub.status === 'canceled') status = 'CANCELED';
  else if (sub.status === 'trialing') status = 'TRIAL';
  else if (sub.status === 'past_due')
    status = overdueDays > SUSPEND_AFTER_OVERDUE_DAYS ? 'SUSPENDED' : 'PAST_DUE';
  else status = 'ACTIVE';
  return {
    plan: isPlanKey(sub.plan) ? sub.plan : 'starter',
    status,
    modules: [...modules],
    maxCompanies: plan.maxCompanies + Math.max(0, sub.extraCompanies),
    maxUsers: plan.maxUsers,
    maxConnectors: plan.maxConnectors,
    validUntil:
      sub.status !== 'trialing' && sub.cancelAtPeriodEnd && sub.currentPeriodEnd
        ? sub.currentPeriodEnd
        : null,
  };
}

/** Rang eines Pakets nach Preis (für Hoch-/Herabstufung). Enterprise ganz oben. */
export function planRank(plan: string): number {
  if (!isPlanKey(plan)) return 0;
  return PLANS[plan].monthlyPriceEur ?? Number.MAX_SAFE_INTEGER;
}
