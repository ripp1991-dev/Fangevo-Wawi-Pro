import { Inject, Injectable } from '@nestjs/common';
import { uuidv7, type Company, type Tx } from '@fangevo/database';
import { canAdd } from '@fangevo/licensing';
import { type CompanyInput, type ListQuery, type ListResult } from '@fangevo/shared';
import { AuditService } from '../audit/audit.service';
import { CustomFieldsService } from '../customfields/custom-fields.service';
import { Database } from '../database/database.service';
import { AppError, Errors } from '../http/errors';
import { type TenantContext } from '../http/context';
import { buildListArgs, type FieldSpec } from '../lists/list-query';
import { SearchService } from '../search/search.service';

/** Felder, nach denen Firmenlisten gefiltert und sortiert werden dürfen. */
export const COMPANY_FIELDS: FieldSpec = {
  name: { kind: 'string', sortable: true },
  legalName: { kind: 'string', sortable: true },
  city: { kind: 'string', sortable: true },
  postalCode: { kind: 'string', sortable: true },
  country: { kind: 'string', sortable: true },
  vatId: { kind: 'string', sortable: true },
  email: { kind: 'string', sortable: true },
  createdAt: { kind: 'date', sortable: true },
  updatedAt: { kind: 'date', sortable: true },
};

@Injectable()
export class CompaniesService {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(CustomFieldsService) private readonly fields: CustomFieldsService,
    @Inject(SearchService) private readonly search: SearchService,
  ) {}

  private run<T>(t: TenantContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.db.tenant({ accountId: t.account.id, userId: t.user.id }, fn);
  }

  private accessWhere(t: TenantContext) {
    return t.account.allCompanies
      ? {}
      : { access: { some: { membershipId: t.account.membershipId } } };
  }

  /** Firmen, auf die der Benutzer Zugriff hat – mit Suche, Filtern, Sortierung und Seiten. */
  list(t: TenantContext, q: ListQuery): Promise<ListResult<Company>> {
    const canManage = t.account.permissions.has('companies.manage');
    return this.run(t, async (tx) => {
      const defs = await this.fields.definitions(tx, 'company', true);
      const args = buildListArgs(q, COMPANY_FIELDS, {
        search: ['name', 'legalName', 'city', 'vatId', 'email'],
        customFields: defs,
        customColumn: 'customFields',
        defaultSort: 'name:asc',
      });
      const where = {
        AND: [
          args.where,
          this.accessWhere(t),
          q.archived === 'true' && canManage ? {} : { archivedAt: null },
        ],
      };
      const [items, total] = await Promise.all([
        tx.company.findMany({ where, orderBy: args.orderBy, skip: args.skip, take: args.take }),
        tx.company.count({ where }),
      ]);
      return { items, total, page: q.page, pageSize: q.pageSize };
    });
  }

  get(t: TenantContext, id: string): Promise<Company> {
    return this.run(t, (tx) => this.getIn(tx, t, id));
  }

  private async getIn(tx: Tx, t: TenantContext, id: string): Promise<Company> {
    const c = await tx.company.findUnique({ where: { id } });
    if (!c) throw Errors.notFound();
    if (!t.account.allCompanies && !t.account.companyIds.includes(id))
      throw new AppError(403, 'COMPANY_ACCESS_DENIED', 'Kein Zugriff auf diese Firma');
    return c;
  }

  private async assertLimit(tx: Tx, t: TenantContext): Promise<void> {
    const active = await tx.company.count({ where: { archivedAt: null } });
    if (!canAdd(t.account.entitlement, 'companies', active)) {
      throw new AppError(
        403,
        'LICENSE_LIMIT_REACHED',
        `Ihre Lizenz umfasst ${t.account.entitlement.maxCompanies} Firmen. Weitere Firmen können zugebucht werden.`,
      );
    }
  }

  private async index(tx: Tx, c: Company): Promise<void> {
    await this.search.upsert(tx, c.accountId, {
      entityType: 'company',
      entityId: c.id,
      companyId: c.id,
      permission: 'companies.read',
      title: c.name,
      subtitle:
        [c.legalName, [c.postalCode, c.city].filter(Boolean).join(' ')]
          .filter(Boolean)
          .join(' · ') || null,
      body: [
        c.vatId,
        c.email,
        c.street,
        ...Object.values((c.customFields ?? {}) as Record<string, unknown>).filter(
          (v) => typeof v === 'string',
        ),
      ]
        .filter(Boolean)
        .join(' '),
      url: `/admin/companies?id=${c.id}`,
      archived: !!c.archivedAt,
    });
  }

  create(t: TenantContext, input: CompanyInput): Promise<Company> {
    return this.run(t, async (tx) => {
      await this.assertLimit(tx, t);
      const customFields = await this.fields.validate(tx, 'company', input.customFields);
      const id = uuidv7();
      const c = await tx.company.create({
        data: {
          ...normalize(input),
          customFields: customFields as object,
          id,
          accountId: t.account.id,
          createdBy: t.user.id,
          updatedBy: t.user.id,
        },
      });
      // Wer nicht auf alle Firmen zugreift, bekommt Zugriff auf die selbst angelegte Firma.
      if (!t.account.allCompanies)
        await tx.companyAccess.create({
          data: { accountId: t.account.id, membershipId: t.account.membershipId, companyId: id },
        });
      await this.index(tx, c);
      await this.audit.record(tx, {
        accountId: t.account.id,
        userId: t.user.id,
        companyId: id,
        action: 'company.created',
        entityType: 'company',
        entityId: id,
        data: { name: c.name },
        ip: t.ip,
      });
      return c;
    });
  }

  /** Optimistische Sperre: `version` muss dem gespeicherten Stand entsprechen. */
  update(t: TenantContext, id: string, input: CompanyInput, version: number): Promise<Company> {
    return this.run(t, async (tx) => {
      const before = await this.getIn(tx, t, id);
      const customFields =
        input.customFields === undefined
          ? undefined
          : await this.fields.validate(
              tx,
              'company',
              input.customFields,
              (before.customFields ?? {}) as Record<string, unknown>,
            );
      const r = await tx.company.updateMany({
        where: { id, version },
        data: {
          ...normalize(input),
          ...(customFields ? { customFields: customFields as object } : {}),
          updatedBy: t.user.id,
          version: { increment: 1 },
        },
      });
      if (!r.count)
        throw new AppError(
          409,
          'CONFLICT',
          'Die Firma wurde zwischenzeitlich geändert. Bitte neu laden.',
        );
      const after = await tx.company.findUniqueOrThrow({ where: { id } });
      await this.index(tx, after);
      await this.audit.record(tx, {
        accountId: t.account.id,
        userId: t.user.id,
        companyId: id,
        action: 'company.updated',
        entityType: 'company',
        entityId: id,
        data: diff(before, after),
        ip: t.ip,
      });
      return after;
    });
  }

  setArchived(t: TenantContext, id: string, archived: boolean): Promise<Company> {
    return this.run(t, async (tx) => {
      const c = await this.getIn(tx, t, id);
      if (archived && !c.archivedAt) {
        const active = await tx.company.count({ where: { archivedAt: null } });
        if (active <= 1)
          throw new AppError(
            409,
            'CONFLICT',
            'Die letzte aktive Firma kann nicht archiviert werden',
          );
      }
      if (!archived && c.archivedAt) await this.assertLimit(tx, t);
      const after = await tx.company.update({
        where: { id },
        data: {
          archivedAt: archived ? (c.archivedAt ?? new Date()) : null,
          updatedBy: t.user.id,
          version: { increment: 1 },
        },
      });
      await this.index(tx, after);
      await this.audit.record(tx, {
        accountId: t.account.id,
        userId: t.user.id,
        companyId: id,
        action: archived ? 'company.archived' : 'company.restored',
        entityType: 'company',
        entityId: id,
        ip: t.ip,
      });
      return after;
    });
  }
}

