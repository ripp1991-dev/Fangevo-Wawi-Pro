import { Inject, Injectable, Logger } from '@nestjs/common';
import { type z } from 'zod';
import { Prisma, uuidv7, type ImportJob, type Tx } from '@fangevo/database';
import {
  articleInputSchema,
  customerInputSchema,
  IMPORT_FIELDS,
  importConfigSchema,
  supplierInputSchema,
  suggestMapping,
  type ExportEntity,
  type ImportConfig,
  type ImportEntity,
  type importTemplateSchema,
  type ListQuery,
} from '@fangevo/shared';
import { AccessService } from '../../core/access/access.service';
import { AuditService } from '../../core/audit/audit.service';
import { AppError, Errors } from '../../core/http/errors';
import { type TenantContext } from '../../core/http/context';
import { JobQueue, type JobHandler, type QueuedJob } from '../../core/jobs/job-queue.service';
import { buildListArgs, type FieldSpec } from '../../core/lists/list-query';
import { ArticlesService } from '../articles/articles.service';
import { CompanyDb, type CompanyContext } from '../common/company-db';
import { dec } from '../common/decimal';
import { CustomersService } from '../customers/customers.service';
import { InventoryService } from '../inventory/inventory.service';
import { MasterDataService } from '../settings/master-data.service';
import { SuppliersService } from '../suppliers/suppliers.service';
import { parseTable, toCsv } from './parse';

export const IMPORT_JOB_FIELDS: FieldSpec = {
  entity: { kind: 'enum', sortable: true },
  status: { kind: 'enum', sortable: true },
  fileName: { kind: 'string', sortable: true },
  createdAt: { kind: 'date', sortable: true },
};

const MAX_ERRORS = 1000;

// ───── Werte umwandeln ─────
const TRUE = new Set(['ja', 'j', 'yes', 'y', '1', 'true', 'wahr', 'x', 'aktiv', 'active']);
const FALSE = new Set(['nein', 'n', 'no', '0', 'false', 'falsch', 'inaktiv', 'inactive']);

export function parseBool(v: string): boolean | undefined {
  const s = v.trim().toLowerCase();
  if (TRUE.has(s)) return true;
  if (FALSE.has(s)) return false;
  return undefined;
}

/** Deutsche und englische Zahlenschreibweise: "1.234,56", "1234,56", "1234.56", "1,234.56". */
export function parseNumber(v: string): string | undefined {
  let s = v.trim().replace(/\s|€|%/g, '');
  if (!s) return undefined;
  const comma = s.lastIndexOf(',');
  const dot = s.lastIndexOf('.');
  if (comma > -1 && dot > -1)
    s = comma > dot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  else if (comma > -1) s = s.replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(s)) throw new Error(`„${v}“ ist keine Zahl`);
  return s;
}

/** Datum TT.MM.JJJJ oder JJJJ-MM-TT → JJJJ-MM-TT */
export function parseDate(v: string): string | undefined {
  const s = v.trim();
  if (!s) return undefined;
  const de = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(s);
  if (de) return `${de[3]}-${de[2]!.padStart(2, '0')}-${de[1]!.padStart(2, '0')}`;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  throw new Error(`„${v}“ ist kein Datum (TT.MM.JJJJ)`);
}

function zodMessage(e: unknown): string {
  if (e && typeof e === 'object' && 'issues' in e) {
    const issues = (e as { issues: { path: PropertyKey[]; message: string }[] }).issues;
    return issues.map((i) => `${i.path.join('.') || 'Eingabe'}: ${i.message}`).join('; ');
  }
  return e instanceof Error ? e.message : String(e);
}

type Values = Record<string, string>;
type RowResult =
  | { action: 'skip'; reason: string }
  | {
      action: 'create' | 'update' | 'book';
      run: () => Promise<{ entityType: string; entityId: string } | null>;
    };

/**
 * FangEvo Import: Datei hochladen → Spalten zuordnen → Prüflauf → Ausführung im Hintergrund.
 * Jede Zeile läuft über die Services der Fachmodule (gleiche Prüfungen, Rechte, Protokolle wie
 * bei der Eingabe in der Oberfläche) in einer eigenen Transaktion; Fehler einer Zeile stoppen den Import nicht.
 */
@Injectable()
export class ImportService implements JobHandler {
  readonly kind = 'import';
  private readonly logger = new Logger('Import');

  constructor(
    @Inject(CompanyDb) private readonly cdb: CompanyDb,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(JobQueue) private readonly queue: JobQueue,
    @Inject(AccessService) private readonly access: AccessService,
    @Inject(ArticlesService) private readonly articles: ArticlesService,
    @Inject(CustomersService) private readonly customers: CustomersService,
    @Inject(SuppliersService) private readonly suppliers: SuppliersService,
    @Inject(InventoryService) private readonly inventory: InventoryService,
    @Inject(MasterDataService) private readonly masterData: MasterDataService,
  ) {}

  // ───── Aufträge (Jobs) ─────

