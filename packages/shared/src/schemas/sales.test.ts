import { describe, expect, it } from 'vitest';
import {
  ORDER_STATUSES,
  ORDER_TRANSITIONS,
  canTransition,
  isValidIban,
  type OrderStatus,
} from '../index';

describe('Auftragsstatus', () => {
  it('erlaubt nur definierte Wechsel', () => {
    expect(canTransition('new', 'in_progress')).toBe(true);
    expect(canTransition('new', 'shipped')).toBe(false);
    expect(canTransition('shipped', 'new')).toBe(false);
    expect(canTransition('cancelled', 'in_progress')).toBe(false);
  });
  it('alle Zielstatus sind bekannt', () => {
    for (const targets of Object.values(ORDER_TRANSITIONS))
      for (const t of targets) expect(Object.keys(ORDER_STATUSES)).toContain(t as OrderStatus);
  });
});

describe('IBAN', () => {
  it('prüft die Prüfziffer', () => {
    expect(isValidIban('DE89370400440532013000')).toBe(true);
    expect(isValidIban('DE89370400440532013001')).toBe(false);
  });
});
