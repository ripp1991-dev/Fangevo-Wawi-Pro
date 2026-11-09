import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import {
  Prisma,
  uuidv7,
  type Subscription,
  type SubscriptionAddon,
  type Tx,
} from '@fangevo/database';
import {
  ADDON_TRIAL_DAYS,
  ALL_MODULES,
  INVOICE_DUE_DAYS,
  MODULES,
  MODULE_DETAILS,
  PLANS,
  YEARLY_MONTHS,
  addInterval,
  addonBookable,
  addonPriceCents,
  computeEntitlement,
  isModuleKey,
  isPlanKey,
  planPriceCents,
  planRank,
  platformTax,
  prorateCents,
  type BillingInterval,
  type ModuleKey,
} from '@fangevo/licensing';
import { type z } from 'zod';
import { type billingDetailsSchema, type planChangeSchema } from '@fangevo/shared';
import { APP_CONFIG, type AppConfig } from '../../config';
import { AuditService } from '../../core/audit/audit.service';
import { Database } from '../../core/database/database.service';
import { AppError, Errors } from '../../core/http/errors';
import { type TenantContext } from '../../core/http/context';
import { MailService, type MailMessage } from '../../core/mail/mail.service';
import { NotificationsService } from '../../core/notifications/notifications.service';
import { usersWithPermission } from '../../core/notifications/recipients';
import { lineAmounts, summarize } from '../common/totals';
import { renderDocumentPdf, type PdfSender } from '../documents/document-pdf';

const DAY = 86_400_000;

export interface InvoiceLine {
  description: string;
  /** Betrag netto in Euro als Text (2 Nachkommastellen), negativ = Gutschrift */
  amountNet: string;
  taxRate: string;
}

/** Wer eine Änderung auslöst: Kunde (Benutzer), Plattform-Mitarbeiter oder Abrechnungslauf. */
export interface Actor {
  userId: string | null;
  label: string;
  ip?: string | null;
}

interface Op {
  tx: Tx;
  accountId: string;
  now: Date;
  actor: Actor;
  mails: MailMessage[];
}

const cents = (c: number) => (c / 100).toFixed(2);
const fmtDate = (d: Date) =>
  new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin' }).format(d);
const fmtEur = (v: string) =>
  new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(Number(v));

/**
 * Abo und Abrechnung von FangEvo gegenüber seinen Kunden (Phase 7, ADR-012).
 * Das Abo ist die Quelle; die Lizenz (entitlements) wird daraus berechnet (`syncEntitlement`).
 * Zahlart zunächst nur „Rechnung/Überweisung“. Zahlungsanbieter (Stripe/Mollie) folgen erst nach
 * Entscheidung von FangEvo und mit Zugangsdaten.
 */
@Injectable()
export class BillingService implements OnModuleDestroy {
  private readonly logger = new Logger('Billing');
  private ticker: NodeJS.Timeout | undefined;

  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(MailService) private readonly mail: MailService,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onModuleDestroy(): void {
    this.stopScheduler();
  }

  /** Führt eine Änderung an einem Account aus; E-Mails gehen erst nach erfolgreichem Abschluss raus. */
  async withAccount<T>(
    accountId: string,
    actor: Actor,
    fn: (op: Op) => Promise<T>,
    now = new Date(),
  ): Promise<T> {
    const mails: MailMessage[] = [];
    const result = await this.db.tenant({ accountId, userId: actor.userId }, (tx) =>
      fn({ tx, accountId, now, actor, mails }),
    );
    for (const m of mails) {
      try {
        await this.mail.send(m);
      } catch (err) {
        this.logger.error(`Rechnungs-Mail an ${m.to} fehlgeschlagen: ${String(err)}`);
      }
    }
    return result;
  }

  private actorOf(t: TenantContext): Actor {
    return { userId: t.user.id, label: `user:${t.user.id}`, ip: t.ip };
  }

  // ───────────────────────── Kundenportal ─────────────────────────

  async overview(t: TenantContext) {
    return this.withAccount(t.account.id, this.actorOf(t), async (op) => {
      const sub = await this.ensureSubscription(op);
      const addons = await op.tx.subscriptionAddon.findMany({ where: { accountId: op.accountId } });
      const invoices = await op.tx.platformInvoice.findMany({
        where: { accountId: op.accountId },
        orderBy: { issuedAt: 'desc' },
        select: {
          id: true,
          number: true,
          periodStart: true,
          periodEnd: true,
          totalNet: true,
          totalTax: true,
          totalGross: true,
          status: true,
          issuedAt: true,
          dueDate: true,
          paidAt: true,
        },
      });
      const ent = await op.tx.entitlement.findUniqueOrThrow({ where: { accountId: op.accountId } });
      return {
        subscription: sub,
        trialEndsAt: ent.trialEndsAt,
        entitlementStatus: ent.status,
        billingComplete: this.missingDetails(sub).length === 0,
        missingDetails: this.missingDetails(sub),
        pricesArePreliminary: true,
        paymentInfo: this.paymentInfo(),
        plans: Object.entries(PLANS).map(([key, p]) => ({
          key,
          name: p.name,
          monthlyEur: p.monthlyPriceEur,
          yearlyEur: p.monthlyPriceEur === null ? null : p.monthlyPriceEur * YEARLY_MONTHS,
          modules: p.modules,
          selfService: p.monthlyPriceEur !== null,
        })),
        addons: addons.map((a) => this.addonView(a, op.now)),
        invoices: invoices.map((i) => ({
          ...i,
          totalNet: i.totalNet.toFixed(2),
          totalTax: i.totalTax.toFixed(2),
          totalGross: i.totalGross.toFixed(2),
        })),
      };
    });
  }

