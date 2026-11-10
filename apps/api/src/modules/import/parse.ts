import ExcelJS from 'exceljs';
import { AppError } from '../../core/http/errors';

export const MAX_ROWS = 50_000;
export const MAX_COLUMNS = 200;

export interface ParsedTable {
  headers: string[];
  rows: string[][];
  format: 'csv' | 'xlsx';
}

/** Zeichensatz erkennen: gültiges UTF-8 bevorzugen, sonst Windows-1252 (z. B. ältere Excel-/JTL-Exporte). */
function decodeText(buf: Buffer): string {
  const text = new TextDecoder('utf-8', { fatal: false }).decode(buf).replace(/^\uFEFF/, '');
  if (!text.includes('�')) return text;
  return new TextDecoder('windows-1252').decode(buf);
}

/** Trennzeichen anhand der ersten Zeilen bestimmen (; , Tab |). */
function detectDelimiter(text: string): string {
  const sample = text.split(/\r?\n/).slice(0, 5).join('\n');
  const candidates = [';', ',', '\t', '|'];
  let best = ';';
  let bestCount = -1;
  for (const d of candidates) {
    const n = sample.split(d).length;
    if (n > bestCount) {
      best = d;
      bestCount = n;
    }
  }
  return best;
}

/** CSV nach RFC 4180 (Anführungszeichen, Zeilenumbrüche in Feldern, doppelte Anführungszeichen). */
export function parseCsv(text: string, delimiter = detectDelimiter(text)): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"' && field === '') quoted = true;
    else if (ch === delimiter) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      if (rows.length > MAX_ROWS + 1) break;
    } else field += ch;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if ('result' in v && v.result !== undefined) return cellText(v.result as ExcelJS.CellValue);
    if ('richText' in v) return v.richText.map((r) => r.text).join('');
    if ('text' in v) return String(v.text);
    return '';
  }
  return String(v);
}

/** Liest CSV oder XLSX (erstes Arbeitsblatt). Erste Zeile = Spaltenüberschriften. */
export async function parseTable(fileName: string, buf: Buffer): Promise<ParsedTable> {
  const isXlsx = /\.xlsx$/i.test(fileName) || buf.subarray(0, 2).toString() === 'PK';
  let all: string[][];
  if (isXlsx) {
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(buf as unknown as ArrayBuffer);
    } catch {
      throw new AppError(422, 'VALIDATION_FAILED', 'Die Excel-Datei konnte nicht gelesen werden');
    }
    const ws = wb.worksheets[0];
    if (!ws)
      throw new AppError(422, 'VALIDATION_FAILED', 'Die Excel-Datei enthält kein Arbeitsblatt');
    all = [];
    ws.eachRow({ includeEmpty: false }, (r) => {
      const values = r.values as ExcelJS.CellValue[];
      all.push(values.slice(1).map(cellText));
    });
  } else {
    all = parseCsv(decodeText(buf));
  }
  if (all.length < 2)
    throw new AppError(
      422,
      'VALIDATION_FAILED',
      'Die Datei braucht eine Überschriftenzeile und mindestens eine Datenzeile',
    );
  const headers = all[0]!.map((h, i) => h.trim() || `Spalte ${i + 1}`).slice(0, MAX_COLUMNS);
  const rows = all.slice(1).map((r) => headers.map((_, i) => (r[i] ?? '').trim()));
  if (rows.length > MAX_ROWS)
    throw new AppError(
      422,
      'VALIDATION_FAILED',
      `Höchstens ${MAX_ROWS.toLocaleString('de-DE')} Zeilen je Import`,
    );
  return { headers, rows, format: isXlsx ? 'xlsx' : 'csv' };
}

/** CSV für den Export (Semikolon, UTF-8 mit BOM für Excel, Schutz gegen Formel-Einschleusung). */
export function toCsv(headers: string[], rows: (string | number | null | undefined)[][]): string {
  const esc = (v: string | number | null | undefined) => {
    let s = v === null || v === undefined ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '\uFEFF' + [headers, ...rows].map((r) => r.map(esc).join(';')).join('\r\n') + '\r\n';
}
