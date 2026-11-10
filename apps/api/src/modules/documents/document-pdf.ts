import PDFDocument from 'pdfkit';
import { DOCUMENT_TYPES, type DocumentType } from '@fangevo/shared';

export interface PdfSender {
  name: string;
  legalName: string | null;
  street: string | null;
  postalCode: string | null;
  city: string | null;
  country: string;
  email: string | null;
  phone: string | null;
  vatId: string | null;
  taxNumber: string | null;
  managingDirector: string | null;
  registerCourt: string | null;
  registerNumber: string | null;
  bankName: string | null;
  iban: string | null;
  bic: string | null;
  documentFooter: string | null;
  logoDataUrl: string | null;
}

export interface PdfAddress {
  name: string | null;
  name2?: string | null;
  street: string | null;
  postalCode: string | null;
  city: string | null;
  country: string;
}

export interface PdfLine {
  articleNumber: string | null;
  name: string;
  unit: string;
  quantity: string;
  unitPriceNet: string;
  discountPercent: string;
  taxRate: string;
  lineNet: string;
  lineGross: string;
}

export interface PdfInput {
  type: DocumentType;
  number: string | null;
  draft: boolean;
  issueDate: Date;
  serviceDate: Date | null;
  dueDate: Date | null;
  sender: PdfSender;
  recipient: { address: PdfAddress | null; customerNumber?: string | null; vatId?: string | null };
  reference: { label: string; value: string }[];
  priceDisplay: 'net' | 'gross';
  showPrices: boolean;
  /** false: ohne Steuerspalte und Steuerausweis (z. B. Bestellungen an Lieferanten) */
  showTax?: boolean;
  lines: PdfLine[];
  taxSummary: { rate: string; net: string; tax: string; gross: string }[];
  totalNet: string;
  totalTax: string;
  totalGross: string;
  intro: string | null;
  notes: string | null;
  currency: string;
}

const fmtMoney = (v: string, currency: string) =>
  new Intl.NumberFormat('de-DE', { style: 'currency', currency }).format(Number(v));
const fmtNum = (v: string) =>
  new Intl.NumberFormat('de-DE', { maximumFractionDigits: 4 }).format(Number(v));
const fmtDate = (d: Date) =>
  new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin' }).format(d);

const NUMBER_LABEL: Record<DocumentType, string> = {
  offer: 'Angebotsnummer',
  order_confirmation: 'Belegnummer',
  delivery_note: 'Lieferscheinnummer',
  invoice: 'Rechnungsnummer',
  credit_note: 'Gutschriftnummer',
  cancellation: 'Stornonummer',
  purchase_order: 'Bestellnummer',
};

const COUNTRY: Record<string, string> = { DE: '', AT: 'Österreich', CH: 'Schweiz' };

function addressLines(a: PdfAddress): string[] {
  return [
    a.name,
    a.name2,
    a.street,
    [a.postalCode, a.city].filter(Boolean).join(' '),
    COUNTRY[a.country] ?? a.country,
  ].filter((x): x is string => !!x && x.trim() !== '');
}

/**
 * Erzeugt das PDF eines Belegs (A4, DIN-5008-ähnliches Layout).
 * Rechnungen enthalten die Pflichtangaben nach § 14 Abs. 4 UStG, soweit sie in den
 * Firmeneinstellungen hinterlegt sind; die Prüfung auf Vollständigkeit erfolgt vor dem Festschreiben.
 */
