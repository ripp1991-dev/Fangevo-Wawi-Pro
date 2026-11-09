import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Button, Field, Input } from '@fangevo/ui';
import { http } from '../lib/api';
import { formatMoney, formatQty } from '../lib/master-data';

export interface PickItem {
  id: string;
  title: string;
  subtitle?: string;
}

/**
 * Suchfeld mit Trefferliste (ab 2 Zeichen). Für Kunden, Lieferanten und Artikel.
 * Mit `value` zeigt es die Auswahl und einen Link „ändern“.
 */
export function SearchPicker<T>({
  label,
  hint,
  value,
  onChange,
  search,
  toItem,
  queryKey,
  error,
  autoFocus,
  disabled,
}: {
  label: string;
  hint?: string;
  value: PickItem | null;
  onChange: (row: T | null) => void;
  search: (q: string) => Promise<T[]>;
  toItem: (row: T) => PickItem;
  queryKey: string;
  error?: string;
  autoFocus?: boolean;
  disabled?: boolean;
}) {
  const [q, setQ] = useState('');
  const result = useQuery({
    queryKey: ['pick', queryKey, q],
    queryFn: () => search(q),
    enabled: q.trim().length >= 2,
  });
  if (value) {
    return (
      <div className="space-y-1">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-sm">
          <strong>{value.title}</strong>{' '}
          {value.subtitle && <span className="text-muted">{value.subtitle}</span>}{' '}
          {!disabled && (
            <Button variant="link" size="sm" onClick={() => onChange(null)}>
              ändern
            </Button>
          )}
        </p>
        {error && <p className="text-sm text-danger">{error}</p>}
      </div>
    );
  }
  return (
    <div>
      <Field label={label} hint={hint ?? 'Mindestens 2 Zeichen eingeben'} error={error}>
        {(p) => (
          <Input
            {...p}
            autoFocus={autoFocus}
            disabled={disabled}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        )}
      </Field>
      {result.data && (
        <ul className="mt-1 max-h-56 space-y-0.5 overflow-y-auto rounded-lg border border-border p-1">
          {result.data.length === 0 && (
            <li className="px-2 py-1.5 text-sm text-muted">Keine Treffer</li>
          )}
          {result.data.map((row) => {
            const it = toItem(row);
            return (
              <li key={it.id}>
                <button
                  type="button"
                  className="w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-surface-2"
                  onClick={() => {
                    onChange(row);
                    setQ('');
                  }}
                >
                  {it.title} {it.subtitle && <span className="text-muted">{it.subtitle}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export interface CustomerPick {
  id: string;
  number: string;
  displayName: string;
  city: string | null;
  email: string | null;
  blocked: boolean;
}
export const searchCustomers = async (q: string) =>
  (await http.get<{ items: CustomerPick[] }>(`/customers?pageSize=15&q=${encodeURIComponent(q)}`))
    .items;
export const customerItem = (c: CustomerPick): PickItem => ({
  id: c.id,
  title: `${c.number} · ${c.displayName}`,
  subtitle: [c.city, c.blocked ? 'gesperrt' : null].filter(Boolean).join(' · ') || undefined,
});

export interface SupplierPick {
  id: string;
  number: string;
  name: string;
  email: string | null;
}
export const searchSuppliers = async (q: string) =>
  (await http.get<{ items: SupplierPick[] }>(`/suppliers?pageSize=15&q=${encodeURIComponent(q)}`))
    .items;
export const supplierItem = (s: SupplierPick): PickItem => ({
  id: s.id,
  title: `${s.number} · ${s.name}`,
});

export interface ArticlePick {
  id: string;
  number: string;
  name: string;
  unit: string;
  kind: string;
  stock: string | null;
  salePriceNet?: string;
  purchasePriceNet?: string;
  stockTracked: boolean;
  active: boolean;
}
export const searchArticles = async (q: string) =>
  (
    await http.get<{ items: ArticlePick[] }>(`/articles?pageSize=15&q=${encodeURIComponent(q)}`)
  ).items.filter((a) => a.kind !== 'parent' && a.active);
export const articleItem = (a: ArticlePick): PickItem => ({
  id: a.id,
  title: `${a.number} · ${a.name}`,
  subtitle: [
    a.salePriceNet !== undefined ? `${formatMoney(a.salePriceNet)} netto` : null,
    a.stockTracked && a.stock !== null ? `Bestand ${formatQty(a.stock)} ${a.unit}` : null,
  ]
    .filter(Boolean)
    .join(' · '),
});
