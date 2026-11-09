import { Inject, Injectable } from '@nestjs/common';
import { uuidv7, type Tx } from '@fangevo/database';
import { type RoleInput } from '@fangevo/shared';
import { assertCanGrant } from '../access/escalation';
import { AuditService } from '../audit/audit.service';
import { Database } from '../database/database.service';
import { AppError, Errors } from '../http/errors';
import { type TenantContext } from '../http/context';

@Injectable()
export class RolesService {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  private run<T>(t: TenantContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.db.tenant({ accountId: t.account.id, userId: t.user.id }, fn);
  }

  list(t: TenantContext) {
    return this.run(t, async (tx) => {
      const roles = await tx.role.findMany({ include: { permissions: true, _count: { select: { members: true } } }, orderBy: { createdAt: 'asc' } });
      return roles.map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        system: r.systemKey !== null,
        permissions: r.permissions.map((p) => p.permission),
        memberCount: r._count.members,
      }));
    });
  }

  create(t: TenantContext, input: RoleInput) {
    assertCanGrant(t.account, input.permissions);
    return this.run(t, async (tx) => {
      const id = uuidv7();
      await tx.role.create({ data: { id, accountId: t.account.id, name: input.name, description: input.description ?? null } });
      await this.setPermissions(tx, t.account.id, id, input.permissions);
      await this.audit.record(tx, { accountId: t.account.id, userId: t.user.id, action: 'role.created', entityType: 'role', entityId: id, data: { ...input }, ip: t.ip });
      return { id };
    });
  }

  update(t: TenantContext, id: string, input: RoleInput) {
    assertCanGrant(t.account, input.permissions);
    return this.run(t, async (tx) => {
      const role = await tx.role.findUnique({ where: { id }, include: { permissions: true } });
      if (!role) throw Errors.notFound();
      if (role.systemKey) throw new AppError(409, 'CONFLICT', 'Systemrollen können nicht geändert werden. Legen Sie eine eigene Rolle an.');
      // Auch entzogene Rechte dürfen nur von Personen geändert werden, die sie selbst haben.
      assertCanGrant(t.account, role.permissions.map((p) => p.permission));
      await tx.role.update({ where: { id }, data: { name: input.name, description: input.description ?? null } });
      await tx.rolePermission.deleteMany({ where: { roleId: id } });
      await this.setPermissions(tx, t.account.id, id, input.permissions);
      await this.audit.record(tx, {
        accountId: t.account.id,
        userId: t.user.id,
        action: 'role.updated',
        entityType: 'role',
        entityId: id,
        data: { before: { name: role.name, permissions: role.permissions.map((p) => p.permission) }, after: input },
        ip: t.ip,
      });
    });
  }

  remove(t: TenantContext, id: string) {
    return this.run(t, async (tx) => {
      const role = await tx.role.findUnique({ where: { id }, include: { permissions: true } });
      if (!role) throw Errors.notFound();
      if (role.systemKey) throw new AppError(409, 'CONFLICT', 'Systemrollen können nicht gelöscht werden');
      assertCanGrant(t.account, role.permissions.map((p) => p.permission));
      await tx.role.delete({ where: { id } });
      await this.audit.record(tx, { accountId: t.account.id, userId: t.user.id, action: 'role.deleted', entityType: 'role', entityId: id, data: { name: role.name }, ip: t.ip });
    });
  }

  private async setPermissions(tx: Tx, accountId: string, roleId: string, permissions: string[]): Promise<void> {
    const unique = [...new Set(permissions)];
    if (unique.length) await tx.rolePermission.createMany({ data: unique.map((permission) => ({ accountId, roleId, permission })) });
  }
}
