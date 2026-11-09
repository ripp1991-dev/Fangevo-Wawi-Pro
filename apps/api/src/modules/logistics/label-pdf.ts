import PDFDocument from 'pdfkit';

export interface LabelInput {
  sender: string[];
  recipient: string[];
  shipmentNumber: string;
  orderNumber: string;
  parcel: number;
  parcels: number;
  weightKg: string;
}

/**
 * Eigenes Adressetikett (A6 quer) – ohne Frankierung und ohne Barcode eines Versanddienstleisters.
 * Für Abholung durch eigene Fahrer, Selbstabgabe mit Frankierung am Schalter o. Ä.
 */
export function renderLabelPdf(labels: LabelInput[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: [419.53, 297.64],
      margin: 18,
      info: { Title: 'Versandetikett', Producer: 'FangEvo Wawi Pro' },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    labels.forEach((l, i) => {
      if (i > 0) doc.addPage();
      doc
        .fontSize(7)
        .fillColor('#444444')
        .text(`Absender: ${l.sender.join(', ')}`, 18, 18, { width: 383 });
      doc.moveTo(18, 34).lineTo(401, 34).strokeColor('#999999').lineWidth(0.5).stroke();
      doc.fillColor('#000000').fontSize(9).text('Empfänger', 18, 48);
      doc.font('Helvetica-Bold').fontSize(15).text(l.recipient.join('\n'), 18, 62, { width: 383 });
      doc.font('Helvetica').fontSize(9);
      doc.moveTo(18, 220).lineTo(401, 220).stroke();
      doc.text(`Sendung ${l.shipmentNumber}`, 18, 228);
      doc.text(`Auftrag ${l.orderNumber}`, 18, 242);
      doc.text(`Paket ${l.parcel} von ${l.parcels} · ${l.weightKg} kg`, 18, 256);
      doc
        .font('Helvetica-Bold')
        .fontSize(20)
        .text(l.shipmentNumber, 210, 232, { width: 191, align: 'right' });
      doc.font('Helvetica');
    });
    doc.end();
  });
}
