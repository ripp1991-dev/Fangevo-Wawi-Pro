import { Prisma } from '@fangevo/database';
import { type ChannelOrder } from '@fangevo/shared';

/**
 * Umsetzung von Shopify-Bestellungen in die Kanal-Bestellung der Wawi (reine Funktionen, gut testbar).
 * Preise: Die Wawi rechnet netto. Shopify liefert Preise je nach Shop brutto (taxesIncluded) oder netto;
 * brutto wird mit dem Steuersatz der Position auf netto umgerechnet (4 Nachkommastellen).
 */

export interface ShopifyMoney {
  shopMoney: { amount: string; currencyCode?: string };
}

export interface ShopifyAddress {
  firstName?: string | null;
  lastName?: string | null;
  name?: string | null;
  company?: string | null;
  address1?: string | null;
  address2?: string | null;
  zip?: string | null;
  city?: string | null;
  countryCodeV2?: string | null;
  phone?: string | null;
}

export interface ShopifyOrderNode {
  id: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  createdAt: string;
  updatedAt: string;
  cancelledAt?: string | null;
  test?: boolean;
  taxesIncluded: boolean;
  currencyCode: string;
  displayFinancialStatus?: string | null;
  displayFulfillmentStatus?: string | null;
  note?: string | null;
  paymentGatewayNames?: string[];
  customer?: { id: string; firstName?: string | null; lastName?: string | null } | null;
  billingAddress?: ShopifyAddress | null;
  shippingAddress?: ShopifyAddress | null;
  shippingLine?: {
    title?: string | null;
    discountedPriceSet?: ShopifyMoney | null;
    taxLines?: { rate?: number | null }[];
  } | null;
  lineItems: {
    nodes: {
      name?: string | null;
      sku?: string | null;
      currentQuantity: number;
      variant?: { id: string; sku?: string | null; barcode?: string | null } | null;
      discountedUnitPriceAfterAllDiscountsSet?: ShopifyMoney | null;
      taxLines?: { rate?: number | null }[];
    }[];
  };
}

export const ORDER_FIELDS = `
  id name email phone createdAt updatedAt cancelledAt test taxesIncluded currencyCode
  displayFinancialStatus displayFulfillmentStatus note paymentGatewayNames
  customer { id firstName lastName }
  billingAddress { firstName lastName name company address1 address2 zip city countryCodeV2 phone }
  shippingAddress { firstName lastName name company address1 address2 zip city countryCodeV2 phone }
  shippingLine { title discountedPriceSet { shopMoney { amount currencyCode } } taxLines { rate } }
  lineItems(first: 100) {
    nodes {
      name sku currentQuantity
      variant { id sku barcode }
      discountedUnitPriceAfterAllDiscountsSet { shopMoney { amount currencyCode } }
      taxLines { rate }
    }
  }`;

/** Numerische ID aus einer Shopify-GID (gid://shopify/Order/123 → 123). */
export const legacyId = (gid: string) => gid.slice(gid.lastIndexOf('/') + 1);

const PAID = new Set(['PAID', 'PARTIALLY_REFUNDED']);
const UNPAID_OK = new Set(['PENDING', 'AUTHORIZED', 'PARTIALLY_PAID', 'EXPIRED']);

export type OrderDecision =
  { action: 'import' } | { action: 'skip'; reason: string; cancelled?: boolean };

/** Soll die Bestellung übernommen werden? (bereits übernommene prüft der Aufrufer) */
export function decideOrder(o: ShopifyOrderNode, importUnpaid: boolean): OrderDecision {
  if (o.cancelledAt) return { action: 'skip', reason: 'storniert', cancelled: true };
  const fin = o.displayFinancialStatus ?? '';
  if (!PAID.has(fin) && !(importUnpaid && UNPAID_OK.has(fin)))
    return { action: 'skip', reason: `Zahlungsstatus ${fin || 'unbekannt'}` };
  if (o.displayFulfillmentStatus === 'FULFILLED')
    return { action: 'skip', reason: 'in Shopify bereits versendet' };
  return { action: 'import' };
}

