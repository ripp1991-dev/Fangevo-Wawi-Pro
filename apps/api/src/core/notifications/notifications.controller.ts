import { Body, Controller, Get, HttpCode, Inject, Param, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  ALL_NOTIFICATION_TYPES,
  NOTIFICATION_TYPES,
  notificationPreferencesSchema,
  type NotificationType,
} from '@fangevo/shared';
import { type Tx } from '@fangevo/database';
import { Database } from '../database/database.service';
import { AllowReadOnly, Tenant, type TenantContext } from '../http/context';
import { ApiZodBody, uuidParam, zodPipe } from '../http/zod';
import { NotificationsService, daysLeft } from './notifications.service';

const listSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  unread: z.enum(['true', 'false']).optional(),
});

@ApiTags('Benachrichtigungen')
@Controller('notifications')
export class NotificationsController {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
  ) {}

  private run<T>(t: TenantContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.db.tenant({ accountId: t.account.id, userId: t.user.id }, fn);
  }

  @Get()
  async list(
    @Tenant() t: TenantContext,
    @Query(zodPipe(listSchema)) q: z.infer<typeof listSchema>,
  ) {
    return this.run(t, async (tx) => {
      await this.ensureTrialNotice(tx, t);
      const where = { userId: t.user.id, ...(q.unread === 'true' ? { readAt: null } : {}) };
      const [items, unread] = await Promise.all([
        tx.notification.findMany({
          where,
          orderBy: { id: 'desc' },
          take: q.limit,
          select: {
            id: true,
            type: true,
            title: true,
            body: true,
            link: true,
            readAt: true,
            createdAt: true,
          },
        }),
        tx.notification.count({ where: { userId: t.user.id, readAt: null } }),
      ]);
      return { items, unread };
    });
  }

  /** Erinnerung an das Ende der Testphase (für Inhaber, einmal je Account und Testzeitraum). */
  private async ensureTrialNotice(tx: Tx, t: TenantContext): Promise<void> {
    const e = t.account.entitlement;
    const left = e.status === 'TRIAL' ? daysLeft(e.trialEndsAt) : null;
    if (!t.account.isOwner || left === null || left > 3 || left < 0) return;
    await this.notifications.create(tx, {
      accountId: t.account.id,
      userIds: [t.user.id],
      type: 'license.trial_ending',
      title: left === 0 ? 'Ihre Testphase endet heute' : `Ihre Testphase endet in ${left} Tagen`,
      body: 'Danach können Daten nur noch gelesen werden. Es geht nichts verloren.',
      link: '/admin/license',
      dedupeKey: `trial:${e.trialEndsAt?.toISOString()}`,
    });
  }

  @Post(':id/read')
  @HttpCode(204)
  @AllowReadOnly()
  async read(@Tenant() t: TenantContext, @Param('id', uuidParam) id: string) {
    await this.run(t, (tx) =>
      tx.notification.updateMany({
        where: { id, userId: t.user.id, readAt: null },
        data: { readAt: new Date() },
      }),
    );
  }

  @Post('read-all')
  @HttpCode(204)
  @AllowReadOnly()
  async readAll(@Tenant() t: TenantContext) {
    await this.run(t, (tx) =>
      tx.notification.updateMany({
        where: { userId: t.user.id, readAt: null },
        data: { readAt: new Date() },
      }),
    );
  }

  @Get('preferences')
  async preferences(@Tenant() t: TenantContext) {
    const rows = await this.run(t, (tx) =>
      tx.notificationPreference.findMany({ where: { userId: t.user.id } }),
    );
    const off = new Map(rows.map((r) => [r.type, r.inApp]));
    return ALL_NOTIFICATION_TYPES.map((type) => ({
      type,
      ...NOTIFICATION_TYPES[type],
      inApp: off.get(type) ?? true,
    }));
  }

  @Put('preferences')
  @HttpCode(204)
  @AllowReadOnly()
  @ApiZodBody(notificationPreferencesSchema)
  async setPreferences(
    @Tenant() t: TenantContext,
    @Body(zodPipe(notificationPreferencesSchema)) body: Record<string, boolean>,
  ) {
    const entries = Object.entries(body).filter(([k]) =>
      (ALL_NOTIFICATION_TYPES as string[]).includes(k),
    ) as [NotificationType, boolean][];
    await this.run(t, async (tx) => {
      for (const [type, inApp] of entries) {
        await tx.notificationPreference.upsert({
          where: { accountId_userId_type: { accountId: t.account.id, userId: t.user.id, type } },
          create: { accountId: t.account.id, userId: t.user.id, type, inApp },
          update: { inApp },
        });
      }
    });
  }
}