  list(t: TenantContext, q: ListQuery) {
    return this.cdb.run(t, async (tx) => {
      const args = buildListArgs(q, IMPORT_JOB_FIELDS, {
        search: ['fileName'],
        defaultSort: 'createdAt:desc',
      });
      const [items, total] = await Promise.all([
        tx.importJob.findMany({
          where: args.where,
          orderBy: args.orderBy,
          skip: args.skip,
          take: args.take,
          omit: { rows: true, errors: true, headers: true },
        }),
        tx.importJob.count({ where: args.where }),
      ]);
      return { items, total, page: q.page, pageSize: q.pageSize };
    });
  }

  get(t: TenantContext, id: string) {
    return this.cdb.run(t, async (tx) => this.view(await this.requireJob(tx, id)));
  }

  private view(job: ImportJob) {
    const { rows, ...rest } = job;
    return {
      ...rest,
      preview: (rows as string[][]).slice(0, 20),
      suggestion: suggestMapping(job.entity as ImportEntity, job.headers as string[]),
    };
  }

  private async requireJob(tx: Tx, id: string): Promise<ImportJob> {
    const job = await tx.importJob.findUnique({ where: { id } });
    if (!job) throw Errors.notFound();
    return job;
  }

  async upload(
    t: TenantContext,
    input: { entity: ImportEntity; fileName: string; contentBase64: string },
  ) {
    const buf = Buffer.from(input.contentBase64, 'base64');
    if (buf.length > 10 * 1024 * 1024)
      throw new AppError(422, 'VALIDATION_FAILED', 'Die Datei ist zu groß (höchstens 10 MB)');
    const table = await parseTable(input.fileName, buf);
    return this.cdb.run(t, async (tx, c) => {
      const job = await tx.importJob.create({
        data: {
          id: uuidv7(),
          accountId: c.account.id,
          companyId: c.companyId,
          entity: input.entity,
          fileName: input.fileName,
          headers: table.headers,
          rows: table.rows,
          totalRows: table.rows.length,
          createdBy: c.user.id,
        },
      });
      await this.log(tx, c, 'import.uploaded', job, {
        entity: input.entity,
        rows: table.rows.length,
      });
      return this.view(job);
    });
  }

  /** Prüflauf: wandelt alle Zeilen um und prüft sie, ohne etwas zu speichern. */
  validate(t: TenantContext, id: string, raw: ImportConfig) {
    const config = importConfigSchema.parse(raw);
    return this.cdb.run(t, async (tx, c) => {
      const job = await this.requireJob(tx, id);
      if (!['uploaded', 'validated'].includes(job.status))
        throw new AppError(409, 'CONFLICT', 'Dieser Import wurde bereits gestartet');
      this.checkMapping(job.entity as ImportEntity, config, (job.headers as string[]).length);
      const rows = job.rows as string[][];
      const counts = { create: 0, update: 0, book: 0, skip: 0, error: 0 };
      const errors: { row: number; message: string }[] = [];
      const cache = new Map<string, string | null>();
      for (const [i, row] of rows.entries()) {
        try {
          const r = await this.prepare(
            tx,
            c,
            job.entity as ImportEntity,
            this.values(row, config),
            config,
            cache,
            true,
          );
          counts[r.action]++;
        } catch (e) {
          counts.error++;
          if (errors.length < MAX_ERRORS) errors.push({ row: i + 2, message: zodMessage(e) });
        }
      }
      const dryRun = {
        ...counts,
        errors: errors.slice(0, 200),
        checkedAt: new Date().toISOString(),
      };
      await tx.importJob.update({
        where: { id },
        data: {
          status: 'validated',
          config: config as unknown as Prisma.InputJsonValue,
          dryRun: dryRun as unknown as Prisma.InputJsonValue,
        },
      });
      return dryRun;
    });
  }

  /** Ausführung starten (nur nach Prüflauf). */
  start(t: TenantContext, id: string) {
    return this.cdb.run(t, async (tx, c) => {
      const job = await this.requireJob(tx, id);
      if (job.status !== 'validated')
        throw new AppError(409, 'CONFLICT', 'Bitte zuerst den Prüflauf durchführen');
      await tx.importJob.update({ where: { id }, data: { status: 'queued' } });
      await this.queue.enqueue(tx, {
        kind: this.kind,
        accountId: c.account.id,
        companyId: c.companyId,
        userId: c.user.id,
        refId: id,
      });
      await this.log(tx, c, 'import.started', job, { entity: job.entity, rows: job.totalRows });
      return this.view({ ...job, status: 'queued' });
    });
  }

  // ───── Hintergrund-Ausführung ─────

