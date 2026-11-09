import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { type z } from 'zod';
import { Prisma, uuidv7, type Document, type Tx } from '@fangevo/database';
import {
  DOCUMENT_TYPES,
  type creditNoteSchema,
  type DocumentType,
  type documentFromOrderSchema,
  type ListQuery,
  type paymentInputSchema,
  type sendDocumentSchema,
} from '@fangevo/shared';
import { AuditService } from '../../core/audit/audit.service';
import { AppError, Errors } from '../../core/http/errors';
import { type TenantContext } from '../../core/http/context';
import { buildListArgs, type FieldSpec } from '../../core/lists/list-query';
import { MailService } from '../../core/mail/mail.service';
import { CompanyDb, type CompanyContext } from '../common/company-db';
import { dec } from '../common/decimal';
import { summarize, type TaxSummaryRow } from '../common/totals';
import { type CustomerSnapshot, OrdersService } from '../orders/orders.service';
import { renderDocumentPdf, type PdfLine, type PdfSender } from './document-pdf';
import { openInvoiceCount } from './document-queries';

export const DOCUMENT_FIELDS: FieldSpec = {
  type: { kind: 'enum', sortable: true },
  number: { kind: 'string', sortable: true },
  status: { kind: 'enum', sortable: true },
  orderId: { kind: 'string' },
  issueDate: { kind: 'date', sortable: true },
  dueDate: { kind: 'date', sortable: true },
  totalNet: { kind: 'number', sortable: true },
  totalGross: { kind: 'number', sortable: true },
  paymentStatus: { kind: 'enum', sortable: true },
  createdAt: { kind: 'date', sortable: true },
};

/** Gespeicherte Position eines Belegs (Werte als Text, exakt). */
export type DocumentLine = PdfLine;

export interface DocumentRecipient {
  customerId: string | null;
  customerNumber: string | null;
  displayName: string;
  email: string | null;
  vatId: string | null;
  priceDisplay: 'net' | 'gross';
  address: CustomerSnapshot['billing'];
  orderNumber: string | null;
  externalNumber: string | null;
  relatedNumber: string | null;
  paymentTermsDays: number;
}

const today = () => new Date(new Date().toISOString().slice(0, 10));
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);

/**
 * Belege (Angebot, Auftragsbestätigung, Lieferschein, Rechnung, Gutschrift, Stornorechnung).
 * Ein Beleg entsteht als Entwurf; erst beim Festschreiben erhält er seine Nummer (lückenlos)
 * und ein PDF, das unveränderlich mit Prüfsumme gespeichert wird (GoBD).
 */
@Injectable()
export class DocumentsService {
  constructor(
    @Inject(CompanyDb) private readonly cdb: CompanyDb,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(MailService) private readonly mail: MailService,
    @Inject(OrdersService) private readonly orders: OrdersService,
  ) {}

  list(t: TenantContext, q: ListQuery) {
    return this.cdb.run(t, async (tx) => {
      const args = buildListArgs(q, DOCUMENT_FIELDS, {
        search: ['number'],
        defaultSort: 'createdAt:desc',
      });
      const where = { AND: [args.where, { type: { not: 'purchase_order' } }] };
      const [items, total] = await Promise.all([
        tx.document.findMany({
          where,
          orderBy: args.orderBy,
          skip: args.skip,
          take: args.take,
          omit: { lines: true },
        }),
        tx.document.count({ where }),
      ]);
      return {
        items: items.map((d) => ({
          ...d,
          recipientName: (d.recipient as unknown as DocumentRecipient).displayName,
        })),
        total,
        page: q.page,
        pageSize: q.pageSize,
      };
    });
  }

  get(t: TenantContext, id: string) {
    return this.cdb.run(t, (tx) => this.load(tx, id));
  }

  private async load(tx: Tx, id: string) {
    const doc = await tx.document.findUnique({ where: { id } });
    if (!doc) throw Errors.notFound();
    const [payments, related] = await Promise.all([
      tx.payment.findMany({ where: { documentId: id }, orderBy: { createdAt: 'asc' } }),
      tx.document.findMany({
        where: { relatedId: id },
        select: { id: true, type: true, number: true, status: true, totalGross: true },
      }),
    ]);
    const paid = payments.reduce((s, p) => s.plus(p.amount), dec(0));
    return {
      ...doc,
      payments,
      related,
      paidAmount: paid.toString(),
      openAmount: dec(doc.totalGross).minus(paid).toString(),
    };
  }

