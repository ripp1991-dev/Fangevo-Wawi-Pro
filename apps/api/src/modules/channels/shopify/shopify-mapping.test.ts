import { describe, expect, it } from 'vitest';
import {
  decideOrder,
  mapOrder,
  MappingError,
  toNet,
  type ShopifyOrderNode,
} from './shopify-mapping';

const base = (o: Partial<ShopifyOrderNode> = {}): ShopifyOrderNode => ({
  id: 'gid://shopify/Order/5001',
  name: '#1001',
  email: 'Kunde@Example.test',
  createdAt: '2026-11-20T10:00:00Z',
  updatedAt: '2026-11-20T10:00:00Z',
  cancelledAt: null,
  test: false,
  taxesIncluded: true,
  currencyCode: 'EUR',
  displayFinancialStatus: 'PAID',
  displayFulfillmentStatus: 'UNFULFILLED',
  paymentGatewayNames: ['paypal'],
  customer: { id: 'gid://shopify/Customer/77', firstName: 'Erika', lastName: 'Muster' },
  billingAddress: {
    firstName: 'Erika',
    lastName: 'Muster',
    address1: 'Deichweg 1',
    address2: 'Hinterhaus',
    zip: '25813',
    city: 'Husum',
    countryCodeV2: 'DE',
  },
  shippingAddress: null,
  shippingLine: {
    title: 'DHL Paket',
    discountedPriceSet: { shopMoney: { amount: '4.90' } },
    taxLines: [{ rate: 0.19 }],
  },
  lineItems: {
    nodes: [
      {
        name: 'Wobbler',
        sku: 'W-1',
        currentQuantity: 2,
        variant: { id: 'gid://shopify/ProductVariant/1', sku: 'W-1', barcode: null },
        discountedUnitPriceAfterAllDiscountsSet: { shopMoney: { amount: '11.90' } },
        taxLines: [{ rate: 0.19 }],
      },
    ],
  },
  ...o,
});

describe('Shopify-Bestellungen', () => {
  it('rechnet Bruttopreise in netto um', () => {
    expect(toNet('11.90', true, [{ rate: 0.19 }])).toBe('10');
    expect(toNet('4.90', true, [{ rate: 0.19 }])).toBe('4.1176');
    expect(toNet('10.00', false, [{ rate: 0.19 }])).toBe('10');
    expect(toNet('5', true, [])).toBe('5');
  });

  it('übernimmt Adresse, Positionen, Versand und externe Nummern', () => {
    const m = mapOrder(base(), () => undefined);
    expect(m.externalId).toBe('5001');
    expect(m.externalNumber).toBe('#1001');
    expect(m.customer.email).toBe('kunde@example.test');
    expect(m.customer.externalId).toBe('77');
    expect(m.billingAddress).toMatchObject({
      name: 'Erika Muster',
      street: 'Deichweg 1, Hinterhaus',
      postalCode: '25813',
      city: 'Husum',
      country: 'DE',
    });
    expect(m.lines).toEqual([{ sku: 'W-1', quantity: '2', unitPriceNet: '10' }]);
    expect(m.shippingNet).toBe('4.1176');
    expect(m.shippingMethod).toBe('DHL Paket');
  });

  it('verknüpfte Variante hat Vorrang vor der SKU, entfernte Positionen fallen weg', () => {
    const o = base();
    o.lineItems.nodes.push({ ...o.lineItems.nodes[0]!, sku: 'X', currentQuantity: 0 });
    const m = mapOrder(o, (v) => (v === 'gid://shopify/ProductVariant/1' ? 'A-000123' : undefined));
    expect(m.lines).toHaveLength(1);
    expect(m.lines[0]!.sku).toBe('A-000123');
  });

  it('meldet fehlende Daten verständlich', () => {
    expect(() => mapOrder(base({ email: null }), () => undefined)).toThrow(MappingError);
    const noSku = base();
    noSku.lineItems.nodes[0] = { ...noSku.lineItems.nodes[0]!, sku: null, variant: null };
    expect(() => mapOrder(noSku, () => undefined)).toThrow(/keine Artikelnummer/);
  });

  it('entscheidet nach Zahlungs-, Versand- und Stornostatus', () => {
    expect(decideOrder(base(), false).action).toBe('import');
    expect(decideOrder(base({ displayFinancialStatus: 'PENDING' }), false).action).toBe('skip');
    expect(decideOrder(base({ displayFinancialStatus: 'PENDING' }), true).action).toBe('import');
    expect(decideOrder(base({ displayFinancialStatus: 'REFUNDED' }), true).action).toBe('skip');
    expect(decideOrder(base({ displayFulfillmentStatus: 'FULFILLED' }), false).action).toBe('skip');
    const c = decideOrder(base({ cancelledAt: '2026-11-20T11:00:00Z' }), false);
    expect(c).toMatchObject({ action: 'skip', cancelled: true });
  });
});
