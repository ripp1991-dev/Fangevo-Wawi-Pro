import { Controller, Get, Inject, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { type z } from 'zod';
import { auditQuerySchema } from '@fangevo/shared';
import { Database } from '../database/database.service';
import { RequirePermission, RequiresModule, Tenant, type TenantContext } from '../http/context';
import { zodPipe } from '../http/zod';

@ApiTags('Administration: Audit-Log')
@Controller('admin/audit')
@RequiresModule('core')
export class AuditController {
  constructor(@Inject(Database) private readonly db: Database) {}

  /** Neueste zuerst, Cursor-Paginierung über die (zeitlich sortierbare) ID. */
  @Get()
  @RequirePermission('audit.read')
  async list(@Tenant() t: TenantContext, @Query(zodPipe(auditQuerySchema)) q: z.infer<typeof auditQuerySchema>) {
    return this.db.tenant({ accountId: t.account.id, userId: t.user.id }, async (tx) => {
      const rows = await tx.auditLog.findMany({
        where: { ...(q.cursor ? { id: { lt: q.cursor } } : {}), ...(q.action ? { action: { startsWith: q.action } } : {}) },
        orderBy: { id: 'desc' },
        take: q.limit + 1,
      });
      const page = rows.slice(0, q.limit);
      const userIds = [...new Set(page.map((r) => r.userId).filter((v): v is string => !!v))];
      const users = await this.db.global.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } });
      const byId = new Map(users.map((u) => [u.id, u]));
      return {
        items: page.map((r) => ({ ...r, user: r.userId ? (byId.get(r.userId) ?? null) : null })),
        nextCursor: rows.length > q.limit ? page.at(-1)?.id : null,
      };
    });
  }
}
