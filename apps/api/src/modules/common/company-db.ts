import { Inject, Injectable } from '@nestjs/common';
import { Prisma, uuidv7, type Tx } from '@fangevo/database';
import { type NumberSequenceKey } from '@fangevo/shared';
import { Database } from '../../core/database/database.service';
import { AppError } from '../../core/http/errors';
import { type TenantContext } from '../../core/http/context';

const DEFAULT_SEQUENCES: Record<NumberSequenceKey, { prefix: string; padding: number }> = {
  article: { prefix: 'A-', padding: 6 },
  customer: { prefix: 'K-', padding: 6 },
  supplier: { prefix: 'L-', padding: 5 },
};

/** Firmenkontext einer Anfrage (Account, Benutzer und aktive Firma). */
export interface CompanyContext extends TenantContext {
  companyId: string;
}

export function requireCompany(t: TenantContext): CompanyContext {
  if (!t.companyId)
    throw new AppError(
      400,
      'COMPANY_REQUIRED',
      'Bitte zuerst eine Firma auswählen (Header X-Company-Id)',
    );
  return t as CompanyContext;
}

/**
 * Datenbankzugriff für firmenbezogene Fachdaten. Setzt Account, Benutzer und Firma
 * für die Row-Level-Security und legt beim ersten Zugriff die Standardwerte der Firma an.
 */
@Injectable()
export class CompanyDb {
  private readonly initialized = new Set<string>();
  constructor(@Inject(Database) private readonly db: Database) {}

  async run<T>(t: TenantContext, fn: (tx: Tx, c: CompanyContext) => Promise<T>): Promise<T> {
    const c = requireCompany(t);
    const ctx = { accountId: c.account.id, userId: c.user.id, companyId: c.companyId };
    if (!this.initialized.has(c.companyId)) {
      // Eigene Transaktion: Standardwerte bleiben auch erhalten, wenn die eigentliche Anfrage scheitert.
      await this.db.tenant(ctx, (tx) => this.ensureDefaults(tx, c.account.id, c.companyId));
      this.initialized.add(c.companyId);
    }
    return this.db.tenant(ctx, (tx) => fn(tx, c));
  }

  /** Standardwerte einer Firma (idempotent). Steuersätze sind Vorschläge und frei änderbar. */
  async ensureDefaults(tx: Tx, accountId: string, companyId: string): Promise<void> {
    // Sperre über den Primärschlüssel: Bei gleichzeitigen ersten Zugriffen legt genau einer die Werte an.
    const created = await tx.companySettings.createMany({
      data: [{ companyId, accountId }],
      skipDuplicates: true,
    });
    if (created.count === 0) return;
    const base = { accountId, companyId };
    await tx.taxRate.createMany({
      data: [
        {
          ...base,
          id: uuidv7(),
          name: 'Regelsteuersatz',
          rate: new Prisma.Decimal(19),
          isDefault: true,
        },
        { ...base, id: uuidv7(), name: 'Ermäßigter Steuersatz', rate: new Prisma.Decimal(7) },
        { ...base, id: uuidv7(), name: 'Steuerfrei', rate: new Prisma.Decimal(0) },
      ],
    });
    await tx.customerGroup.createMany({
      data: [
        { ...base, id: uuidv7(), name: 'Endkunden', priceDisplay: 'gross', isDefault: true },
        { ...base, id: uuidv7(), name: 'Geschäftskunden', priceDisplay: 'net' },
      ],
    });
    await tx.warehouse.create({
      data: { ...base, id: uuidv7(), code: 'HL', name: 'Hauptlager', isDefault: true },
    });
    await tx.numberSequence.createMany({
      data: Object.entries(DEFAULT_SEQUENCES).map(([key, v]) => ({ ...base, key, ...v })),
    });
  }

  /**
   * Nächste Nummer aus einem Nummernkreis. Die Zeile wird bis zum Ende der Transaktion gesperrt;
   * scheitert die Transaktion, wird die Nummer nicht verbraucht (lückenlos).
   */
  async nextNumber(tx: Tx, companyId: string, key: NumberSequenceKey): Promise<string> {
    const rows = await tx.$queryRaw<{ prefix: string; value: number; padding: number }[]>`
      UPDATE number_sequences SET next_value = next_value + 1
      WHERE company_id = ${companyId}::uuid AND key = ${key}
      RETURNING prefix, next_value - 1 AS value, padding`;
    const r = rows[0];
    if (!r) throw new AppError(500, 'INTERNAL_ERROR', `Nummernkreis ${key} fehlt`);
    return `${r.prefix}${String(r.value).padStart(r.padding, '0')}`;
  }

  /** Testhilfe: Initialisierungs-Cache leeren. */
  reset(): void {
    this.initialized.clear();
  }
}
