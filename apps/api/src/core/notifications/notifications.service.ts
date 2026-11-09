import { Injectable } from '@nestjs/common';
import { uuidv7, type Tx } from '@fangevo/database';
import { type NotificationType } from '@fangevo/shared';
import { daysLeft } from './util';

export interface NewNotification {
  accountId: string;
  userIds: string[];
  type: NotificationType;
  title: string;
  body?: string;
  link?: string;
  dedupeKey: string;
}

@Injectable()
export class NotificationsService {
  /** Legt Benachrichtigungen an. Doppelte (gleicher dedupeKey) werden ignoriert; Einstellungen werden beachtet. */
  async create(tx: Tx, n: NewNotification): Promise<number> {
    const userIds = [...new Set(n.userIds)];
    if (!userIds.length) return 0;
    const off = await tx.notificationPreference.findMany({
      where: { accountId: n.accountId, userId: { in: userIds }, type: n.type, inApp: false },
    });
    const muted = new Set(off.map((p) => p.userId));
    const data = userIds
      .filter((u) => !muted.has(u))
      .map((userId) => ({
        id: uuidv7(),
        accountId: n.accountId,
        userId,
        type: n.type,
        title: n.title,
        body: n.body ?? null,
        link: n.link ?? null,
        dedupeKey: n.dedupeKey,
      }));
    if (!data.length) return 0;
    const r = await tx.notification.createMany({ data, skipDuplicates: true });
    return r.count;
  }
}

export { daysLeft };
