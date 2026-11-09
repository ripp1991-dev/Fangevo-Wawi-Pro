import { Inject, Injectable } from '@nestjs/common';
import { uuidv7, type Tx } from '@fangevo/database';
import { Database } from '../database/database.service';

export interface AuditEntry {
  accountId: string;
  userId: string | null;
  action: string;
  entityType?: string;
  entityId?: string;
  companyId?: string | null;
  data?: Record<string, unknown>;
  ip?: string | null;
}

export interface SecurityEventEntry {
  type: string;
  userId?: string | null;
  email?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}

/**
 * Audit-Log (pro Account, unveränderlich) und Sicherheitsereignisse (pro Benutzer).
 * Audit-Einträge werden in derselben Transaktion geschrieben wie die Änderung selbst,
 * damit es keine Änderung ohne Protokolleintrag gibt.
 */
@Injectable()
export class AuditService {
  constructor(@Inject(Database) private readonly db: Database) {}

  /**
   * Schreibt den Audit-Eintrag und das fachliche Ereignis (Outbox) in derselben Transaktion.
   * Der Ereignis-Verteiler stellt es danach zu (Benachrichtigungen, später Webhooks/Workflows).
   */
  async record(tx: Tx, e: AuditEntry): Promise<void> {
    const eventId = uuidv7();
    await tx.outboxEvent.create({
      data: {
        id: eventId,
        accountId: e.accountId,
        type: e.action,
        entityType: e.entityType,
        entityId: e.entityId,
        actorUserId: e.userId,
        payload: (e.data ?? undefined) as object | undefined,
      },
    });
    await tx.outboxPending.create({ data: { eventId, accountId: e.accountId } });
    await tx.auditLog.create({
      data: {
        id: uuidv7(),
        accountId: e.accountId,
        userId: e.userId,
        companyId: e.companyId ?? null,
        action: e.action,
        entityType: e.entityType,
        entityId: e.entityId,
        data: (e.data ?? undefined) as object | undefined,
        ip: e.ip ?? null,
      },
    });
  }

  async security(e: SecurityEventEntry): Promise<void> {
    await this.db.global.securityEvent.create({
      data: {
        id: uuidv7(),
        type: e.type,
        userId: e.userId ?? null,
        email: e.email ?? null,
        ip: e.ip ?? null,
        userAgent: e.userAgent?.slice(0, 300) ?? null,
      },
    });
  }
}
