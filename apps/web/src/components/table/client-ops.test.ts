import { describe, expect, it } from 'vitest';
import { applyClient, toCsv } from './client-ops';
import { type Column } from './types';

interface R {
  name: string;
  n: number;
  active: boolean;
}
const cols: Column<R>[] = [
  { id: 'name', header: 'Name', kind: 'string', value: (r) => r.name },
  { id: 'n', header: 'Anzahl', kind: 'number', value: (r) => r.n },
  {
    id: 'active',
    header: 'Aktiv',
    kind: 'boolean',
    value: (r) => r.active,
    text: (r) => (r.active ? 'Ja' : 'Nein'),
  },
];
const rows: R[] = [
  { name: 'Beta', n: 2, active: true },
  { name: 'alpha', n: 10, active: false },
  { name: 'Gamma', n: 5, active: true },
];

describe('Tabellen im Browser', () => {
  it('sucht, filtert und sortiert', () => {
    expect(applyClient(rows, cols, 'mm', [], null).map((r) => r.name)).toEqual(['Gamma']);
    expect(
      applyClient(rows, cols, '', [{ field: 'n', op: 'gte', value: 5 }], 'n:desc').map(
        (r) => r.name,
      ),
    ).toEqual(['alpha', 'Gamma']);
    expect(
      applyClient(rows, cols, '', [{ field: 'active', op: 'eq', value: true }], 'name:asc').map(
        (r) => r.name,
      ),
    ).toEqual(['Beta', 'Gamma']);
  });
  it('erzeugt Excel-taugliches CSV und entschärft Formeln', () => {
    const csv = toCsv(
      [
        { name: '=HYPERLINK("x")', n: 1, active: true },
        { name: 'A;B', n: 2, active: false },
      ],
      cols,
    );
    expect(csv.startsWith('﻿Name;Anzahl;Aktiv')).toBe(true);
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
    expect(csv).toContain('"A;B";2;Nein');
  });
});