  async run(q: QueuedJob): Promise<void> {
    if (!q.userId || !q.companyId) throw new Error('Import ohne Benutzer/Firma');
    const account = await this.access.loadAccountContext(q.userId, q.accountId);
    if (!account) throw new Error('Benutzer hat keinen Zugriff mehr auf den Account');
    const t: TenantContext = {
      sessionId: `job:${q.id}`,
      user: { id: q.userId, email: '', name: 'Import', mfaEnabled: false },
      account,
      companyId: q.companyId,
      ip: null,
    };
    const job = await this.cdb.run(t, async (tx) => {
      const j = await this.requireJob(tx, q.refId);
      if (!['queued', 'running'].includes(j.status)) return null;
      await tx.importJob.update({
        where: { id: j.id },
        data: { status: 'running', startedAt: new Date() },
      });
      return j;
    });
    if (!job) return;
    const entity = job.entity as ImportEntity;
    const config = importConfigSchema.parse(job.config);
    const rows = job.rows as string[][];
    const cache = new Map<string, string | null>();
    let ok = job.okRows;
    let failed = job.errorRows;
    const errors = [...((job.errors as { row: number; message: string }[]) ?? [])];
    // Bei Wiederaufnahme nach Absturz: bereits verarbeitete Zeilen überspringen
    for (let i = job.processedRows; i < rows.length; i++) {
      try {
        const prepared = await this.cdb.run(t, (tx, c) =>
          this.prepare(tx, c, entity, this.values(rows[i]!, config), config, cache, false),
        );
        if (prepared.action !== 'skip') {
          const rec = await prepared.run();
          if (rec)
            await this.cdb.run(t, (tx, c) =>
              tx.importJobRecord.create({
                data: {
                  id: uuidv7(),
                  accountId: c.account.id,
                  companyId: c.companyId,
                  jobId: job.id,
                  rowNumber: i + 2,
                  entityType: rec.entityType,
                  entityId: rec.entityId,
                  action:
                    prepared.action === 'book'
                      ? 'booked'
                      : prepared.action === 'create'
                        ? 'created'
                        : 'updated',
                },
              }),
            );
        }
        ok++;
      } catch (e) {
        failed++;
        if (errors.length < MAX_ERRORS) errors.push({ row: i + 2, message: zodMessage(e) });
      }
      if ((i + 1) % 50 === 0 || i === rows.length - 1)
        await this.cdb.run(t, (tx) =>
          tx.importJob.update({
            where: { id: job.id },
            data: {
              processedRows: i + 1,
              okRows: ok,
              errorRows: failed,
              errors: errors as unknown as Prisma.InputJsonValue,
            },
          }),
        );
    }
    await this.cdb.run(t, async (tx, c) => {
      await tx.importJob.update({
        where: { id: job.id },
        data: {
          status: 'done',
          finishedAt: new Date(),
          processedRows: rows.length,
          okRows: ok,
          errorRows: failed,
          errors: errors as unknown as Prisma.InputJsonValue,
        },
      });
      await this.log(tx, c, 'import.finished', job, { entity, ok, failed });
    });
  }

  async failed(q: QueuedJob, error: unknown): Promise<void> {
    if (!q.userId || !q.companyId) return;
    const account = await this.access.loadAccountContext(q.userId, q.accountId);
    if (!account) return;
    await this.cdb.run(
      {
        sessionId: 'job',
        user: { id: q.userId, email: '', name: 'Import', mfaEnabled: false },
        account,
        companyId: q.companyId,
        ip: null,
      },
      (tx) =>
        tx.importJob.update({
          where: { id: q.refId },
          data: {
            status: 'failed',
            finishedAt: new Date(),
            errors: [
              { row: 0, message: `Abbruch: ${String(error).slice(0, 500)}` },
            ] as unknown as Prisma.InputJsonValue,
          },
        }),
    );
  }

  /** Rückgängig: neu angelegte Artikel, Kunden, Lieferanten werden archiviert. Buchungen bleiben (Journal). */
  rollback(t: TenantContext, id: string) {
    return this.cdb
      .run(t, async (tx) => {
        const job = await this.requireJob(tx, id);
        if (job.status !== 'done')
          throw new AppError(
            409,
            'CONFLICT',
            'Nur abgeschlossene Importe können rückgängig gemacht werden',
          );
        if (!['articles', 'customers', 'suppliers'].includes(job.entity))
          throw new AppError(
            409,
            'CONFLICT',
            'Bestands-, Preis- und Kategorie-Importe können nicht automatisch zurückgenommen werden (Korrektur über Inventur bzw. Bearbeitung)',
          );
        return tx.importJobRecord.findMany({ where: { jobId: id, action: 'created' } });
      })
      .then(async (records) => {
        let archived = 0;
        for (const r of records) {
          if (r.entityType === 'article') await this.articles.setArchived(t, r.entityId, true);
          else if (r.entityType === 'customer')
            await this.customers.setArchived(t, r.entityId, true);
          else if (r.entityType === 'supplier')
            await this.suppliers.setArchived(t, r.entityId, true);
          archived++;
        }
        return this.cdb.run(t, async (tx, c) => {
          const job = await tx.importJob.update({
            where: { id },
            data: { status: 'rolled_back' },
            omit: { rows: true },
          });
          await this.log(tx, c, 'import.rolled_back', job as ImportJob, { archived });
          return {
            archived,
            updatedNotReverted: await tx.importJobRecord.count({
              where: { jobId: id, action: 'updated' },
            }),
          };
        });
      });
  }

  // ───── Zeilen vorbereiten ─────

