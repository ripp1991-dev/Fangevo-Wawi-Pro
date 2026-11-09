import { Inject, Injectable, Logger } from '@nestjs/common';
import { uuidv7, type SupportTicket, type Tx } from '@fangevo/database';
import { type z } from 'zod';
import {
  SUPPORT_CATEGORIES,
  SUPPORT_PRIORITIES,
  type supportMessageSchema,
  type supportTicketSchema,
} from '@fangevo/shared';
import { APP_CONFIG, type AppConfig } from '../../config';
import { AuditService } from '../../core/audit/audit.service';
import { Database } from '../../core/database/database.service';
import { Errors } from '../../core/http/errors';
import { type TenantContext } from '../../core/http/context';
import { MailService, type MailMessage } from '../../core/mail/mail.service';
import { NotificationsService } from '../../core/notifications/notifications.service';

/**
 * Support-Anfragen der Kunden an FangEvo (Phase 7). Tickets liegen beim Account (RLS);
 * das Support-Team sieht über den globalen Index nur IDs und Status und öffnet ein Ticket
 * gezielt im Kontext des Accounts (Plattform-Verwaltung).
 */
@Injectable()
export class SupportService {
  private readonly logger = new Logger('Support');

  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(MailService) private readonly mail: MailService,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  private ctx(t: TenantContext) {
    return { accountId: t.account.id, userId: t.user.id };
  }

  async list(t: TenantContext) {
    return this.db.tenant(this.ctx(t), (tx) =>
      tx.supportTicket.findMany({
        where: { accountId: t.account.id },
        orderBy: { updatedAt: 'desc' },
        take: 200,
      }),
    );
  }

  async get(t: TenantContext, id: string) {
    return this.db.tenant(this.ctx(t), (tx) => this.load(tx, t.account.id, id));
  }

  async load(tx: Tx, accountId: string, id: string) {
    const ticket = await tx.supportTicket.findFirst({ where: { id, accountId } });
    if (!ticket) throw Errors.notFound('Anfrage nicht gefunden');
    const messages = await tx.supportMessage.findMany({
      where: { ticketId: id, accountId },
      orderBy: { createdAt: 'asc' },
    });
    return { ...ticket, messages };
  }

  async create(t: TenantContext, input: z.infer<typeof supportTicketSchema>) {
    const mails: MailMessage[] = [];
    const result = await this.db.tenant(this.ctx(t), async (tx) => {
      const [r] = await tx.$queryRaw<{ value: number }[]>`
        INSERT INTO platform_counters (key, value) VALUES ('support', 1)
        ON CONFLICT (key) DO UPDATE SET value = platform_counters.value + 1
        RETURNING value`;
      const number = `S-${String(r!.value).padStart(6, '0')}`;
      const id = uuidv7();
      const ticket = await tx.supportTicket.create({
        data: {
          id,
          accountId: t.account.id,
          number,
          subject: input.subject,
          category: input.category,
          priority: input.priority,
          status: 'waiting_support',
          createdBy: t.user.id,
        },
      });
      await tx.supportMessage.create({
        data: {
          id: uuidv7(),
          accountId: t.account.id,
          ticketId: id,
          authorUserId: t.user.id,
          authorName: t.user.name,
          body: input.message,
        },
      });
      await this.index(tx, ticket);
      await this.audit.record(tx, {
        accountId: t.account.id,
        userId: t.user.id,
        action: 'support.ticket_created',
        entityType: 'support_ticket',
        entityId: id,
        data: { number, category: input.category, priority: input.priority },
        ip: t.ip,
      });
      mails.push(this.supportMail(t, ticket, input.message, true));
      return ticket;
    });
    await this.flush(mails);
    return result;
  }

  async reply(t: TenantContext, id: string, input: z.infer<typeof supportMessageSchema>) {
    const mails: MailMessage[] = [];
    const result = await this.db.tenant(this.ctx(t), async (tx) => {
      const ticket = await tx.supportTicket.findFirst({ where: { id, accountId: t.account.id } });
      if (!ticket) throw Errors.notFound('Anfrage nicht gefunden');
      await tx.supportMessage.create({
        data: {
          id: uuidv7(),
          accountId: t.account.id,
          ticketId: id,
          authorUserId: t.user.id,
          authorName: t.user.name,
          body: input.message,
        },
      });
      const updated = await tx.supportTicket.update({
        where: { id },
        data: { status: 'waiting_support' },
      });
      await this.index(tx, updated);
      mails.push(this.supportMail(t, updated, input.message, false));
      return this.load(tx, t.account.id, id);
    });
    await this.flush(mails);
    return result;
  }

