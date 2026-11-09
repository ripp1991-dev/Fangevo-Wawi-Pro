import { type ListFilter } from '@fangevo/shared';
import { type Column } from './types';

function norm(v: unknown): unknown {
  if (v instanceof Date) return v.getTime();
  return typeof v === 'string' ? v.toLowerCase() : v;
}

/** Filter-Logik im Browser (gleiche Bedeutung wie in der API) für kleine Listen. */
export function matches<T>(row: T, f: ListFilter, col: Column<T>): boolean {
  const raw = col.value(row);
  const v = col.kind === 'date' && raw ? new Date(String(raw)).getTime() : norm(raw);
  const target =
    col.kind === 'date' && f.value
      ? new Date(String(f.value)).getTime()
      : col.kind === 'number'
        ? Number(f.value)
        : col.kind === 'boolean'
          ? f.value === true || f.value === 'true'
          : norm(f.value);
  switch (f.op) {
    case 'eq':
      return Array.isArray(v) ? v.includes(f.value) : v === target;
    case 'neq':
      return v !== target;
    case 'contains':
      return String(v ?? '').includes(String(target ?? ''));
    case 'in':
      return Array.isArray(f.value) && f.value.map(norm).includes(v as never);
    case 'gte':
      return v !== null && v !== undefined && (v as number) >= (target as number);
    case 'lte':
      return v !== null && v !== undefined && (v as number) <= (target as number);
    case 'empty':
      return v === null || v === undefined || v === '';
    case 'notEmpty':
      return !(v === null || v === undefined || v === '');
  }
}

export function applyClient<T>(
  rows: T[],
  columns: Column<T>[],
  q: string,
  filters: ListFilter[],
  sort: string | null,
): T[] {
  const byId = new Map(columns.map((c) => [c.id, c]));
  const needle = q.trim().toLowerCase();
  let out = rows.filter((r) => {
    if (
      needle &&
      !columns.some((c) =>
        String(c.text?.(r) ?? c.value(r) ?? '')
          .toLowerCase()
          .includes(needle),
      )
    )
      return false;
    return filters.every((f) => {
      const c = byId.get(f.field);
      return !c || matches(r, f, c);
    });
  });
  if (sort) {
    const [id, dir] = sort.split(':');
    const c = byId.get(id ?? '');
    if (c) {
      out = [...out].sort((a, b) => {
        const x = norm(c.value(a));
        const y = norm(c.value(b));
        const cmp =
          x === y
            ? 0
            : x === null || x === undefined
              ? 1
              : y === null || y === undefined
                ? -1
                : (x as number) < (y as number)
                  ? -1
                  : 1;
        return dir === 'desc' ? -cmp : cmp;
      });
    }
  }
  return out;
}

/** CSV mit Semikolon und BOM, damit Excel in Deutschland Umlaute und Spalten korrekt erkennt. */
export function toCsv<T>(rows: T[], columns: Column<T>[]): string {
  const esc = (s: string) => (/[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const cell = (c: Column<T>, r: T) => {
    const t = c.text?.(r) ?? c.value(r);
    if (t === null || t === undefined) return '';
    // Schutz gegen Formel-Einschleusung in Tabellenkalkulationen
    const s = Array.isArray(t) ? t.join(', ') : String(t);
    return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  };
  const lines = [
    columns.map((c) => esc(c.header)).join(';'),
    ...rows.map((r) => columns.map((c) => esc(cell(c, r))).join(';')),
  ];
  return '﻿' + lines.join('\r\n');
}

export function download(name: string, content: string, type = 'text/csv;charset=utf-8'): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