  // ───── Erstellen ─────

  fromOrder(t: TenantContext, orderId: string, input: z.infer<typeof documentFromOrderSchema>) {
    return this.cdb.run(t, async (tx, c) => {
      const { order, lines } = await this.orders.forDocument(tx, orderId);
      if (order.status === 'cancelled')
        throw new AppError(409, 'CONFLICT', 'Der Auftrag ist storniert');
      if (input.type === 'invoice' && (await openInvoiceCount(tx, orderId)) > 0)
        throw new AppError(409, 'CONFLICT', 'Zu diesem Auftrag gibt es bereits eine Rechnung');
      const snap = order.customerSnapshot as unknown as CustomerSnapshot;
      const docLines: DocumentLine[] = lines.map((l) => ({
        articleNumber: l.articleNumber,
        name: l.name,
        unit: l.unit,
        quantity: l.quantity.toString(),
        unitPriceNet: l.unitPriceNet.toString(),
        discountPercent: l.discountPercent.toString(),
        taxRate: l.taxRate.toString(),
        lineNet: l.lineNet.toFixed(2),
        lineGross: l.lineGross.toFixed(2),
      }));
      if (!dec(order.shippingNet).isZero()) {
        const net = dec(order.shippingNet);
        const tax = net.times(order.shippingTaxRate).div(100).toDecimalPlaces(2);
        docLines.push({
          articleNumber: null,
          name: `Versandkosten${order.shippingMethod ? ` (${order.shippingMethod})` : ''}`,
          unit: 'pauschal',
          quantity: '1',
          unitPriceNet: net.toString(),
          discountPercent: '0',
          taxRate: order.shippingTaxRate.toString(),
          lineNet: net.toFixed(2),
          lineGross: net.plus(tax).toFixed(2),
        });
      }
      const recipient: DocumentRecipient = {
        customerId: order.customerId,
        customerNumber: snap.number,
        displayName: snap.displayName,
        email: snap.email,
        vatId: snap.vatId,
        priceDisplay: snap.priceDisplay === 'net' ? 'net' : 'gross',
        address: input.type === 'delivery_note' ? snap.shipping : snap.billing,
        orderNumber: order.number,
        externalNumber: order.externalNumber,
        relatedNumber: null,
        paymentTermsDays: snap.paymentTermsDays,
      };
      const doc = await this.createDraft(tx, c, {
        type: input.type,
        orderId,
        relatedId: null,
        recipient,
        lines: docLines,
        serviceDate: input.serviceDate
          ? new Date(input.serviceDate)
          : order.shippedAt
            ? new Date(order.shippedAt.toISOString().slice(0, 10))
            : null,
        notes: input.notes ?? null,
      });
      return this.load(tx, doc.id);
    });
  }

  /** Gutschrift zu einer Rechnung (ganz oder für einzelne Positionen). */
  creditNote(t: TenantContext, invoiceId: string, input: z.infer<typeof creditNoteSchema>) {
    return this.cdb.run(t, async (tx, c) => {
      const invoice = await this.requireFinalInvoice(tx, invoiceId);
      const source = invoice.lines as unknown as DocumentLine[];
      const picked = input.lines?.length
        ? input.lines.map((sel) => {
            const l = source[sel.index];
            if (!l)
              throw new AppError(
                422,
                'VALIDATION_FAILED',
                `Position ${sel.index + 1} gibt es nicht`,
              );
            if (dec(sel.quantity).greaterThan(l.quantity))
              throw new AppError(
                422,
                'VALIDATION_FAILED',
                `Position ${sel.index + 1}: höchstens ${l.quantity} möglich`,
              );
            return this.scaleLine(l, dec(sel.quantity));
          })
        : source;
      const totals = summarize(picked.map((l) => ({ net: dec(l.lineNet), taxRate: l.taxRate })));
      const credited = await tx.document.aggregate({
        where: { relatedId: invoiceId, type: 'credit_note' },
        _sum: { totalGross: true },
      });
      if (totals.totalGross.plus(credited._sum.totalGross ?? 0).greaterThan(invoice.totalGross))
        throw new AppError(
          409,
          'CONFLICT',
          'Gutschriften dürfen zusammen den Rechnungsbetrag nicht übersteigen',
        );
      const recipient = {
        ...(invoice.recipient as unknown as DocumentRecipient),
        relatedNumber: invoice.number,
      };
      const doc = await this.createDraft(tx, c, {
        type: 'credit_note',
        orderId: invoice.orderId,
        relatedId: invoice.id,
        recipient,
        lines: picked,
        serviceDate: invoice.serviceDate,
        notes: `Gutschrift zur Rechnung ${invoice.number}. Grund: ${input.reason}`,
      });
      return this.load(tx, doc.id);
    });
  }

