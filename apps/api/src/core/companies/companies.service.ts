import { Inject, Injectable } from '@nestjs/common';
import { uuidv7, type Company, type Tx } from '@fangevo/database';
import { canAdd } from '@fangevo/licensing';
import { type CompanyInput } from '@fangevo/shared';
import { AuditService } from '../audit/audit.service';
import { Database } from '../database/database.service';
import { AppError, Errors } from '../http/errors';
import { type TenantContext } from '../http/context';

@Injectable()
export class CompaniesService {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  private run<T>(t: TenantContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.db.tenant({ accountId: t.account.id, userId: t.user.id }, fn);
  }

  /** Firmen, auf die der Benutzer Zugriff hat. Archivierte nur auf Wunsch und mit Verwaltungsrecht. */
  list(t: TenantContext, includeArchived: boolean): Promise<Company[]> {
    const canManage = t.account.permissions.has('companies.manage');
    return this.run(t, (tx) =>
      tx.company.findMany({
        where: {
          ...(includeArchived && canManage ? {} : { archivedAt: null }),
          ...(t.account.allCompanies ? {} : { access: { some: { membershipId: t.account.membershipId } } }),
        },
        orderBy: [{ archivedAt: 'asc' }, { name: 'asc' }],
      }),
    );
  }

  get(t: TenantContext, id: string): Promise<Company> {
    return this.run(t, async (tx) => {
      const c = await tx.company.findUnique({ where: { id } });
      if (!c) throw Errors.notFound();
      if (!t.account.allCompanies && !t.account.companyIds.includes(id)) throw new AppError(403, 'COMPANY_ACCESS_DENIED', 'Kein Zugriff auf diese Firma');
      return c;
    });
  }

  private async assertLimit(tx: Tx, t: TenantContext): Promise<void> {
    const active = await tx.company.count({ where: { archivedAt: null } });
    if (!canAdd(t.account.entitlement, 'companies', active)) {
      throw new AppError(403, 'LICENSE_LIMIT_REACHED', `Ihre Lizenz umfasst ${t.account.entitlement.maxCompanies} Firmen. Weitere Firmen können zugebucht werden.`);
    }
  }

  create(t: TenantContext, input: CompanyInput): Promise<Company> {
    return this.run(t, async (tx) => {
      await this.assertLimit(tx, t);
      const id = uuidv7();
      const c = await tx.company.create({ data: { ...normalize(input), id, accountId: t.account.id, createdBy: t.user.id, updatedBy: t.user.id } });
      // Wer nicht auf alle Firmen zugreift, bekommt Zugriff auf die selbst angelegte Firma.
      if (!t.account.allCompanies) await tx.companyAccess.create({ data: { accountId: t.account.id, membershipId: t.account.membershipId, companyId: id } });
      await this.audit.record(tx, { accountId: t.account.id, userId: t.user.id, companyId: id, action: 'company.created', entityType: 'company', entityId: id, data: { name: c.name }, ip: t.ip });
      return c;
    });
  }

  /** Optimistische Sperre: `version` muss dem gespeicherten Stand entsprechen. */
  update(t: TenantContext, id: string, input: CompanyInput, version: number): Promise<Company> {
    return this.run(t, async (tx) => {
      const before = await this.get(t, id);
      const r = await tx.company.updateMany({ where: { id, version }, data: { ...normalize(input), updatedBy: t.user.id, version: { increment: 1 } } });
      if (!r.count) throw new AppError(409, 'CONFLICT', 'Die Firma wurde zwischenzeitlich geändert. Bitte neu laden.');
      const after = await tx.company.findUniqueOrThrow({ where: { id } });
      await this.audit.record(tx, { accountId: t.account.id, userId: t.user.id, companyId: id, action: 'company.updated', entityType: 'company', entityId: id, data: diff(before, after), ip: t.ip });
      return after;
    });
  }

  setArchived(t: TenantContext, id: string, archived: boolean): Promise<Company> {
    return this.run(t, async (tx) => {
      const c = await this.get(t, id);
      if (archived && !c.archivedAt) {
        const active = await tx.company.count({ where: { archivedAt: null } });
        if (active <= 1) throw new AppError(409, 'CONFLICT', 'Die letzte aktive Firma kann nicht archiviert werden');
      }
      if (!archived && c.archivedAt) await this.assertLimit(tx, t);
      const after = await tx.company.update({ where: { id }, data: { archivedAt: archived ? (c.archivedAt ?? new Date()) : null, updatedBy: t.user.id, version: { increment: 1 } } });
      await this.audit.record(tx, { accountId: t.account.id, userId: t.user.id, companyId: id, action: archived ? 'company.archived' : 'company.restored', entityType: 'company', entityId: id, ip: t.ip });
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
  for (const k of ['name', 'legalName', 'vatId', 'street', 'postalCode', 'city', 'country', 'email', 'phone'] as const) {
    if (a[k] !== b[k]) out[k] = { from: a[k], to: b[k] };
  }
  return out;
}