/** Bruttobetrag → netto (falls der Shop Bruttopreise führt). */
export function toNet(
  amount: string | undefined | null,
  taxesIncluded: boolean,
  taxLines: { rate?: number | null }[] | undefined,
): string {
  const v = new Prisma.Decimal(amount ?? '0');
  if (!taxesIncluded) return v.toDecimalPlaces(4).toString();
  const rate = (taxLines ?? []).reduce(
    (s, t) => s.plus(new Prisma.Decimal(t.rate ?? 0)),
    new Prisma.Decimal(0),
  );
  return v.dividedBy(rate.plus(1)).toDecimalPlaces(4).toString();
}

function street(a: ShopifyAddress): string {
  return [a.address1, a.address2]
    .map((x) => x?.trim())
    .filter(Boolean)
    .join(', ');
}

function personName(a: ShopifyAddress | null | undefined): string | null {
  if (!a) return null;
  return (a.name ?? [a.firstName, a.lastName].filter(Boolean).join(' ')).trim() || null;
}

function address(a: ShopifyAddress) {
  return {
    name: personName(a),
    street: street(a),
    postalCode: (a.zip ?? '').trim(),
    city: (a.city ?? '').trim(),
    country: (a.countryCodeV2 ?? 'DE').toUpperCase(),
  };
}

export class MappingError extends Error {}

/**
 * Shopify-Bestellung → Kanal-Bestellung der Wawi.
 * `skuFor` liefert für eine Variante die Artikelnummer (verknüpfte Artikel); sonst gilt SKU bzw. Barcode.
 */
export function mapOrder(
  o: ShopifyOrderNode,
  skuFor: (variantId: string) => string | undefined,
): ChannelOrder {
  const bill = o.billingAddress ?? o.shippingAddress;
  if (!bill) throw new MappingError('Bestellung ohne Rechnungs- und Lieferadresse');
  const email = (o.email ?? '').trim().toLowerCase();
  if (!email)
    throw new MappingError(
      'Bestellung ohne E-Mail-Adresse (bei Shopify sind ggf. Kundendaten nicht freigegeben)',
    );
  const b = address(bill);
  if (!b.street || !b.postalCode || !b.city)
    throw new MappingError('Adresse unvollständig (Straße, PLZ oder Ort fehlt)');
  const lines = o.lineItems.nodes
    .filter((l) => l.currentQuantity > 0)
    .map((l) => {
      const sku =
        (l.variant ? skuFor(l.variant.id) : undefined) ??
        (l.sku?.trim() || l.variant?.sku?.trim() || l.variant?.barcode?.trim() || '');
      if (!sku) throw new MappingError(`Position „${l.name ?? '?'}“ hat keine Artikelnummer (SKU)`);
      return {
        sku,
        quantity: String(l.currentQuantity),
        unitPriceNet: toNet(
          l.discountedUnitPriceAfterAllDiscountsSet?.shopMoney.amount,
          o.taxesIncluded,
          l.taxLines,
        ),
      };
    });
  if (!lines.length) throw new MappingError('Bestellung ohne offene Positionen');
  const ship = o.shippingAddress ? address(o.shippingAddress) : null;
  const notes = [
    o.test ? 'Testbestellung aus Shopify' : null,
    o.note?.trim() ? `Kundenhinweis: ${o.note.trim()}` : null,
  ]
    .filter(Boolean)
    .join('\n');
  return {
    externalId: legacyId(o.id),
    externalNumber: o.name,
    customer: {
      externalId: o.customer ? legacyId(o.customer.id) : null,
      email,
      companyName: bill.company?.trim() || null,
      firstName: bill.firstName?.trim() || o.customer?.firstName?.trim() || null,
      lastName: bill.lastName?.trim() || o.customer?.lastName?.trim() || null,
      phone: (bill.phone ?? o.phone)?.trim() || null,
      vatId: null,
    },
    billingAddress: b,
    shippingAddress: ship && ship.street ? ship : null,
    lines,
    shippingNet: toNet(
      o.shippingLine?.discountedPriceSet?.shopMoney.amount,
      o.taxesIncluded,
      o.shippingLine?.taxLines,
    ),
    paymentMethod: o.paymentGatewayNames?.join(', ').slice(0, 80) || null,
    shippingMethod: o.shippingLine?.title?.slice(0, 80) || null,
    notes: notes || null,
  };
}
