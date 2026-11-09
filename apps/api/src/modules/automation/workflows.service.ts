import { Inject, Injectable, Logger } from '@nestjs/common';
import { type z } from 'zod';
import { type Prisma, uuidv7, type Tx, type WorkflowRule } from '@fangevo/database';
import {
  canTransition,
  CONDITION_FIELDS,
  ORDER_STATUSES,
  triggerContext,
  workflowDefinitionSchema,
  type ListQuery,
  type OrderStatus,
  type WorkflowAction,
  type WorkflowDefinition,
  type workflowInputSchema,
} from '@fangevo/shared';
import { AccessService } from '../../core/access/access.service';
import { AuditService } from '../../core/audit/audit.service';
import { Database } from '../../core/database/database.service';
import { type DomainEvent, type EventHandler } from '../../core/events/event-types';
import { AppError, Errors } from '../../core/http/errors';
import { type TenantContext } from '../../core/http/context';
import { JobQueue, type JobHandler, type QueuedJob } from '../../core/jobs/job-queue.service';
import { MailService } from '../../core/mail/mail.service';
import { usersWithPermission } from '../../core/notifications/recipients';
import { NotificationsService } from '../../core/notifications/notifications.service';
import { buildListArgs, type FieldSpec } from '../../core/lists/list-query';
import { isPermission } from '@fangevo/shared';
import { CompanyDb, type CompanyContext } from '../common/company-db';
import { dec } from '../common/decimal';
import { type CustomerSnapshot, OrdersService } from '../orders/orders.service';
import { WebhooksService } from './webhooks.service';

export const WORKFLOW_FIELDS: FieldSpec = {
  name: { kind: 'string', sortable: true },
  triggerType: { kind: 'enum', sortable: true },
  active: { kind: 'boolean', sortable: true },
  updatedAt: { kind: 'date', sortable: true },
};

/** Ereignis → Auslöser einer Regel */
const EVENT_TRIGGERS: Record<string, string> = {
  'order.created': 'order.created',
  'order.status_changed': 'order.status_changed',
  'order.shipped': 'order.shipped',
  'return.received': 'return.received',
  'stock.issued': 'stock.low',
  'stock.corrected': 'stock.low',
  'stock.transferred': 'stock.low',
};

/** Schutz vor Endlosschleifen: höchstens so viele Ausführungen je Regel und Datensatz in 10 Minuten. */
const LOOP_LIMIT = 3;

type Context = Record<string, unknown> & {
  kind: 'order' | 'article' | 'purchase';
  entityId: string;
};
type Step = { action: string; ok: boolean; message: string };

/**
 * Regeln „Wenn – und – dann“ (Playbook 16). Jede gespeicherte Fassung wird als Version abgelegt;
 * Ausführungen verweisen auf ihre Version und werden protokolliert. Regeln laufen im Hintergrund mit
 * den aktuellen Rechten der Person, die sie zuletzt gespeichert hat.
 */
