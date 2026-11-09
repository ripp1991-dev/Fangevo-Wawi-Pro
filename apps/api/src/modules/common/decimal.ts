import { Prisma } from '@fangevo/database';

export const dec = (v: string | number | Prisma.Decimal | null | undefined): Prisma.Decimal =>
  new Prisma.Decimal(v ?? 0);

/** Prisma-Decimal für JSON-Antworten als Text (exakt, ohne Gleitkomma). */
export function decimalsToString<T>(value: T): T {
  if (value instanceof Prisma.Decimal) return value.toString() as T;
  if (Array.isArray(value)) return value.map(decimalsToString) as T;
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, decimalsToString(v)])) as T;
  }
  return value;
}
