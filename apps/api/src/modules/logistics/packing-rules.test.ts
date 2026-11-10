import { describe, expect, it } from 'vitest';
import { checkRules, expandCategories, readRules } from './packing-rules';

const tree = [
  { id: 'sweets', parentId: null },
  { id: 'choc', parentId: 'sweets' },
  { id: 'dark', parentId: 'choc' },
  { id: 'cold', parentId: null },
];
const none = new Set<string>();

describe('Packregeln', () => {
  it('erweitert Kategorien um alle Unterkategorien', () => {
    expect([...expandCategories(['sweets'], tree)].sort()).toEqual(['choc', 'dark', 'sweets']);
    expect([...expandCategories(['cold'], tree)]).toEqual(['cold']);
    expect([...expandCategories([], tree)]).toEqual([]);
  });

  it('prüft Kanäle inkl. „ohne Kanal“', () => {
    const rules = { channelIds: ['amazon', 'none'] };
    expect(checkRules({ channelId: 'amazon', categoryIds: [] }, rules, none, none).ok).toBe(true);
    expect(checkRules({ channelId: null, categoryIds: [] }, rules, none, none).ok).toBe(true);
    expect(checkRules({ channelId: 'shopify', categoryIds: [] }, rules, none, none)).toEqual({
      ok: false,
      reason: 'channel',
    });
    expect(checkRules({ channelId: 'x', categoryIds: [] }, { channelIds: [] }, none, none).ok).toBe(
      true,
    );
  });

  it('„nur Kategorien“ verlangt, dass alle Positionen passen', () => {
    const inc = expandCategories(['sweets'], tree);
    const r = { channelIds: [] };
    expect(checkRules({ channelId: null, categoryIds: ['dark', 'choc'] }, r, inc, none).ok).toBe(
      true,
    );
    expect(checkRules({ channelId: null, categoryIds: ['dark', 'cold'] }, r, inc, none).ok).toBe(
      false,
    );
    expect(checkRules({ channelId: null, categoryIds: ['dark', null] }, r, inc, none).ok).toBe(
      false,
    );
    expect(checkRules({ channelId: null, categoryIds: [] }, r, inc, none).ok).toBe(false);
  });

  it('„ohne Kategorien“ blendet nur reine Aufträge aus, gemischte bleiben', () => {
    const exc = expandCategories(['cold'], tree);
    const r = { channelIds: [] };
    expect(checkRules({ channelId: null, categoryIds: ['cold'] }, r, none, exc).ok).toBe(false);
    expect(checkRules({ channelId: null, categoryIds: ['cold', 'choc'] }, r, none, exc).ok).toBe(
      true,
    );
    expect(checkRules({ channelId: null, categoryIds: [null] }, r, none, exc).ok).toBe(true);
  });

  it('liest fehlende oder kaputte Regeln als „alles erlaubt“', () => {
    expect(readRules({})).toMatchObject({ channelIds: [], categoryIds: [], mismatch: 'warn' });
    expect(readRules(null).locked).toBe(false);
    expect(readRules({ rules: { channelIds: 'kaputt' } }).channelIds).toEqual([]);
  });
});
