import { Inject, Injectable } from '@nestjs/common';
import { ALL_PERMISSIONS, isPermission, permissionModule, type Permission } from '@fangevo/shared';
import { accessMode, hasModule, isModuleKey, type EntitlementSnapshot } from '@fangevo/licensing';
import { type Entitlement } from '@fangevo/database';
import { Database } from '../database/database.service';
import { type AccountContext } from '../http/context';

export function toSnapshot(e: Entitlement): EntitlementSnapshot {
  return {
    status: e.status,
    plan: e.plan,
    modules: e.modules,
    maxCompanies: e.maxCompanies,
    maxUsers: e.maxUsers,
    maxConnectors: e.maxConnectors,
    trialEndsAt: e.trialEndsAt,
    validUntil: e.validUntil,
  };
}

/**
 * Effektive Rechte = (Inhaber: alle) bzw. Rollenrechte ∪ Einzelrechte,
 * jeweils nur für lizenzierte Module.
 */
export function effectivePermissions(input: {
  isOwner: boolean;
  rolePermissions: string[];
  directPermissions: string[];
  entitlement: EntitlementSnapshot;
}): Set<Permission> {
  const raw = input.isOwner ? ALL_PERMISSIONS : [...input.rolePermissions, ...input.directPermissions];
  const out = new Set<Permission>();
  for (const p of raw) {
    if (!isPermission(p)) continue;
    const m = permissionModule(p);
    if (isModuleKey(m) && hasModule(input.entitlement, m)) out.add(p);
  }
  return out;
}

@Injectable()
export class AccessService {
  constructor(@Inject(Database) private readonly db: Database) {}

  /** Lädt den Account-Kontext eines Benutzers. null = keine aktive Mitgliedschaft. */
  async loadAccountContext(userId: string, accountId: string): Promise<AccountContext | null> {
    return this.db.tenant({ accountId, userId }, async (tx) => {
      const m = await tx.membership.findFirst({
        where: { accountId, userId, status: 'ACTIVE' },
        include: {
          account: true,
          roles: { include: { role: { include: { permissions: true } } } },
          permissions: true,
          companies: true,
        },
      });
      if (!m || m.account.status !== 'ACTIVE') return null;
      const ent = await tx.entitlement.findUnique({ where: { accountId } });
      if (!ent) return null;
      const allCompanies = m.isOwner || m.allCompanies;
      // Zugängliche, nicht archivierte Firmen (bei "alle Firmen" alle des Accounts)
      const companies = await tx.company.findMany({
        where: { accountId, archivedAt: null, ...(allCompanies ? {} : { id: { in: m.companies.map((c) => c.companyId) } }) },
        select: { id: true },
      });
      const entitlement = toSnapshot(ent);
      return {
        id: accountId,
        name: m.account.name,
        membershipId: m.id,
        isOwner: m.isOwner,
        permissions: effectivePermissions({
          isOwner: m.isOwner,
          rolePermissions: m.roles.flatMap((r) => r.role.permissions.map((p) => p.permission)),
          directPermissions: m.permissions.map((p) => p.permission),
          entitlement,
        }),
        entitlement,
        accessMode: accessMode(entitlement),
        allCompanies,
        companyIds: companies.map((c) => c.id),
      };
    });
  }

  /** Accounts, in denen der Benutzer aktives Mitglied ist. */
  async listAccounts(userId: string): Promise<{ id: string; name: string; isOwner: boolean }[]> {
    return this.db.tenant({ accountId: null, userId }, async (tx) => {
      const ms = await tx.membership.findMany({
        where: { userId, status: 'ACTIVE', account: { status: 'ACTIVE' } },
        include: { account: true },
        orderBy: { createdAt: 'asc' },
      });
      return ms.map((m) => ({ id: m.accountId, name: m.account.name, isOwner: m.isOwner }));
    });
  }
}