export function renderDocumentPdf(input: PdfInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      bufferPages: true,
      margins: { top: 50, bottom: 90, left: 60, right: 50 },
      info: {
        Title: `${DOCUMENT_TYPES[input.type]} ${input.number ?? ''}`.trim(),
        Author: input.sender.legalName ?? input.sender.name,
        Producer: 'FangEvo Wawi Pro',
        Creator: 'FangEvo Wawi Pro',
      },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const s = input.sender;
    const left = 60;
    const right = doc.page.width - 50;
    const width = right - left;
    const cur = input.currency;

    // Kopf: Logo und Absender
    if (s.logoDataUrl) {
      try {
        const data = Buffer.from(s.logoDataUrl.split(',')[1] ?? '', 'base64');
        doc.image(data, right - 150, 40, { fit: [150, 60], align: 'right' });
      } catch {
        // Ungültiges Logo wird ignoriert, der Beleg entsteht trotzdem.
      }
    }
    const senderName = s.legalName || s.name;
    doc
      .fontSize(7)
      .fillColor('#555555')
      .text(
        [senderName, s.street, [s.postalCode, s.city].filter(Boolean).join(' ')]
          .filter(Boolean)
          .join(' · '),
        left,
        130,
        { width: 260, underline: false },
      );

    // Empfänger
    doc.fillColor('#000000').fontSize(10);
    const addr = input.recipient.address ? addressLines(input.recipient.address) : [];
    doc.text(addr.join('\n') || '–', left, 145, { width: 250 });

    // Infoblock rechts
    const info: [string, string][] = [];
    if (input.number) info.push([NUMBER_LABEL[input.type], input.number]);
    info.push(['Datum', fmtDate(input.issueDate)]);
    if (input.serviceDate) info.push(['Leistungsdatum', fmtDate(input.serviceDate)]);
    if (input.recipient.customerNumber) info.push(['Kundennummer', input.recipient.customerNumber]);
    for (const r of input.reference) info.push([r.label, r.value]);
    if (input.recipient.vatId) info.push(['USt-IdNr. Kunde', input.recipient.vatId]);
    if (input.dueDate) info.push(['Fällig am', fmtDate(input.dueDate)]);
    let y = 140;
    doc.fontSize(9);
    for (const [k, v] of info) {
      doc.fillColor('#555555').text(k, right - 220, y, { width: 100 });
      doc.fillColor('#000000').text(v, right - 115, y, { width: 115, align: 'right' });
      y += 14;
    }

    // Titel
    y = Math.max(y, 230) + 15;
    doc
      .fontSize(15)
      .font('Helvetica-Bold')
      .text(`${DOCUMENT_TYPES[input.type]}${input.number ? ` ${input.number}` : ''}`, left, y);
    doc.font('Helvetica');
    if (input.draft) {
      doc
        .fontSize(10)
        .fillColor('#b00020')
        .text('ENTWURF – nicht gültig', right - 200, y + 4, {
          width: 200,
          align: 'right',
        });
      doc.fillColor('#000000');
    }
    y += 28;
    if (input.intro) {
      doc.fontSize(10).text(input.intro, left, y, { width });
      y = doc.y + 10;
    }

    // Positionen
    const gross = input.priceDisplay === 'gross';
    const cols = input.showPrices
      ? [
          { key: 'pos', label: 'Pos.', w: 28, align: 'left' as const },
          { key: 'name', label: 'Bezeichnung', w: 0, align: 'left' as const },
          { key: 'qty', label: 'Menge', w: 62, align: 'right' as const },
          {
            key: 'price',
            label: gross ? 'Einzelpreis brutto' : 'Einzelpreis netto',
            w: 72,
            align: 'right' as const,
          },
          ...(input.showTax === false
            ? []
            : [{ key: 'tax', label: 'USt', w: 34, align: 'right' as const }]),
          {
            key: 'total',
            label: gross ? 'Gesamt brutto' : 'Gesamt netto',
            w: 74,
            align: 'right' as const,
          },
        ]
      : [
          { key: 'pos', label: 'Pos.', w: 28, align: 'left' as const },
          { key: 'name', label: 'Bezeichnung', w: 0, align: 'left' as const },
          { key: 'qty', label: 'Menge', w: 90, align: 'right' as const },
        ];
    const fixed = cols.reduce((s2, c) => s2 + c.w, 0);
    cols.find((c) => c.key === 'name')!.w = width - fixed;

    const header = () => {
      doc.fontSize(8).font('Helvetica-Bold');
      let x = left;
      for (const c of cols) {
        doc.text(c.label, x, y, { width: c.w - 4, align: c.align });
        x += c.w;
      }
      doc.font('Helvetica');
      y += 14;
      doc
        .moveTo(left, y - 3)
        .lineTo(right, y - 3)
        .strokeColor('#999999')
        .lineWidth(0.5)
        .stroke();
    };
    header();
    doc.fontSize(9);
    input.lines.forEach((l, i) => {
      const unitNet = Number(l.unitPriceNet);
      const unit = gross ? (unitNet * (100 + Number(l.taxRate))) / 100 : unitNet;
      const discount = Number(l.discountPercent);
      const nameText =
        (l.articleNumber ? `${l.articleNumber} · ` : '') +
        l.name +
        (discount > 0 && input.showPrices ? `\nRabatt ${fmtNum(l.discountPercent)} %` : '');
      const values: Record<string, string> = {
        pos: String(i + 1),
        name: nameText,
        qty: `${fmtNum(l.quantity)} ${l.unit}`,
        price: fmtMoney(unit.toFixed(4), cur),
        tax: `${fmtNum(l.taxRate)} %`,
        total: fmtMoney(gross ? l.lineGross : l.lineNet, cur),
      };
      const h = Math.max(
        doc.heightOfString(nameText, { width: cols.find((c) => c.key === 'name')!.w - 4 }),
        12,
      );
      if (y + h > doc.page.height - 140) {
        doc.addPage();
        y = 60;
        header();
        doc.fontSize(9);
      }
      let x = left;
      for (const c of cols) {
        doc.text(values[c.key] ?? '', x, y, { width: c.w - 4, align: c.align });
        x += c.w;
      }
      y += h + 6;
    });
    doc.moveTo(left, y).lineTo(right, y).strokeColor('#999999').lineWidth(0.5).stroke();
    y += 8;

    // Summen
    if (input.showPrices) {
      if (y > doc.page.height - 200) {
        doc.addPage();
        y = 60;
      }
      const row = (label: string, value: string, bold = false) => {
        doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9);
        doc.text(label, right - 260, y, { width: 170, align: 'right' });
        doc.text(value, right - 90, y, { width: 90, align: 'right' });
        y += 14;
      };
      row('Summe netto', fmtMoney(input.totalNet, cur), input.showTax === false);
      if (input.showTax !== false) {
        for (const t of input.taxSummary) {
          row(`zzgl. ${fmtNum(t.rate)} % USt auf ${fmtMoney(t.net, cur)}`, fmtMoney(t.tax, cur));
        }
        row('Gesamtbetrag', fmtMoney(input.totalGross, cur), true);
      }
      doc.font('Helvetica');
      y += 8;
    }

    if (input.notes) {
      doc.fontSize(9).text(input.notes, left, y, { width });
      y = doc.y + 8;
    }
    if (input.type === 'invoice' && input.dueDate && s.iban) {
      doc
        .fontSize(9)
        .text(
          `Bitte überweisen Sie den Betrag bis zum ${fmtDate(input.dueDate)} unter Angabe der Rechnungsnummer auf das unten genannte Konto.`,
          left,
          y,
          { width },
        );
    }

    // Fußzeile auf jeder Seite
    const footer = [
      [senderName, s.street, [s.postalCode, s.city].filter(Boolean).join(' '), s.email, s.phone],
      [
        s.managingDirector ? `Geschäftsführung: ${s.managingDirector}` : null,
        s.registerCourt && s.registerNumber ? `${s.registerCourt} ${s.registerNumber}` : null,
        s.vatId ? `USt-IdNr.: ${s.vatId}` : null,
        s.taxNumber ? `Steuernummer: ${s.taxNumber}` : null,
      ],
      [s.bankName, s.iban ? `IBAN ${s.iban}` : null, s.bic ? `BIC ${s.bic}` : null],
    ].map((col) => col.filter(Boolean).join('\n'));
    const range = doc.bufferedPageRange();
    for (let p = range.start; p < range.start + range.count; p++) {
      doc.switchToPage(p);
      // Fußzeile liegt im unteren Rand: Rand kurz aufheben, sonst entstünde eine neue Seite.
      const bottom = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      const fy = doc.page.height - 80;
      doc
        .moveTo(left, fy - 6)
        .lineTo(right, fy - 6)
        .strokeColor('#cccccc')
        .lineWidth(0.5)
        .stroke();
      doc.fontSize(7).fillColor('#555555');
      const cw = width / 3;
      footer.forEach((text, i) => {
        doc.text(text, left + i * cw, fy, { width: cw - 8, lineBreak: true, height: 50 });
      });
      if (s.documentFooter) doc.text(s.documentFooter, left, fy + 44, { width, height: 12 });
      doc.text(`Seite ${p - range.start + 1} von ${range.count}`, right - 80, fy + 56, {
        width: 80,
        align: 'right',
      });
      doc.fillColor('#000000');
      doc.page.margins.bottom = bottom;
    }
    doc.end();
  });
}
