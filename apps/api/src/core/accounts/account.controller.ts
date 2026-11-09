import { Body, Controller, Get, HttpCode, Inject, Patch } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { Database } from '../database/database.service';
import { RequirePermission, RequiresCompany, Tenant, type TenantContext } from '../http/context';
import { ApiZodBody, zodPipe } from '../http/zod';

const accountSchema = z.object({ name: z.string().trim().min(1).max(160) });

@ApiTags('Account')
@Controller()
export class AccountController {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  @Patch('admin/account')
  @HttpCode(204)
  @RequirePermission('account.manage')
  @ApiZodBody(accountSchema)
  async update(@Tenant() t: TenantContext, @Body(zodPipe(accountSchema)) body: z.infer<typeof accountSchema>) {
    await this.db.tenant({ accountId: t.account.id, userId: t.user.id }, async (tx) => {
      const before = await tx.account.findUniqueOrThrow({ where: { id: t.account.id } });
      await tx.account.update({ where: { id: t.account.id }, data: { name: body.name } });
      await this.audit.record(tx, { accountId: t.account.id, userId: t.user.id, action: 'account.updated', entityType: 'account', entityId: t.account.id, data: { name: { from: before.name, to: body.name } }, ip: t.ip });
    });
  }

  /**
   * Aktive Firma prüfen. Das Frontend ruft dies beim Firmenwechsel auf;
   * fachliche Module verlangen den Header X-Company-Id ab Phase 3 auf allen Routen.
   */
  @Get('context/company')
  @RequiresCompany()
  async company(@Tenant() t: TenantContext) {
    return this.db.tenant({ accountId: t.account.id, userId: t.user.id }, (tx) =>
      tx.company.findUniqueOrThrow({ where: { id: t.companyId! }, select: { id: true, name: true, country: true } }),
    );
  }
}
