import { Inject, Injectable } from '@nestjs/common';
import { Prisma, uuidv7, type Tx } from '@fangevo/database';
import { type ArticleInput, type ListQuery, type ListResult } from '@fangevo/shared';
import { AuditService } from '../../core/audit/audit.service';
import { CustomFieldsService } from '../../core/customfields/custom-fields.service';
import { AppError, Errors } from '../../core/http/errors';
import { type TenantContext } from '../../core/http/context';
import { buildListArgs, type FieldSpec } from '../../core/lists/list-query';
import { SearchService } from '../../core/search/search.service';
import { CompanyDb, type CompanyContext } from '../common/company-db';
import { dec } from '../common/decimal';

export const ARTICLE_FIELDS: FieldSpec = {
  number: { kind: 'string', sortable: true },
  name: { kind: 'string', sortable: true },
  kind: { kind: 'enum', sortable: true },
  gtin: { kind: 'string', sortable: true },
  brand: { kind: 'string', sortable: true },
  unit: { kind: 'string', sortable: true },
  categoryId: { kind: 'string' },
  manufacturerId: { kind: 'string' },
  parentId: { kind: 'string' },
  salePriceNet: { kind: 'number', sortable: true },
  purchasePriceNet: { kind: 'number', sortable: true },
  minStock: { kind: 'number', sortable: true },
  active: { kind: 'boolean', sortable: true },
  createdAt: { kind: 'date', sortable: true },
  updatedAt: { kind: 'date', sortable: true },
};

type ArticleRow = Prisma.ArticleGetPayload<object>;

@Injectable()
export class ArticlesService {
  constructor(
    @Inject(CompanyDb) private readonly cdb: CompanyDb,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(CustomFieldsService) private readonly fields: CustomFieldsService,
    @Inject(SearchService) private readonly search: SearchService,
  ) {}

  /** Einkaufspreise nur mit Recht articles.prices sichtbar. */
  private redact<T extends Partial<ArticleRow>>(c: CompanyContext, a: T): T {
    if (c.account.permissions.has('articles.prices')) return a;
    const { purchasePriceNet: _p, ...rest } = a;
    return rest as T;
  }

  list(
    t: TenantContext,
    q: ListQuery,
  ): Promise<ListResult<ArticleRow & { stock: string; reserved: string }>> {
    return this.cdb.run(t, async (tx, c) => {
      if (
        !c.account.permissions.has('articles.prices') &&
        (q.sort?.startsWith('purchasePriceNet') ||
          q.filters.some((f) => f.field === 'purchasePriceNet'))
      ) {
        throw new AppError(403, 'PERMISSION_DENIED', 'Fehlende Berechtigung: articles.prices');
      }
      const defs = await this.fields.definitions(tx, 'article', true);
      const args = buildListArgs(q, ARTICLE_FIELDS, {
        search: ['number', 'name', 'gtin', 'brand'],
        customFields: defs,
        customColumn: 'customFields',
        defaultSort: 'number:asc',
      });
      const where = { AND: [args.where, q.archived === 'true' ? {} : { archivedAt: null }] };
      const [items, total] = await Promise.all([
        tx.article.findMany({ where, orderBy: args.orderBy, skip: args.skip, take: args.take }),
        tx.article.count({ where }),
      ]);
      const stock = items.length
        ? await tx.stockLevel.groupBy({
            by: ['articleId'],
            where: { articleId: { in: items.map((i) => i.id) } },
            _sum: { quantity: true, reserved: true },
          })
        : [];
      const byId = new Map(stock.map((s) => [s.articleId, s._sum]));
      return {
        items: items.map((a) =>
          this.redact(c, {
            ...a,
            stock: (byId.get(a.id)?.quantity ?? dec(0)).toString(),
            reserved: (byId.get(a.id)?.reserved ?? dec(0)).toString(),
          }),
        ),
        total,
        page: q.page,
        pageSize: q.pageSize,
      };
    });
  }