  async updateDetails(t: TenantContext, input: z.infer<typeof billingDetailsSchema>) {
    return this.withAccount(t.account.id, this.actorOf(t), async (op) => {
      await this.ensureSubscription(op);
      const sub = await op.tx.subscription.update({
        where: { accountId: op.accountId },
        data: { ...input, billingVatId: input.billingVatId ?? null },
      });
      await this.record(op, 'billing.details_updated', {});
      return sub;
    });
  }

  /** Abo aus der Testphase (oder nach Ende) kostenpflichtig starten. Erste Rechnung wird sofort erstellt. */
  async activate(t: TenantContext, input: z.infer<typeof planChangeSchema>) {
    return this.withAccount(t.account.id, this.actorOf(t), async (op) => {
      const sub = await this.lock(op);
      if (sub.status === 'active' || sub.status === 'past_due')
        throw Errors.conflict('Das Abo ist bereits aktiv. Bitte „Paket wechseln“ verwenden.');
      const missing = this.missingDetails(sub);
      if (missing.length)
        throw new AppError(
          422,
          'BILLING_DETAILS_MISSING',
          `Bitte zuerst die Rechnungsdaten vervollständigen: ${missing.join(', ')}`,
        );
      this.requireSelfService(input.plan);
      this.requireIssuer();
      const start = op.now;
      const end = addInterval(start, input.interval);
      const updated = await op.tx.subscription.update({
        where: { accountId: op.accountId },
        data: {
          plan: input.plan,
          interval: input.interval,
          status: 'active',
          currentPeriodStart: start,
          currentPeriodEnd: end,
          cancelAtPeriodEnd: false,
          scheduledPlan: null,
          scheduledInterval: null,
        },
      });
      // Zusatzmodule, die jetzt im Paket enthalten sind, entfallen
      await this.dropIncludedAddons(op, input.plan);
      const addons = await this.billableAddons(op);
      await this.issueInvoice(op, updated, start, end, [...this.periodLines(updated, addons)]);
      await this.record(op, 'billing.activated', { plan: input.plan, interval: input.interval });
      await this.syncEntitlement(op);
      return updated;
    });
  }

  /**
   * Paketwechsel. Testphase: sofort. Aktives Abo: Hochstufen sofort mit anteiliger Rechnung,
   * Herabstufen und Wechsel monatlich/jährlich zum Laufzeitende.
   */
  async changePlan(t: TenantContext, input: z.infer<typeof planChangeSchema>) {
    return this.withAccount(t.account.id, this.actorOf(t), async (op) => {
      const sub = await this.lock(op);
      this.requireSelfService(input.plan);
      if (sub.status === 'canceled')
        throw Errors.conflict('Das Abo ist beendet. Bitte das Abo neu aktivieren.');
      if (sub.status === 'trialing') {
        const updated = await op.tx.subscription.update({
          where: { accountId: op.accountId },
          data: { plan: input.plan, interval: input.interval },
        });
        await this.dropIncludedAddons(op, input.plan);
        await this.record(op, 'billing.plan_changed', {
          from: sub.plan,
          to: input.plan,
          when: 'now',
        });
        await this.syncEntitlement(op);
        return { subscription: updated, effective: 'now' as const };
      }
      const interval = sub.interval as BillingInterval;
      if (input.plan === sub.plan && input.interval === interval) {
        if (!sub.scheduledPlan && !sub.scheduledInterval)
          throw Errors.conflict('Dieses Paket ist bereits gebucht.');
        const updated = await op.tx.subscription.update({
          where: { accountId: op.accountId },
          data: { scheduledPlan: null, scheduledInterval: null },
        });
        await this.record(op, 'billing.plan_change_revoked', {});
        return { subscription: updated, effective: 'now' as const };
      }
      const upgrade = planRank(input.plan) > planRank(sub.plan);
      if (upgrade && input.interval === interval) {
        const lines = this.upgradeLines(sub, input.plan, op.now);
        const credits = await this.dropIncludedAddons(op, input.plan, sub);
        const updated = await op.tx.subscription.update({
          where: { accountId: op.accountId },
          data: { plan: input.plan, scheduledPlan: null, scheduledInterval: null },
        });
        await this.issueInvoice(op, updated, op.now, sub.currentPeriodEnd!, [...lines, ...credits]);
        await this.record(op, 'billing.plan_changed', {
          from: sub.plan,
          to: input.plan,
          when: 'now',
        });
        await this.syncEntitlement(op);
        return { subscription: updated, effective: 'now' as const };
      }
      const updated = await op.tx.subscription.update({
        where: { accountId: op.accountId },
        data: {
          scheduledPlan: input.plan === sub.plan ? null : input.plan,
          scheduledInterval: input.interval === interval ? null : input.interval,
        },
      });
      await this.record(op, 'billing.plan_changed', {
        from: sub.plan,
        to: input.plan,
        interval: input.interval,
        when: 'period_end',
      });
      return { subscription: updated, effective: 'period_end' as const };
    });
  }

