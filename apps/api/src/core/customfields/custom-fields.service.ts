import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { uuidv7, type Tx } from '@fangevo/database';
import {
  customFieldCreateSchema,
  customFieldUpdateSchema,
  type CustomFieldEntity,
} from '@fangevo/shared';
import { AuditService } from '../audit/audit.service';
import { Database } from '../database/database.service';
import { AppError, Errors } from '../http/errors';
import { type TenantContext } from '../http/context';

export interface FieldDef {
  id: string;
  key: string;
  label: string;
  type: string;
  options: { value: string; label: string }[] | null;
  required: boolean;
  position: number;
  referenceEntity: string | null;
  archivedAt: Date | null;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Eigene Felder: Definitionen verwalten und Werte serverseitig prüfen.
 * Werte liegen als JSON am Datensatz (Spalte custom_fields), Schlüssel = Feld-Key.
 */
@Injectable()
export class CustomFieldsService {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  private run<T>(t: TenantContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.db.tenant({ accountId: t.account.id, userId: t.user.id }, fn);
  }

  async definitions(
    tx: Tx,
    entityType: CustomFieldEntity,
    includeArchived = false,
  ): Promise<FieldDef[]> {
    const rows = await tx.customFieldDefinition.findMany({
      where: { entityType, ...(includeArchived ? {} : { archivedAt: null }) },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map((r) => ({ ...r, options: (r.options as FieldDef['options']) ?? null }));
  }

  list(t: TenantContext, entityType: CustomFieldEntity, includeArchived: boolean) {
    return this.run(t, (tx) => this.definitions(tx, entityType, includeArchived));
  }

  create(t: TenantContext, input: z.infer<typeof customFieldCreateSchema>) {
    return this.run(t, async (tx) => {
      const count = await tx.customFieldDefinition.count({
        where: { entityType: input.entityType },
      });
      if (count >= 100)
        throw new AppError(409, 'CONFLICT', 'Maximal 100 eigene Felder je Datensatztyp');
      const id = uuidv7();
      await tx.customFieldDefinition.create({
        data: {
          id,
          accountId: t.account.id,
          entityType: input.entityType,
          key: input.key,
          label: input.label,
          type: input.type,
          options: input.options ?? undefined,
          required: input.required,
          position: input.position,
          referenceEntity: input.type === 'reference' ? input.referenceEntity : null,
        },
      });
      await this.audit.record(tx, {
        accountId: t.account.id,
        userId: t.user.id,
        action: 'custom_field.created',
        entityType: 'custom_field',
        entityId: id,
        data: { ...input },
        ip: t.ip,
      });
      return { id };
    });
  }

  update(t: TenantContext, id: string, input: z.infer<typeof customFieldUpdateSchema>) {
    return this.run(t, async (tx) => {
      const def = await tx.customFieldDefinition.findUnique({ where: { id } });
      if (!def) throw Errors.notFound();
      if ((def.type === 'select' || def.type === 'multiselect') && !input.options?.length)
        throw new AppError(422, 'VALIDATION_FAILED', 'Mindestens eine Auswahlmöglichkeit nötig');
      await tx.customFieldDefinition.update({
        where: { id },
        data: {
          label: input.label,
          required: input.required,
          position: input.position,
          options: def.type === 'select' || def.type === 'multiselect' ? input.options : undefined,
        },
      });
      await this.audit.record(tx, {
        accountId: t.account.id,
        userId: t.user.id,
        action: 'custom_field.updated',
        entityType: 'custom_field',
        entityId: id,
        data: {
          before: { label: def.label, required: def.required, options: def.options },
          after: input,
        },
        ip: t.ip,
      });
    });
  }

  /** Archivieren statt Löschen: gespeicherte Werte bleiben erhalten (nicht-destruktiv). */
  setArchived(t: TenantContext, id: string, archived: boolean) {
    return this.run(t, async (tx) => {
      const r = await tx.customFieldDefinition.updateMany({
        where: { id },
        data: { archivedAt: archived ? new Date() : null },
      });
      if (!r.count) throw Errors.notFound();
      await this.audit.record(tx, {
        accountId: t.account.id,
        userId: t.user.id,
        action: archived ? 'custom_field.archived' : 'custom_field.restored',
        entityType: 'custom_field',
        entityId: id,
        ip: t.ip,
      });
    });
  }

  /**
   * Prüft eingehende Werte gegen die Definitionen und liefert das zu speichernde Objekt.
   * - unbekannte Felder werden abgelehnt
   * - Werte archivierter Felder bleiben unverändert erhalten
   * - Pflichtfelder müssen gefüllt sein
   * - Verweise müssen auf existierende Datensätze desselben Accounts zeigen (RLS)
   */
  async validate(
    tx: Tx,
    entityType: CustomFieldEntity,
    input: Record<string, unknown> | undefined,
    existing: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> {
    const defs = await this.definitions(tx, entityType, true);
    const byKey = new Map(defs.map((d) => [d.key, d]));
    const errors: { path: string; message: string }[] = [];
    const out: Record<string, unknown> = { ...existing };
    for (const [key, raw] of Object.entries(input ?? {})) {
      const def = byKey.get(key);
      if (!def) {
        errors.push({ path: `customFields.${key}`, message: 'Unbekanntes Feld' });
        continue;
      }
      if (def.archivedAt) continue;
      const empty =
        raw === null || raw === undefined || raw === '' || (Array.isArray(raw) && raw.length === 0);
      if (empty) {
        delete out[key];
        continue;
      }
      const r = await this.checkValue(tx, def, raw);
      if (typeof r === 'string') errors.push({ path: `customFields.${key}`, message: r });
      else out[key] = r.value;
    }
    for (const d of defs) {
      if (d.required && !d.archivedAt && (out[d.key] === undefined || out[d.key] === null))
        errors.push({ path: `customFields.${d.key}`, message: `${d.label} ist ein Pflichtfeld` });
    }
    if (errors.length)
      throw new AppError(422, 'VALIDATION_FAILED', 'Eigene Felder sind ungültig', errors);
    return out;
  }

  private async checkValue(
    tx: Tx,
    def: FieldDef,
    raw: unknown,
  ): Promise<{ value: unknown } | string> {
    const opts = new Set((def.options ?? []).map((o) => o.value));
    switch (def.type) {
      case 'text':
        return typeof raw === 'string' && raw.length <= 2000
          ? { value: raw.trim() }
          : 'Text (max. 2000 Zeichen) erwartet';
      case 'number': {
        const n =
          typeof raw === 'number'
            ? raw
            : typeof raw === 'string'
              ? Number(raw.replace(',', '.'))
              : NaN;
        return Number.isFinite(n) && Math.abs(n) < 1e15 ? { value: n } : 'Zahl erwartet';
      }
      case 'date':
        return typeof raw === 'string' &&
          DATE_RE.test(raw) &&
          !Number.isNaN(new Date(raw).getTime())
          ? { value: raw }
          : 'Datum im Format JJJJ-MM-TT erwartet';
      case 'boolean':
        return typeof raw === 'boolean'
          ? { value: raw }
          : raw === 'true' || raw === 'false'
            ? { value: raw === 'true' }
            : 'Ja/Nein erwartet';
      case 'select':
        return typeof raw === 'string' && opts.has(raw) ? { value: raw } : 'Ungültige Auswahl';
      case 'multiselect':
        return Array.isArray(raw) &&
          raw.length <= 100 &&
          raw.every((v) => typeof v === 'string' && opts.has(v))
          ? { value: [...new Set(raw)] }
          : 'Ungültige Auswahl';
      case 'reference': {
        if (typeof raw !== 'string' || !/^[0-9a-f-]{36}$/i.test(raw)) return 'Ungültiger Verweis';
        const exists =
          def.referenceEntity === 'company'
            ? await tx.company.count({ where: { id: raw } })
            : await tx.membership.count({ where: { id: raw } });
        return exists ? { value: raw } : 'Verweisziel nicht gefunden';
      }
      default:
        return 'Unbekannter Feldtyp';
    }
  }
}
