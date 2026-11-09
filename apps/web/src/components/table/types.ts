import { type ReactNode } from 'react';
import { type FilterOp, type ListFilter, type TableState } from '@fangevo/shared';

export type ColumnKind = 'string' | 'number' | 'date' | 'boolean' | 'enum';

export interface Column<T> {
  id: string;
  header: string;
  kind: ColumnKind;
  value: (row: T) => unknown;
  cell?: (row: T) => ReactNode;
  /** Text für Export und Gruppierung (Standard: value) */
  text?: (row: T) => string;
  options?: { value: string; label: string }[];
  sortable?: boolean;
  filterable?: boolean;
  groupable?: boolean;
  defaultHidden?: boolean;
  width?: number;
}

export const OPS_BY_KIND: Record<ColumnKind, { op: FilterOp; label: string }[]> = {
  string: [
    { op: 'contains', label: 'enthält' },
    { op: 'eq', label: 'ist gleich' },
    { op: 'neq', label: 'ist nicht' },
    { op: 'empty', label: 'ist leer' },
    { op: 'notEmpty', label: 'ist nicht leer' },
  ],
  number: [
    { op: 'eq', label: '=' },
    { op: 'gte', label: '≥' },
    { op: 'lte', label: '≤' },
  ],
  date: [
    { op: 'gte', label: 'ab' },
    { op: 'lte', label: 'bis' },
  ],
  boolean: [{ op: 'eq', label: 'ist' }],
  enum: [
    { op: 'eq', label: 'ist' },
    { op: 'neq', label: 'ist nicht' },
  ],
};

export const EMPTY_STATE: TableState = {
  columnOrder: [],
  hidden: [],
  widths: {},
  sort: null,
  filters: [],
  groupBy: null,
  q: '',
};

export type { ListFilter, TableState };