  /** Kündigung zum Laufzeitende (bzw. zum Ende der Testphase). Daten bleiben erhalten. */
  async cancel(t: TenantContext) {
    return this.withAccount(t.account.id, this.actorOf(t), async (op) => {
      const sub = await this.lock(op);
      if (sub.status === 'canceled') throw Errors.conflict('Das Abo ist bereits beendet.');
      const updated = await op.tx.subscription.update({
        where: { accountId: op.accountId },
        data: { cancelAtPeriodEnd: true, scheduledPlan: null, scheduledInterval: null },
      });
      await this.record(op, 'billing.canceled', { endsAt: sub.currentPeriodEnd });
      await this.syncEntitlement(op);
      return updated;
    });
  }

  async reactivate(t: TenantContext) {
    return this.withAccount(t.account.id, this.actorOf(t), async (op) => {
      const sub = await this.lock(op);
      if (sub.status === 'canceled')
        throw Errors.conflict('Das Abo ist bereits beendet. Bitte das Abo neu aktivieren.');
      if (!sub.cancelAtPeriodEnd) throw Errors.conflict('Das Abo ist nicht gekündigt.');
      const updated = await op.tx.subscription.update({
        where: { accountId: op.accountId },
        data: { cancelAtPeriodEnd: false },
      });
      await this.record(op, 'billing.reactivated', {});
      await this.syncEntitlement(op);
      return updated;
    });
  }

  async invoicePdf(t: TenantContext, id: string) {
    return this.db.tenant({ accountId: t.account.id, userId: t.user.id }, async (tx) => {
      const inv = await tx.platformInvoice.findFirst({ where: { id, accountId: t.account.id } });
      if (!inv) throw Errors.notFound('Rechnung nicht gefunden');
      return { filename: `${inv.number}.pdf`, pdf: Buffer.from(inv.pdf) };
    });
  }

  // ───────────────────────── Marketplace ─────────────────────────

  async marketplace(t: TenantContext) {
    return this.withAccount(t.account.id, this.actorOf(t), async (op) => {
      const sub = await this.ensureSubscription(op);
      const addons = new Map(
        (await op.tx.subscriptionAddon.findMany({ where: { accountId: op.accountId } })).map(
          (a) => [a.module, a],
        ),
      );
      const ent = await op.tx.entitlement.findUniqueOrThrow({ where: { accountId: op.accountId } });
      const plan = isPlanKey(sub.plan) ? PLANS[sub.plan] : PLANS.starter;
      return {
        plan: sub.plan,
        planName: plan.name,
        pricesArePreliminary: true,
        trialDays: ADDON_TRIAL_DAYS,
        modules: ALL_MODULES.map((k) => {
          const a = addons.get(k);
          return {
            key: k,
            name: MODULES[k].name,
            description: MODULE_DETAILS[k].description,
            version: MODULE_DETAILS[k].version,
            available: MODULES[k].available,
            includedInPlan: (plan.modules as readonly ModuleKey[]).includes(k),
            licensed: k === 'core' || ent.modules.includes(k),
            bookable: addonBookable(sub.plan, k),
            monthlyEur: MODULE_DETAILS[k].addonMonthlyEur,
            trialAvailable: !a?.trialEndsAt,
            addon: a ? this.addonView(a, op.now) : null,
          };
        }),
      };
    });
  }

  /** Zusatzmodul buchen: beim ersten Mal 14 Tage Testversion, danach kostenpflichtig. */
  async bookAddon(t: TenantContext, module: string) {
    return this.withAccount(t.account.id, this.actorOf(t), async (op) => {
      const sub = await this.lock(op);
      if (sub.status === 'canceled') throw Errors.conflict('Das Abo ist beendet.');
      if (!isModuleKey(module) || !addonBookable(sub.plan, module))
        throw new AppError(
          422,
          'VALIDATION_FAILED',
          'Dieses Modul kann nicht einzeln gebucht werden.',
        );
      const existing = await op.tx.subscriptionAddon.findUnique({
        where: { accountId_module: { accountId: op.accountId, module } },
      });
      const paying = sub.status === 'active' || sub.status === 'past_due';
      let result: SubscriptionAddon;
      if (!existing) {
        result = await op.tx.subscriptionAddon.create({
          data: {
            id: uuidv7(),
            accountId: op.accountId,
            module,
            status: 'trial',
            trialEndsAt: new Date(op.now.getTime() + ADDON_TRIAL_DAYS * DAY),
            startedAt: op.now,
          },
        });
      } else if (
        existing.status === 'active' ||
        (existing.status === 'trial' && existing.trialEndsAt && existing.trialEndsAt > op.now)
      ) {
        throw Errors.conflict('Das Modul ist bereits gebucht.');
      } else if (existing.status === 'canceled' && existing.endsAt && existing.endsAt > op.now) {
        // Kündigung zurücknehmen – bereits bezahlt bzw. Test läuft noch
        const inTrial = !!existing.trialEndsAt && existing.trialEndsAt > op.now;
        result = await op.tx.subscriptionAddon.update({
          where: { id: existing.id },
          data: { status: inTrial ? 'trial' : 'active', endsAt: null },
        });
      } else {
        result = await op.tx.subscriptionAddon.update({
          where: { id: existing.id },
          data: { status: 'active', endsAt: null, startedAt: op.now },
        });
        if (paying) await this.chargeAddonRest(op, sub, [module]);
      }
      await this.record(op, 'billing.addon_booked', { module, status: result.status });
      await this.syncEntitlement(op);
      return this.addonView(result, op.now);
    });
  }

