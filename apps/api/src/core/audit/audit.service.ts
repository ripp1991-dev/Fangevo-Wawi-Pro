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

  async record(tx: Tx, e: AuditEntry): Promise<void> {
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
      data: { id: uuidv7(), type: e.type, userId: e.userId ?? null, email: e.email ?? null, ip: e.ip ?? null, userAgent: e.userAgent?.slice(0, 300) ?? null },
    });
  }
}
