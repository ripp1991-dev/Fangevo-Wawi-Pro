import { Controller, Get, Inject } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ALL_MODULES, MODULES, PLANS, accessMode, isModuleKey } from '@fangevo/licensing';
import { Database } from '../database/database.service';
import { RequirePermission, Tenant, type TenantContext } from '../http/context';

@ApiTags('Administration: Lizenz')
@Controller('admin/license')
export class LicenseController {
  constructor(@Inject(Database) private readonly db: Database) {}

  /** Lizenzstand inklusive Nutzung. Änderungen über das Abo (Kundenportal, Marketplace, Plattform-Verwaltung). */
  @Get()
  @RequirePermission('license.read')
  async get(@Tenant() t: TenantContext) {
    const e = t.account.entitlement;
    const usage = await this.db.tenant(
      { accountId: t.account.id, userId: t.user.id },
      async (tx) => ({
        companies: await tx.company.count({ where: { archivedAt: null } }),
        users: await tx.membership.count({ where: { status: 'ACTIVE' } }),
        openInvitations: await tx.invitation.count({
          where: { acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
        }),
      }),
    );
    const plan = e.plan in PLANS ? PLANS[e.plan as keyof typeof PLANS] : null;
    return {
      plan: e.plan,
      planName: plan?.name ?? e.plan,
      priceIsPreliminary: true,
      monthlyPriceEur: plan?.monthlyPriceEur ?? null,
      status: e.status,
      accessMode: accessMode(e),
      trialEndsAt: e.trialEndsAt,
      validUntil: e.validUntil,
      limits: { companies: e.maxCompanies, users: e.maxUsers, connectors: e.maxConnectors },
      usage,
      modules: ALL_MODULES.map((k) => ({
        key: k,
        name: MODULES[k].name,
        phase: MODULES[k].phase,
        available: MODULES[k].available,
        licensed: k === 'core' || e.modules.filter(isModuleKey).includes(k),
      })),
    };
  }
}