  /** Zusatzmodul kündigen: Testversion sofort, bezahltes Modul zum Laufzeitende. */
  async cancelAddon(t: TenantContext, module: string) {
    return this.withAccount(t.account.id, this.actorOf(t), async (op) => {
      const sub = await this.lock(op);
      const a = await op.tx.subscriptionAddon.findUnique({
        where: { accountId_module: { accountId: op.accountId, module } },
      });
      if (!a || a.status === 'canceled') throw Errors.notFound('Das Modul ist nicht gebucht.');
      const paying = sub.status === 'active' || sub.status === 'past_due';
      const endsAt =
        a.status === 'trial'
          ? op.now
          : paying && sub.currentPeriodEnd
            ? sub.currentPeriodEnd
            : op.now;
      const result = await op.tx.subscriptionAddon.update({
        where: { id: a.id },
        data: { status: 'canceled', endsAt },
      });
      await this.record(op, 'billing.addon_canceled', { module, endsAt });
      await this.syncEntitlement(op);
      return this.addonView(result, op.now);
    });
  }

  // ───────────────────────── Abrechnungslauf ─────────────────────────

  startScheduler(intervalMs = 15 * 60_000): void {
    const loop = async () => {
      try {
        await this.billingRun();
      } catch (err) {
        this.logger.error(`Abrechnungslauf: ${String(err)}`);
      }
      this.ticker = setTimeout(loop, intervalMs);
    };
    this.ticker = setTimeout(loop, 5_000);
  }
  stopScheduler(): void {
    if (this.ticker) clearTimeout(this.ticker);
  }

  /** Alle Accounts abrechnen (Verlängerung, Testende, Zahlungsverzug). Mehrfach ausführbar. */
  async billingRun(now = new Date()): Promise<number> {
    const accounts = await this.db.global.platformAccount.findMany({ select: { accountId: true } });
    let changed = 0;
    for (const a of accounts) {
      try {
        if (await this.processAccount(a.accountId, now)) changed++;
      } catch (err) {
        this.logger.error(`Abrechnung Account ${a.accountId}: ${String(err)}`);
      }
    }
    return changed;
  }

  /** Einen Account abrechnen. Gibt true zurück, wenn sich etwas geändert hat. */
  async processAccount(accountId: string, now = new Date()): Promise<boolean> {
    return this.withAccount(
      accountId,
      { userId: null, label: 'billing-run' },
      async (op) => {
        const [row] = await op.tx.$queryRaw<{ account_id: string }[]>`
          SELECT account_id FROM subscriptions WHERE account_id = ${accountId}::uuid FOR UPDATE`;
        if (!row) return false;
        let sub = await op.tx.subscription.findUniqueOrThrow({ where: { accountId } });
        let changed = false;
        const paying = () => sub.status === 'active' || sub.status === 'past_due';

        // 1. Testversionen von Zusatzmodulen enden → kostenpflichtig (kündbar bis dahin)
        const ended = await op.tx.subscriptionAddon.findMany({
          where: { accountId, status: 'trial', trialEndsAt: { lte: now } },
        });
        if (ended.length) {
          await op.tx.subscriptionAddon.updateMany({
            where: { id: { in: ended.map((a) => a.id) } },
            data: { status: 'active' },
          });
          if (paying() && sub.currentPeriodEnd && sub.currentPeriodEnd > now)
            await this.chargeAddonRest(
              op,
              sub,
              ended.map((a) => a.module),
            );
          changed = true;
        }

        // 2. Laufzeitende: beenden oder verlängern (bei Ausfall des Laufs werden Zeiträume nachgeholt)
        for (
          let i = 0;
          i < 24 && paying() && sub.currentPeriodEnd && sub.currentPeriodEnd <= now;
          i++
        ) {
          if (sub.cancelAtPeriodEnd) {
            sub = await op.tx.subscription.update({
              where: { accountId },
              data: { status: 'canceled' },
            });
            await this.record(op, 'billing.ended', {});
          } else {
            const plan = sub.scheduledPlan ?? sub.plan;
            const interval = (sub.scheduledInterval ?? sub.interval) as BillingInterval;
            const start = sub.currentPeriodEnd;
            const end = addInterval(start, interval);
            sub = await op.tx.subscription.update({
              where: { accountId },
              data: {
                plan,
                interval,
                currentPeriodStart: start,
                currentPeriodEnd: end,
                scheduledPlan: null,
                scheduledInterval: null,
              },
            });
            await this.dropIncludedAddons(op, plan);
            await this.issueInvoice(
              op,
              sub,
              start,
              end,
              this.periodLines(sub, await this.billableAddons(op)),
            );
            await this.record(op, 'billing.renewed', { plan, interval, periodEnd: end });
          }
          changed = true;
        }

        // 3. Gekündigte Testphase endet
        if (sub.status === 'trialing' && sub.cancelAtPeriodEnd) {
          const ent = await op.tx.entitlement.findUniqueOrThrow({ where: { accountId } });
          if (ent.trialEndsAt && ent.trialEndsAt <= now) {
            sub = await op.tx.subscription.update({
              where: { accountId },
              data: { status: 'canceled' },
            });
            await this.record(op, 'billing.ended', {});
            changed = true;
          }
        }

        // 4. Zahlungsverzug
        if (paying()) {
          const overdue = await op.tx.platformInvoice.count({
            where: { accountId, status: 'open', dueDate: { lt: now } },
          });
          const target = overdue > 0 ? 'past_due' : 'active';
          if (sub.status !== target) {
            sub = await op.tx.subscription.update({
              where: { accountId },
              data: { status: target },
            });
            await this.record(
              op,
              target === 'past_due' ? 'billing.past_due' : 'billing.paid_up',
              {},
            );
            changed = true;
          }
        }

        if ((await this.syncEntitlement(op)) || changed) return true;
        return false;
      },
      now,
    );
  }