  /** Stornorechnung: hebt eine Rechnung vollständig auf (negierte Beträge, sofort festgeschrieben). */
  cancelInvoice(t: TenantContext, invoiceId: string, reason: string) {
    return this.cdb.run(t, async (tx, c) => {
      const invoice = await this.requireFinalInvoice(tx, invoiceId);
      const lines = (invoice.lines as unknown as DocumentLine[]).map((l) => ({
        ...l,
        quantity: dec(l.quantity).negated().toString(),
        lineNet: dec(l.lineNet).negated().toFixed(2),
        lineGross: dec(l.lineGross).negated().toFixed(2),
      }));
      const recipient = {
        ...(invoice.recipient as unknown as DocumentRecipient),
        relatedNumber: invoice.number,
      };
      const draft = await this.createDraft(tx, c, {
        type: 'cancellation',
        orderId: invoice.orderId,
        relatedId: invoice.id,
        recipient,
        lines,
        serviceDate: invoice.serviceDate,
        notes: `Storno der Rechnung ${invoice.number}. Grund: ${reason}`,
      });
      await this.doFinalize(tx, c, draft);
      await tx.document.update({
        where: { id: invoice.id },
        data: { paymentStatus: 'cancelled' },
      });
      return this.load(tx, draft.id);
    });
  }

  private async requireFinalInvoice(tx: Tx, id: string) {
    const invoice = await tx.document.findUnique({ where: { id } });
    if (!invoice) throw Errors.notFound();
    if (invoice.type !== 'invoice' || invoice.status !== 'finalized')
      throw new AppError(409, 'CONFLICT', 'Nur für festgeschriebene Rechnungen möglich');
    if (invoice.paymentStatus === 'cancelled')
      throw new AppError(409, 'CONFLICT', 'Die Rechnung ist bereits storniert');
    return invoice;
  }

  private scaleLine(l: DocumentLine, qty: Prisma.Decimal): DocumentLine {
    const factor = qty.div(l.quantity);
    const net = dec(l.lineNet).times(factor).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    const tax = net.times(l.taxRate).div(100).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    return {
      ...l,
      quantity: qty.toString(),
      lineNet: net.toFixed(2),
      lineGross: net.plus(tax).toFixed(2),
    };
  }

  private async createDraft(
    tx: Tx,
    c: CompanyContext,
    d: {
      type: DocumentType;
      orderId: string | null;
      relatedId: string | null;
      recipient: DocumentRecipient;
      lines: DocumentLine[];
      serviceDate: Date | null;
      notes: string | null;
    },
  ): Promise<Document> {
    const totals = summarize(d.lines.map((l) => ({ net: dec(l.lineNet), taxRate: l.taxRate })));
    const doc = await tx.document.create({
      data: {
        id: uuidv7(),
        accountId: c.account.id,
        companyId: c.companyId,
        type: d.type,
        status: 'draft',
        orderId: d.orderId,
        relatedId: d.relatedId,
        recipient: d.recipient as unknown as Prisma.InputJsonValue,
        lines: d.lines as unknown as Prisma.InputJsonValue,
        taxSummary: totals.taxSummary as unknown as Prisma.InputJsonValue,
        totalNet: totals.totalNet,
        totalTax: totals.totalTax,
        totalGross: totals.totalGross,
        issueDate: today(),
        serviceDate: d.serviceDate,
        notes: d.notes,
        createdBy: c.user.id,
      },
    });
    await this.log(tx, c, 'document.created', doc, { type: d.type });
    return doc;
  }

  // ───── Festschreiben, PDF, Versand ─────

