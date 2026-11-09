import { describe, expect, it } from 'vitest';
import {
  articleInputSchema,
  customerInputSchema,
  isValidGtin,
  money,
  taxRateInputSchema,
} from '../index';

describe('Stammdaten-Validierung', () => {
  it('prüft GTIN/EAN-Prüfziffern', () => {
    expect(isValidGtin('4006381333931')).toBe(true);
    expect(isValidGtin('4006381333932')).toBe(false);
    expect(isValidGtin('96385074')).toBe(true);
    expect(isValidGtin('abc')).toBe(false);
  });
  it('akzeptiert deutsche Kommazahlen, lehnt Gleitkomma-Unsinn ab', () => {
    expect(money.parse('12,5')).toBe('12.5');
    expect(money.parse(3)).toBe('3');
    expect(money.safeParse('-1').success).toBe(false);
    expect(money.safeParse('1.23456').success).toBe(false);
    expect(money.safeParse('1e5').success).toBe(false);
  });
  it('Steuersatz zwischen 0 und 100 %', () => {
    expect(taxRateInputSchema.parse({ name: 'Ermäßigt', rate: '7' }).rate).toBe('7');
    expect(taxRateInputSchema.safeParse({ name: 'X', rate: '101' }).success).toBe(false);
  });
  it('Artikel braucht Bezeichnung und gültige GTIN', () => {
    expect(articleInputSchema.safeParse({ name: '' }).success).toBe(false);
    expect(articleInputSchema.safeParse({ name: 'A', gtin: '4006381333932' }).success).toBe(false);
    const a = articleInputSchema.parse({ name: 'Angel', salePriceNet: '19,99' });
    expect(a.salePriceNet).toBe('19.99');
    expect(a.unit).toBe('Stück');
  });
  it('Geschäftskunde braucht Firmennamen, Privatkunde Nachnamen', () => {
    expect(customerInputSchema.safeParse({ type: 'business' }).success).toBe(false);
    expect(customerInputSchema.safeParse({ type: 'private', firstName: 'A' }).success).toBe(false);
    expect(
      customerInputSchema.safeParse({ type: 'private', lastName: 'Muster', email: '' }).success,
    ).toBe(true);
  });
});