  // ───────────────────────── Bausteine ─────────────────────────

  /**
   * Abo des Accounts; für Accounts aus der Zeit vor Phase 7 wird es aus der Lizenz übernommen
   * (Testphase bleibt Testphase, aktive Lizenz wird aktives Abo; Module außerhalb des Pakets
   * werden als gebuchte Zusatzmodule übernommen, damit nichts wegfällt).
   */
  async ensureSubscription(op: Op): Promise<Subscription> {
    const sub = await op.tx.subscription.findUnique({ where: { accountId: op.accountId } });
    if (sub) return sub;
    const ent = await op.tx.entitlement.findUniqueOrThrow({ where: { accountId: op.accountId } });
    const account = await op.tx.account.findUniqueOrThrow({ where: { id: op.accountId } });
    const plan = isPlanKey(ent.plan) ? ent.plan : 'starter';
    const trial = ent.status === 'TRIAL';
    const created = await op.tx.subscription.create({
      data: {
        accountId: op.accountId,
        plan,
        status: trial ? 'trialing' : ent.status === 'CANCELED' ? 'canceled' : 'active',
        currentPeriodStart: trial ? null : op.now,
        currentPeriodEnd: trial ? null : addInterval(op.now, 'month'),
        suspendedAt: ent.status === 'SUSPENDED' ? op.now : null,
        extraCompanies: Math.max(0, ent.maxCompanies - PLANS[plan].maxCompanies),
        billingName: account.name,
      },
    });
    const extra = ent.modules.filter(
      (m) => isModuleKey(m) && !(PLANS[plan].modules as readonly string[]).includes(m),
    );
    for (const m of extra)
      await op.tx.subscriptionAddon.create({
        data: {
          id: uuidv7(),
          accountId: op.accountId,
          module: m,
          status: 'active',
          startedAt: op.now,
        },
      });
    await op.tx.platformAccount.upsert({
      where: { accountId: op.accountId },
      create: { accountId: op.accountId, name: account.name, plan, status: ent.status },
      update: {},
    });
    return created;
  }

  private async lock(op: Op): Promise<Subscription> {
    await this.ensureSubscription(op);
    await op.tx
      .$queryRaw`SELECT account_id FROM subscriptions WHERE account_id = ${op.accountId}::uuid FOR UPDATE`;
    return op.tx.subscription.findUniqueOrThrow({ where: { accountId: op.accountId } });
  }

  /** Lizenz aus Abo neu berechnen. true, wenn sich die Lizenz geändert hat. */
  async syncEntitlement(op: Op): Promise<boolean> {
    const sub = await op.tx.subscription.findUnique({ where: { accountId: op.accountId } });
    if (!sub) return false;
    const addons = await op.tx.subscriptionAddon.findMany({ where: { accountId: op.accountId } });
    const oldest = await op.tx.platformInvoice.findFirst({
      where: { accountId: op.accountId, status: 'open', dueDate: { lt: op.now } },
      orderBy: { dueDate: 'asc' },
    });
    const overdueDays = oldest
      ? Math.floor((op.now.getTime() - oldest.dueDate.getTime()) / DAY)
      : 0;
    const next = computeEntitlement(sub, addons, op.now, overdueDays);
    const cur = await op.tx.entitlement.findUniqueOrThrow({ where: { accountId: op.accountId } });
    const same =
      cur.plan === next.plan &&
      cur.status === next.status &&
      cur.maxCompanies === next.maxCompanies &&
      cur.maxUsers === next.maxUsers &&
      cur.maxConnectors === next.maxConnectors &&
      (cur.validUntil?.getTime() ?? null) === (next.validUntil?.getTime() ?? null) &&
      [...cur.modules].sort().join() === [...next.modules].sort().join();
    if (same) return false;
    await op.tx.entitlement.update({ where: { accountId: op.accountId }, data: next });
    await op.tx.entitlementEvent.create({
      data: {
        id: uuidv7(),
        accountId: op.accountId,
        actor: op.actor.label,
        change: {
          before: {
            plan: cur.plan,
            status: cur.status,
            modules: cur.modules,
            validUntil: cur.validUntil,
          },
          after: {
            plan: next.plan,
            status: next.status,
            modules: next.modules,
            validUntil: next.validUntil,
          },
        } as object,
      },
    });
    await op.tx.platformAccount.updateMany({
      where: { accountId: op.accountId },
      data: { plan: next.plan, status: next.status },
    });
    return true;
  }

