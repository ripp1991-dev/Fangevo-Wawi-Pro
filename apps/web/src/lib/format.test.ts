import { describe, expect, it } from 'vitest';
import { daysUntil, formatDate } from './format';

describe('format', () => {
  it('formatiert Datum deutsch und behandelt leere Werte', () => {
    expect(formatDate('2026-11-09T10:00:00Z')).toMatch(/09\.11\.2026|9\. Nov\. 2026/);
    expect(formatDate(null)).toBe('–');
  });
  it('berechnet verbleibende Tage', () => {
    expect(daysUntil(new Date(Date.now() + 2.5 * 86_400_000).toISOString())).toBe(3);
    expect(daysUntil(null)).toBeNull();
  });
});