  private checkMapping(entity: ImportEntity, config: ImportConfig, columns: number) {
    for (const [k, idx] of Object.entries(config.mapping)) {
      if (!IMPORT_FIELDS[entity].some((f) => f.key === k))
        throw new AppError(422, 'VALIDATION_FAILED', `Unbekanntes Feld ${k}`);
      if (idx >= columns)
        throw new AppError(422, 'VALIDATION_FAILED', `Spalte ${idx + 1} gibt es nicht`);
    }
    // Beim reinen Ändern genügt die Nummer; Pflichtfelder gelten für neue Datensätze
    const updateOnly =
      config.mode === 'update' && ['articles', 'customers', 'suppliers'].includes(entity);
    for (const f of IMPORT_FIELDS[entity].filter((x) => x.required && !updateOnly))
      if (config.mapping[f.key] === undefined && !config.defaults[f.key])
        throw new AppError(
          422,
          'VALIDATION_FAILED',
          `Pflichtfeld „${f.label}“ ist keiner Spalte zugeordnet`,
        );
  }

  private values(row: string[], config: ImportConfig): Values {
    const out: Values = {};
    for (const [k, def] of Object.entries(config.defaults)) out[k] = def;
    for (const [k, idx] of Object.entries(config.mapping)) {
      const v = (row[idx] ?? '').trim();
      if (v !== '') out[k] = v;
    }
    return out;
  }

  private async prepare(
    tx: Tx,
    c: CompanyContext,
    entity: ImportEntity,
    v: Values,
    config: ImportConfig,
    cache: Map<string, string | null>,
    dry: boolean,
  ): Promise<RowResult> {
    const t = this.ctx(c);
    switch (entity) {
      case 'articles':
        return this.prepareArticle(tx, c, t, v, config, cache, dry);
      case 'customers':
        return this.prepareParty(tx, t, 'customer', v, config, cache);
      case 'suppliers':
        return this.prepareParty(tx, t, 'supplier', v, config, cache);
      case 'stock':
        return this.prepareStock(tx, c, t, v, config, cache, dry);
      case 'prices':
        return this.preparePrice(tx, t, v);
      case 'categories': {
        if (!v.path) throw new Error('Kategoriepfad fehlt');
        const existing = await this.masterData.categoryPath(tx, c, v.path, false);
        if (existing) return { action: 'skip', reason: 'vorhanden' };
        return {
          action: 'create',
          run: () =>
            this.cdb.run(t, async (tx2, c2) => ({
              entityType: 'category',
              entityId: (await this.masterData.categoryPath(tx2, c2, v.path!, true))!,
            })),
        };
      }
    }
  }

  private ctx(c: CompanyContext): TenantContext {
    return {
      sessionId: c.sessionId,
      user: c.user,
      account: c.account,
      companyId: c.companyId,
      ip: c.ip,
    };
  }

  private async findArticle(tx: Tx, ref: string) {
    return (
      (await tx.article.findFirst({ where: { number: ref, archivedAt: null } })) ??
      (await tx.article.findFirst({ where: { gtin: ref, archivedAt: null } })) ??
      (await tx.articleBarcode
        .findFirst({ where: { code: ref } })
        .then((b) => (b ? tx.article.findUnique({ where: { id: b.articleId } }) : null)))
    );
  }

  private async prepareArticle(
    tx: Tx,
    c: CompanyContext,
    t: TenantContext,
    v: Values,
    config: ImportConfig,
    cache: Map<string, string | null>,
    _dry: boolean,
  ): Promise<RowResult> {
    const existing = v.number ? await tx.article.findFirst({ where: { number: v.number } }) : null;
    if (existing && config.mode === 'create')
      return { action: 'skip', reason: 'Artikelnummer vorhanden' };
    if (!existing && config.mode === 'update')
      throw new Error(`Artikel ${v.number ?? '(ohne Nummer)'} nicht gefunden`);
    const o: Record<string, unknown> = {};
    for (const k of [
      'number',
      'name',
      'shortDescription',
      'description',
      'gtin',
      'unit',
      'brand',
    ] as const)
      if (v[k] !== undefined) o[k] = v[k];
    for (const k of ['salePriceNet', 'purchasePriceNet', 'weightKg', 'minStock'] as const)
      if (v[k] !== undefined) o[k] = parseNumber(v[k]);
    for (const k of ['active', 'stockTracked'] as const)
      if (v[k] !== undefined) {
        const b = parseBool(v[k]);
        if (b === undefined) throw new Error(`„${v[k]}“ ist kein Ja/Nein-Wert`);
        o[k] = b;
      }
    if (v.taxRate !== undefined) {
      const rate = parseNumber(v.taxRate)!;
      const key = `tax:${rate}`;
      if (!cache.has(key)) {
        const tr = (await tx.taxRate.findMany({ where: { archivedAt: null } })).find((r) =>
          dec(r.rate).equals(dec(rate)),
        );
        cache.set(key, tr?.id ?? null);
      }
      if (!cache.get(key)) throw new Error(`Steuersatz ${rate} % ist nicht angelegt`);
      o.taxRateId = cache.get(key);
    }
    if (v.category !== undefined) {
      const key = `cat:${v.category.toLowerCase()}`;
      if (!cache.has(key))
        cache.set(key, await this.masterData.categoryPath(tx, c, v.category, false));
      if (!cache.get(key) && !config.createMissing)
        throw new Error(`Kategorie „${v.category}“ fehlt`);
    }
    if (v.manufacturer !== undefined) {
      const key = `man:${v.manufacturer.toLowerCase()}`;
      if (!cache.has(key))
        cache.set(key, await this.masterData.manufacturer(tx, c, v.manufacturer, false));
      if (!cache.get(key) && !config.createMissing)
        throw new Error(`Hersteller „${v.manufacturer}“ fehlt`);
    }
    // Lookups, die beim Ausführen ggf. Datensätze anlegen
    const resolveRefs = async () => {
      if (v.category !== undefined)
        o.categoryId = await this.cdb.run(t, (tx2, c2) =>
          this.masterData.categoryPath(tx2, c2, v.category!, config.createMissing),
        );
      if (v.manufacturer !== undefined)
        o.manufacturerId = await this.cdb.run(t, (tx2, c2) =>
          this.masterData.manufacturer(tx2, c2, v.manufacturer!, config.createMissing),
        );
    };
    if (!existing) {
      articleInputSchema.parse(o);
      return {
        action: 'create',
        run: async () => {
          await resolveRefs();
          const a = await this.articles.create(t, articleInputSchema.parse(o));
          return { entityType: 'article', entityId: (a as { id: string }).id };
        },
      };
    }
    const base = this.articleBase(
      existing,
      await tx.setComponent.findMany({ where: { setArticleId: existing.id } }),
    );
    articleInputSchema.parse({ ...base, ...o });
    return {
      action: 'update',
      run: async () => {
        await resolveRefs();
        const cur = await this.cdb.run(t, (tx2) =>
          tx2.article.findUnique({ where: { id: existing.id } }),
        );
        const comps = await this.cdb.run(t, (tx2) =>
          tx2.setComponent.findMany({ where: { setArticleId: existing.id } }),
        );
        await this.articles.update(
          t,
          existing.id,
          articleInputSchema.parse({ ...this.articleBase(cur!, comps), ...o }),
          cur!.version,
        );
        return { entityType: 'article', entityId: existing.id };
      },
    };
  }