  get(t: TenantContext, id: string) {
    return this.cdb.run(t, async (tx, c) => {
      const a = await tx.article.findUnique({ where: { id } });
      if (!a) throw Errors.notFound();
      const [prices, components, variants, supplierArticles, levels, parent] = await Promise.all([
        tx.articlePrice.findMany({
          where: { articleId: id },
          orderBy: [{ customerGroupId: 'asc' }, { minQuantity: 'asc' }],
        }),
        tx.setComponent.findMany({ where: { setArticleId: id } }),
        tx.article.findMany({ where: { parentId: id }, orderBy: { number: 'asc' } }),
        tx.supplierArticle.findMany({ where: { articleId: id } }),
        tx.stockLevel.findMany({ where: { articleId: id } }),
        a.parentId
          ? tx.article.findUnique({
              where: { id: a.parentId },
              select: { id: true, number: true, name: true },
            })
          : null,
      ]);
      const componentArticles = await tx.article.findMany({
        where: { id: { in: components.map((x) => x.componentArticleId) } },
        select: { id: true, number: true, name: true, unit: true },
      });
      const suppliers = await tx.supplier.findMany({
        where: { id: { in: supplierArticles.map((s) => s.supplierId) } },
        select: { id: true, number: true, name: true },
      });
      const canPrices = c.account.permissions.has('articles.prices');
      return {
        ...this.redact(c, a),
        parent,
        prices: canPrices ? prices : prices.map(({ priceNet: _p, ...r }) => r),
        setComponents: components.map((x) => ({
          articleId: x.componentArticleId,
          quantity: x.quantity,
          article: componentArticles.find((ca) => ca.id === x.componentArticleId) ?? null,
        })),
        variants: variants.map((v) => this.redact(c, v)),
        supplierArticles: supplierArticles.map((s) => ({
          ...(canPrices ? s : { ...s, purchasePriceNet: undefined }),
          supplier: suppliers.find((x) => x.id === s.supplierId) ?? null,
        })),
        stock: levels,
      };
    });
  }

  /** Bezüge (Steuersatz, Kategorie, Hersteller, Set-Bestandteile) prüfen – alles innerhalb der Firma (RLS). */
  private async validateRefs(tx: Tx, input: ArticleInput, selfId?: string): Promise<string> {
    const errors: { path: string; message: string }[] = [];
    let taxRateId = input.taxRateId ?? null;
    if (taxRateId) {
      const tr = await tx.taxRate.findUnique({ where: { id: taxRateId } });
      if (!tr || tr.archivedAt)
        errors.push({ path: 'taxRateId', message: 'Steuersatz nicht gefunden oder archiviert' });
    } else {
      taxRateId = (await tx.taxRate.findFirst({ where: { isDefault: true } }))?.id ?? null;
      if (!taxRateId)
        errors.push({ path: 'taxRateId', message: 'Kein Standard-Steuersatz vorhanden' });
    }
    if (
      input.categoryId &&
      !(await tx.category.count({ where: { id: input.categoryId, archivedAt: null } }))
    )
      errors.push({ path: 'categoryId', message: 'Kategorie nicht gefunden' });
    if (
      input.manufacturerId &&
      !(await tx.manufacturer.count({ where: { id: input.manufacturerId } }))
    )
      errors.push({ path: 'manufacturerId', message: 'Hersteller nicht gefunden' });
    if (input.kind === 'set') {
      if (!input.setComponents.length)
        errors.push({
          path: 'setComponents',
          message: 'Ein Set braucht mindestens einen Bestandteil',
        });
      const ids = input.setComponents.map((s) => s.articleId);
      if (new Set(ids).size !== ids.length)
        errors.push({ path: 'setComponents', message: 'Bestandteil doppelt' });
      if (selfId && ids.includes(selfId))
        errors.push({ path: 'setComponents', message: 'Ein Set kann nicht sich selbst enthalten' });
      const comps = await tx.article.findMany({ where: { id: { in: ids } } });
      if (comps.length !== ids.length)
        errors.push({ path: 'setComponents', message: 'Bestandteil nicht gefunden' });
      if (comps.some((x) => x.kind === 'set' || x.kind === 'parent'))
        errors.push({
          path: 'setComponents',
          message: 'Sets und Vaterartikel können keine Bestandteile sein',
        });
    } else if (input.setComponents.length) {
      errors.push({ path: 'setComponents', message: 'Bestandteile nur bei Sets' });
    }
    if (input.kind === 'parent' && !input.variantAttributes)
      errors.push({
        path: 'variantAttributes',
        message: 'Vaterartikel brauchen Variantenmerkmale (z. B. Größe: S, M, L)',
      });
    const groups = [
      ...new Set(
        (input.prices ?? []).map((p) => p.customerGroupId).filter((g): g is string => !!g),
      ),
    ];
    if (
      groups.length &&
      (await tx.customerGroup.count({ where: { id: { in: groups } } })) !== groups.length
    )
      errors.push({ path: 'prices', message: 'Kundengruppe nicht gefunden' });
    if (errors.length)
      throw new AppError(422, 'VALIDATION_FAILED', 'Eingaben sind ungültig', errors);
    return taxRateId!;
  }

