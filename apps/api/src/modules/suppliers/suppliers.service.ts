import { Inject, Injectable } from '@nestjs/common';
import { type z } from 'zod';
import { uuidv7, type Supplier, type Tx } from '@fangevo/database';
import {
  type ListQuery,
  type ListResult,
  type SupplierInput,
  type supplierArticleInputSchema,
} from '@fangevo/shared';
import { AuditService } from '../../core/audit/audit.service';
import { CustomFieldsService } from '../../core/customfields/custom-fields.service';
import { AppError, Errors } from '../../core/http/errors';
import { type TenantContext } from '../../core/http/context';
import { buildListArgs, type FieldSpec } from '../../core/lists/list-query';
import { SearchService } from '../../core/search/search.service';
import { CompanyDb, type CompanyContext } from '../common/company-db';
import { dec } from '../common/decimal';
import { loadPartyDetails, replacePartyDetails } from '../common/parties';

type SupplierArticleInput = z.infer<typeof supplierArticleInputSchema>;

export const SUPPLIER_FIELDS: FieldSpec = {
  number: { kind: 'string', sortable: true },
  name: { kind: 'string', sortable: true },
  email: { kind: 'string', sortable: true },
  phone: { kind: 'string' },
  vatId: { kind: 'string', sortable: true },
  customerNumber: { kind: 'string', sortable: true },
  paymentTermsDays: { kind: 'number', sortable: true },
  defaultDeliveryDays: { kind: 'number', sortable: true },
  createdAt: { kind: 'date', sortable: true },
  updatedAt: { kind: 'date', sortable: true },
};

@Injectable()
export class SuppliersService {
  constructor(
    @Inject(CompanyDb) private readonly cdb: CompanyDb,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(CustomFieldsService) private readonly fields: CustomFieldsService,
    @Inject(SearchService) private readonly search: SearchService,
  ) {}

  list(t: TenantContext, q: ListQuery): Promise<ListResult<Supplier & { articleCount: number }>> {
    return this.cdb.run(t, async (tx) => {
      const defs = await this.fields.definitions(tx, 'supplier', true);
      const args = buildListArgs(q, SUPPLIER_FIELDS, {
        search: ['number', 'name', 'email', 'vatId', 'customerNumber'],
        customFields: defs,
        customColumn: 'customFields',
        defaultSort: 'name:asc',
      });
      const where = { AND: [args.where, q.archived === 'true' ? {} : { archivedAt: null }] };
      const [items, total] = await Promise.all([
        tx.supplier.findMany({ where, orderBy: args.orderBy, skip: args.skip, take: args.take }),
        tx.supplier.count({ where }),
      ]);
      const counts = items.length
        ? await tx.supplierArticle.groupBy({
            by: ['supplierId'],
            where: { supplierId: { in: items.map((i) => i.id) } },
            _count: { _all: true },
          })
        : [];
      const byId = new Map(counts.map((c) => [c.supplierId, c._count._all]));
      return {
        items: items.map((s) => ({ ...s, articleCount: byId.get(s.id) ?? 0 })),
        total,
        page: q.page,
        pageSize: q.pageSize,
      };
    });
  }

  get(t: TenantContext, id: string) {
    return this.cdb.run(t, async (tx, c) => {
      const s = await tx.supplier.findUnique({ where: { id } });
      if (!s) throw Errors.notFound();
      const articles = await tx.supplierArticle.findMany({
        where: { supplierId: id },
        orderBy: { createdAt: 'asc' },
      });
      const arts = await tx.article.findMany({
        where: { id: { in: articles.map((a) => a.articleId) } },
        select: { id: true, number: true, name: true, unit: true },
      });
      const canPrices = c.account.permissions.has('articles.prices');
      return {
        ...s,
        ...(await loadPartyDetails(tx, 'supplier', id)),
        articles: articles.map((a) => ({
          ...a,
          purchasePriceNet: canPrices ? a.purchasePriceNet : undefined,
          article: arts.find((x) => x.id === a.articleId) ?? null,
        })),
      };
    });
  }

  private index(tx: Tx, s: Supplier): Promise<void> {
    return this.search.upsert(tx, s.accountId, {
      entityType: 'supplier',
      entityId: s.id,
      companyId: s.companyId,
      permission: 'suppliers.read',
      title: s.name,
      subtitle: [s.number, s.email].filter(Boolean).join(' · '),
      body: [s.vatId, s.customerNumber, s.phone].filter(Boolean).join(' '),
      url: `/suppliers?id=${s.id}`,
      archived: !!s.archivedAt,
    });
  }

  private data(i: SupplierInput) {
    return {
      name: i.name,
      email: i.email,
      phone: i.phone,
      website: i.website,
      vatId: i.vatId,
      customerNumber: i.customerNumber,
      paymentTermsDays: i.paymentTermsDays,
      defaultDeliveryDays: i.defaultDeliveryDays ?? null,
      notes: i.notes,
    };
  }

  create(t: TenantContext, input: SupplierInput) {
    return this.cdb.run(t, async (tx, c) => {
      const customFields = await this.fields.validate(tx, 'supplier', input.customFields);
      const number = input.number ?? (await this.cdb.nextNumber(tx, c.companyId, 'supplier'));
      if (await tx.supplier.count({ where: { number } }))
        throw new AppError(409, 'CONFLICT', `Lieferantennummer ${number} ist bereits vergeben`, [
          { path: 'number', message: 'Bereits vergeben' },
        ]);
      const id = uuidv7();
      const s = await tx.supplier.create({
        data: {
          ...this.data(input),
          id,
          number,
          accountId: c.account.id,
          companyId: c.companyId,
          customFields: customFields as object,
          createdBy: c.user.id,
          updatedBy: c.user.id,
        },
      });
      await replacePartyDetails(tx, c, 'supplier', id, input.addresses, input.contacts);
      await this.index(tx, s);
      await this.log(tx, c, 'supplier.created', id, { number, name: s.name });
      return s;
    });
  }