  /** Vollständige Eingabe aus einem vorhandenen Artikel (Preise bleiben unverändert). */
  private articleBase(
    a: Prisma.ArticleGetPayload<object>,
    comps: { componentArticleId: string; quantity: Prisma.Decimal }[],
  ) {
    return {
      number: a.number,
      kind: a.kind === 'variant' ? 'standard' : a.kind,
      name: a.name,
      shortDescription: a.shortDescription,
      description: a.description,
      gtin: a.gtin,
      manufacturerId: a.manufacturerId,
      brand: a.brand,
      categoryId: a.categoryId,
      unit: a.unit,
      taxRateId: a.taxRateId,
      weightKg: a.weightKg?.toString() ?? null,
      minStock: a.minStock.toString(),
      stockTracked: a.stockTracked,
      trackBatches: a.trackBatches,
      trackSerials: a.trackSerials,
      trackBestBefore: a.trackBestBefore,
      active: a.active,
      setComponents: comps.map((x) => ({
        articleId: x.componentArticleId,
        quantity: x.quantity.toString(),
      })),
      variantAttributes:
        (a.variantAttributes as { name: string; values: string[] }[] | null) ?? undefined,
      customFields: (a.customFields as Record<string, unknown>) ?? {},
    };
  }

  private async prepareParty(
    tx: Tx,
    t: TenantContext,
    type: 'customer' | 'supplier',
    v: Values,
    config: ImportConfig,
    cache: Map<string, string | null>,
  ): Promise<RowResult> {
    const existing = v.number
      ? type === 'customer'
        ? await tx.customer.findFirst({ where: { number: v.number } })
        : await tx.supplier.findFirst({ where: { number: v.number } })
      : null;
    if (existing && config.mode === 'create') return { action: 'skip', reason: 'Nummer vorhanden' };
    if (!existing && config.mode === 'update')
      throw new Error(`${v.number ?? '(ohne Nummer)'} nicht gefunden`);
    const o: Record<string, unknown> = {};
    const textKeys =
      type === 'customer'
        ? [
            'number',
            'companyName',
            'salutation',
            'firstName',
            'lastName',
            'email',
            'phone',
            'vatId',
            'notes',
          ]
        : ['number', 'name', 'email', 'phone', 'website', 'vatId', 'customerNumber'];
    for (const k of textKeys) if (v[k] !== undefined) o[k] = v[k];
    for (const k of ['paymentTermsDays', 'defaultDeliveryDays'])
      if (v[k] !== undefined) {
        if (type === 'customer' && k === 'defaultDeliveryDays') continue;
        o[k] = Math.round(Number(parseNumber(v[k])));
      }
    if (type === 'customer') {
      const ty = (v.type ?? '').toLowerCase();
      if (ty) o.type = /gesch|business|firma|b2b|gewerb/.test(ty) ? 'business' : 'private';
      else if (!existing) o.type = v.companyName ? 'business' : 'private';
      if (v.customerGroup !== undefined) {
        const key = `grp:${v.customerGroup.toLowerCase()}`;
        if (!cache.has(key))
          cache.set(
            key,
            (
              await tx.customerGroup.findFirst({
                where: { name: { equals: v.customerGroup, mode: 'insensitive' }, archivedAt: null },
              })
            )?.id ?? null,
          );
        if (!cache.get(key))
          throw new Error(`Kundengruppe „${v.customerGroup}“ ist nicht angelegt`);
        o.customerGroupId = cache.get(key);
      }
    }
    if (v.email) o.email = v.email.toLowerCase();
    const hasAddress = ['street', 'postalCode', 'city', 'country'].some((k) => v[k] !== undefined);
    const address = hasAddress
      ? {
          kind: 'billing' as const,
          isDefault: true,
          name: type === 'customer' ? null : (v.name ?? null),
          street: v.street ?? null,
          postalCode: v.postalCode ?? null,
          city: v.city ?? null,
          country: (v.country ?? 'DE').toUpperCase().slice(0, 2),
        }
      : null;
    const schema = type === 'customer' ? customerInputSchema : supplierInputSchema;
    const service = type === 'customer' ? this.customers : this.suppliers;
    if (!existing) {
      const input = { ...o, addresses: address ? [address] : [], contacts: [] };
      schema.parse(input);
      return {
        action: 'create',
        run: async () => {
          const created = (await (service as CustomersService).create(
            t,
            schema.parse(input) as never,
          )) as { id: string };
          return { entityType: type, entityId: created.id };
        },
      };
    }
    return {
      action: 'update',
      run: async () => {
        const cur = (await (service as CustomersService).get(t, existing.id)) as unknown as Record<
          string,
          unknown
        > & {
          addresses: {
            id: string;
            kind: string;
            isDefault: boolean;
            name: string | null;
            name2: string | null;
            street: string | null;
            postalCode: string | null;
            city: string | null;
            country: string;
          }[];
          contacts: {
            id: string;
            name: string;
            role: string | null;
            email: string | null;
            phone: string | null;
          }[];
          version: number;
        };
        let addresses = cur.addresses.map((a) => ({
          id: a.id,
          kind: a.kind,
          isDefault: a.isDefault,
          name: a.name,
          name2: a.name2,
          street: a.street,
          postalCode: a.postalCode,
          city: a.city,
          country: a.country,
        }));
        if (address) {
          const idx = addresses.findIndex((a) => a.kind === 'billing' && a.isDefault);
          if (idx >= 0)
            addresses[idx] = {
              ...addresses[idx]!,
              ...address,
              name: address.name ?? addresses[idx]!.name,
            };
          else
            addresses = [
              ...addresses,
              { ...address, id: undefined as unknown as string, name2: null },
            ];
        }
        const keep = Object.fromEntries(
          Object.entries(cur).filter(
            ([k]) =>
              ![
                'id',
                'accountId',
                'companyId',
                'createdAt',
                'createdBy',
                'updatedAt',
                'updatedBy',
                'version',
                'archivedAt',
                'displayName',
                'addresses',
                'contacts',
                'blockedAt',
              ].includes(k),
          ),
        );
        const input = schema.parse({
          ...keep,
          ...o,
          addresses,
          contacts: cur.contacts.map((p) => ({
            id: p.id,
            name: p.name,
            role: p.role,
            email: p.email ?? '',
            phone: p.phone,
          })),
        });
        await (service as CustomersService).update(t, existing.id, input as never, cur.version);
        return { entityType: type, entityId: existing.id };
      },
    };
  }

