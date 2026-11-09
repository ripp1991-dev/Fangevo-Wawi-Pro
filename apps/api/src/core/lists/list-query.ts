import { type ListFilter, type ListQuery } from '@fangevo/shared';
import { AppError } from '../http/errors';

export type FieldKind = 'string' | 'number' | 'date' | 'boolean' | 'enum';

/** Freigegebene Felder einer Liste: nur diese dürfen gefiltert und sortiert werden. */
export type FieldSpec = Record<string, { kind: FieldKind; sortable?: boolean }>;

export interface CustomFieldSpec {
  key: string;
  type: string;
}

function bad(msg: string): AppError {
  return new AppError(422, 'VALIDATION_FAILED', msg);
}

function coerce(kind: FieldKind, v: unknown): unknown {
  if (v === null || v === undefined) return v;
  switch (kind) {
    case 'number': {
      const n = Number(v);
      if (!Number.isFinite(n)) throw bad('Zahl erwartet');
      return n;
    }
    case 'date': {
      const d = new Date(String(v));
      if (Number.isNaN(d.getTime())) throw bad('Datum erwartet');
      return d;
    }
    case 'boolean':
      return v === true || v === 'true';
    default:
      return String(v);
  }
}

/** Übersetzt einen Filter auf ein normales Feld in eine Prisma-Bedingung. */
function columnCondition(field: string, kind: FieldKind, f: ListFilter): Record<string, unknown> {
  const v = f.value;
  switch (f.op) {
    case 'eq':
      return {
        [field]:
          kind === 'string' ? { equals: coerce(kind, v), mode: 'insensitive' } : coerce(kind, v),
      };
    case 'neq':
      return { NOT: { [field]: coerce(kind, v) } };
    case 'contains':
      if (kind !== 'string') throw bad(`"contains" nur für Text (${field})`);
      return { [field]: { contains: String(v ?? ''), mode: 'insensitive' } };
    case 'in':
      if (!Array.isArray(v)) throw bad('Liste erwartet');
      return { [field]: { in: v.map((x) => coerce(kind, x)) } };
    case 'gte':
      return { [field]: { gte: coerce(kind, v) } };
    case 'lte':
      return { [field]: { lte: coerce(kind, v) } };
    case 'empty':
      return kind === 'string' ? { OR: [{ [field]: null }, { [field]: '' }] } : { [field]: null };
    case 'notEmpty':
      return kind === 'string'
        ? { AND: [{ NOT: { [field]: null } }, { NOT: { [field]: '' } }] }
        : { NOT: { [field]: null } };
  }
}

/** Filter auf ein eigenes Feld (JSONB-Spalte custom_fields). */
function customCondition(
  column: string,
  def: CustomFieldSpec,
  f: ListFilter,
): Record<string, unknown> {
  const path = [def.key];
  const v = f.value;
  switch (f.op) {
    case 'eq':
      return {
        [column]: {
          path,
          equals:
            def.type === 'number'
              ? Number(v)
              : def.type === 'boolean'
                ? v === true || v === 'true'
                : v,
        },
      };
    case 'neq':
      return { NOT: { [column]: { path, equals: v } } };
    case 'contains':
      if (def.type === 'multiselect') return { [column]: { path, array_contains: [v] } };
      return { [column]: { path, string_contains: String(v ?? '') } };
    case 'in':
      if (!Array.isArray(v)) throw bad('Liste erwartet');
      return { OR: v.map((x) => ({ [column]: { path, equals: x } })) };
    case 'gte':
      return def.type === 'number'
        ? { [column]: { path, gte: Number(v) } }
        : { [column]: { path, gte: String(v) } };
    case 'lte':
      return def.type === 'number'
        ? { [column]: { path, lte: Number(v) } }
        : { [column]: { path, lte: String(v) } };
    case 'empty':
    case 'notEmpty':
      throw bad('Filter "leer/nicht leer" ist für eigene Felder noch nicht verfügbar');
  }
}

/**
 * Baut aus der Listenabfrage Prisma-Bedingungen. Nur freigegebene Felder sind erlaubt
 * (keine beliebigen Spaltennamen aus dem Browser). Eigene Felder: Präfix "cf.".
 */
export function buildListArgs(
  q: ListQuery,
  spec: FieldSpec,
  opts: {
    search?: string[];
    customFields?: CustomFieldSpec[];
    customColumn?: string;
    defaultSort: string;
  },
): {
  where: Record<string, unknown>;
  orderBy: Record<string, 'asc' | 'desc'>[];
  skip: number;
  take: number;
} {
  const and: Record<string, unknown>[] = [];
  if (q.q && opts.search?.length) {
    and.push({ OR: opts.search.map((f) => ({ [f]: { contains: q.q, mode: 'insensitive' } })) });
  }
  for (const f of q.filters) {
    if (f.field.startsWith('cf.')) {
      const def = opts.customFields?.find((c) => `cf.${c.key}` === f.field);
      if (!def || !opts.customColumn) throw bad(`Unbekanntes Feld ${f.field}`);
      and.push(customCondition(opts.customColumn, def, f));
      continue;
    }
    const s = spec[f.field];
    if (!s) throw bad(`Nach "${f.field}" kann nicht gefiltert werden`);
    and.push(columnCondition(f.field, s.kind, f));
  }
  const [sortField, dir] = (q.sort ?? opts.defaultSort).split(':') as [string, 'asc' | 'desc'];
  if (!spec[sortField]?.sortable) throw bad(`Nach "${sortField}" kann nicht sortiert werden`);
  return {
    where: and.length ? { AND: and } : {},
    orderBy: [{ [sortField]: dir }, { id: 'asc' }],
    skip: (q.page - 1) * q.pageSize,
    take: q.pageSize,
  };
}