  update(t: TenantContext, id: string, input: SupplierInput, version: number) {
    return this.cdb.run(t, async (tx, c) => {
      const before = await tx.supplier.findUnique({ where: { id } });
      if (!before) throw Errors.notFound();
      const customFields =
        input.customFields === undefined
          ? undefined
          : await this.fields.validate(
              tx,
              'supplier',
              input.customFields,
              before.customFields as Record<string, unknown>,
            );
      const number = input.number ?? before.number;
      if (number !== before.number && (await tx.supplier.count({ where: { number } })))
        throw new AppError(409, 'CONFLICT', `Lieferantennummer ${number} ist bereits vergeben`, [
          { path: 'number', message: 'Bereits vergeben' },
        ]);
      const r = await tx.supplier.updateMany({
        where: { id, version },
        data: {
          ...this.data(input),
          number,
          ...(customFields ? { customFields: customFields as object } : {}),
          updatedBy: c.user.id,
          version: { increment: 1 },
        },
      });
      if (!r.count)
        throw new AppError(
          409,
          'CONFLICT',
          'Der Lieferant wurde zwischenzeitlich geändert. Bitte neu laden.',
        );
      await replacePartyDetails(tx, c, 'supplier', id, input.addresses, input.contacts);
      const after = await tx.supplier.findUniqueOrThrow({ where: { id } });
      await this.index(tx, after);
      const changes: Record<string, { from: unknown; to: unknown }> = {};
      for (const k of [
        'number',
        'name',
        'email',
        'phone',
        'vatId',
        'customerNumber',
        'paymentTermsDays',
        'defaultDeliveryDays',
      ] as const)
        if (before[k] !== after[k]) changes[k] = { from: before[k], to: after[k] };
      await this.log(tx, c, 'supplier.updated', id, changes);
      return after;
    });
  }

  setArchived(t: TenantContext, id: string, archived: boolean) {
    return this.cdb.run(t, async (tx, c) => {
      const s = await tx.supplier.findUnique({ where: { id } });
      if (!s) throw Errors.notFound();
      const after = await tx.supplier.update({
        where: { id },
        data: {
          archivedAt: archived ? (s.archivedAt ?? new Date()) : null,
          updatedBy: c.user.id,
          version: { increment: 1 },
        },
      });
      await this.index(tx, after);
      await this.log(tx, c, archived ? 'supplier.archived' : 'supplier.restored', id);
      return after;
    });
  }

  /** Bezugsquelle anlegen oder ändern. Einkaufspreise nur mit articles.prices; nur ein bevorzugter Lieferant je Artikel. */
  upsertArticle(t: TenantContext, supplierId: string, input: SupplierArticleInput) {
    return this.cdb.run(t, async (tx, c) => {
      if (!c.account.permissions.has('articles.prices'))
        throw new AppError(
          403,
          'PERMISSION_DENIED',
          'Einkaufspreise dürfen nur mit dem Recht „Preise“ gepflegt werden',
        );
      if (!(await tx.supplier.count({ where: { id: supplierId } }))) throw Errors.notFound();
      const art = await tx.article.findUnique({ where: { id: input.articleId } });
      if (!art)
        throw new AppError(422, 'VALIDATION_FAILED', 'Artikel nicht gefunden', [
          { path: 'articleId', message: 'Artikel nicht gefunden' },
        ]);
      if (art.kind === 'parent' || art.kind === 'set')
        throw new AppError(
          422,
          'VALIDATION_FAILED',
          'Vaterartikel und Sets werden nicht direkt eingekauft',
        );
      const data = {
        supplierSku: input.supplierSku,
        purchasePriceNet: dec(input.purchasePriceNet),
        deliveryDays: input.deliveryDays ?? null,
        minOrderQuantity: dec(input.minOrderQuantity),
        isPreferred: input.isPreferred,
      };
      const existing = await tx.supplierArticle.findUnique({
        where: { supplierId_articleId: { supplierId, articleId: input.articleId } },
      });
      const row = existing
        ? await tx.supplierArticle.update({ where: { id: existing.id }, data })
        : await tx.supplierArticle.create({
            data: {
              ...data,
              id: uuidv7(),
              accountId: c.account.id,
              companyId: c.companyId,
              supplierId,
              articleId: input.articleId,
            },
          });
      if (input.isPreferred)
        await tx.supplierArticle.updateMany({
          where: { articleId: input.articleId, id: { not: row.id } },
          data: { isPreferred: false },
        });
      await this.log(
        tx,
        c,
        existing ? 'supplier_article.updated' : 'supplier_article.created',
        supplierId,
        {
          articleId: input.articleId,
          supplierSku: input.supplierSku,
          purchasePriceNet: input.purchasePriceNet,
        },
      );
      return row;
    });
  }

  removeArticle(t: TenantContext, supplierId: string, articleId: string) {
    return this.cdb.run(t, async (tx, c) => {
      const r = await tx.supplierArticle.deleteMany({ where: { supplierId, articleId } });
      if (!r.count) throw Errors.notFound();
      await this.log(tx, c, 'supplier_article.removed', supplierId, { articleId });
    });
  }

  private log(
    tx: Tx,
    c: CompanyContext,
    action: string,
    id: string,
    data?: Record<string, unknown>,
  ) {
    return this.audit.record(tx, {
      accountId: c.account.id,
      userId: c.user.id,
      companyId: c.companyId,
      action,
      entityType: 'supplier',
      entityId: id,
      data,
      ip: c.ip,
    });
  }
}