  /** Wurden Preise geschickt, die vom gespeicherten Stand abweichen? Nicht geschickte Preise zählen nicht. */
  private pricesChanged(
    input: ArticleInput,
    before?: ArticleRow,
    beforePrices: {
      customerGroupId: string | null;
      minQuantity: Prisma.Decimal;
      priceNet: Prisma.Decimal;
    }[] = [],
  ): boolean {
    const norm = (
      l: {
        customerGroupId?: string | null;
        minQuantity: string | Prisma.Decimal;
        priceNet: string | Prisma.Decimal;
      }[],
    ) =>
      JSON.stringify(
        l
          .map((p) => [
            p.customerGroupId ?? null,
            dec(p.minQuantity).toString(),
            dec(p.priceNet).toString(),
          ])
          .sort(),
      );
    const differs = (v: string | undefined, old: Prisma.Decimal | undefined) =>
      v !== undefined && !dec(v).equals(old ?? dec(0));
    return (
      differs(input.purchasePriceNet, before?.purchasePriceNet) ||
      differs(input.salePriceNet, before?.salePriceNet) ||
      (input.prices !== undefined && norm(input.prices) !== norm(beforePrices))
    );
  }

  private async writeChildren(
    tx: Tx,
    c: CompanyContext,
    articleId: string,
    input: ArticleInput,
  ): Promise<void> {
    const base = { accountId: c.account.id, companyId: c.companyId };
    const prices = input.prices;
    if (prices !== undefined && c.account.permissions.has('articles.prices'))
      await tx.articlePrice.deleteMany({ where: { articleId } });
    if (prices?.length && c.account.permissions.has('articles.prices'))
      await tx.articlePrice.createMany({
        data: prices.map((p) => ({
          ...base,
          id: uuidv7(),
          articleId,
          customerGroupId: p.customerGroupId ?? null,
          minQuantity: dec(p.minQuantity),
          priceNet: dec(p.priceNet),
        })),
      });
    await tx.setComponent.deleteMany({ where: { setArticleId: articleId } });
    if (input.setComponents.length)
      await tx.setComponent.createMany({
        data: input.setComponents.map((s) => ({
          ...base,
          setArticleId: articleId,
          componentArticleId: s.articleId,
          quantity: dec(s.quantity),
        })),
      });
  }

  private index(tx: Tx, a: ArticleRow): Promise<void> {
    return this.search.upsert(tx, a.accountId, {
      entityType: 'article',
      entityId: a.id,
      companyId: a.companyId,
      permission: 'articles.read',
      title: a.name,
      subtitle: [a.number, a.gtin, a.brand].filter(Boolean).join(' · '),
      body: [
        a.shortDescription,
        ...Object.values((a.customFields ?? {}) as Record<string, unknown>).filter(
          (v) => typeof v === 'string',
        ),
      ]
        .filter(Boolean)
        .join(' '),
      url: `/articles?id=${a.id}`,
      archived: !!a.archivedAt,
    });
  }

  private data(input: ArticleInput, taxRateId: string, canPrices: boolean, before?: ArticleRow) {
    return {
      name: input.name,
      shortDescription: input.shortDescription,
      description: input.description,
      gtin: input.gtin,
      manufacturerId: input.manufacturerId ?? null,
      brand: input.brand,
      categoryId: input.categoryId ?? null,
      unit: input.unit,
      taxRateId,
      purchasePriceNet: canPrices
        ? dec(input.purchasePriceNet)
        : (before?.purchasePriceNet ?? dec(0)),
      salePriceNet: canPrices ? dec(input.salePriceNet) : (before?.salePriceNet ?? dec(0)),
      weightKg: input.weightKg ? dec(input.weightKg) : null,
      minStock: dec(input.minStock),
      stockTracked: input.kind === 'standard' ? input.stockTracked : false,
      trackBatches: input.trackBatches,
      trackSerials: input.trackSerials,
      trackBestBefore: input.trackBestBefore,
      active: input.active,
      variantAttributes: input.kind === 'parent' ? (input.variantAttributes as object) : undefined,
    };
  }

