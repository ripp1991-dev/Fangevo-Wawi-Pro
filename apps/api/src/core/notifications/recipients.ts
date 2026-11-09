import { type Tx } from '@fangevo/database';
import { type Permission } from '@fangevo/shared';
import { effectivePermissions, rolePermissions, toSnapshot } from '../access/access.service';

/** Aktive Mitglieder eines Accounts mit ihren effektiven Rechten (für die Empfängerermittlung). */
export async function activeMembers(tx: Tx, accountId: string) {
  const ent = await tx.entitlement.findUnique({ where: { accountId } });
  if (!ent) return [];
  const entitlement = toSnapshot(ent);
  const ms = await tx.membership.findMany({
    where: { accountId, status: 'ACTIVE' },
    include: {
      roles: { include: { role: { include: { permissions: true } } } },
      permissions: true,
    },
  });
  return ms.map((m) => ({
    membershipId: m.id,
    userId: m.userId,
    isOwner: m.isOwner,
    roleIds: m.roles.map((r) => r.roleId),
    permissions: effectivePermissions({
      isOwner: m.isOwner,
      rolePermissions: m.roles.flatMap((r) => rolePermissions(r.role)),
      directPermissions: m.permissions.map((p) => p.permission),
      entitlement,
    }),
  }));
}

export async function usersWithPermission(
  tx: Tx,
  accountId: string,
  p: Permission,
): Promise<string[]> {
  return (await activeMembers(tx, accountId))
    .filter((m) => m.permissions.has(p))
    .map((m) => m.userId);
}
