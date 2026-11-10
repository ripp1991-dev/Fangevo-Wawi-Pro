import { useQuery } from '@tanstack/react-query';
import { http } from './api';
import { useSession } from './session';

export interface TaxRate {
  id: string;
  name: string;
  rate: string;
  isDefault: boolean;
  archivedAt: string | null;
}
export interface CustomerGroup {
  id: string;
  name: string;
  priceDisplay: 'gross' | 'net';
  discountPercent: string;
  isDefault: boolean;
  archivedAt: string | null;
}
export interface Category {
  id: string;
  name: string;
  parentId: string | null;
  position: number;
  archivedAt: string | null;
}
export interface Manufacturer {
  id: string;
  name: string;
}
export interface Warehouse {
  id: string;
  code: string;
  name: string;
  street: string | null;
  postalCode: string | null;
  city: string | null;
  country: string;
  isDefault: boolean;
  archivedAt: string | null;
}
export interface StorageLocation {
  id: string;
  warehouseId: string;
  code: string;
  description: string | null;
}
export interface NumberSequence {
  key: string;
  label: string;
  prefix: string;
  nextValue: number;
  padding: number;
}

export interface MasterData {
  settings: { allowNegativeStock: boolean; currency: string } | null;
  taxRates: TaxRate[];
  customerGroups: CustomerGroup[];
  categories: Category[];
  manufacturers: Manufacturer[];
  warehouses: Warehouse[];
  locations: StorageLocation[];
  sequences: NumberSequence[];
}

/** Auswahllisten der aktiven Firma (Steuersätze, Kundengruppen, Kategorien, Lager …). */
export function useMasterData() {
  const s = useSession();
  return useQuery({
    queryKey: ['master-data', s.account?.id],
    queryFn: () => http.get<MasterData>('/company/master-data'),
    staleTime: 60_000,
  });
}

/** Kategorienamen mit Pfad, z. B. "Angeln › Ruten". */
export function categoryPaths(categories: Category[]): Map<string, string> {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const out = new Map<string, string>();
  for (const c of categories) {
    const parts: string[] = [];
    let cur: Category | undefined = c;
    for (let i = 0; cur && i < 20; i++) {
      parts.unshift(cur.name);
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
    out.set(c.id, parts.join(' › '));
  }
  return out;
}

const eur = new Intl.NumberFormat('de-DE', {
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});
const num = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 4 });

/** Beträge kommen als exakter Text aus der API; nur zur Anzeige in Zahlen umwandeln. */
export const formatMoney = (v: string | null | undefined) =>
  v === null || v === undefined ? '–' : eur.format(Number(v));
export const formatQty = (v: string | null | undefined) =>
  v === null || v === undefined ? '–' : num.format(Number(v));
/** Text für Eingabefelder im deutschen Format ("12,5"). */
export const toInput = (v: string | null | undefined) =>
  v === null || v === undefined ? '' : String(v).replace('.', ',');

/** Bruttopreis zur Anzeige (Rundung auf Cent erst bei der Anzeige). */
export function gross(net: string, rate: string): string {
  return ((Number(net) * (100 + Number(rate))) / 100).toFixed(2);
}