  create(t: TenantContext, input: ArticleInput) {
    return this.cdb.run(t, async (tx, c) => {
      const canPrices = c.account.permissions.has('articles.prices');
      if (!canPrices && this.pricesChanged(input))
        throw new AppError(
          403,
          'PERMISSION_DENIED',
          'Preise dürfen nur mit dem Recht „Preise“ gesetzt werden',
        );
      const taxRateId = await this.validateRefs(tx, input);
      const customFields = await this.fields.validate(tx, 'article', input.customFields);
      const number = input.number ?? (await this.cdb.nextNumber(tx, c.companyId, 'article'));
      if (await tx.article.count({ where: { number } }))
        throw new AppError(409, 'CONFLICT', `Artikelnummer ${number} ist bereits vergeben`, [
          { path: 'number', message: 'Bereits vergeben' },
        ]);
      const id = uuidv7();
      const a = await tx.article.create({
        data: {
          ...this.data(input, taxRateId, canPrices),
          id,
          accountId: c.account.id,
          companyId: c.companyId,
          number,
          kind: input.kind,
          customFields: customFields as object,
          createdBy: c.user.id,
          updatedBy: c.user.id,
        },
      });
      await this.writeChildren(tx, c, id, input);
      await this.index(tx, a);
      await this.audit.record(tx, {
        accountId: c.account.id,
        userId: c.user.id,
        companyId: c.companyId,
        action: 'article.created',
        entityType: 'article',
        entityId: id,
        data: { number, name: a.name },
        ip: c.ip,
      });
      return this.redact(c, a);
    });
  }

