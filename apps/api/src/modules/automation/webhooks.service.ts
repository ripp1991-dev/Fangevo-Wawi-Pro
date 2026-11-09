import { createHmac, randomBytes } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { type z } from 'zod';
import { Prisma, uuidv7, type Tx, type Webhook } from '@fangevo/database';
import { WEBHOOK_EVENTS, type webhookInputSchema } from '@fangevo/shared';
import { APP_CONFIG, type AppConfig } from '../../config';
import { AuditService } from '../../core/audit/audit.service';
import { Database } from '../../core/database/database.service';
import { type DomainEvent, type EventHandler } from '../../core/events/event-types';
import { AppError, Errors } from '../../core/http/errors';
import { type TenantContext } from '../../core/http/context';
import { JobQueue, type JobHandler, type QueuedJob } from '../../core/jobs/job-queue.service';
import { usersWithPermission } from '../../core/notifications/recipients';
import { NotificationsService } from '../../core/notifications/notifications.service';
import { SecretBox } from '../../core/security/crypto';
import { CompanyDb } from '../common/company-db';

const MAX_ATTEMPTS = 8;
const DISABLE_AFTER = 20;
const TIMEOUT_MS = 10_000;

/** Wartezeit vor dem nächsten Versuch: 1 min, 2, 4, 8 … höchstens 6 Stunden. */
const backoffMs = (attempt: number) => Math.min(60_000 * 2 ** (attempt - 1), 6 * 3600_000);

/** Private, Loopback- und Link-Local-Adressen (Schutz gegen Aufrufe ins interne Netz, SSRF). */
export function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase();
    if (v === '::1' || v === '::') return true;
    if (v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80')) return true;
    const mapped = /::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v);
    return mapped ? isPrivateAddress(mapped[1]!) : false;
  }
  const [a, b] = ip.split('.').map(Number) as [number, number];
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    a >= 224
  );
}

