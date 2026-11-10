import { type Tx } from '@fangevo/database';

/** Anzahl gültiger Rechnungen (Entwurf oder festgeschrieben, nicht storniert) zu einem Auftrag. */
export function openInvoiceCount(tx: Tx, orderId: string): Promise<number> {
  return tx.document.count({
    where: {
      orderId,
      type: 'invoice',
      OR: [{ status: 'draft' }, { paymentStatus: { not: 'cancelled' } }],
    },
  });
}
