import { describe, expect, it } from 'vitest';
import { normalizeHeader, suggestMapping } from './import';

describe('Import: Spaltenerkennung', () => {
  it('normalisiert Umlaute und Sonderzeichen', () => {
    expect(normalizeHeader('Ø Netto-EK')).toBe('nettoek');
    expect(normalizeHeader('Bestandsführung aktiv')).toBe('bestandsfuehrungaktiv');
  });

  it('erkennt Spalten einer Artikellisten-Ansicht (z. B. Warenwirtschafts-Export)', () => {
    const headers = [
      'Artikelnummer',
      'Letzter Bearbeiter',
      'Artikelname',
      'Bestandsführung aktiv',
      'Lagerbestand (gesamt)',
      'Netto-VK',
      'Ø Netto-EK',
    ];
    expect(suggestMapping('articles', headers)).toEqual({
      number: 0,
      name: 2,
      stockTracked: 3,
      salePriceNet: 5,
      purchasePriceNet: 6,
    });
  });

  it('erkennt den eigenen Lagerbestand für den Bestandsimport', () => {
    expect(
      suggestMapping('stock', ['Artikelnummer', 'Lagerbestand (gesamt)', 'Lagerbestand (eigen)']),
    ).toEqual({ article: 0, quantity: 2 });
  });
});
