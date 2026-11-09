import { Inject, Injectable } from '@nestjs/common';
import { uuidv7, type Session, type User } from '@fangevo/database';
import { APP_CONFIG, type AppConfig } from '../../config';
import { Database } from '../database/database.service';
import { hashToken, randomToken } from '../security/crypto';

export const SESSION_COOKIE = 'fe_session';
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Serverseitige Sitzungen. Im Cookie steht nur ein zufälliges Token,
 * in der Datenbank nur dessen Hash. Sitzungen laufen nach Inaktivität und
 * nach einer Maximaldauer ab und können jederzeit widerrufen werden.
 */
@Injectable()
export class SessionService {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  get maxAgeSec(): number {
    return this.config.SESSION_TTL_HOURS * 3600;
  }

  async create(input: { userId: string; accountId: string | null; mfaPending: boolean; ip: string | null; userAgent: string | null }): Promise<{ token: string; session: Session }> {
    const token = randomToken();
    const session = await this.db.global.session.create({
      data: {
        id: uuidv7(),
        tokenHash: hashToken(token),
        userId: input.userId,
        accountId: input.accountId,
        mfaPending: input.mfaPending,
        ip: input.ip,
        userAgent: input.userAgent?.slice(0, 300) ?? null,
        expiresAt: new Date(Date.now() + this.maxAgeSec * 1000),
      },
    });
    return { token, session };
  }

  async resolve(token: string): Promise<(Session & { user: User }) | null> {
    if (!token || token.length > 200) return null;
    const s = await this.db.global.session.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: true } });
    if (!s || s.revokedAt) return null;
    const now = Date.now();
    if (s.expiresAt.getTime() < now) return null;
    if (now - s.lastSeenAt.getTime() > this.config.SESSION_IDLE_HOURS * 3600 * 1000) return null;
    if (now - s.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
      await this.db.global.session.update({ where: { id: s.id }, data: { lastSeenAt: new Date(now) } });
    }
    return s;
  }

  async update(sessionId: string, data: { accountId?: string | null; mfaPending?: boolean }): Promise<void> {
    await this.db.global.session.update({ where: { id: sessionId }, data });
  }

  async revoke(sessionId: string): Promise<void> {
    await this.db.global.session.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  /** Alle Sitzungen eines Benutzers widerrufen, optional außer der aktuellen. */
  async revokeAllForUser(userId: string, exceptSessionId?: string): Promise<void> {
    await this.db.global.session.updateMany({
      where: { userId, revokedAt: null, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) },
      data: { revokedAt: new Date() },
    });
  }

  /** Beim Sperren eines Mitglieds: dessen Sitzungen in diesem Account beenden. */
  async revokeForAccount(userId: string, accountId: string): Promise<void> {
    await this.db.global.session.updateMany({ where: { userId, accountId, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  async listActive(userId: string): Promise<Session[]> {
    return this.db.global.session.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() }, mfaPending: false },
      orderBy: { lastSeenAt: 'desc' },
      take: 50,
    });
  }
}
