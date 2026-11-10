import { Controller, Get, Inject, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { Database } from '../database/database.service';
import { AppError } from '../http/errors';
import { Tenant, type TenantContext } from '../http/context';
import { zodPipe } from '../http/zod';
import { CompanyDb } from '../../modules/common/company-db';

const schema = z.object({
  entityType: z
    .enum(['company', 'membership', 'role', 'custom_field', 'article', 'customer', 'supplier'])
    .optional(),
  entityId: z.uuid().optional(),
  cursor: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const READ_PERMISSION = {
  company: 'companies.read',
  membership: 'users.read',
  role: 'roles.read',
  custom_field: 'custom_fields.manage',
  article: 'articles.read',
  customer: 'customers.read',
  supplier: 'suppliers.read',
} as const;
const COMPANY_SCOPED = new Set(['article', 'customer', 'supplier']);

/**
 * Aktivitäten (aus dem Audit-Log, verständlich aufbereitet im Frontend).
 * - Gesamtverlauf: Recht audit.read
 * - Verlauf eines Datensatzes: Leserecht für diesen Datensatz (bei Firmen zusätzlich Firmenzugriff)
 */
@ApiTags('Aktivitäten')
@Controller('activity')
export class ActivityController {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(CompanyDb) private readonly cdb: CompanyDb,
  ) {}

  @Get()
  async list(@Tenant() t: TenantContext, @Query(zodPipe(schema)) q: z.infer<typeof schema>) {
    const perms = t.account.permissions;
    if (q.entityType && q.entityId) {
      if (!perms.has(READ_PERMISSION[q.entityType]) && !perms.has('audit.read'))
        throw new AppError(403, 'PERMISSION_DENIED', 'Keine Berechtigung');
      if (COMPANY_SCOPED.has(q.entityType)) {
        // Datensatz muss in der aktiven Firma liegen (RLS mit Firmenkontext)
        const id = q.entityId;
        const exists = await this.cdb.run(t, (tx) =>
          q.entityType === 'article'
            ? tx.article.count({ where: { id } })
            : q.entityType === 'customer'
              ? tx.customer.count({ where: { id } })
              : tx.supplier.count({ where: { id } }),
        );
        if (!exists) throw new AppError(404, 'NOT_FOUND', 'Nicht gefunden');
      }
      if (q.entityType === 'company') {
        // Firma muss im eigenen Account existieren (RLS) und zugänglich sein
        const exists = await this.db.tenant({ accountId: t.account.id, userId: t.user.id }, (tx) =>
          tx.company.count({ where: { id: q.entityId } }),
        );
        if (!exists) throw new AppError(404, 'NOT_FOUND', 'Nicht gefunden');
        if (!t.account.allCompanies && !t.account.companyIds.includes(q.entityId))
          throw new AppError(403, 'COMPANY_ACCESS_DENIED', 'Kein Zugriff auf diese Firma');
      }
    } else if (!perms.has('audit.read')) {
      throw new AppError(403, 'PERMISSION_DENIED', 'Fehlende Berechtigung: audit.read');
    }
    return this.db.tenant({ accountId: t.account.id, userId: t.user.id }, async (tx) => {
      const rows = await tx.auditLog.findMany({
        where: {
          ...(q.entityType && q.entityId
            ? { entityType: q.entityType, entityId: q.entityId }
            : { action: { notIn: ['auth.login', 'security.new_device'] } }),
          ...(q.cursor ? { id: { lt: q.cursor } } : {}),
        },
        orderBy: { id: 'desc' },
        take: q.limit + 1,
        select: {
          id: true,
          action: true,
          entityType: true,
          entityId: true,
          data: true,
          createdAt: true,
          userId: true,
        },
      });
      const page = rows.slice(0, q.limit);
      const ids = [...new Set(page.map((r) => r.userId).filter((v): v is string => !!v))];
      const users = await this.db.global.user.findMany({
        where: { id: { in: ids } },
        select: { id: true, name: true },
      });
      const names = new Map(users.map((u) => [u.id, u.name]));
      return {
        items: page.map(({ userId, ...r }) => ({
          ...r,
          actor: userId ? (names.get(userId) ?? 'Unbekannt') : 'System',
        })),
        nextCursor: rows.length > q.limit ? (page.at(-1)?.id ?? null) : null,
      };
    });
  }
}
