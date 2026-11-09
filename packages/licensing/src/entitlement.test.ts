import { describe, expect, it } from 'vitest';
import { accessMode, canAdd, hasModule, type EntitlementSnapshot } from './entitlement';
import { ALL_MODULES, PLANS, isModuleKey } from './catalog';

const base: EntitlementSnapshot = {
  status: 'ACTIVE',
  plan: 'starter',
  modules: ['core', 'articles'],
  maxCompanies: 3,
  maxUsers: null,
  maxConnectors: 2,
  trialEndsAt: null,
  validUntil: null,
};
const now = new Date('2026-11-09T12:00:00Z');

describe('accessMode', () => {
  it('aktiv = voller Zugriff', () => expect(accessMode(base, now)).toBe('full'));
  it('Zahlungsverzug sperrt nicht sofort', () => expect(accessMode({ ...base, status: 'PAST_DUE' }, now)).toBe('full'));
  it('gesperrt = nur lesen (Export bleibt möglich)', () => {
    expect(accessMode({ ...base, status: 'SUSPENDED' }, now)).toBe('read_only');
    expect(accessMode({ ...base, status: 'CANCELED' }, now)).toBe('read_only');
  });
  it('abgelaufener Test = nur lesen', () => {
    expect(accessMode({ ...base, status: 'TRIAL', trialEndsAt: new Date('2026-11-01') }, now)).toBe('read_only');
    expect(accessMode({ ...base, status: 'TRIAL', trialEndsAt: new Date('2026-12-01') }, now)).toBe('full');
  });
  it('abgelaufene Laufzeit = nur lesen', () => {
    expect(accessMode({ ...base, validUntil: new Date('2026-11-08') }, now)).toBe('read_only');
  });
});

describe('Module und Limits', () => {
  it('core ist immer enthalten', () => expect(hasModule({ ...base, modules: [] }, 'core')).toBe(true));
  it('nicht gebuchtes Modul fehlt', () => expect(hasModule(base, 'orders')).toBe(false));
  it('Firmenlimit greift bei 3', () => {
    expect(canAdd(base, 'companies', 2)).toBe(true);
    expect(canAdd(base, 'companies', 3)).toBe(false);
  });
  it('null = unbegrenzt', () => expect(canAdd(base, 'users', 10_000)).toBe(true));
  it('Pakete verwenden nur bekannte Module und 3 inkludierte Firmen', () => {
    for (const p of Object.values(PLANS)) {
      expect(p.maxCompanies).toBe(3);
      for (const m of p.modules) expect(isModuleKey(m)).toBe(true);
    }
    expect(ALL_MODULES).toContain('core');
  });
});