  private missingDetails(s: Subscription): string[] {
    const m: string[] = [];
    if (!s.billingName) m.push('Name');
    if (!s.billingStreet) m.push('Straße');
    if (!s.billingPostalCode) m.push('PLZ');
    if (!s.billingCity) m.push('Ort');
    if (!s.billingEmail) m.push('Rechnungs-E-Mail');
    return m;
  }

  private requireSelfService(plan: string) {
    if (planPriceCents(plan, 'month') === null)
      throw new AppError(
        422,
        'PLAN_NOT_SELF_SERVICE',
        'Dieses Paket wird individuell vereinbart. Bitte wenden Sie sich an den FangEvo-Vertrieb.',
      );
  }

  private issuerConfigured(): boolean {
    const c = this.config;
    return !!(
      c.PLATFORM_ISSUER_NAME &&
      c.PLATFORM_ISSUER_STREET &&
      c.PLATFORM_ISSUER_POSTAL_CODE &&
      c.PLATFORM_ISSUER_CITY &&
      (c.PLATFORM_ISSUER_VAT_ID || c.PLATFORM_ISSUER_TAX_NUMBER) &&
      c.PLATFORM_ISSUER_IBAN
    );
  }

  /** In Produktion keine Rechnung ohne vollständige Absenderdaten (Pflichtangaben § 14 UStG). */
  private requireIssuer() {
    if (this.config.isProd && !this.issuerConfigured())
      throw new AppError(
        503,
        'BILLING_NOT_CONFIGURED',
        'Die Abrechnung ist noch nicht eingerichtet. Bitte wenden Sie sich an FangEvo.',
      );
  }

  private paymentInfo() {
    return {
      method: 'invoice' as const,
      iban: this.config.PLATFORM_ISSUER_IBAN ?? null,
      bic: this.config.PLATFORM_ISSUER_BIC ?? null,
      bankName: this.config.PLATFORM_ISSUER_BANK_NAME ?? null,
      issuerConfigured: this.issuerConfigured(),
    };
  }

  private addonView(a: SubscriptionAddon, now: Date) {
    return {
      module: a.module,
      name: isModuleKey(a.module) ? MODULES[a.module].name : a.module,
      status: a.status,
      trialEndsAt: a.trialEndsAt,
      endsAt: a.endsAt,
      startedAt: a.startedAt,
      usable:
        a.status === 'active' ||
        (a.status === 'trial' && !!a.trialEndsAt && a.trialEndsAt > now) ||
        (a.status === 'canceled' && !!a.endsAt && a.endsAt > now),
    };
  }

  /** Bezahlte Zusatzmodule (aktiv). Testversionen und gekündigte werden nicht berechnet. */
  private async billableAddons(op: Op): Promise<string[]> {
    const rows = await op.tx.subscriptionAddon.findMany({
      where: { accountId: op.accountId, status: 'active' },
      orderBy: { module: 'asc' },
    });
    return rows.map((r) => r.module);
  }

  /** Zusatzmodule, die im neuen Paket enthalten sind, beenden. Liefert Gutschriften für Restlaufzeit. */
  private async dropIncludedAddons(
    op: Op,
    plan: string,
    sub?: Subscription,
  ): Promise<InvoiceLine[]> {
    if (!isPlanKey(plan)) return [];
    const included = PLANS[plan].modules as readonly string[];
    const rows = await op.tx.subscriptionAddon.findMany({
      where: {
        accountId: op.accountId,
        module: { in: [...included] },
        status: { not: 'canceled' },
      },
    });
    const credits: InvoiceLine[] = [];
    for (const a of rows) {
      await op.tx.subscriptionAddon.update({
        where: { id: a.id },
        data: { status: 'canceled', endsAt: op.now },
      });
      if (sub && a.status === 'active' && sub.currentPeriodStart && sub.currentPeriodEnd) {
        const price = addonPriceCents(a.module, sub.interval as BillingInterval) ?? 0;
        const rest = prorateCents(price, op.now, sub.currentPeriodStart, sub.currentPeriodEnd);
        if (rest > 0)
          credits.push({
            description: `Gutschrift Zusatzmodul ${this.moduleName(a.module)} (jetzt im Paket enthalten), anteilig bis ${fmtDate(sub.currentPeriodEnd)}`,
            amountNet: cents(-rest),
            taxRate: this.taxRate(sub),
          });
      }
    }
    return credits;
  }