  finalize(t: TenantContext, id: string) {
    return this.cdb.run(t, async (tx, c) => {
      const doc = await tx.document.findUnique({ where: { id } });
      if (!doc) throw Errors.notFound();
      if (doc.status !== 'draft')
        throw new AppError(409, 'CONFLICT', 'Der Beleg ist bereits festgeschrieben');
      if (doc.orderId && ['invoice', 'order_confirmation', 'delivery_note'].includes(doc.type)) {
        const order = await tx.salesOrder.findUnique({ where: { id: doc.orderId } });
        if (order?.status === 'cancelled')
          throw new AppError(409, 'CONFLICT', 'Der Auftrag ist storniert');
      }
      await this.doFinalize(tx, c, doc);
      return this.load(tx, id);
    });
  }

  private async doFinalize(tx: Tx, c: CompanyContext, doc: Document) {
    const sender = await this.sender(tx, c);
    if (['invoice', 'credit_note', 'cancellation'].includes(doc.type)) {
      const missing = [
        !sender.street || !sender.postalCode || !sender.city ? 'Anschrift der Firma' : null,
        !sender.taxNumber && !sender.vatId ? 'Steuernummer oder USt-IdNr.' : null,
      ].filter(Boolean);
      if (missing.length)
        throw new AppError(
          422,
          'VALIDATION_FAILED',
          `Für Rechnungen fehlen Pflichtangaben der Firma: ${missing.join(', ')}. Bitte unter Firmeneinstellungen ergänzen.`,
        );
      const r = doc.recipient as unknown as DocumentRecipient;
      if (!r.address?.street || !r.address.city)
        throw new AppError(
          422,
          'VALIDATION_FAILED',
          'Für Rechnungen ist die vollständige Anschrift des Kunden Pflicht',
        );
    }
    const number = await this.cdb.nextNumber(tx, c.companyId, doc.type as DocumentType);
    const issueDate = today();
    const recipient = doc.recipient as unknown as DocumentRecipient;
    const dueDate = doc.type === 'invoice' ? addDays(issueDate, recipient.paymentTermsDays) : null;
    const finalized = {
      ...doc,
      number,
      issueDate,
      dueDate,
      serviceDate: doc.serviceDate ?? (doc.type === 'invoice' ? issueDate : null),
    };
    const pdf = await this.render(finalized, sender, false);
    const sha256 = createHash('sha256').update(pdf).digest('hex');
    await tx.document.update({
      where: { id: doc.id },
      data: {
        number,
        status: 'finalized',
        issueDate,
        dueDate,
        serviceDate: finalized.serviceDate,
        paymentStatus: doc.type === 'invoice' ? 'unpaid' : null,
        finalizedAt: new Date(),
        finalizedBy: c.user.id,
        pdfSha256: sha256,
      },
    });
    await tx.documentFile.create({
      data: {
        documentId: doc.id,
        accountId: c.account.id,
        companyId: c.companyId,
        content: new Uint8Array(pdf),
        sha256,
      },
    });
    await this.log(tx, c, 'document.finalized', doc, { type: doc.type, number });
  }

  remove(t: TenantContext, id: string) {
    return this.cdb.run(t, async (tx, c) => {
      const doc = await tx.document.findUnique({ where: { id } });
      if (!doc) throw Errors.notFound();
      if (doc.status !== 'draft')
        throw new AppError(409, 'CONFLICT', 'Festgeschriebene Belege können nicht gelöscht werden');
      await tx.document.delete({ where: { id } });
      await this.log(tx, c, 'document.deleted', doc, { type: doc.type });
      return { ok: true };
    });
  }

  /** PDF: festgeschriebene Belege aus dem Archiv (Prüfsumme wird kontrolliert), Entwürfe als Vorschau. */
  pdf(t: TenantContext, id: string) {
    return this.cdb.run(t, async (tx, c) => this.pdfFor(tx, c, id));
  }

  private async pdfFor(tx: Tx, c: CompanyContext, id: string) {
    const doc = await tx.document.findUnique({ where: { id } });
    if (!doc) throw Errors.notFound();
    const filename = `${DOCUMENT_TYPES[doc.type as DocumentType]}${doc.number ? `-${doc.number}` : '-Entwurf'}.pdf`;
    if (doc.status === 'finalized') {
      const file = await tx.documentFile.findUnique({ where: { documentId: id } });
      if (!file) throw new AppError(500, 'INTERNAL_ERROR', 'PDF des Belegs fehlt');
      const content = Buffer.from(file.content);
      if (createHash('sha256').update(content).digest('hex') !== file.sha256)
        throw new AppError(500, 'INTERNAL_ERROR', 'Prüfsumme des Beleg-PDFs stimmt nicht');
      return { doc, filename, content };
    }
    return { doc, filename, content: await this.render(doc, await this.sender(tx, c), true) };
  }