  async close(t: TenantContext, id: string) {
    return this.db.tenant(this.ctx(t), async (tx) => {
      const ticket = await tx.supportTicket.findFirst({ where: { id, accountId: t.account.id } });
      if (!ticket) throw Errors.notFound('Anfrage nicht gefunden');
      const updated = await tx.supportTicket.update({ where: { id }, data: { status: 'closed' } });
      await this.index(tx, updated);
      return updated;
    });
  }

  // ───────── Support-Team (über Plattform-Verwaltung) ─────────

  /** Antwort des Supports: Nachricht, Status, Benachrichtigung und E-Mail an die anfragende Person. */
  async answer(
    accountId: string,
    id: string,
    staff: { name: string },
    input: { message: string; status: 'waiting_customer' | 'waiting_support' | 'closed' },
  ) {
    const mails: MailMessage[] = [];
    const result = await this.db.tenant({ accountId, userId: null }, async (tx) => {
      const ticket = await tx.supportTicket.findFirst({ where: { id, accountId } });
      if (!ticket) throw Errors.notFound('Anfrage nicht gefunden');
      await tx.supportMessage.create({
        data: {
          id: uuidv7(),
          accountId,
          ticketId: id,
          authorUserId: null,
          authorName: `FangEvo Support (${staff.name})`,
          fromSupport: true,
          body: input.message,
        },
      });
      const updated = await tx.supportTicket.update({
        where: { id },
        data: { status: input.status },
      });
      await this.index(tx, updated);
      await this.notifications.create(tx, {
        accountId,
        userIds: [ticket.createdBy],
        type: 'support.reply',
        title: `Antwort vom Support zu ${ticket.number}`,
        body: ticket.subject,
        link: `/support?ticket=${ticket.id}`,
        dedupeKey: `support:${uuidv7()}`,
      });
      const creator = await this.db.global.user.findUnique({
        where: { id: ticket.createdBy },
        select: { email: true },
      });
      if (creator)
        mails.push({
          to: creator.email,
          subject: `[${ticket.number}] Antwort vom FangEvo-Support: ${ticket.subject}`,
          text: `${input.message}\n\n—\nSie können direkt in FangEvo Wawi Pro unter „Support“ antworten:\n${this.config.WEB_ORIGIN}/support?ticket=${ticket.id}`,
        });
      return this.load(tx, accountId, id);
    });
    await this.flush(mails);
    return result;
  }

  private async index(tx: Tx, t: SupportTicket) {
    await tx.supportTicketIndex.upsert({
      where: { ticketId: t.id },
      create: {
        ticketId: t.id,
        accountId: t.accountId,
        status: t.status,
        priority: t.priority,
        updatedAt: t.updatedAt,
      },
      update: { status: t.status, priority: t.priority, updatedAt: t.updatedAt },
    });
  }

  private supportMail(
    t: TenantContext,
    ticket: SupportTicket,
    body: string,
    isNew: boolean,
  ): MailMessage {
    return {
      to: this.config.SUPPORT_EMAIL ?? 'support@fangevo.local',
      subject: `${isNew ? 'Neue Anfrage' : 'Antwort'} [${ticket.number}] ${ticket.subject}`,
      text: [
        `Account: ${t.account.name} (${t.account.id})`,
        `Von: ${t.user.name} <${t.user.email}>`,
        `Kategorie: ${SUPPORT_CATEGORIES[ticket.category as keyof typeof SUPPORT_CATEGORIES] ?? ticket.category}`,
        `Priorität: ${SUPPORT_PRIORITIES[ticket.priority as keyof typeof SUPPORT_PRIORITIES] ?? ticket.priority}`,
        '',
        body,
        '',
        'Antworten bitte über die Plattform-Verwaltung (nicht per E-Mail).',
      ].join('\n'),
    };
  }

  private async flush(mails: MailMessage[]) {
    for (const m of mails) {
      try {
        await this.mail.send(m);
      } catch (err) {
        this.logger.error(`Support-Mail an ${m.to} fehlgeschlagen: ${String(err)}`);
      }
    }
  }
}