  private moduleName(m: string) {
    return isModuleKey(m) ? MODULES[m].name : m;
  }

  private taxRate(sub: Subscription): string {
    return String(platformTax(sub.billingCountry, sub.billingVatId).rate);
  }

  private planName(plan: string) {
    return isPlanKey(plan) ? PLANS[plan].name : plan;
  }

  private periodLines(sub: Subscription, addons: string[]): InvoiceLine[] {
    const interval = sub.interval as BillingInterval;
    const label = interval === 'year' ? 'jährlich' : 'monatlich';
    const lines: InvoiceLine[] = [];
    const planCents = planPriceCents(sub.plan, interval);
    if (planCents !== null)
      lines.push({
        description: `FangEvo Wawi Pro – Paket ${this.planName(sub.plan)} (${label})`,
        amountNet: cents(planCents),
        taxRate: this.taxRate(sub),
      });
    for (const m of addons) {
      const p = addonPriceCents(m, interval);
      if (p !== null)
        lines.push({
          description: `Zusatzmodul ${this.moduleName(m)} (${label})`,
          amountNet: cents(p),
          taxRate: this.taxRate(sub),
        });
    }
    return lines;
  }

  private upgradeLines(sub: Subscription, plan: string, now: Date): InvoiceLine[] {
    const interval = sub.interval as BillingInterval;
    const start = sub.currentPeriodStart!;
    const end = sub.currentPeriodEnd!;
    const diff =
      prorateCents(planPriceCents(plan, interval) ?? 0, now, start, end) -
      prorateCents(planPriceCents(sub.plan, interval) ?? 0, now, start, end);
    return [
      {
        description: `Paketwechsel ${this.planName(sub.plan)} → ${this.planName(plan)}, anteilig ${fmtDate(now)} – ${fmtDate(end)}`,
        amountNet: cents(diff),
        taxRate: this.taxRate(sub),
      },
    ];
  }

  /** Anteilige Rechnung für Zusatzmodule bis zum Laufzeitende. */
  private async chargeAddonRest(op: Op, sub: Subscription, modules: string[]) {
    if (!sub.currentPeriodStart || !sub.currentPeriodEnd || sub.currentPeriodEnd <= op.now) return;
    const interval = sub.interval as BillingInterval;
    const lines: InvoiceLine[] = [];
    for (const m of modules) {
      const rest = prorateCents(
        addonPriceCents(m, interval) ?? 0,
        op.now,
        sub.currentPeriodStart,
        sub.currentPeriodEnd,
      );
      if (rest > 0)
        lines.push({
          description: `Zusatzmodul ${this.moduleName(m)}, anteilig ${fmtDate(op.now)} – ${fmtDate(sub.currentPeriodEnd)}`,
          amountNet: cents(rest),
          taxRate: this.taxRate(sub),
        });
    }
    if (lines.length) await this.issueInvoice(op, sub, op.now, sub.currentPeriodEnd, lines);
  }

  private async nextInvoiceNumber(tx: Tx, now: Date): Promise<string> {
    const year = now.getUTCFullYear();
    const [r] = await tx.$queryRaw<{ value: number }[]>`
      INSERT INTO platform_counters (key, value) VALUES (${`invoice:${year}`}, 1)
      ON CONFLICT (key) DO UPDATE SET value = platform_counters.value + 1
      RETURNING value`;
    return `FE-${year}-${String(r!.value).padStart(6, '0')}`;
  }

  private sender(): PdfSender {
    const c = this.config;
    const configured = this.issuerConfigured();
    return {
      name: c.PLATFORM_ISSUER_NAME ?? 'FangEvo (Absenderdaten nicht konfiguriert)',
      legalName: c.PLATFORM_ISSUER_NAME ?? null,
      street: c.PLATFORM_ISSUER_STREET ?? null,
      postalCode: c.PLATFORM_ISSUER_POSTAL_CODE ?? null,
      city: c.PLATFORM_ISSUER_CITY ?? null,
      country: c.PLATFORM_ISSUER_COUNTRY,
      email: c.PLATFORM_ISSUER_EMAIL ?? null,
      phone: null,
      vatId: c.PLATFORM_ISSUER_VAT_ID ?? null,
      taxNumber: c.PLATFORM_ISSUER_TAX_NUMBER ?? null,
      managingDirector: c.PLATFORM_ISSUER_MANAGING_DIRECTOR ?? null,
      registerCourt: c.PLATFORM_ISSUER_REGISTER_COURT ?? null,
      registerNumber: c.PLATFORM_ISSUER_REGISTER_NUMBER ?? null,
      bankName: c.PLATFORM_ISSUER_BANK_NAME ?? null,
      iban: c.PLATFORM_ISSUER_IBAN ?? null,
      bic: c.PLATFORM_ISSUER_BIC ?? null,
      documentFooter: configured ? null : 'TESTRECHNUNG – keine Forderung (Absenderdaten fehlen).',
      logoDataUrl: null,
    };
  }