  update(t: TenantContext, id: string, input: ArticleInput, version: number) {
    return this.cdb.run(t, async (tx, c) => {
      const before = await tx.article.findUnique({ where: { id } });
      if (!before) throw Errors.notFound();
      if (before.kind !== input.kind && !(before.kind === 'variant' && input.kind === 'standard'))
        throw new AppError(
          409,
          'CONFLICT',
          'Die Artikelart kann nachträglich nicht geändert werden',
        );
      const kindInput = {
        ...input,
        kind: before.kind === 'variant' ? ('standard' as const) : input.kind,
      };
      const canPrices = c.account.permissions.has('articles.prices');
      const beforePrices = await tx.articlePrice.findMany({ where: { articleId: id } });
      if (!canPrices && this.pricesChanged(input, before, beforePrices))
        throw new AppError(
          403,
          'PERMISSION_DENIED',
          'Preise dürfen nur mit dem Recht „Preise“ geändert werden',
        );
      const taxRateId = await this.validateRefs(tx, kindInput, id);
      const customFields =
        input.customFields === undefined
          ? undefined
          : await this.fields.validate(
              tx,
              'article',
              input.customFields,
              before.customFields as Record<string, unknown>,
            );
      const number = input.number ?? before.number;
      if (number !== before.number && (await tx.article.count({ where: { number } })))
        throw new AppError(409, 'CONFLICT', `Artikelnummer ${number} ist bereits vergeben`, [
          { path: 'number', message: 'Bereits vergeben' },
        ]);
      const data = this.data(kindInput, taxRateId, canPrices, before);
      const r = await tx.article.updateMany({
        where: { id, version },
        data: {
          ...data,
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
          'Der Artikel wurde zwischenzeitlich geändert. Bitte neu laden.',
        );
      await this.writeChildren(tx, c, id, kindInput);
      const after = await tx.article.findUniqueOrThrow({ where: { id } });
      await this.index(tx, after);
      await this.audit.record(tx, {
        accountId: c.account.id,
        userId: c.user.id,
        companyId: c.companyId,
        action: 'article.updated',
        entityType: 'article',
        entityId: id,
        data: diffArticle(before, after, canPrices),
        ip: c.ip,
      });
      return this.redact(c, after);
    });
  }

  setArchived(t: TenantContext, id: string, archived: boolean) {
    return this.cdb.run(t, async (tx, c) => {
      const a = await tx.article.findUnique({ where: { id } });
      if (!a) throw Errors.notFound();
      const after = await tx.article.update({
        where: { id },
        data: {
          archivedAt: archived ? (a.archivedAt ?? new Date()) : null,
          updatedBy: c.user.id,
          version: { increment: 1 },
        },
      });
      await this.index(tx, after);
      await this.audit.record(tx, {
        accountId: c.account.id,
        userId: c.user.id,
        companyId: c.companyId,
        action: archived ? 'article.archived' : 'article.restored',
        entityType: 'article',
        entityId: id,
        ip: c.ip,
      });
      return this.redact(c, after);
    });
  }

  /**
   * Erzeugt fehlende Kindartikel für alle Kombinationen der Variantenmerkmale.
   * Bestehende Varianten bleiben unverändert. Maximal 500 Varianten je Vaterartikel.
   */
  generateVariants(t: TenantContext, parentId: string) {
    return this.cdb.run(t, async (tx, c) => {
      const parent = await tx.article.findUnique({ where: { id: parentId } });
      if (!parent || parent.kind !== 'parent')
        throw new AppError(422, 'VALIDATION_FAILED', 'Nur Vaterartikel haben Varianten');
      // Merkmale als geordnete Liste: die Reihenfolge bestimmt den Variantennamen, z. B. "(L, braun)"
      const attrs = (parent.variantAttributes ?? []) as { name: string; values: string[] }[];
      const keys = attrs.map((a) => a.name);
      let combos: Record<string, string>[] = [{}];
      for (const a of attrs)
        combos = combos.flatMap((cmb) => a.values.map((v) => ({ ...cmb, [a.name]: v })));
      if (combos.length > 500)
        throw new AppError(
          422,
          'VALIDATION_FAILED',
          `Zu viele Kombinationen (${combos.length}). Maximal 500.`,
        );
      const existing = await tx.article.findMany({ where: { parentId } });
      const key = (o: Record<string, string>) => JSON.stringify(keys.map((k) => o[k]));
      const have = new Set(
        existing.map((e) => key((e.variantAttributes ?? {}) as Record<string, string>)),
      );
      let n = existing.length;
      const created: string[] = [];
      for (const cmb of combos) {
        if (have.has(key(cmb))) continue;
        let number = `${parent.number}-${String(++n).padStart(2, '0')}`;
        while (await tx.article.count({ where: { number } }))
          number = `${parent.number}-${String(++n).padStart(2, '0')}`;
        const id = uuidv7();
        const child = await tx.article.create({
          data: {
            id,
            accountId: c.account.id,
            companyId: c.companyId,
            number,
            kind: 'variant',
            parentId,
            variantAttributes: cmb,
            name: `${parent.name} (${keys.map((k) => cmb[k]).join(', ')})`,
            shortDescription: parent.shortDescription,
            description: parent.description,
            manufacturerId: parent.manufacturerId,
            brand: parent.brand,
            categoryId: parent.categoryId,
            unit: parent.unit,
            taxRateId: parent.taxRateId,
            purchasePriceNet: parent.purchasePriceNet,
            salePriceNet: parent.salePriceNet,
            weightKg: parent.weightKg,
            minStock: parent.minStock,
            stockTracked: true,
            trackBatches: parent.trackBatches,
            trackSerials: parent.trackSerials,
            trackBestBefore: parent.trackBestBefore,
            createdBy: c.user.id,
            updatedBy: c.user.id,
          },
        });
        await this.index(tx, child);
        created.push(id);
      }
      await this.audit.record(tx, {
        accountId: c.account.id,
        userId: c.user.id,
        companyId: c.companyId,
        action: 'article.variants_generated',
        entityType: 'article',
        entityId: parentId,
        data: { created: created.length },
        ip: c.ip,
      });
      return { created: created.length, total: existing.length + created.length };
    });
  }
}

function diffArticle(
  a: ArticleRow,
  b: ArticleRow,
  canPrices: boolean,
): Record<string, { from: unknown; to: unknown }> {
  const out: Record<string, { from: unknown; to: unknown }> = {};
  const keys = [
    'number',
    'name',
    'gtin',
    'brand',
    'unit',
    'salePriceNet',
    'minStock',
    'active',
    'categoryId',
    'manufacturerId',
    'taxRateId',
    ...(canPrices ? ['purchasePriceNet'] : []),
  ] as (keyof ArticleRow)[];
  for (const k of keys) {
    const x = a[k] instanceof Prisma.Decimal ? String(a[k]) : a[k];
    const y = b[k] instanceof Prisma.Decimal ? String(b[k]) : b[k];
    if (x !== y) out[k] = { from: x, to: y };
  }
  return out;
}
