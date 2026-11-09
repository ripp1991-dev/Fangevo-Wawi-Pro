import { Inject, Injectable } from '@nestjs/common';
import { uuidv7, type Customer, type Tx } from '@fangevo/database';
import { type CustomerInput, type ListQuery, type ListResult } from '@fangevo/shared';
import { AuditService } from '../../core/audit/audit.service';
import { CustomFieldsService } from '../../core/customfields/custom-fields.service';
import { AppError, Errors } from '../../core/http/errors';
import { type TenantContext } from '../../core/http/context';
import { buildListArgs, type FieldSpec } from '../../core/lists/list-query';
import { SearchService } from '../../core/search/search.service';
import { CompanyDb, type CompanyContext } from '../common/company-db';
import { loadPartyDetails, replacePartyDetails } from '../common/parties';

export const CUSTOMER_FIELDS: FieldSpec = {
  number: { kind: 'string', sortable: true },
  type: { kind: 'enum', sortable: true },
  companyName: { kind: 'string', sortable: true },
  firstName: { kind: 'string', sortable: true },
  lastName: { kind: 'string', sortable: true },
  email: { kind: 'string', sortable: true },
  phone: { kind: 'string' },
  vatId: { kind: 'string', sortable: true },
  customerGroupId: { kind: 'enum' },
  paymentTermsDays: { kind: 'number', sortable: true },
  blocked: { kind: 'boolean', sortable: true },
  createdAt: { kind: 'date', sortable: true },
  updatedAt: { kind: 'date', sortable: true },
};

export function customerDisplayName(
  c: Pick<Customer, 'companyName' | 'firstName' | 'lastName'>,
): string {
  return c.companyName || [c.firstName, c.lastName].filter(Boolean).join(' ') || '–';
}

@Injectable()
export class CustomersService {
  constructor(
    @Inject(CompanyDb) private readonly cdb: CompanyDb,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(CustomFieldsService) private readonly fields: CustomFieldsService,
    @Inject(SearchService) private readonly search: SearchService,
  ) {}

  list(
    t: TenantContext,
    q: ListQuery,
  ): Promise<ListResult<Customer & { displayName: string; city: string | null }>> {
    return this.cdb.run(t, async (tx) => {
      const defs = await this.fields.definitions(tx, 'customer', true);
      const args = buildListArgs(q, CUSTOMER_FIELDS, {
        search: ['number', 'companyName', 'firstName', 'lastName', 'email', 'vatId'],
        customFields: defs,
        customColumn: 'customFields',
        defaultSort: 'number:asc',
      });
      const where = { AND: [args.where, q.archived === 'true' ? {} : { archivedAt: null }] };
      const [items, total] = await Promise.all([
        tx.customer.findMany({ where, orderBy: args.orderBy, skip: args.skip, take: args.take }),
        tx.customer.count({ where }),
      ]);
      const billing = items.length
        ? await tx.address.findMany({
            where: {
              ownerType: 'customer',
              ownerId: { in: items.map((i) => i.id) },
              kind: 'billing',
              isDefault: true,
            },
          })
        : [];
      const city = new Map(billing.map((a) => [a.ownerId, a.city]));
      return {
        items: items.map((c) => ({
          ...c,
          displayName: customerDisplayName(c),
          city: city.get(c.id) ?? null,
        })),
        total,
        page: q.page,
        pageSize: q.pageSize,
      };
    });
  }

  get(t: TenantContext, id: string) {
    return this.cdb.run(t, async (tx) => {
      const c = await tx.customer.findUnique({ where: { id } });
      if (!c) throw Errors.notFound();
      return {
        ...c,
        displayName: customerDisplayName(c),
        ...(await loadPartyDetails(tx, 'customer', id)),
      };
    });
  }

  private async checkGroup(tx: Tx, input: CustomerInput): Promise<string | null> {
    if (input.customerGroupId) {
      const g = await tx.customerGroup.findUnique({ where: { id: input.customerGroupId } });
      if (!g || g.archivedAt)
        throw new AppError(422, 'VALIDATION_FAILED', 'Kundengruppe nicht gefunden', [
          { path: 'customerGroupId', message: 'Kundengruppe nicht gefunden' },
        ]);
      return g.id;
    }
    return (
      (await tx.customerGroup.findFirst({ where: { isDefault: true, archivedAt: null } }))?.id ??
      null
    );
  }

  private index(tx: Tx, c: Customer): Promise<void> {
    return this.search.upsert(tx, c.accountId, {
      entityType: 'customer',
      entityId: c.id,
      companyId: c.companyId,
      permission: 'customers.read',
      title: customerDisplayName(c),
      subtitle: [c.number, c.email].filter(Boolean).join(' · '),
      body: [c.firstName, c.lastName, c.companyName, c.phone, c.vatId].filter(Boolean).join(' '),
      url: `/customers?id=${c.id}`,
      archived: !!c.archivedAt,
    });
  }