  /** Rechnung erstellen (unveränderlich), PDF erzeugen, Mail vormerken, Benachrichtigung anlegen. */
  async issueInvoice(
    op: Op,
    sub: Subscription,
    periodStart: Date,
    periodEnd: Date,
    lines: InvoiceLine[],
  ) {
    if (!lines.length) return null;
    this.requireIssuer();
    const amounts = lines.map((l) =>
      lineAmounts({
        quantity: '1',
        unitPriceNet: l.amountNet,
        discountPercent: '0',
        taxRate: l.taxRate,
      }),
    );
    const totals = summarize(
      amounts.map((a, i) => ({ net: a.lineNet, taxRate: lines[i]!.taxRate })),
    );
    if (totals.totalNet.lte(0)) return null; // nichts zu berechnen (z. B. reine Gutschrift wird verrechnet)
    const number = await this.nextInvoiceNumber(op.tx, op.now);
    const dueDate = new Date(op.now.getTime() + INVOICE_DUE_DAYS * DAY);
    const tax = platformTax(sub.billingCountry, sub.billingVatId);
    const sender = this.sender();
    const pdf = await renderDocumentPdf({
      type: 'invoice',
      number,
      draft: false,
      issueDate: op.now,
      serviceDate: periodStart,
      dueDate,
      sender,
      recipient: {
        address: {
          name: sub.billingName,
          street: sub.billingStreet,
          postalCode: sub.billingPostalCode,
          city: sub.billingCity,
          country: sub.billingCountry,
        },
        customerNumber: op.accountId.slice(-12).toUpperCase(),
        vatId: sub.billingVatId,
      },
      reference: [
        { label: 'Leistungszeitraum', value: `${fmtDate(periodStart)} – ${fmtDate(periodEnd)}` },
      ],
      priceDisplay: 'net',
      showPrices: true,
      lines: lines.map((l, i) => ({
        articleNumber: null,
        name: l.description,
        unit: 'Stk',
        quantity: '1',
        unitPriceNet: l.amountNet,
        discountPercent: '0',
        taxRate: l.taxRate,
        lineNet: amounts[i]!.lineNet.toFixed(2),
        lineGross: amounts[i]!.lineGross.toFixed(2),
      })),
      taxSummary: totals.taxSummary,
      totalNet: totals.totalNet.toFixed(2),
      totalTax: totals.totalTax.toFixed(2),
      totalGross: totals.totalGross.toFixed(2),
      intro: 'Vielen Dank für Ihr Vertrauen. Wir berechnen Ihnen folgende Leistungen:',
      notes: [
        tax.note,
        `Bitte überweisen Sie den Betrag bis ${fmtDate(dueDate)}${sender.iban ? ` auf das Konto ${sender.iban}` : ''} unter Angabe der Rechnungsnummer ${number}.`,
      ]
        .filter(Boolean)
        .join('\n'),
      currency: 'EUR',
    });
    const invoice = await op.tx.platformInvoice.create({
      data: {
        id: uuidv7(),
        accountId: op.accountId,
        number,
        periodStart,
        periodEnd,
        lines: lines.map((l, i) => ({ ...l, lineNet: amounts[i]!.lineNet.toFixed(2) })) as object,
        totalNet: new Prisma.Decimal(totals.totalNet),
        totalTax: new Prisma.Decimal(totals.totalTax),
        totalGross: new Prisma.Decimal(totals.totalGross),
        status: 'open',
        pdf: new Uint8Array(pdf),
        sha256: createHash('sha256').update(pdf).digest('hex'),
        issuedAt: op.now,
        dueDate,
      },
    });
    await this.record(op, 'billing.invoice_issued', {
      number,
      totalGross: totals.totalGross.toFixed(2),
    });
    const users = await usersWithPermission(op.tx, op.accountId, 'billing.manage');
    await this.notifications.create(op.tx, {
      accountId: op.accountId,
      userIds: users,
      type: 'billing.invoice',
      title: `Neue Rechnung ${number}`,
      body: `${fmtEur(totals.totalGross.toFixed(2))}, fällig am ${fmtDate(dueDate)}`,
      link: '/admin/billing',
      dedupeKey: `invoice:${invoice.id}`,
    });
    if (sub.billingEmail)
      op.mails.push({
        to: sub.billingEmail,
        subject: `Ihre FangEvo-Rechnung ${number}`,
        text: [
          `Guten Tag,`,
          ``,
          `anbei erhalten Sie die Rechnung ${number} über ${fmtEur(totals.totalGross.toFixed(2))}.`,
          `Leistungszeitraum: ${fmtDate(periodStart)} – ${fmtDate(periodEnd)}`,
          `Fällig am: ${fmtDate(dueDate)}`,
          ``,
          `Alle Rechnungen finden Sie auch in FangEvo Wawi Pro unter Administration → Abo & Rechnungen.`,
        ].join('\n'),
        attachments: [{ filename: `${number}.pdf`, content: pdf, contentType: 'application/pdf' }],
      });
    return invoice;
  }

  async record(op: Op, action: string, data: Record<string, unknown>) {
    await this.audit.record(op.tx, {
      accountId: op.accountId,
      userId: op.actor.userId,
      action,
      entityType: 'subscription',
      entityId: op.accountId,
      data: { ...data, actor: op.actor.label },
      ip: op.actor.ip ?? null,
    });
  }
}
