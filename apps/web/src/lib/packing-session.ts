/**
 * Packlogik im Browser (ohne Oberfläche): Scans einem Auftrag zuordnen, Mengen zählen,
 * Seriennummern abfragen und die Daten für den Abschluss bündeln.
 * Die verbindliche Prüfung macht immer die API beim Abschluss (PackingService.verify).
 */

export interface PackItem {
  orderLineId: string;
  articleId: string;
  articleNumber: string;
  name: string;
  unit: string;
  setName: string | null;
  quantity: string;
  trackBatches: boolean;
  trackSerials: boolean;
  barcodes: string[];
  suggestedBatch: string | null;
  suggestedLocationId: string | null;
}

export interface Packed {
  key: string;
  orderLineId: string;
  articleId: string;
  quantity: number;
  batch: string;
  serialNumber: string | null;
  locationId: string | null;
}

export type ScanResult =
  | { kind: 'packed'; item: PackItem; packed: Packed[] }
  | { kind: 'need_serial'; item: PackItem }
  | { kind: 'not_in_order'; code: string }
  | { kind: 'already_complete'; item: PackItem }
  | { kind: 'duplicate_serial'; code: string };

const sameLine = (p: { orderLineId: string; articleId: string }, it: PackItem) =>
  p.orderLineId === it.orderLineId && p.articleId === it.articleId;

/** Bereits gepackte Menge einer Position. */
export function packedCount(packed: Packed[], it: PackItem): number {
  return packed.filter((p) => sameLine(p, it)).reduce((a, p) => a + p.quantity, 0);
}

export function isComplete(items: PackItem[], packed: Packed[]): boolean {
  return items.length > 0 && items.every((it) => packedCount(packed, it) === Number(it.quantity));
}

/** Gesamtfortschritt (Stück) für die Anzeige. */
export function progress(items: PackItem[], packed: Packed[]): { done: number; total: number } {
  return {
    done: items.reduce((a, it) => a + Math.min(packedCount(packed, it), Number(it.quantity)), 0),
    total: items.reduce((a, it) => a + Number(it.quantity), 0),
  };
}

/** Eine Einheit hinzufügen (ohne Prüfung auf Vollständigkeit). */
export function addUnit(packed: Packed[], it: PackItem, serial: string | null = null): Packed[] {
  return [
    ...packed,
    {
      key: newKey(),
      orderLineId: it.orderLineId,
      articleId: it.articleId,
      quantity: 1,
      batch: it.suggestedBatch ?? '',
      serialNumber: serial,
      locationId: it.suggestedLocationId,
    },
  ];
}

/** Letzte Einheit einer Position wieder entfernen. */
export function removeUnit(packed: Packed[], it: PackItem): Packed[] {
  const last = packed.filter((p) => sameLine(p, it)).at(-1);
  return last ? packed.filter((p) => p.key !== last.key) : packed;
}

/** Artikel-Scan (EAN, Artikelnummer, weitere Barcodes) auswerten. */
export function scanArticle(items: PackItem[], packed: Packed[], code: string): ScanResult {
  const c = code.trim().toLowerCase();
  const matches = items.filter((it) => it.barcodes.some((b) => b.toLowerCase() === c));
  if (!matches.length) return { kind: 'not_in_order', code: code.trim() };
  // Bei mehreren Positionen mit demselben Artikel zuerst die noch offene füllen
  const it = matches.find((m) => packedCount(packed, m) < Number(m.quantity));
  if (!it) return { kind: 'already_complete', item: matches[0]! };
  if (it.trackSerials) return { kind: 'need_serial', item: it };
  return { kind: 'packed', item: it, packed: addUnit(packed, it) };
}

/** Seriennummer für eine Position erfassen (doppelte Seriennummern werden abgelehnt). */
export function scanSerial(packed: Packed[], it: PackItem, serial: string): ScanResult {
  const s = serial.trim();
  if (packed.some((p) => p.articleId === it.articleId && p.serialNumber === s))
    return { kind: 'duplicate_serial', code: s };
  if (packedCount(packed, it) >= Number(it.quantity)) return { kind: 'already_complete', item: it };
  return { kind: 'packed', item: it, packed: addUnit(packed, it, s) };
}

/** Gleiche Einheiten zusammenfassen (Seriennummern bleiben einzeln) – Format der Abschluss-API. */
export function completeItems(packed: Packed[]) {
  const items = new Map<
    string,
    {
      orderLineId: string;
      articleId: string;
      quantity: number;
      batch: string | null;
      serialNumber: string | null;
      locationId: string | null;
    }
  >();
  for (const p of packed) {
    const key = p.serialNumber
      ? p.key
      : `${p.orderLineId}|${p.articleId}|${p.batch}|${p.locationId ?? ''}`;
    const prev = items.get(key);
    if (prev) prev.quantity += p.quantity;
    else
      items.set(key, {
        orderLineId: p.orderLineId,
        articleId: p.articleId,
        quantity: p.quantity,
        batch: p.batch || null,
        serialNumber: p.serialNumber,
        locationId: p.locationId,
      });
  }
  return [...items.values()].map((i) => ({ ...i, quantity: String(i.quantity) }));
}

/** Eingabe am Zahlenfeld (Gewicht in kg, Komma oder Punkt, höchstens 3 Nachkommastellen). */
export function typeWeight(current: string, key: string): string {
  if (key === 'clear') return '';
  if (key === 'back') return current.slice(0, -1);
  if (key === ',' || key === '.') {
    if (current.includes(',')) return current;
    return (current || '0') + ',';
  }
  if (!/^\d$/.test(key)) return current;
  const [whole, frac] = current.split(',');
  if (frac !== undefined && frac.length >= 3) return current;
  if (frac === undefined && (whole ?? '').length >= 4) return current;
  if (current === '0') return key;
  return current + key;
}

/** Gewicht für die API (Punkt als Dezimaltrenner, leer = 0). */
export function weightForApi(w: string): string {
  const v = w.replace(',', '.').replace(/\.$/, '');
  return v || '0';
}

let seq = 0;
function newKey(): string {
  try {
    return crypto.randomUUID();
  } catch {
    seq += 1;
    return `k${Date.now()}-${seq}`;
  }
}