function normalize(i: CompanyInput) {
  const empty = (v: string | null | undefined) => (v === '' || v === undefined ? null : v);
  return {
    name: i.name,
    legalName: empty(i.legalName),
    vatId: empty(i.vatId),
    street: empty(i.street),
    postalCode: empty(i.postalCode),
    city: empty(i.city),
    country: i.country,
    email: empty(i.email),
    phone: empty(i.phone),
  };
}

function diff(a: Company, b: Company): Record<string, { from: unknown; to: unknown }> {
  const out: Record<string, { from: unknown; to: unknown }> = {};
  for (const k of [
    'name',
    'legalName',
    'vatId',
    'street',
    'postalCode',
    'city',
    'country',
    'email',
    'phone',
  ] as const) {
    if (a[k] !== b[k]) out[k] = { from: a[k], to: b[k] };
  }
  const ca = (a.customFields ?? {}) as Record<string, unknown>;
  const cb = (b.customFields ?? {}) as Record<string, unknown>;
  for (const k of new Set([...Object.keys(ca), ...Object.keys(cb)])) {
    if (JSON.stringify(ca[k]) !== JSON.stringify(cb[k]))
      out[`cf.${k}`] = { from: ca[k] ?? null, to: cb[k] ?? null };
  }
  return out;
}