  send(t: TenantContext, id: string, input: z.infer<typeof sendDocumentSchema>) {
    return this.cdb.run(t, async (tx, c) => {
      const { doc, filename, content } = await this.pdfFor(tx, c, id);
      if (doc.status !== 'finalized')
        throw new AppError(409, 'CONFLICT', 'Bitte den Beleg zuerst festschreiben');
      const sender = await this.sender(tx, c);
      const label = `${DOCUMENT_TYPES[doc.type as DocumentType]} ${doc.number}`;
      await this.mail.send({
        to: input.to,
        subject: input.subject ?? `${label} – ${sender.legalName || sender.name}`,
        text:
          input.message ??
          `Guten Tag,\n\nanbei erhalten Sie ${label} als PDF.\n\nMit freundlichen Grüßen\n${sender.legalName || sender.name}`,
        attachments: [{ filename, content, contentType: 'application/pdf' }],
      });
      await tx.document.update({ where: { id }, data: { sentAt: new Date() } });
      await this.log(tx, c, 'document.sent', doc, { number: doc.number, to: input.to });
      return this.load(tx, id);
    });
  }

  // ───── Zahlungen ─────

  addPayment(t: TenantContext, id: string, input: z.infer<typeof paymentInputSchema>) {
    return this.cdb.run(t, async (tx, c) => {
      const invoice = await this.requireFinalInvoice(tx, id);
      await tx.payment.create({
        data: {
          id: uuidv7(),
          accountId: c.account.id,
          companyId: c.companyId,
          documentId: id,
          amount: dec(input.amount),
          paidOn: new Date(input.paidOn),
          method: input.method,
          reference: input.reference,
          createdBy: c.user.id,
        },
      });
      const sum = await tx.payment.aggregate({ where: { documentId: id }, _sum: { amount: true } });
      const paid = dec(sum._sum.amount ?? 0);
      const status = paid.greaterThanOrEqualTo(invoice.totalGross)
        ? 'paid'
        : paid.greaterThan(0)
          ? 'partially_paid'
          : 'unpaid';
      await tx.document.update({ where: { id }, data: { paymentStatus: status } });
      await this.log(tx, c, 'document.payment_added', invoice, {
        number: invoice.number,
        amount: input.amount,
        paymentStatus: status,
      });
      return this.load(tx, id);
    });
  }

  // ───── Kennzahlen ─────

  /** Umsatz (netto) aus festgeschriebenen Rechnungen abzüglich Gutschriften und Stornos. */
  stats(t: TenantContext) {
    return this.cdb.run(t, async (tx, c) => {
      const rows = await tx.$queryRaw<{ period: string; net: string; gross: string }[]>`
        WITH p AS (
          SELECT 'today' AS period, (now() AT TIME ZONE 'Europe/Berlin')::date AS since
          UNION ALL SELECT 'week', date_trunc('week', now() AT TIME ZONE 'Europe/Berlin')::date
          UNION ALL SELECT 'month', date_trunc('month', now() AT TIME ZONE 'Europe/Berlin')::date
        )
        SELECT p.period,
          COALESCE(SUM(CASE WHEN d.type = 'credit_note' THEN -d.total_net ELSE d.total_net END), 0)::text AS net,
          COALESCE(SUM(CASE WHEN d.type = 'credit_note' THEN -d.total_gross ELSE d.total_gross END), 0)::text AS gross
        FROM p LEFT JOIN documents d
          ON d.company_id = ${c.companyId}::uuid AND d.status = 'finalized'
         AND d.type IN ('invoice','credit_note','cancellation') AND d.issue_date >= p.since
        GROUP BY p.period`;
      const open = await tx.document.aggregate({
        where: { type: 'invoice', paymentStatus: { in: ['unpaid', 'partially_paid'] } },
        _count: { _all: true },
        _sum: { totalGross: true },
      });
      const get = (p: string) => {
        const r = rows.find((x) => x.period === p);
        return { net: dec(r?.net ?? 0).toString(), gross: dec(r?.gross ?? 0).toString() };
      };
      return {
        today: get('today'),
        week: get('week'),
        month: get('month'),
        openInvoices: {
          count: open._count._all,
          totalGross: (open._sum.totalGross ?? dec(0)).toString(),
        },
      };
    });
  }

