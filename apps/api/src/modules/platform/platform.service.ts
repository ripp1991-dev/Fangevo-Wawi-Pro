import { Inject, Injectable } from '@nestjs/common';
import { type z } from 'zod';
import { addInterval, isPlanKey, type BillingInterval } from '@fangevo/licensing';
import { type platformLicenseSchema } from '@fangevo/shared';
import { Database } from '../../core/database/database.service';
import { Errors } from '../../core/http/errors';
import { BillingService, type Actor } from '../billing/billing.service';
import { SupportService } from '../support/support.service';

export interface PlatformStaff {
  userId: string;
  email: string;
  name: string;
}

const DAY = 86_400_000;

/**
 * Plattform-Verwaltung für FangEvo-Mitarbeiter (Phase 7). Zugriff auf Accounts nur gezielt
 * über deren ID im Mandantenkontext (RLS bleibt aktiv); Übersichten kommen aus globalen
 * Verzeichnissen, die nur Kennzahlen enthalten. Jede Änderung landet im Audit-Log des Accounts.
 */
@Injectable()
export class PlatformService {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(BillingService) private readonly billing: BillingService,
    @Inject(SupportService) private readonly support: SupportService,
  ) {}

  private actor(s: PlatformStaff): Actor {
    return { userId: null, label: `platform:${s.email}` };
  }

  async accounts(q?: string) {
    const where = q
      ? {
          OR: [
            { name: { contains: q, mode: 'insensitive' as const } },
            { ownerEmail: { contains: q, mode: 'insensitive' as const } },
          ],
        }
      : {};
    const [items, total] = await Promise.all([
      this.db.global.platformAccount.findMany({ where, orderBy: { createdAt: 'desc' }, take: 200 }),
      this.db.global.platformAccount.count({ where }),
    ]);
    return { items, total };
  }

  async account(accountId: string) {
    const dir = await this.db.global.platformAccount.findUnique({ where: { accountId } });
    if (!dir) throw Errors.notFound('Account nicht gefunden');
    return this.db.tenant({ accountId, userId: null }, async (tx) => {
      const [entitlement, subscription, addons, invoices, events, companies, users] =
        await Promise.all([
          tx.entitlement.findUnique({ where: { accountId } }),
          tx.subscription.findUnique({ where: { accountId } }),
          tx.subscriptionAddon.findMany({ where: { accountId } }),
          tx.platformInvoice.findMany({
            where: { accountId },
            orderBy: { issuedAt: 'desc' },
            omit: { pdf: true },
          }),
          tx.entitlementEvent.findMany({
            where: { accountId },
            orderBy: { createdAt: 'desc' },
            take: 20,
          }),
          tx.company.count({ where: { archivedAt: null } }),
          tx.membership.count({ where: { status: 'ACTIVE' } }),
        ]);
      return {
        ...dir,
        entitlement,
        subscription,
        addons,
        invoices: invoices.map((i) => ({
          ...i,
          totalNet: i.totalNet.toFixed(2),
          totalTax: i.totalTax.toFixed(2),
          totalGross: i.totalGross.toFixed(2),
        })),
        events,
        usage: { companies, users },
      };
    });
  }

  /** Lizenz/Abo eines Kunden ändern (ohne Rechnung). Rechnungen entstehen nur durch Kundenaktionen und den Abrechnungslauf. */
  async changeLicense(
    staff: PlatformStaff,
    accountId: string,
    input: z.infer<typeof platformLicenseSchema>,
  ) {
    await this.ensureExists(accountId);
    await this.billing.withAccount(accountId, this.actor(staff), async (op) => {
      const sub = await this.billing.ensureSubscription(op);
      const data: Record<string, unknown> = {};
      if (input.plan && isPlanKey(input.plan)) data.plan = input.plan;
      if (input.interval) data.interval = input.interval;
      if (input.extraCompanies !== undefined) data.extraCompanies = input.extraCompanies;
      if (input.suspended !== undefined) data.suspendedAt = input.suspended ? op.now : null;
      if (input.activateWithoutInvoice) {
        const interval = (input.interval ?? sub.interval) as BillingInterval;
        data.status = 'active';
        data.cancelAtPeriodEnd = false;
        data.currentPeriodStart = op.now;
        data.currentPeriodEnd = addInterval(op.now, interval);
      }
      if (Object.keys(data).length) await op.tx.subscription.update({ where: { accountId }, data });
      if (input.extendTrialDays) {
        await op.tx.entitlement.update({
          where: { accountId },
          data: { trialEndsAt: new Date(op.now.getTime() + input.extendTrialDays * DAY) },
        });
        if (sub.status === 'canceled' || sub.cancelAtPeriodEnd)
          await op.tx.subscription.update({
            where: { accountId },
            data: {
              status: sub.status === 'canceled' ? 'trialing' : sub.status,
              cancelAtPeriodEnd: false,
            },
          });
      }
      await this.billing.record(op, 'platform.license_changed', {
        ...input,
        staff: staff.email,
      });
      await this.billing.syncEntitlement(op);
    });
    return this.account(accountId);
  }

  async markInvoicePaid(staff: PlatformStaff, accountId: string, invoiceId: string) {
    await this.ensureExists(accountId);
    await this.billing.withAccount(accountId, this.actor(staff), async (op) => {
      const inv = await op.tx.platformInvoice.findFirst({ where: { id: invoiceId, accountId } });
      if (!inv) throw Errors.notFound('Rechnung nicht gefunden');
      if (inv.status !== 'open') throw Errors.conflict('Die Rechnung ist nicht offen.');
      await op.tx.platformInvoice.update({
        where: { id: invoiceId },
        data: { status: 'paid', paidAt: op.now },
      });
      await this.billing.record(op, 'platform.invoice_paid', {
        number: inv.number,
        staff: staff.email,
      });
    });
    // Zahlungsverzug ggf. aufheben
    await this.billing.processAccount(accountId);
    return this.account(accountId);
  }

  async invoicePdf(accountId: string, invoiceId: string) {
    return this.db.tenant({ accountId, userId: null }, async (tx) => {
      const inv = await tx.platformInvoice.findFirst({ where: { id: invoiceId, accountId } });
      if (!inv) throw Errors.notFound('Rechnung nicht gefunden');
      return { filename: `${inv.number}.pdf`, pdf: Buffer.from(inv.pdf) };
    });
  }

  async supportInbox(status?: string) {
    const rows = await this.db.global.supportTicketIndex.findMany({
      where: status ? { status } : { status: { not: 'closed' } },
      orderBy: { updatedAt: 'desc' },
      take: 200,
    });
    const names = new Map(
      (
        await this.db.global.platformAccount.findMany({
          where: { accountId: { in: [...new Set(rows.map((r) => r.accountId))] } },
          select: { accountId: true, name: true },
        })
      ).map((a) => [a.accountId, a.name]),
    );
    // Betreff und Nummer je Account im Mandantenkontext nachladen
    const byAccount = new Map<string, string[]>();
    for (const r of rows)
      byAccount.set(r.accountId, [...(byAccount.get(r.accountId) ?? []), r.ticketId]);
    const details = new Map<string, { number: string; subject: string; category: string }>();
    for (const [accountId, ids] of byAccount) {
      const tickets = await this.db.tenant({ accountId, userId: null }, (tx) =>
        tx.supportTicket.findMany({
          where: { id: { in: ids } },
          select: { id: true, number: true, subject: true, category: true },
        }),
      );
      for (const t of tickets) details.set(t.id, t);
    }
    return rows.map((r) => ({
      ...r,
      accountName: names.get(r.accountId) ?? '–',
      ...details.get(r.ticketId),
    }));
  }

  private async ticketAccount(ticketId: string): Promise<string> {
    const idx = await this.db.global.supportTicketIndex.findUnique({ where: { ticketId } });
    if (!idx) throw Errors.notFound('Anfrage nicht gefunden');
    return idx.accountId;
  }

  async ticket(ticketId: string) {
    const accountId = await this.ticketAccount(ticketId);
    return this.db.tenant({ accountId, userId: null }, (tx) =>
      this.support.load(tx, accountId, ticketId),
    );
  }

  async answer(
    staff: PlatformStaff,
    ticketId: string,
    input: { message: string; status: 'waiting_customer' | 'waiting_support' | 'closed' },
  ) {
    const accountId = await this.ticketAccount(ticketId);
    return this.support.answer(accountId, ticketId, { name: staff.name }, input);
  }

  private async ensureExists(accountId: string) {
    const dir = await this.db.global.platformAccount.findUnique({ where: { accountId } });
    if (!dir) throw Errors.notFound('Account nicht gefunden');
  }
}
