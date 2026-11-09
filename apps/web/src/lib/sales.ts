import {
  DOCUMENT_TYPES,
  ORDER_STATUSES,
  PURCHASE_STATUSES,
  type DocumentType,
  type OrderStatus,
  type PurchaseStatus,
} from '@fangevo/shared';
import { ApiError, getActiveCompany } from './api';

type Tone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger';

export const ORDER_TONE: Record<OrderStatus, Tone> = {
  new: 'primary',
  unchecked: 'warning',
  in_progress: 'primary',
  awaiting_payment: 'warning',
  awaiting_stock: 'warning',
  picking: 'primary',
  packing: 'primary',
  ready_to_ship: 'primary',
  shipped: 'success',
  completed: 'success',
  cancelled: 'neutral',
};

export const PURCHASE_TONE: Record<PurchaseStatus, Tone> = {
  draft: 'neutral',
  ordered: 'primary',
  partially_received: 'warning',
  received: 'success',
  cancelled: 'neutral',
};

export const PAYMENT_STATUS: Record<string, { label: string; tone: Tone }> = {
  unpaid: { label: 'Offen', tone: 'warning' },
  partially_paid: { label: 'Teilweise bezahlt', tone: 'warning' },
  paid: { label: 'Bezahlt', tone: 'success' },
  cancelled: { label: 'Storniert', tone: 'neutral' },
};

export const orderStatusLabel = (s: string) => ORDER_STATUSES[s as OrderStatus] ?? s;
export const purchaseStatusLabel = (s: string) => PURCHASE_STATUSES[s as PurchaseStatus] ?? s;
export const documentTypeLabel = (t: string) => DOCUMENT_TYPES[t as DocumentType] ?? t;

export interface AddressSnapshot {
  name: string | null;
  name2: string | null;
  street: string | null;
  postalCode: string | null;
  city: string | null;
  country: string;
}

export interface DocumentRow {
  id: string;
  type: DocumentType;
  number: string | null;
  status: 'draft' | 'finalized';
  orderId: string | null;
  relatedId: string | null;
  totalNet: string;
  totalTax: string;
  totalGross: string;
  issueDate: string;
  dueDate: string | null;
  paymentStatus: string | null;
  sentAt: string | null;
  recipientName?: string;
  recipient: { displayName: string; email: string | null; orderNumber: string | null };
}

export interface DocumentDetail extends DocumentRow {
  lines: {
    articleNumber: string | null;
    name: string;
    unit: string;
    quantity: string;
    unitPriceNet: string;
    taxRate: string;
    lineNet: string;
  }[];
  taxSummary: { rate: string; net: string; tax: string; gross: string }[];
  notes: string | null;
  pdfSha256: string | null;
  payments: {
    id: string;
    amount: string;
    paidOn: string;
    method: string | null;
    reference: string | null;
  }[];
  related: {
    id: string;
    type: string;
    number: string | null;
    status: string;
    totalGross: string;
  }[];
  paidAmount: string;
  openAmount: string;
}

/** PDF über die API laden (mit Firmen- und Sitzungskontext) und in neuem Tab öffnen. */
export async function openPdf(path: string): Promise<void> {
  const companyId = getActiveCompany();
  const win = window.open('', '_blank');
  const res = await fetch(`/api/v1${path}`, {
    credentials: 'include',
    headers: companyId ? { 'x-company-id': companyId } : {},
  });
  if (!res.ok) {
    win?.close();
    const p = (await res.json().catch(() => ({}))) as { detail?: string };
    throw new ApiError(res.status, 'INTERNAL_ERROR', p.detail ?? 'PDF konnte nicht geladen werden');
  }
  const url = URL.createObjectURL(await res.blob());
  if (win) win.location.href = url;
  else window.location.href = url;
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Heutiges Datum als JJJJ-MM-TT (Ortszeit). */
export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