  // ───── Hilfen ─────

  async sender(tx: Tx, c: CompanyContext): Promise<PdfSender & { currency: string }> {
    const [company, settings] = await Promise.all([
      tx.company.findUnique({ where: { id: c.companyId } }),
      tx.companySettings.findUnique({ where: { companyId: c.companyId } }),
    ]);
    if (!company) throw Errors.notFound('Firma nicht gefunden');
    return {
      name: company.name,
      legalName: company.legalName,
      street: company.street,
      postalCode: company.postalCode,
      city: company.city,
      country: company.country,
      email: company.email,
      phone: company.phone,
      vatId: company.vatId,
      taxNumber: settings?.taxNumber ?? null,
      managingDirector: settings?.managingDirector ?? null,
      registerCourt: settings?.registerCourt ?? null,
      registerNumber: settings?.registerNumber ?? null,
      bankName: settings?.bankName ?? null,
      iban: settings?.iban ?? null,
      bic: settings?.bic ?? null,
      documentFooter: settings?.documentFooter ?? null,
      logoDataUrl: settings?.logoDataUrl ?? null,
      currency: settings?.currency ?? 'EUR',
    };
  }

  private render(
    doc: Pick<
      Document,
      | 'type'
      | 'number'
      | 'issueDate'
      | 'serviceDate'
      | 'dueDate'
      | 'recipient'
      | 'lines'
      | 'taxSummary'
      | 'totalNet'
      | 'totalTax'
      | 'totalGross'
      | 'notes'
    >,
    sender: PdfSender & { currency: string },
    draft: boolean,
  ): Promise<Buffer> {
    const r = doc.recipient as unknown as DocumentRecipient;
    const type = doc.type as DocumentType;
    const reference = [
      r.orderNumber ? { label: 'Auftrag', value: r.orderNumber } : null,
      r.externalNumber ? { label: 'Ihre Bestellung', value: r.externalNumber } : null,
      r.relatedNumber ? { label: 'Zur Rechnung', value: r.relatedNumber } : null,
    ].filter((x): x is { label: string; value: string } => !!x);
    const intro: Partial<Record<DocumentType, string>> = {
      offer: 'Vielen Dank für Ihre Anfrage. Gerne bieten wir Ihnen an:',
      order_confirmation: 'Vielen Dank für Ihren Auftrag. Wir bestätigen:',
      delivery_note: 'Wir liefern Ihnen:',
      invoice: 'Wir berechnen Ihnen:',
      credit_note: 'Wir schreiben Ihnen gut:',
      cancellation: 'Hiermit stornieren wir:',
    };
    return renderDocumentPdf({
      type,
      number: doc.number,
      draft,
      issueDate: doc.issueDate,
      serviceDate: doc.serviceDate,
      dueDate: doc.dueDate,
      sender,
      recipient: { address: r.address, customerNumber: r.customerNumber, vatId: r.vatId },
      reference,
      priceDisplay: r.priceDisplay,
      showPrices: type !== 'delivery_note',
      lines: doc.lines as unknown as DocumentLine[],
      taxSummary: doc.taxSummary as unknown as TaxSummaryRow[],
      totalNet: dec(doc.totalNet).toFixed(2),
      totalTax: dec(doc.totalTax).toFixed(2),
      totalGross: dec(doc.totalGross).toFixed(2),
      intro: intro[type] ?? null,
      notes: doc.notes,
      currency: sender.currency,
    });
  }

  private log(
    tx: Tx,
    c: CompanyContext,
    action: string,
    doc: Pick<Document, 'id' | 'orderId'>,
    data: Record<string, unknown>,
  ) {
    return this.audit.record(tx, {
      accountId: c.account.id,
      userId: c.user.id,
      companyId: c.companyId,
      action,
      entityType: doc.orderId ? 'order' : 'document',
      entityId: doc.orderId ?? doc.id,
      data: { ...data, documentId: doc.id },
      ip: c.ip,
    });
  }
}