  private data(input: CustomerInput, groupId: string | null) {
    return {
      type: input.type,
      companyName: input.companyName,
      salutation: input.salutation,
      firstName: input.firstName,
      lastName: input.lastName,
      email: input.email,
      phone: input.phone,
      vatId: input.vatId,
      customerGroupId: groupId,
      paymentTermsDays: input.paymentTermsDays,
      blocked: input.blocked,
      blockedReason: input.blocked ? input.blockedReason : null,
      notes: input.notes,
    };
  }

  create(t: TenantContext, input: CustomerInput) {
    return this.cdb.run(t, (tx, c) => this.createInTx(tx, c, input));
  }

  /** Kunde in einer laufenden Transaktion anlegen (z. B. aus einem Verkaufskanal). */
  async createInTx(tx: Tx, c: CompanyContext, input: CustomerInput) {
    {
      const groupId = await this.checkGroup(tx, input);
      const customFields = await this.fields.validate(tx, 'customer', input.customFields);
      const number = input.number ?? (await this.cdb.nextNumber(tx, c.companyId, 'customer'));
      if (await tx.customer.count({ where: { number } }))
        throw new AppError(409, 'CONFLICT', `Kundennummer ${number} ist bereits vergeben`, [
          { path: 'number', message: 'Bereits vergeben' },
        ]);
      const id = uuidv7();
      const row = await tx.customer.create({
        data: {
          ...this.data(input, groupId),
          id,
          number,
          accountId: c.account.id,
          companyId: c.companyId,
          customFields: customFields as object,
          createdBy: c.user.id,
          updatedBy: c.user.id,
        },
      });
      await replacePartyDetails(tx, c, 'customer', id, input.addresses, input.contacts);
      await this.index(tx, row);
      await this.log(tx, c, 'customer.created', id, { number, name: customerDisplayName(row) });
      return { ...row, displayName: customerDisplayName(row) };
    }
  }

  update(t: TenantContext, id: string, input: CustomerInput, version: number) {
    return this.cdb.run(t, async (tx, c) => {
      const before = await tx.customer.findUnique({ where: { id } });
      if (!before) throw Errors.notFound();
      const groupId = await this.checkGroup(tx, input);
      const customFields =
        input.customFields === undefined
          ? undefined
          : await this.fields.validate(
              tx,
              'customer',
              input.customFields,
              before.customFields as Record<string, unknown>,
            );
      const number = input.number ?? before.number;
      if (number !== before.number && (await tx.customer.count({ where: { number } })))
        throw new AppError(409, 'CONFLICT', `Kundennummer ${number} ist bereits vergeben`, [
          { path: 'number', message: 'Bereits vergeben' },
        ]);
      const r = await tx.customer.updateMany({
        where: { id, version },
        data: {
          ...this.data(input, groupId),
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
          'Der Kunde wurde zwischenzeitlich geändert. Bitte neu laden.',
        );
      await replacePartyDetails(tx, c, 'customer', id, input.addresses, input.contacts);
      const after = await tx.customer.findUniqueOrThrow({ where: { id } });
      await this.index(tx, after);
      const changes: Record<string, { from: unknown; to: unknown }> = {};
      for (const k of [
        'number',
        'type',
        'companyName',
        'firstName',
        'lastName',
        'email',
        'phone',
        'vatId',
        'customerGroupId',
        'paymentTermsDays',
        'blocked',
      ] as const) {
        if (before[k] !== after[k]) changes[k] = { from: before[k], to: after[k] };
      }
      await this.log(
        tx,
        c,
        before.blocked !== after.blocked
          ? after.blocked
            ? 'customer.blocked'
            : 'customer.unblocked'
          : 'customer.updated',
        id,
        changes,
      );
      return { ...after, displayName: customerDisplayName(after) };
    });
  }

  setArchived(t: TenantContext, id: string, archived: boolean) {
    return this.cdb.run(t, async (tx, c) => {
      const row = await tx.customer.findUnique({ where: { id } });
      if (!row) throw Errors.notFound();
      const after = await tx.customer.update({
        where: { id },
        data: {
          archivedAt: archived ? (row.archivedAt ?? new Date()) : null,
          updatedBy: c.user.id,
          version: { increment: 1 },
        },
      });
      await this.index(tx, after);
      await this.log(tx, c, archived ? 'customer.archived' : 'customer.restored', id);
      return after;
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
      entityType: 'customer',
      entityId: id,
      data,
      ip: c.ip,
    });
  }
}
