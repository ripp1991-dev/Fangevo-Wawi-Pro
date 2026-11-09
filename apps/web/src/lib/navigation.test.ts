import { describe, expect, it } from 'vitest';
import { allowedItems, applyOrder } from './navigation';

describe('Navigation', () => {
  it('zeigt nur Einträge mit Recht', () => {
    const items = allowedItems(new Set(['companies.read']), new Set(['core']));
    expect(items.map((i) => i.to)).toEqual(['/', '/admin/companies']);
  });
  it('wendet persönliche Reihenfolge an', () => {
    const items = allowedItems(new Set(['companies.read', 'users.read']), new Set());
    expect(applyOrder(items, ['/admin/members', '/']).map((i) => i.to)).toEqual([
      '/admin/members',
      '/',
      '/admin/companies',
    ]);
  });
});
