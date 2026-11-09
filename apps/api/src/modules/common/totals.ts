import { Prisma } from '@fangevo/database';
import { dec } from './decimal';

/** Kaufmännisch auf Cent runden (0,005 → 0,01). */
export const round2 = (v: Prisma.Decimal): Prisma.Decimal =>
  v.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

export interface LineInput {
  quantity: Prisma.Decimal | string;
  unitPriceNet: Prisma.Decimal | string;
  discountPercent: Prisma.Decimal | string;
  taxRate: Prisma.Decimal | string;
}

export interface LineAmounts {
  lineNet: Prisma.Decimal;
  lineTax: Prisma.Decimal;
  lineGross: Prisma.Decimal;
}

/** Beträge einer Position: Netto auf Cent gerundet, Steuer je Position nur zur Anzeige. */
export function lineAmounts(l: LineInput): LineAmounts {
  const factor = dec(100).minus(dec(l.discountPercent)).div(100);
  const lineNet = round2(dec(l.quantity).times(dec(l.unitPriceNet)).times(factor));
  const lineTax = round2(lineNet.times(dec(l.taxRate)).div(100));
  return { lineNet, lineTax, lineGross: lineNet.plus(lineTax) };
}

export interface TaxSummaryRow {
  rate: string;
  net: string;
  tax: string;
  gross: string;
}

export interface Totals {
  taxSummary: TaxSummaryRow[];
  totalNet: Prisma.Decimal;
  totalTax: Prisma.Decimal;
  totalGross: Prisma.Decimal;
}

/**
 * Summen je Steuersatz. Die Umsatzsteuer wird je Steuersatz auf die Nettosumme berechnet
 * und gerundet (§ 14 Abs. 4 Nr. 8 UStG: Entgelt und Steuerbetrag je Steuersatz).
 */
export function summarize(
  rows: { net: Prisma.Decimal; taxRate: Prisma.Decimal | string }[],
): Totals {
  const byRate = new Map<string, Prisma.Decimal>();
  for (const r of rows) {
    const key = dec(r.taxRate).toFixed(2);
    byRate.set(key, (byRate.get(key) ?? dec(0)).plus(r.net));
  }
  const taxSummary = [...byRate.entries()]
    .sort((a, b) => dec(b[0]).comparedTo(dec(a[0])))
    .map(([rate, net]) => {
      const tax = round2(net.times(dec(rate)).div(100));
      return {
        rate,
        net: net.toFixed(2),
        tax: tax.toFixed(2),
        gross: net.plus(tax).toFixed(2),
      };
    });
  const totalNet = taxSummary.reduce((s, r) => s.plus(r.net), dec(0));
  const totalTax = taxSummary.reduce((s, r) => s.plus(r.tax), dec(0));
  return { taxSummary, totalNet, totalTax, totalGross: totalNet.plus(totalTax) };
}