export function sign(secret: string, timestamp: string, body: string): string {
  return 'sha256=' + createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

/**
 * Webhooks (Playbook 20): Abonnements je Firma, Zustellung im Hintergrund.
 * Jede Zustellung ist mit HMAC-SHA256 signiert (`X-FangEvo-Signature: sha256=…` über
 * `Zeitstempel.Body`). Fehlgeschlagene Zustellungen werden mit wachsender Wartezeit wiederholt;
 * nach dauerhaften Fehlern wird der Webhook abgeschaltet und die Verantwortlichen werden benachrichtigt.
 */
@Injectable()
export class WebhooksService implements EventHandler, JobHandler {
  readonly name = 'webhooks';
  readonly kind = 'webhook_delivery';
  private readonly logger = new Logger('Webhooks');
  private readonly box: SecretBox;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(Database) private readonly db: Database,
    @Inject(CompanyDb) private readonly cdb: CompanyDb,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(JobQueue) private readonly queue: JobQueue,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
  ) {
    this.box = new SecretBox(config.APP_ENCRYPTION_KEY);
  }

  // ───── Verwaltung ─────

  list(t: TenantContext) {
    return this.cdb.run(t, (tx) =>
      tx.webhook.findMany({
        where: { archivedAt: null },
        orderBy: { createdAt: 'asc' },
        omit: { secretEnc: true },
      }),
    );
  }

  create(t: TenantContext, input: z.infer<typeof webhookInputSchema>) {
    return this.cdb.run(t, async (tx, c) => {
      const secret = `whsec_${randomBytes(24).toString('base64url')}`;
      const w = await tx.webhook.create({
        data: {
          id: uuidv7(),
          accountId: c.account.id,
          companyId: c.companyId,
          name: input.name,
          url: input.url,
          events: input.events,
          active: input.active,
          secretEnc: this.box.encrypt(secret),
          createdBy: c.user.id,
        },
        omit: { secretEnc: true },
      });
      await this.log(tx, t, c.companyId, 'webhook.created', w.id, {
        name: w.name,
        url: w.url,
        events: w.events,
      });
      return { ...w, secret };
    });
  }

  update(t: TenantContext, id: string, input: z.infer<typeof webhookInputSchema>) {
    return this.cdb.run(t, async (tx, c) => {
      await this.require(tx, id);
      const w = await tx.webhook.update({
        where: { id },
        data: {
          name: input.name,
          url: input.url,
          events: input.events,
          active: input.active,
          ...(input.active ? { failureCount: 0, disabledReason: null } : {}),
        },
        omit: { secretEnc: true },
      });
      await this.log(tx, t, c.companyId, 'webhook.updated', id, {
        name: w.name,
        url: w.url,
        active: w.active,
      });
      return w;
    });
  }

  /** Neuen Signaturschlüssel erzeugen (wird einmalig angezeigt). */
  rotate(t: TenantContext, id: string) {
    return this.cdb.run(t, async (tx, c) => {
      await this.require(tx, id);
      const secret = `whsec_${randomBytes(24).toString('base64url')}`;
      await tx.webhook.update({ where: { id }, data: { secretEnc: this.box.encrypt(secret) } });
      await this.log(tx, t, c.companyId, 'webhook.secret_rotated', id, {});
      return { secret };
    });
  }

  archive(t: TenantContext, id: string) {
    return this.cdb.run(t, async (tx, c) => {
      await this.require(tx, id);
      await tx.webhook.update({ where: { id }, data: { archivedAt: new Date(), active: false } });
      await this.log(tx, t, c.companyId, 'webhook.archived', id, {});
    });
  }

  deliveries(t: TenantContext, id: string) {
    return this.cdb.run(t, async (tx) => {
      await this.require(tx, id);
      return tx.webhookDelivery.findMany({
        where: { webhookId: id },
        orderBy: { createdAt: 'desc' },
        take: 100,
      });
    });
  }

  /** Test-Ping (Ereignis „ping“) sofort einreihen. */
  ping(t: TenantContext, id: string) {
    return this.cdb.run(t, async (tx, c) => {
      const w = await this.require(tx, id);
      return this.createDelivery(
        tx,
        w,
        null,
        'ping',
        { message: 'Test von FangEvo Wawi Pro', webhookId: id },
        c.user.id,
      );
    });
  }

  /** Fehlgeschlagene Zustellung erneut senden. */
  redeliver(t: TenantContext, id: string, deliveryId: string) {
    return this.cdb.run(t, async (tx, c) => {
      const w = await this.require(tx, id);
      const d = await tx.webhookDelivery.findUnique({ where: { id: deliveryId } });
      if (!d || d.webhookId !== id) throw Errors.notFound();
      return this.createDelivery(
        tx,
        w,
        null,
        d.eventType,
        d.payload as Record<string, unknown>,
        c.user.id,
      );
    });
  }

  private async require(tx: Tx, id: string): Promise<Webhook> {
    const w = await tx.webhook.findUnique({ where: { id } });
    if (!w || w.archivedAt) throw Errors.notFound('Webhook nicht gefunden');
    return w;
  }

  /** Zustellung anlegen und einreihen (auch von Regeln genutzt). */
  async createDelivery(
    tx: Tx,
    w: Pick<Webhook, 'id' | 'accountId' | 'companyId'>,
    eventId: string | null,
    eventType: string,
    payload: Record<string, unknown>,
    userId: string | null = null,
  ) {
    const d = await tx.webhookDelivery.create({
      data: {
        id: uuidv7(),
        accountId: w.accountId,
        companyId: w.companyId,
        webhookId: w.id,
        eventId,
        eventType,
        payload: payload as Prisma.InputJsonValue,
      },
    });
    await this.queue.enqueue(tx, {
      kind: this.kind,
      accountId: w.accountId,
      companyId: w.companyId,
      userId,
      refId: d.id,
    });
    return d;
  }

  // ───── Ereignisse → Zustellungen ─────

  handles(type: string): boolean {
    return type in WEBHOOK_EVENTS;
  }

  async handle(_tx: Tx, e: DomainEvent): Promise<void> {
    if (!e.companyId) return;
    await this.db.tenant(
      { accountId: e.accountId, userId: null, companyId: e.companyId },
      async (tx) => {
        const hooks = await tx.webhook.findMany({
          where: { active: true, archivedAt: null, events: { has: e.type } },
          select: { id: true, accountId: true, companyId: true },
        });
        for (const w of hooks) {
          // Idempotent: dasselbe Ereignis höchstens einmal je Webhook
          const exists = await tx.webhookDelivery.count({
            where: { webhookId: w.id, eventId: e.id },
          });
          if (exists) continue;
          await this.createDelivery(tx, w, e.id, e.type, {
            entityType: e.entityType,
            entityId: e.entityId,
            actorUserId: e.actorUserId,
            ...(e.payload ?? {}),
          });
        }
      },
    );
  }

  // ───── Zustellung ─────

  async run(job: QueuedJob): Promise<void> {
    if (!job.companyId) return;
    const ctx = { accountId: job.accountId, userId: null, companyId: job.companyId };
    const data = await this.db.tenant(ctx, async (tx) => {
      const d = await tx.webhookDelivery.findUnique({ where: { id: job.refId } });
      if (!d || d.status !== 'pending') return null;
      const w = await tx.webhook.findUnique({ where: { id: d.webhookId } });
      return w ? { d, w } : null;
    });
    if (!data) return;
    const { d, w } = data;
    if (!w.active || w.archivedAt) {
      await this.db.tenant(ctx, (tx) =>
        tx.webhookDelivery.update({
          where: { id: d.id },
          data: { status: 'failed', error: 'Webhook ist deaktiviert' },
        }),
      );
      return;
    }
    const timestamp = String(Math.floor(Date.now() / 1000));
    const body = JSON.stringify({
      id: d.eventId ?? d.id,
      type: d.eventType,
      createdAt: d.createdAt.toISOString(),
      companyId: d.companyId,
      data: d.payload,
    });
    let status: number | null = null;
    let responseBody: string | null = null;
    let error: string | null = null;
    try {
      await this.checkTarget(w.url);
      const res = await fetch(w.url, {
        method: 'POST',
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: {
          'content-type': 'application/json',
          'user-agent': 'FangEvo-Webhooks/1.0',
          'x-fangevo-event': d.eventType,
          'x-fangevo-delivery': d.id,
          'x-fangevo-timestamp': timestamp,
          'x-fangevo-signature': sign(this.box.decrypt(w.secretEnc), timestamp, body),
        },
        body,
      });
      status = res.status;
      responseBody = (await res.text().catch(() => '')).slice(0, 1000);
      if (status < 200 || status >= 300) error = `Antwort ${status}`;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    const attempts = d.attempts + 1;
    await this.db.tenant(ctx, async (tx) => {
      if (!error) {
        await tx.webhookDelivery.update({
          where: { id: d.id },
          data: {
            status: 'delivered',
            attempts,
            responseStatus: status,
            responseBody,
            error: null,
            deliveredAt: new Date(),
          },
        });
        await tx.webhook.update({
          where: { id: w.id },
          data: { failureCount: 0, lastStatus: status, lastDeliveryAt: new Date() },
        });
        return;
      }
      const final = attempts >= MAX_ATTEMPTS;
      await tx.webhookDelivery.update({
        where: { id: d.id },
        data: {
          status: final ? 'failed' : 'pending',
          attempts,
          responseStatus: status,
          responseBody,
          error: error.slice(0, 500),
        },
      });
      if (!final) {
        await this.queue.enqueue(tx, {
          kind: this.kind,
          accountId: d.accountId,
          companyId: d.companyId,
          refId: d.id,
          availableAt: new Date(Date.now() + backoffMs(attempts)),
        });
        return;
      }
      const failures = w.failureCount + 1;
      const disable = failures >= DISABLE_AFTER;
      await tx.webhook.update({
        where: { id: w.id },
        data: {
          failureCount: failures,
          lastStatus: status,
          lastDeliveryAt: new Date(),
          ...(disable
            ? {
                active: false,
                disabledReason: `Nach ${failures} fehlgeschlagenen Zustellungen abgeschaltet`,
              }
            : {}),
        },
      });
      if (disable) {
        const users = await usersWithPermission(tx, d.accountId, 'webhooks.manage');
        await this.notifications.create(tx, {
          accountId: d.accountId,
          userIds: users,
          type: 'webhook.disabled',
          title: `Webhook „${w.name}“ wurde abgeschaltet`,
          body: `Die Adresse ${w.url} war dauerhaft nicht erreichbar. Bitte prüfen und wieder aktivieren.`,
          link: '/automation?tab=webhooks',
          dedupeKey: `webhook-disabled:${w.id}:${new Date().toISOString().slice(0, 10)}`,
        });
      }
    });
  }

  /** Nur öffentliche Ziele (außer in Entwicklung/Tests, siehe WEBHOOK_ALLOW_PRIVATE). */
  private async checkTarget(url: string): Promise<void> {
    if (this.config.webhookAllowPrivate) return;
    const host = new URL(url).hostname.replace(/^\[|\]$/g, '');
    const ips = isIP(host) ? [host] : (await lookup(host, { all: true })).map((a) => a.address);
    if (!ips.length || ips.some(isPrivateAddress))
      throw new AppError(
        422,
        'VALIDATION_FAILED',
        'Ziel liegt in einem privaten Netz und ist nicht erlaubt',
      );
  }

  private log(
    tx: Tx,
    t: TenantContext,
    companyId: string,
    action: string,
    id: string,
    data: Record<string, unknown>,
  ) {
    return this.audit.record(tx, {
      accountId: t.account.id,
      userId: t.user.id,
      companyId,
      action,
      entityType: 'webhook',
      entityId: id,
      data,
      ip: t.ip,
    });
  }
}