@Injectable()
export class WorkflowsService implements EventHandler {
  readonly name = 'workflows';
  private readonly logger = new Logger('Workflows');

  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(CompanyDb) private readonly cdb: CompanyDb,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(JobQueue) private readonly queue: JobQueue,
    @Inject(AccessService) private readonly access: AccessService,
    @Inject(OrdersService) private readonly orders: OrdersService,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
    @Inject(MailService) private readonly mail: MailService,
    @Inject(WebhooksService) private readonly webhooks: WebhooksService,
  ) {}

  // ───── Verwaltung ─────

  list(t: TenantContext, q: ListQuery) {
    return this.cdb.run(t, async (tx) => {
      const args = buildListArgs(q, WORKFLOW_FIELDS, { search: ['name'], defaultSort: 'name:asc' });
      const where = { AND: [args.where, { archivedAt: null }] };
      const [items, total] = await Promise.all([
        tx.workflowRule.findMany({
          where,
          orderBy: args.orderBy,
          skip: args.skip,
          take: args.take,
        }),
        tx.workflowRule.count({ where }),
      ]);
      return { items, total, page: q.page, pageSize: q.pageSize };
    });
  }

  get(t: TenantContext, id: string) {
    return this.cdb.run(t, async (tx) => {
      const rule = await this.require(tx, id);
      const [versions, runs] = await Promise.all([
        tx.workflowVersion.findMany({ where: { ruleId: id }, orderBy: { version: 'desc' } }),
        tx.workflowRun.findMany({
          where: { ruleId: id },
          orderBy: { createdAt: 'desc' },
          take: 50,
        }),
      ]);
      return { ...rule, definition: versions[0]?.definition, versions, runs };
    });
  }

  private async require(tx: Tx, id: string): Promise<WorkflowRule> {
    const r = await tx.workflowRule.findUnique({ where: { id } });
    if (!r || r.archivedAt) throw Errors.notFound('Regel nicht gefunden');
    return r;
  }

  /** Speichern legt immer eine neue Version an. */
  save(t: TenantContext, id: string | null, input: z.infer<typeof workflowInputSchema>) {
    return this.cdb.run(t, async (tx, c) => {
      await this.checkActions(tx, c, input.definition);
      let rule: WorkflowRule;
      let version = 1;
      if (id) {
        const cur = await this.require(tx, id);
        version = cur.currentVersion + 1;
        rule = await tx.workflowRule.update({
          where: { id },
          data: {
            name: input.name,
            active: input.active,
            triggerType: input.definition.trigger.type,
            currentVersion: version,
            runAs: c.user.id,
          },
        });
      } else {
        rule = await tx.workflowRule.create({
          data: {
            id: uuidv7(),
            accountId: c.account.id,
            companyId: c.companyId,
            name: input.name,
            active: input.active,
            triggerType: input.definition.trigger.type,
            runAs: c.user.id,
          },
        });
      }
      await tx.workflowVersion.create({
        data: {
          id: uuidv7(),
          accountId: c.account.id,
          companyId: c.companyId,
          ruleId: rule.id,
          version,
          definition: input.definition as unknown as Prisma.InputJsonValue,
          createdBy: c.user.id,
        },
      });
      await this.syncSchedule(tx, rule, input.definition);
      await this.audit.record(tx, {
        accountId: c.account.id,
        userId: c.user.id,
        companyId: c.companyId,
        action: id ? 'workflow.updated' : 'workflow.created',
        entityType: 'workflow',
        entityId: rule.id,
        data: { name: rule.name, version, active: rule.active },
        ip: c.ip,
      });
      return { ...rule, definition: input.definition };
    });
  }

  archive(t: TenantContext, id: string) {
    return this.cdb.run(t, async (tx, c) => {
      const rule = await this.require(tx, id);
      await tx.workflowRule.update({
        where: { id },
        data: { archivedAt: new Date(), active: false },
      });
      await tx.workflowSchedule.deleteMany({ where: { ruleId: id } });
      await this.audit.record(tx, {
        accountId: c.account.id,
        userId: c.user.id,
        companyId: c.companyId,
        action: 'workflow.archived',
        entityType: 'workflow',
        entityId: id,
        data: { name: rule.name },
        ip: c.ip,
      });
    });
  }

  /** Aktionen vorab prüfen (Status gültig, Webhook vorhanden, Recht bekannt). */
  private async checkActions(tx: Tx, c: CompanyContext, d: WorkflowDefinition) {
    const kind = triggerContext(d.trigger);
    const allowed = Object.keys(CONDITION_FIELDS[kind]);
    for (const cond of d.conditions)
      if (!allowed.includes(cond.field))
        throw new AppError(
          422,
          'VALIDATION_FAILED',
          `Das Feld ${cond.field} passt nicht zum Auslöser`,
        );
    for (const a of d.actions) {
      if ((a.type === 'set_order_status' || a.type === 'set_shipping_method') && kind !== 'order')
        throw new AppError(
          422,
          'VALIDATION_FAILED',
          'Auftragsaktionen gibt es nur bei Auftrags-Auslösern',
        );
      if (a.type === 'set_order_status' && !(a.status in ORDER_STATUSES))
        throw new AppError(422, 'VALIDATION_FAILED', `Unbekannter Status ${a.status}`);
      if (a.type === 'set_order_status' && ['shipped', 'cancelled'].includes(a.status))
        throw new AppError(
          422,
          'VALIDATION_FAILED',
          'Versenden und Stornieren sind als Regel-Aktion nicht erlaubt',
        );
      if (a.type === 'notify' && !isPermission(a.permission))
        throw new AppError(422, 'VALIDATION_FAILED', `Unbekanntes Recht ${a.permission}`);
      if (
        a.type === 'webhook' &&
        !(await tx.webhook.count({ where: { id: a.webhookId, archivedAt: null } }))
      )
        throw new AppError(422, 'VALIDATION_FAILED', 'Webhook nicht gefunden');
      if (a.type === 'send_email' && !c.account.permissions.has('workflows.manage'))
        throw new AppError(403, 'PERMISSION_DENIED', 'Fehlende Berechtigung');
    }
  }

  // ───── Zeitsteuerung ─────

  /** Nächster Lauf (stündlich zur vollen Stunde bzw. täglich zur Uhrzeit, Europe/Berlin). */
  static nextRun(every: 'hour' | 'day', hour: number, from = new Date()): Date {
    const next = new Date(from);
    next.setUTCSeconds(0, 0);
    if (every === 'hour') {
      next.setUTCMinutes(0);
      next.setUTCHours(next.getUTCHours() + 1);
      return next;
    }
    // Uhrzeit in Berlin → UTC (Sommerzeit über Intl ermitteln)
    const berlin = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Berlin',
      hour: '2-digit',
      hourCycle: 'h23',
    });
    const offset = (Number(berlin.format(from)) - from.getUTCHours() + 24) % 24;
    next.setUTCMinutes(0);
    next.setUTCHours(hour - offset);
    while (next <= from) next.setUTCDate(next.getUTCDate() + 1);
    return next;
  }

  private async syncSchedule(tx: Tx, rule: WorkflowRule, d: WorkflowDefinition) {
    await tx.workflowSchedule.deleteMany({ where: { ruleId: rule.id } });
    if (rule.active && d.trigger.type === 'schedule' && d.trigger.schedule)
      await tx.workflowSchedule.create({
        data: {
          ruleId: rule.id,
          accountId: rule.accountId,
          companyId: rule.companyId,
          nextRunAt: WorkflowsService.nextRun(d.trigger.schedule.every, d.trigger.schedule.hour),
        },
      });
  }

  /** Fällige zeitgesteuerte Regeln einreihen (vom Worker jede Minute aufgerufen). */
  async tick(now = new Date()): Promise<number> {
    const due = await this.db.global.$queryRaw<
      { rule_id: string; account_id: string; company_id: string }[]
    >`
      SELECT rule_id, account_id, company_id FROM workflow_schedule
      WHERE next_run_at <= ${now} ORDER BY next_run_at LIMIT 50 FOR UPDATE SKIP LOCKED`;
    for (const r of due) {
      await this.db.tenant(
        { accountId: r.account_id, userId: null, companyId: r.company_id },
        async (tx) => {
          const rule = await tx.workflowRule.findUnique({ where: { id: r.rule_id } });
          const v = rule
            ? await tx.workflowVersion.findUnique({
                where: { ruleId_version: { ruleId: rule.id, version: rule.currentVersion } },
              })
            : null;
          const def = v ? workflowDefinitionSchema.parse(v.definition) : null;
          if (!rule || !rule.active || rule.archivedAt || !def?.trigger.schedule) {
            await tx.workflowSchedule.deleteMany({ where: { ruleId: r.rule_id } });
            return;
          }
          await tx.workflowSchedule.update({
            where: { ruleId: rule.id },
            data: {
              nextRunAt: WorkflowsService.nextRun(
                def.trigger.schedule.every,
                def.trigger.schedule.hour,
                now,
              ),
            },
          });
          await this.queue.enqueue(tx, {
            kind: 'workflow_schedule',
            accountId: rule.accountId,
            companyId: rule.companyId,
            userId: rule.runAs,
            refId: rule.id,
          });
        },
      );
    }
    return due.length;
  }

  private ticker: NodeJS.Timeout | undefined;
  startScheduler(intervalMs = 60_000): void {
    const loop = async () => {
      try {
        await this.tick();
      } catch (err) {
        this.logger.error(`Zeitsteuerung: ${String(err)}`);
      }
      this.ticker = setTimeout(loop, intervalMs);
    };
    this.ticker = setTimeout(loop, 1000);
  }
  stopScheduler(): void {
    if (this.ticker) clearTimeout(this.ticker);
  }

  /** Zeitgesteuerte Prüfung ausführen: für jeden Treffer einen Lauf anlegen. */
  async runSchedule(job: QueuedJob): Promise<void> {
    const t = await this.runAs(job);
    if (!t) return;
    await this.cdb.run(t, async (tx, c) => {
      const rule = await tx.workflowRule.findUnique({ where: { id: job.refId } });
      if (!rule?.active) return;
      const v = await tx.workflowVersion.findUnique({
        where: { ruleId_version: { ruleId: rule.id, version: rule.currentVersion } },
      });
      const def = workflowDefinitionSchema.parse(v!.definition);
      const s = def.trigger.schedule!;
      let ids: string[] = [];
      if (s.check === 'orders_waiting') {
        const since = new Date(Date.now() - (s.hours ?? 24) * 3600_000);
        const rows = await tx.$queryRaw<{ id: string }[]>`
          SELECT o.id FROM sales_orders o
          WHERE o.company_id = ${c.companyId}::uuid
            AND o.status NOT IN ('shipped','completed','cancelled')
            AND (${s.status ?? null}::text IS NULL OR o.status = ${s.status ?? ''})
            AND COALESCE((SELECT MAX(h.created_at) FROM order_status_history h WHERE h.order_id = o.id), o.created_at) < ${since}
          LIMIT 500`;
        ids = rows.map((r) => r.id);
      } else if (s.check === 'purchase_overdue') {
        ids = (
          await tx.purchaseOrder.findMany({
            where: {
              status: { in: ['ordered', 'partially_received'] },
              expectedDate: { lt: new Date() },
            },
            select: { id: true },
            take: 500,
          })
        ).map((p) => p.id);
      } else {
        const rows = await tx.$queryRaw<{ id: string }[]>`
          SELECT a.id FROM articles a
          WHERE a.company_id = ${c.companyId}::uuid AND a.archived_at IS NULL AND a.active AND a.stock_tracked AND a.min_stock > 0
            AND COALESCE((SELECT SUM(quantity) FROM stock_levels l WHERE l.company_id = a.company_id AND l.article_id = a.id), 0) < a.min_stock
          LIMIT 500`;
        ids = rows.map((r) => r.id);
      }
      // Ein Lauf je Treffer und Zeitraum (stündlich bzw. täglich)
      const period = new Date().toISOString().slice(0, s.every === 'hour' ? 13 : 10);
      for (const id of ids)
        await this.enqueueRun(tx, c, rule, 'schedule', rule.id, `${id}@${period}`);
    });
  }

  // ───── Ereignisse → Läufe ─────

  handles(type: string): boolean {
    return type in EVENT_TRIGGERS;
  }

  async handle(_tx: Tx, e: DomainEvent): Promise<void> {
    if (!e.companyId || !e.entityId) return;
    const trigger = EVENT_TRIGGERS[e.type]!;
    await this.db.tenant(
      { accountId: e.accountId, userId: null, companyId: e.companyId },
      async (tx) => {
        const rules = await tx.workflowRule.findMany({
          where: { active: true, archivedAt: null, triggerType: trigger },
        });
        for (const rule of rules) {
          if (trigger === 'order.status_changed') {
            const v = await tx.workflowVersion.findUnique({
              where: { ruleId_version: { ruleId: rule.id, version: rule.currentVersion } },
            });
            const to =
              (workflowDefinitionSchema.parse(v!.definition).trigger.toStatus ?? '') || null;
            if (to && (e.payload as { to?: string } | null)?.to !== to) continue;
          }
          await this.enqueueRun(
            tx,
            { account: { id: e.accountId }, companyId: e.companyId } as CompanyContext,
            rule,
            e.type,
            e.id,
            e.entityId!,
          );
        }
      },
    );
  }

  private async enqueueRun(
    tx: Tx,
    c: Pick<CompanyContext, 'account' | 'companyId'>,
    rule: WorkflowRule,
    eventType: string,
    eventId: string,
    entityId: string,
  ) {
    const exists = await tx.workflowRun.count({ where: { ruleId: rule.id, eventId, entityId } });
    if (exists) return;
    const run = await tx.workflowRun.create({
      data: {
        id: uuidv7(),
        accountId: c.account.id,
        companyId: c.companyId,
        ruleId: rule.id,
        version: rule.currentVersion,
        eventType,
        eventId,
        entityId,
      },
    });
    await this.queue.enqueue(tx, {
      kind: 'workflow_run',
      accountId: c.account.id,
      companyId: c.companyId,
      userId: rule.runAs,
      refId: run.id,
    });
  }

  private async runAs(job: QueuedJob): Promise<TenantContext | null> {
    if (!job.userId || !job.companyId) return null;
    const account = await this.access.loadAccountContext(job.userId, job.accountId);
    if (!account) return null;
    const user = await this.db.global.user.findUnique({
      where: { id: job.userId },
      select: { id: true, email: true, name: true, mfaEnabled: true },
    });
    if (!user) return null;
    return { sessionId: `workflow:${job.id}`, user, account, companyId: job.companyId, ip: null };
  }

  /** Einen Lauf ausführen: Kontext laden, Bedingungen prüfen, Aktionen ausführen, protokollieren. */
  async runOne(job: QueuedJob): Promise<void> {
    const t = await this.runAs(job);
    if (!t) {
      await this.db.tenant(
        { accountId: job.accountId, userId: null, companyId: job.companyId },
        (tx) =>
          tx.workflowRun.update({
            where: { id: job.refId },
            data: {
              status: 'failed',
              error: 'Die ausführende Person hat keinen Zugriff mehr',
              finishedAt: new Date(),
            },
          }),
      );
      return;
    }
    await this.cdb.run(t, async (tx, c) => {
      const run = await tx.workflowRun.findUnique({ where: { id: job.refId } });
      if (!run || run.status !== 'queued') return;
      const v = await tx.workflowVersion.findUnique({
        where: { ruleId_version: { ruleId: run.ruleId, version: run.version } },
      });
      const def = workflowDefinitionSchema.parse(v!.definition);
      const entityId = (run.entityId ?? '').split('@')[0]!;
      const finish = (
        status: 'success' | 'skipped' | 'failed',
        data: { context?: Context | null; steps?: Step[]; error?: string },
      ) =>
        tx.workflowRun.update({
          where: { id: run.id },
          data: {
            status,
            context: (data.context ?? null) as Prisma.InputJsonValue,
            steps: (data.steps ?? []) as Prisma.InputJsonValue,
            error: data.error ?? null,
            finishedAt: new Date(),
          },
        });
      // Schutz vor Endlosschleifen
      const recent = await tx.workflowRun.count({
        where: {
          ruleId: run.ruleId,
          status: 'success',
          entityId: { startsWith: entityId },
          createdAt: { gte: new Date(Date.now() - 600_000) },
        },
      });
      if (recent >= LOOP_LIMIT) {
        await finish('skipped', {
          error: `Schutz vor Endlosschleifen: Regel lief in 10 Minuten bereits ${recent}× für diesen Datensatz`,
        });
        return;
      }
      const context = await this.context(tx, c, triggerContext(def.trigger), entityId);
      if (!context) {
        await finish('skipped', { error: 'Datensatz nicht gefunden' });
        return;
      }
      if (
        def.trigger.type === 'stock.low' &&
        !(Number(context['article.stock']) < Number(context['article.minStock']))
      ) {
        await finish('skipped', { context, error: 'Bestand nicht unter Mindestbestand' });
        return;
      }
      if (!this.matches(def, context)) {
        await finish('skipped', { context, error: 'Bedingungen nicht erfüllt' });
        return;
      }
      const steps: Step[] = [];
      for (const a of def.actions) {
        try {
          steps.push({
            action: a.type,
            ok: true,
            message: await this.execute(tx, c, run.ruleId, a, context),
          });
        } catch (e) {
          steps.push({
            action: a.type,
            ok: false,
            message: e instanceof Error ? e.message : String(e),
          });
          await finish('failed', { context, steps, error: `Aktion ${a.type} fehlgeschlagen` });
          return;
        }
      }
      await finish('success', { context, steps });
    });
  }

  /** Testlauf: Bedingungen gegen einen echten Datensatz prüfen, ohne Aktionen auszuführen. */
  test(t: TenantContext, id: string, entityId: string) {
    return this.cdb.run(t, async (tx, c) => {
      const rule = await this.require(tx, id);
      const v = await tx.workflowVersion.findUnique({
        where: { ruleId_version: { ruleId: id, version: rule.currentVersion } },
      });
      const def = workflowDefinitionSchema.parse(v!.definition);
      const context = await this.context(tx, c, triggerContext(def.trigger), entityId);
      if (!context)
        throw Errors.notFound(
          'Datensatz nicht gefunden (Auftrag, Artikel bzw. Bestellung der aktiven Firma)',
        );
      const results = def.conditions.map((cond) => ({
        ...cond,
        actual: context[cond.field] ?? null,
        ok: this.check(cond, context),
      }));
      const matched = this.matches(def, context);
      await tx.workflowRun.create({
        data: {
          id: uuidv7(),
          accountId: c.account.id,
          companyId: c.companyId,
          ruleId: id,
          version: rule.currentVersion,
          status: 'test',
          eventType: 'test',
          entityId: `${entityId}@test-${Date.now()}`,
          context: context as unknown as Prisma.InputJsonValue,
          steps: (matched
            ? def.actions.map((a) => ({ action: a.type, ok: true, message: 'würde ausgeführt' }))
            : []) as unknown as Prisma.InputJsonValue,
          finishedAt: new Date(),
        },
      });
      return { matched, conditions: results, actions: matched ? def.actions : [], context };
    });
  }

  // ───── Bedingungen ─────

  private matches(d: WorkflowDefinition, ctx: Context): boolean {
    if (!d.conditions.length) return true;
    const r = d.conditions.map((c) => this.check(c, ctx));
    return d.match === 'any' ? r.some(Boolean) : r.every(Boolean);
  }

  private check(c: WorkflowDefinition['conditions'][number], ctx: Context): boolean {
    const actual = ctx[c.field];
    const a = actual === null || actual === undefined ? '' : String(actual);
    const num = (s: string) => Number(s.replace(',', '.'));
    switch (c.op) {
      case 'eq':
        return a.toLowerCase() === c.value.toLowerCase();
      case 'neq':
        return a.toLowerCase() !== c.value.toLowerCase();
      case 'contains':
        return a.toLowerCase().includes(c.value.toLowerCase());
      case 'in':
        return c.value
          .split(',')
          .map((x) => x.trim().toLowerCase())
          .includes(a.toLowerCase());
      case 'gt':
        return num(a) > num(c.value);
      case 'gte':
        return num(a) >= num(c.value);
      case 'lt':
        return num(a) < num(c.value);
      case 'lte':
        return num(a) <= num(c.value);
    }
  }

  private async context(
    tx: Tx,
    c: CompanyContext,
    kind: 'order' | 'article' | 'purchase',
    id: string,
  ): Promise<Context | null> {
    if (kind === 'order') {
      const o = await tx.salesOrder.findUnique({ where: { id } });
      if (!o) return null;
      const snap = o.customerSnapshot as unknown as CustomerSnapshot;
      const [customer, lines, last, channel] = await Promise.all([
        tx.customer.findUnique({ where: { id: o.customerId }, select: { customerGroupId: true } }),
        tx.salesOrderLine.count({ where: { orderId: id } }),
        tx.orderStatusHistory.findFirst({ where: { orderId: id }, orderBy: { createdAt: 'desc' } }),
        o.channelId
          ? tx.salesChannel.findUnique({ where: { id: o.channelId }, select: { name: true } })
          : null,
      ]);
      const group = customer?.customerGroupId
        ? await tx.customerGroup.findUnique({
            where: { id: customer.customerGroupId },
            select: { name: true },
          })
        : null;
      return {
        kind,
        entityId: id,
        'order.number': o.number,
        'order.totalGross': dec(o.totalGross).toNumber(),
        'order.totalNet': dec(o.totalNet).toNumber(),
        'order.status': o.status,
        'order.customerCountry': snap.shipping?.country ?? snap.billing?.country ?? '',
        'order.customerType': snap.type,
        'order.customerGroup': group?.name ?? '',
        'order.customerName': snap.displayName,
        'order.paymentMethod': o.paymentMethod ?? '',
        'order.shippingMethod': o.shippingMethod ?? '',
        'order.channel': channel?.name ?? '',
        'order.itemCount': lines,
        'order.hoursInStatus': Math.floor(
          (Date.now() - (last?.createdAt ?? o.createdAt).getTime()) / 3600_000,
        ),
      };
    }
    if (kind === 'article') {
      const a = await tx.article.findUnique({ where: { id } });
      if (!a) return null;
      const s = await tx.stockLevel.aggregate({
        where: { articleId: id },
        _sum: { quantity: true },
      });
      return {
        kind,
        entityId: id,
        'article.number': a.number,
        'article.name': a.name,
        'article.stock': dec(s._sum.quantity ?? 0).toNumber(),
        'article.minStock': dec(a.minStock).toNumber(),
      };
    }
    const p = await tx.purchaseOrder.findUnique({ where: { id } });
    if (!p) return null;
    const sup = await tx.supplier.findUnique({
      where: { id: p.supplierId },
      select: { name: true },
    });
    return {
      kind,
      entityId: id,
      'purchase.number': p.number,
      'purchase.supplier': sup?.name ?? '',
      'purchase.daysOverdue': p.expectedDate
        ? Math.max(0, Math.floor((Date.now() - p.expectedDate.getTime()) / 86_400_000))
        : 0,
      'purchase.totalNet': dec(p.totalNet).toNumber(),
    };
  }

  // ───── Aktionen ─────

  /** Platzhalter {{order.number}} usw. ersetzen. */
  private fill(text: string, ctx: Context): string {
    return text.replace(/\{\{\s*([a-zA-Z.]+)\s*\}\}/g, (_, k: string) => String(ctx[k] ?? ''));
  }

  private async execute(
    tx: Tx,
    c: CompanyContext,
    ruleId: string,
    a: WorkflowAction,
    ctx: Context,
  ): Promise<string> {
    const rule = await tx.workflowRule.findUnique({
      where: { id: ruleId },
      select: { name: true },
    });
    const note = `Regel „${rule?.name ?? ''}“`;
    switch (a.type) {
      case 'set_order_status': {
        const from = ctx['order.status'] as OrderStatus;
        if (from === a.status) return 'Status war bereits gesetzt';
        if (!canTransition(from, a.status as OrderStatus))
          throw new Error(
            `Wechsel von „${ORDER_STATUSES[from]}“ nach „${ORDER_STATUSES[a.status as OrderStatus]}“ ist nicht erlaubt`,
          );
        await this.orders.transitionInTx(tx, c, ctx.entityId, a.status as OrderStatus, note);
        return `Status auf „${ORDER_STATUSES[a.status as OrderStatus]}“ gesetzt`;
      }
      case 'set_shipping_method':
        await this.orders.setShippingMethodInTx(tx, c, ctx.entityId, this.fill(a.value, ctx), note);
        return `Versandart „${a.value}“ gesetzt`;
      case 'notify': {
        const users = await usersWithPermission(tx, c.account.id, a.permission as never);
        const n = await this.notifications.create(tx, {
          accountId: c.account.id,
          userIds: users,
          type: 'workflow.notice',
          title: this.fill(a.title, ctx),
          body: this.fill(a.message, ctx),
          link:
            ctx.kind === 'order'
              ? `/orders?id=${ctx.entityId}`
              : ctx.kind === 'article'
                ? `/articles?id=${ctx.entityId}`
                : `/purchasing?id=${ctx.entityId}`,
          dedupeKey: `workflow:${ruleId}:${ctx.entityId}:${Date.now()}`,
        });
        return `${n} Person(en) benachrichtigt`;
      }
      case 'send_email':
        await this.mail.send({
          to: a.to,
          subject: this.fill(a.subject, ctx),
          text: this.fill(a.message, ctx),
        });
        return `E-Mail an ${a.to} gesendet`;
      case 'webhook': {
        const w = await tx.webhook.findUnique({ where: { id: a.webhookId } });
        if (!w || w.archivedAt || !w.active)
          throw new Error('Webhook nicht gefunden oder deaktiviert');
        await this.webhooks.createDelivery(tx, w, null, 'workflow', {
          rule: rule?.name,
          ruleId,
          context: ctx,
        });
        return 'An Webhook übergeben';
      }
    }
  }
}

/** Hintergrund-Handler für einzelne Läufe und zeitgesteuerte Prüfungen. */
@Injectable()
export class WorkflowRunHandler implements JobHandler {
  readonly kind = 'workflow_run';
  constructor(@Inject(WorkflowsService) private readonly wf: WorkflowsService) {}
  run(job: QueuedJob) {
    return this.wf.runOne(job);
  }
}

@Injectable()
export class WorkflowScheduleHandler implements JobHandler {
  readonly kind = 'workflow_schedule';
  constructor(@Inject(WorkflowsService) private readonly wf: WorkflowsService) {}
  run(job: QueuedJob) {
    return this.wf.runSchedule(job);
  }
}