  private async prepareStock(
    tx: Tx,
    c: CompanyContext,
    t: TenantContext,
    v: Values,
    config: ImportConfig,
    cache: Map<string, string | null>,
    _dry: boolean,
  ): Promise<RowResult> {
    if (!v.article) throw new Error('Artikelnummer/EAN fehlt');
    const a = await this.findArticle(tx, v.article);
    if (!a) throw new Error(`Artikel „${v.article}“ nicht gefunden`);
    const qty = parseNumber(v.quantity ?? '');
    if (qty === undefined) throw new Error('Menge fehlt');
    const wkey = `wh:${(v.warehouse ?? '').toLowerCase()}`;
    if (!cache.has(wkey)) {
      const w = v.warehouse
        ? await tx.warehouse.findFirst({
            where: { code: { equals: v.warehouse, mode: 'insensitive' }, archivedAt: null },
          })
        : await tx.warehouse.findFirst({ where: { isDefault: true, archivedAt: null } });
      cache.set(wkey, w?.id ?? null);
    }
    const warehouseId = cache.get(wkey);
    if (!warehouseId) throw new Error(`Lager „${v.warehouse ?? 'Standard'}“ nicht gefunden`);
    let locationId: string | null = null;
    if (v.location) {
      locationId = await this.masterData.location(tx, c, warehouseId, v.location, false);
      if (!locationId && !config.createMissing) throw new Error(`Lagerplatz „${v.location}“ fehlt`);
    }
    const bestBefore = v.bestBefore ? parseDate(v.bestBefore) : undefined;
    const lot = { batch: v.batch ?? null, serialNumber: v.serialNumber ?? null };
    await this.inventory.checkSlot(tx, { articleId: a.id, warehouseId, locationId });
    return {
      action: 'book',
      run: async () => {
        const loc = v.location
          ? await this.cdb.run(t, (tx2, c2) =>
              this.masterData.location(tx2, c2, warehouseId, v.location!, config.createMissing),
            )
          : null;
        if (config.stockMode === 'add')
          await this.inventory.book(t, {
            type: 'receipt',
            articleId: a.id,
            warehouseId,
            locationId: loc,
            quantity: qty,
            bestBefore: bestBefore ?? null,
            note: 'Import',
            ...lot,
          });
        else
          try {
            await this.inventory.correct(t, {
              articleId: a.id,
              warehouseId,
              locationId: loc,
              countedQuantity: qty,
              bestBefore: bestBefore ?? null,
              note: 'Import (Bestand gesetzt)',
              ...lot,
            });
          } catch (e) {
            // Keine Abweichung: nichts zu buchen
            if (!(
              e instanceof AppError &&
              e.getStatus() === 409 &&
              /Keine Abweichung/.test(e.message)
            ))
              throw e;
            return null;
          }
        return { entityType: 'article', entityId: a.id };
      },
    };
  }

