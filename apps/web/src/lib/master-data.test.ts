import { describe, expect, it } from 'vitest';
import { categoryPaths, gross, toInput } from './master-data';

describe('Stammdaten-Helfer', () => {
  it('baut Kategoriepfade', () => {
    const p = categoryPaths([
      { id: 'a', name: 'Angeln', parentId: null, position: 0, archivedAt: null },
      { id: 'b', name: 'Ruten', parentId: 'a', position: 0, archivedAt: null },
    ]);
    expect(p.get('b')).toBe('Angeln › Ruten');
  });
  it('rechnet Brutto zur Anzeige und formatiert Eingaben deutsch', () => {
    expect(gross('10', '19')).toBe('11.90');
    expect(gross('49.9', '7')).toBe('53.39');
    expect(toInput('12.5')).toBe('12,5');
  });
});
