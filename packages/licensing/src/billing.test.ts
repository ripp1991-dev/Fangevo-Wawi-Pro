import { describe, expect, it } from 'vitest';
import {
  addInterval,
  addonBookable,
  addonGrantsAccess,
  addonPriceCents,
  computeEntitlement,
  planPriceCents,
  platformTax,
  prorateCents,
  type SubscriptionState,
} from './billing';

const now = new Date('2026-11-09T12:00:00Z');
const sub: SubscriptionState = {
  plan: 'business',
  interval: 'month',
  status: 'active',
  currentPeriodEnd: new Date('2026-12-01T00:00:00Z'),
  cancelAtPeriodEnd: false,
  suspendedAt: null,
  extraCompanies: 0,
};

describe('Preise', () => {
  it('Jahrespreis = 10 Monate, Enterprise individuell', () => {
    expect(planPriceCents('business', 'month')).toBe(29_900);
    expect(planPriceCents('business', 'year')).toBe(299_000);
    expect(planPriceCents('enterprise', 'month')).toBeNull();
    expect(planPriceCents('gibt-es-nicht', 'month')).toBeNull();
    expect(addonPriceCents('automation', 'month')).toBe(7_900);
    expect(addonPriceCents('crm', 'month')).toBeNull();
  });
  it('Zusatzmodule nur, wenn verfügbar, preislich festgelegt und nicht im Paket', () => {
    expect(addonBookable('starter', 'purchasing')).toBe(true);
    expect(addonBookable('business', 'purchasing')).toBe(false);
    expect(addonBookable('starter', 'crm')).toBe(false);
    expect(addonBookable('starter', 'core')).toBe(false);
  });
  it('anteilige Berechnung auf ganze Tage, ohne Gleitkomma-Reste', () => {
    const s = new Date('2026-11-01T00:00:00Z');
    const e = new Date('2026-12-01T00:00:00Z');
    expect(prorateCents(3000, s, s, e)).toBe(3000);
    expect(prorateCents(3000, e, s, e)).toBe(0);
    expect(prorateCents(3000, new Date('2026-11-16T00:00:00Z'), s, e)).toBe(1500);
    expect(prorateCents(1000, new Date('2026-11-21T00:00:00Z'), s, e)).toBe(333);
  });
  it('Laufzeiten', () => {
    expect(addInterval(new Date('2026-01-31T00:00:00Z'), 'year').toISOString()).toBe(
      '2027-01-31T00:00:00.000Z',
    );
    expect(addInterval(new Date('2026-11-09T00:00:00Z'), 'month').toISOString()).toBe(
      '2026-12-09T00:00:00.000Z',
    );
  });
});

describe('Umsatzsteuer (vorläufig)', () => {
  it('DE 19 %, EU mit USt-IdNr. Reverse Charge, Drittland 0 %', () => {
    expect(platformTax('DE', null).rate).toBe(19);
    expect(platformTax('AT', 'ATU12345678')).toMatchObject({ rate: 0 });
    expect(platformTax('AT', null).rate).toBe(19);
    expect(platformTax('CH', null).rate).toBe(0);
  });
});

describe('Lizenz aus Abo', () => {
  it('Paketmodule plus aktive und laufende Zusatzmodule', () => {
    const e = computeEntitlement(
      { ...sub, plan: 'starter' },
      [
        {
          module: 'purchasing',
          status: 'trial',
          trialEndsAt: new Date('2026-11-20'),
          endsAt: null,
        },
        { module: 'import', status: 'trial', trialEndsAt: new Date('2026-11-01'), endsAt: null },
        {
          module: 'shipping',
          status: 'canceled',
          trialEndsAt: null,
          endsAt: new Date('2026-12-01'),
        },
        {
          module: 'returns',
          status: 'canceled',
          trialEndsAt: null,
          endsAt: new Date('2026-11-01'),
        },
        { module: 'api', status: 'active', trialEndsAt: null, endsAt: null },
      ],
      now,
    );
    expect(e.modules).toEqual(expect.arrayContaining(['core', 'purchasing', 'shipping', 'api']));
    expect(e.modules).not.toContain('import');
    expect(e.modules).not.toContain('returns');
    expect(e.status).toBe('ACTIVE');
  });
  it('Status: Test, Verzug erst nach 30 Tagen gesperrt, Kündigung zum Laufzeitende', () => {
    expect(computeEntitlement({ ...sub, status: 'trialing' }, [], now).status).toBe('TRIAL');
    expect(computeEntitlement({ ...sub, status: 'past_due' }, [], now, 10).status).toBe('PAST_DUE');
    expect(computeEntitlement({ ...sub, status: 'past_due' }, [], now, 31).status).toBe(
      'SUSPENDED',
    );
    expect(computeEntitlement({ ...sub, suspendedAt: now }, [], now).status).toBe('SUSPENDED');
    expect(computeEntitlement({ ...sub, status: 'canceled' }, [], now).status).toBe('CANCELED');
    expect(computeEntitlement({ ...sub, cancelAtPeriodEnd: true }, [], now).validUntil).toEqual(
      sub.currentPeriodEnd,
    );
    expect(computeEntitlement({ ...sub, extraCompanies: 2 }, [], now).maxCompanies).toBe(5);
  });
  it('Testmodul nach Ablauf nicht mehr nutzbar', () => {
    expect(
      addonGrantsAccess({ module: 'api', status: 'trial', trialEndsAt: now, endsAt: null }, now),
    ).toBe(false);
  });
});