  private async preparePrice(tx: Tx, t: TenantContext, v: Values): Promise<RowResult> {
    if (!t.account.permissions.has('articles.prices'))
      throw new Error('Für Preise fehlt das Recht articles.prices');
    if (!v.article) throw new Error('Artikelnummer/EAN fehlt');
    const a = await this.findArticle(tx, v.article);
    if (!a) throw new Error(`Artikel „${v.article}“ nicht gefunden`);
    const priceNet = parseNumber(v.priceNet ?? '');
    if (priceNet === undefined) throw new Error('Preis fehlt');
    const minQuantity = parseNumber(v.minQuantity ?? '1') ?? '1';
    let groupId: string | null = null;
    if (v.customerGroup) {
      groupId =
        (
          await tx.customerGroup.findFirst({
            where: { name: { equals: v.customerGroup, mode: 'insensitive' }, archivedAt: null },
          })
        )?.id ?? null;
      if (!groupId) throw new Error(`Kundengruppe „${v.customerGroup}“ ist nicht angelegt`);
    }
    return {
      action: 'update',
      run: async () => {
        const [cur, comps, prices] = await this.cdb.run(t, (tx2) =>
          Promise.all([
            tx2.article.findUnique({ where: { id: a.id } }),
            tx2.setComponent.findMany({ where: { setArticleId: a.id } }),
            tx2.articlePrice.findMany({ where: { articleId: a.id } }),
          ]),
        );
        const keep = prices
          .filter(
            (p) => !(p.customerGroupId === groupId && dec(p.minQuantity).equals(dec(minQuantity))),
          )
          .map((p) => ({
            customerGroupId: p.customerGroupId,
            minQuantity: p.minQuantity.toString(),
            priceNet: p.priceNet.toString(),
          }));
        await this.articles.update(
          t,
          a.id,
          articleInputSchema.parse({
            ...this.articleBase(cur!, comps),
            salePriceNet: cur!.salePriceNet.toString(),
            purchasePriceNet: cur!.purchasePriceNet.toString(),
            prices: [...keep, { customerGroupId: groupId, minQuantity, priceNet }],
          }),
          cur!.version,
        );
        return { entityType: 'article', entityId: a.id };
      },
    };
  }

  // ───── Vorlagen ─────

  templates(t: TenantContext, entity?: string) {
    return this.cdb.run(t, (tx) =>
      tx.importTemplate.findMany({ where: entity ? { entity } : {}, orderBy: { name: 'asc' } }),
    );
  }

  saveTemplate(t: TenantContext, input: z.infer<typeof importTemplateSchema>) {
    return this.cdb.run(t, async (tx, c) => {
      const data = {
        columns: input.columns as Prisma.InputJsonValue,
        config: input.config as unknown as Prisma.InputJsonValue,
      };
      return tx.importTemplate.upsert({
        where: {
          companyId_entity_name: { companyId: c.companyId, entity: input.entity, name: input.name },
        },
        update: data,
        create: {
          id: uuidv7(),
          accountId: c.account.id,
          companyId: c.companyId,
          entity: input.entity,
          name: input.name,
          ...data,
        },
      });
    });
  }

  deleteTemplate(t: TenantContext, id: string) {
    return this.cdb.run(t, async (tx) => {
      const r = await tx.importTemplate.deleteMany({ where: { id } });
      if (!r.count) throw Errors.notFound();
    });
  }

  // ───── Export ─────

