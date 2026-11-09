import { Inject, Injectable } from '@nestjs/common';
import { type Tx } from '@fangevo/database';
import { Database } from '../database/database.service';
import { type DomainEvent, type EventHandler } from '../events/event-types';
import { activeMembers, usersWithPermission } from './recipients';
import { NotificationsService } from './notifications.service';

const HANDLED = new Set([
  'member.joined',
  'member.disabled',
  'member.access_changed',
  'role.updated',
  'company.created',
  'company.archived',
  'security.new_device',
]);

/** Erzeugt aus fachlichen Ereignissen Benachrichtigungen. Der Auslöser selbst wird nicht benachrichtigt. */
@Injectable()
export class NotificationHandler implements EventHandler {
  readonly name = 'notifications';
  constructor(
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
    @Inject(Database) private readonly db: Database,
  ) {}

  handles(type: string): boolean {
    return HANDLED.has(type);
  }

  private async userName(userId: string | null): Promise<string> {
    if (!userId) return 'Jemand';
    const u = await this.db.global.user.findUnique({
      where: { id: userId },
      select: { name: true },
    });
    return u?.name ?? 'Jemand';
  }

  async handle(tx: Tx, e: DomainEvent): Promise<void> {
    const notActor = (ids: string[]) => ids.filter((id) => id !== e.actorUserId);
    const base = { accountId: e.accountId, dedupeKey: e.id };
    switch (e.type) {
      case 'member.joined': {
        const name = await this.userName(e.actorUserId);
        await this.notifications.create(tx, {
          ...base,
          type: 'member.joined',
          userIds: notActor(await usersWithPermission(tx, e.accountId, 'users.manage')),
          title: `${name} ist dem Account beigetreten`,
          link: '/admin/members',
        });
        return;
      }
      case 'member.disabled': {
        const m = e.entityId ? await tx.membership.findUnique({ where: { id: e.entityId } }) : null;
        const owners = (await activeMembers(tx, e.accountId))
          .filter((x) => x.isOwner)
          .map((x) => x.userId);
        await this.notifications.create(tx, {
          ...base,
          type: 'member.disabled',
          userIds: notActor(owners),
          title: `${await this.userName(m?.userId ?? null)} wurde gesperrt`,
          body: `durch ${await this.userName(e.actorUserId)}`,
          link: '/admin/members',
        });
        return;
      }
      case 'member.access_changed': {
        const m = e.entityId ? await tx.membership.findUnique({ where: { id: e.entityId } }) : null;
        if (!m) return;
        await this.notifications.create(tx, {
          ...base,
          type: 'member.access_changed',
          userIds: notActor([m.userId]),
          title: 'Ihre Rechte wurden geändert',
          body: `durch ${await this.userName(e.actorUserId)}`,
        });
        return;
      }
      case 'role.updated': {
        if (!e.entityId) return;
        const role = await tx.role.findUnique({
          where: { id: e.entityId },
          include: { members: { include: { membership: true } } },
        });
        if (!role) return;
        const userIds = role.members
          .filter((x) => x.membership.status === 'ACTIVE')
          .map((x) => x.membership.userId);
        await this.notifications.create(tx, {
          ...base,
          type: 'role.updated',
          userIds: notActor(userIds),
          title: `Ihre Rolle „${role.name}“ wurde geändert`,
          body: `durch ${await this.userName(e.actorUserId)}`,
        });
        return;
      }
      case 'company.created':
      case 'company.archived': {
        const c = e.entityId ? await tx.company.findUnique({ where: { id: e.entityId } }) : null;
        if (!c) return;
        const verb = e.type === 'company.created' ? 'angelegt' : 'archiviert';
        await this.notifications.create(tx, {
          ...base,
          type: e.type,
          userIds: notActor(await usersWithPermission(tx, e.accountId, 'companies.manage')),
          title: `Firma „${c.name}“ wurde ${verb}`,
          body: `durch ${await this.userName(e.actorUserId)}`,
          link: '/admin/companies',
        });
        return;
      }
      case 'security.new_device': {
        if (!e.actorUserId) return;
        const p = e.payload ?? {};
        await this.notifications.create(tx, {
          ...base,
          type: 'security.new_device',
          userIds: [e.actorUserId],
          title: 'Anmeldung von einem neuen Gerät',
          body: `${String(p.userAgent ?? 'Unbekanntes Gerät')} · IP ${String(p.ip ?? '–')}`,
          link: '/settings/security',
        });
        return;
      }
    }
  }
}
