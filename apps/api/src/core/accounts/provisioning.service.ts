import { Inject, Injectable } from '@nestjs/common';
import { uuidv7, type Tx } from '@fangevo/database';
import { DEFAULT_TRIAL_DAYS, PLANS } from '@fangevo/licensing';
import { SYSTEM_ROLES } from '@fangevo/shared';
import { AuditService } from '../audit/audit.service';
import { Database } from '../database/database.service';
import { SearchService } from '../search/search.service';

/**
 * Legt einen neuen FangEvo-Account vollständig an:
 * Account, erste Firma, Systemrollen, Inhaber-Mitgliedschaft und Testlizenz (Starter, 14 Tage).
 */
@Injectable()
export class ProvisioningService {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(SearchService) private readonly search: SearchService,
  ) {}

  async createAccount(input: {
    ownerUserId: string;
    accountName: string;
    ip: string | null;
  }): Promise<{ accountId: string; companyId: string }> {
    const accountId = uuidv7();
    return this.db.tenant({ accountId, userId: input.ownerUserId }, async (tx) => {
      await tx.account.create({ data: { id: accountId, name: input.accountName } });
      const companyId = uuidv7();
      await tx.company.create({
        data: { id: companyId, accountId, name: input.accountName, createdBy: input.ownerUserId },
      });
      await this.search.indexCompanyBasic(tx, accountId, {
        id: companyId,
        name: input.accountName,
      });
      await this.createSystemRoles(tx, accountId);
      const membershipId = uuidv7();
      const owner = await this.db.global.user.findUniqueOrThrow({
        where: { id: input.ownerUserId },
        select: { name: true, email: true },
      });
      await this.search.indexMember(tx, accountId, {
        id: membershipId,
        disabled: false,
        user: owner,
      });
      await tx.membership.create({
        data: {
          id: membershipId,
          accountId,
          userId: input.ownerUserId,
          isOwner: true,
          allCompanies: true,
        },
      });
      const plan = PLANS.starter;
      await tx.entitlement.create({
        data: {
          accountId,
          plan: 'starter',
          status: 'TRIAL',
          modules: [...plan.modules],
          maxCompanies: plan.maxCompanies,
          maxUsers: plan.maxUsers,
          maxConnectors: plan.maxConnectors,
          trialEndsAt: new Date(Date.now() + DEFAULT_TRIAL_DAYS * 86400_000),
        },
      });
      await tx.entitlementEvent.create({
        data: {
          id: uuidv7(),
          accountId,
          actor: 'system',
          change: { event: 'trial_started', plan: 'starter', days: DEFAULT_TRIAL_DAYS },
        },
      });
      await this.audit.record(tx, {
        accountId,
        userId: input.ownerUserId,
        action: 'account.created',
        entityType: 'account',
        entityId: accountId,
        ip: input.ip,
      });
      return { accountId, companyId };
    });
  }

  private async createSystemRoles(tx: Tx, accountId: string): Promise<void> {
    for (const [key, def] of Object.entries(SYSTEM_ROLES)) {
      const id = uuidv7();
      await tx.role.create({
        data: { id, accountId, name: def.name, description: def.description, systemKey: key },
      });
      await this.search.indexRole(tx, accountId, {
        id,
        name: def.name,
        description: def.description,
      });
      await tx.rolePermission.createMany({
        data: def.permissions.map((permission) => ({ accountId, roleId: id, permission })),
      });
    }
  }
}