  export(t: TenantContext, entity: ExportEntity) {
    return this.cdb.run(t, async (tx, c) => {
      const canPrices = c.account.permissions.has('articles.prices');
      const need = {
        articles: 'articles.read',
        customers: 'customers.read',
        suppliers: 'suppliers.read',
        stock: 'inventory.read',
      } as const;
      if (!c.account.permissions.has(need[entity]))
        throw new AppError(403, 'PERMISSION_DENIED', `Fehlende Berechtigung: ${need[entity]}`);
      const taxRates = await tx.taxRate.findMany();
      const rate = (id: string) => taxRates.find((r) => r.id === id)?.rate.toString() ?? '';
      const de = (v: Prisma.Decimal | null | undefined) =>
        v === null || v === undefined ? '' : v.toString().replace('.', ',');
      if (entity === 'articles') {
        const rows = await tx.article.findMany({
          where: { archivedAt: null },
          orderBy: { number: 'asc' },
          take: 200_000,
        });
        const cats = await tx.category.findMany();
        const mans = await tx.manufacturer.findMany();
        const path = (id: string | null) => {
          const parts: string[] = [];
          let cur = cats.find((x) => x.id === id);
          for (let i = 0; cur && i < 10; i++) {
            parts.unshift(cur.name);
            cur = cats.find((x) => x.id === cur!.parentId);
          }
          return parts.join(' > ');
        };
        return toCsv(
          [
            'Artikelnummer',
            'Bezeichnung',
            'Kurzbeschreibung',
            'EAN',
            'Einheit',
            'VK netto',
            ...(canPrices ? ['EK netto'] : []),
            'Steuersatz',
            'Kategorie',
            'Hersteller',
            'Marke',
            'Gewicht',
            'Mindestbestand',
            'Aktiv',
          ],
          rows.map((a) => [
            a.number,
            a.name,
            a.shortDescription,
            a.gtin,
            a.unit,
            de(a.salePriceNet),
            ...(canPrices ? [de(a.purchasePriceNet)] : []),
            rate(a.taxRateId),
            path(a.categoryId),
            mans.find((m) => m.id === a.manufacturerId)?.name ?? '',
            a.brand,
            de(a.weightKg),
            de(a.minStock),
            a.active ? 'ja' : 'nein',
          ]),
        );
      }
      if (entity === 'customers' || entity === 'suppliers') {
        const rows =
          entity === 'customers'
            ? await tx.customer.findMany({
                where: { archivedAt: null },
                orderBy: { number: 'asc' },
                take: 200_000,
              })
            : await tx.supplier.findMany({
                where: { archivedAt: null },
                orderBy: { number: 'asc' },
                take: 200_000,
              });
        const addrs = await tx.address.findMany({
          where: {
            ownerType: entity === 'customers' ? 'customer' : 'supplier',
            kind: 'billing',
            isDefault: true,
          },
        });
        const addr = (id: string) => addrs.find((a) => a.ownerId === id);
        if (entity === 'customers')
          return toCsv(
            [
              'Kundennummer',
              'Art',
              'Firma',
              'Anrede',
              'Vorname',
              'Nachname',
              'E-Mail',
              'Telefon',
              'USt-IdNr.',
              'Straße',
              'PLZ',
              'Ort',
              'Land',
              'Zahlungsziel',
            ],
            (rows as Prisma.CustomerGetPayload<object>[]).map((k) => {
              const a = addr(k.id);
              return [
                k.number,
                k.type === 'business' ? 'geschäftlich' : 'privat',
                k.companyName,
                k.salutation,
                k.firstName,
                k.lastName,
                k.email,
                k.phone,
                k.vatId,
                a?.street,
                a?.postalCode,
                a?.city,
                a?.country,
                k.paymentTermsDays,
              ];
            }),
          );
        return toCsv(
          [
            'Lieferantennummer',
            'Name',
            'E-Mail',
            'Telefon',
            'Website',
            'USt-IdNr.',
            'Unsere Kundennummer',
            'Straße',
            'PLZ',
            'Ort',
            'Land',
            'Zahlungsziel',
            'Lieferzeit',
          ],
          (rows as Prisma.SupplierGetPayload<object>[]).map((s) => {
            const a = addr(s.id);
            return [
              s.number,
              s.name,
              s.email,
              s.phone,
              s.website,
              s.vatId,
              s.customerNumber,
              a?.street,
              a?.postalCode,
              a?.city,
              a?.country,
              s.paymentTermsDays,
              s.defaultDeliveryDays,
            ];
          }),
        );
      }
      const levels = await tx.stockLevel.findMany({
        where: { NOT: { quantity: 0 } },
        take: 500_000,
      });
      const [arts, whs, locs] = await Promise.all([
        tx.article.findMany({
          where: { id: { in: [...new Set(levels.map((l) => l.articleId))] } },
          select: { id: true, number: true, name: true },
        }),
        tx.warehouse.findMany(),
        tx.storageLocation.findMany(),
      ]);
      return toCsv(
        [
          'Artikelnummer',
          'Bezeichnung',
          'Lager',
          'Lagerplatz',
          'Charge',
          'Seriennummer',
          'MHD',
          'Menge',
        ],
        levels.map((l) => [
          arts.find((a) => a.id === l.articleId)?.number,
          arts.find((a) => a.id === l.articleId)?.name,
          whs.find((w) => w.id === l.warehouseId)?.code,
          locs.find((x) => x.id === l.locationId)?.code,
          l.batch,
          l.serialNumber,
          l.bestBefore?.toISOString().slice(0, 10),
          de(l.quantity),
        ]),
      );
    });
  }

  private log(
    tx: Tx,
    c: CompanyContext,
    action: string,
    job: ImportJob,
    data: Record<string, unknown>,
  ) {
    return this.audit.record(tx, {
      accountId: c.account.id,
      userId: c.user.id,
      companyId: c.companyId,
      action,
      entityType: 'import_job',
      entityId: job.id,
      data: { ...data, fileName: job.fileName },
      ip: c.ip,
    });
  }
}
