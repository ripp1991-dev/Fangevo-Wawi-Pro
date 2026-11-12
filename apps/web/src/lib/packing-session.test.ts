import { describe, expect, it } from 'vitest';
import {
  type PackItem,
  completeItems,
  isComplete,
  progress,
  removeUnit,
  scanArticle,
  scanSerial,
  typeWeight,
  weightForApi,
} from './packing-session';

const item = (over: Partial<PackItem> = {}): PackItem => ({
  orderLineId: 'L1',
  articleId: 'A1',
  articleNumber: 'ART-1',
  name: 'Wobbler',
  unit: 'Stk',
  setName: null,
  quantity: '2',
  trackBatches: false,
  trackSerials: false,
  barcodes: ['4001234567890', 'ART-1'],
  suggestedBatch: null,
  suggestedLocationId: null,
  ...over,
});

describe('Packen im Browser', () => {
  it('zählt Scans per EAN oder Artikelnummer (Groß/Klein egal) bis zur Sollmenge', () => {
    const items = [item()];
    const r1 = scanArticle(items, [], '4001234567890');
    expect(r1.kind).toBe('packed');
    const p1 = r1.kind === 'packed' ? r1.packed : [];
    const r2 = scanArticle(items, p1, ' art-1 ');
    expect(r2.kind).toBe('packed');
    const p2 = r2.kind === 'packed' ? r2.packed : [];
    expect(isComplete(items, p2)).toBe(true);
    expect(progress(items, p2)).toEqual({ done: 2, total: 2 });
    expect(scanArticle(items, p2, 'ART-1').kind).toBe('already_complete');
  });

  it('meldet fremde Artikel und füllt bei gleichen Artikeln zuerst die offene Position', () => {
    const items = [item({ quantity: '1' }), item({ orderLineId: 'L2', quantity: '1' })];
    expect(scanArticle(items, [], '999').kind).toBe('not_in_order');
    const r1 = scanArticle(items, [], 'ART-1');
    const p1 = r1.kind === 'packed' ? r1.packed : [];
    const r2 = scanArticle(items, p1, 'ART-1');
    expect(r2.kind === 'packed' && r2.item.orderLineId).toBe('L2');
  });

  it('fragt Seriennummern ab und lehnt doppelte ab', () => {
    const it = item({ trackSerials: true });
    expect(scanArticle([it], [], 'ART-1').kind).toBe('need_serial');
    const r = scanSerial([], it, 'SN1');
    const p = r.kind === 'packed' ? r.packed : [];
    expect(scanSerial(p, it, 'SN1').kind).toBe('duplicate_serial');
    const r2 = scanSerial(p, it, 'SN2');
    const p2 = r2.kind === 'packed' ? r2.packed : [];
    expect(completeItems(p2)).toHaveLength(2);
  });

  it('fasst gleiche Einheiten für den Abschluss zusammen und nimmt Einheiten zurück', () => {
    const items = [item({ quantity: '3' })];
    let p = scanArticle(items, [], 'ART-1');
    let packed = p.kind === 'packed' ? p.packed : [];
    p = scanArticle(items, packed, 'ART-1');
    packed = p.kind === 'packed' ? p.packed : [];
    expect(completeItems(packed)).toEqual([
      {
        orderLineId: 'L1',
        articleId: 'A1',
        quantity: '2',
        batch: null,
        serialNumber: null,
        locationId: null,
      },
    ]);
    expect(completeItems(removeUnit(packed, items[0]!))[0]!.quantity).toBe('1');
  });

  it('Zahlenfeld für das Gewicht', () => {
    let w = '';
    for (const k of ['1', ',', '2', '5', '0', '0']) w = typeWeight(w, k);
    expect(w).toBe('1,250');
    expect(typeWeight('', ',')).toBe('0,');
    expect(typeWeight('12,5', ',')).toBe('12,5');
    expect(typeWeight('1234', '5')).toBe('1234');
    expect(typeWeight('0', '7')).toBe('7');
    expect(typeWeight('1,2', 'back')).toBe('1,');
    expect(weightForApi('1,250')).toBe('1.250');
    expect(weightForApi('2,')).toBe('2');
    expect(weightForApi('')).toBe('0');
  });
});
