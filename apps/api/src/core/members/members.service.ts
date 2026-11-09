import { Inject, Injectable } from '@nestjs/common';
import { uuidv7, type Tx } from '@fangevo/database';
import { canAdd } from '@fangevo/licensing';
import { type InviteUserInput, type UpdateMemberAccessInput } from '@fangevo/shared';
import { assertCanGrant } from '../access/escalation';
import { AuditService } from '../audit/audit.service';
import { SessionService } from '../auth/session.service';
import { Database } from '../database/database.service';
import { AppError, Errors } from '../http/errors';
import { type TenantContext } from '../http/context';
import { MailService } from '../mail/mail.service';
import { hashPassword, hashToken, randomToken } from '../security/crypto';

const INVITE_TTL_MS = 7 * 86400_000;

@Injectable()
export class MembersService {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(MailService) private readonly mail: MailService,
    @Inject(SessionService) private readonly sessions: SessionService,
  ) {}

  private run<T>(t: TenantContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.db.tenant({ accountId: t.account.id, userId: t.user.id }, fn);
  }

  async list(t: TenantContext) {
    return this.run(t, async (tx) => {
      const ms = await tx.membership.findMany({
        where: { accountId: t.account.id },
        include: {
          user: { select: { id: true, email: true, name: true, mfaEnabled: true } },
          roles: true,
          permissions: true,
          companies: true,
        },
        orderBy: { createdAt: 'asc' },
      });
      return ms.map((m) => ({
        id: m.id,
        user: m.user,
        isOwner: m.isOwner,
        status: m.status,
        allCompanies: m.allCompanies,
        roleIds: m.roles.map((r) => r.roleId),
        permissions: m.permissions.map((p) => p.permission),
        companyIds: m.companies.map((c) => c.companyId),
        createdAt: m.createdAt,
      }));
    });
  }

  /** Benutzerlizenz: aktive Mitglieder + offene Einladungen. */
  private async seatsInUse(tx: Tx, accountId: string): Promise<number> {
    const [members, invites] = await Promise.all([
      tx.membership.count({ where: { accountId, status: 'ACTIVE' } }),
      tx.invitation.count({
        where: { accountId, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
      }),
    ]);
    return members + invites;
  }

  private async validateRolesAndCompanies(
    tx: Tx,
    t: TenantContext,
    roleIds: string[],
    companyIds: string[],
    extraPermissions: string[] = [],
  ): Promise<void> {
    const roles = await tx.role.findMany({
      where: { id: { in: roleIds } },
      include: { permissions: true },
    });
    if (roles.length !== new Set(roleIds).size)
      throw new AppError(422, 'VALIDATION_FAILED', 'Unbekannte Rolle');
    assertCanGrant(t.account, [
      ...roles.flatMap((r) => r.permissions.map((p) => p.permission)),
      ...extraPermissions,
    ]);
    if (companyIds.length) {
      const n = await tx.company.count({ where: { id: { in: companyIds } } });
      if (n !== new Set(companyIds).size)
        throw new AppError(422, 'VALIDATION_FAILED', 'Unbekannte Firma');
    }
  }

  async invite(t: TenantContext, input: InviteUserInput) {
    const secret = randomToken();
    const token = `${t.account.id}.${secret}`;
    const invitation = await this.run(t, async (tx) => {
      if (!canAdd(t.account.entitlement, 'users', await this.seatsInUse(tx, t.account.id))) {
        throw new AppError(403, 'LICENSE_LIMIT_REACHED', 'Benutzerlimit der Lizenz erreicht');
      }
      if (input.allCompanies && !t.account.allCompanies)
        throw new AppError(
          403,
          'PERMISSION_DENIED',
          'Sie haben selbst keinen Zugriff auf alle Firmen',
        );
      if (
        !t.account.allCompanies &&
        input.companyIds.some((c) => !t.account.companyIds.includes(c))
      ) {
        throw new AppError(
          403,
          'COMPANY_ACCESS_DENIED',
          'Sie können nur Zugriff auf eigene Firmen vergeben',
        );
      }
      await this.validateRolesAndCompanies(tx, t, input.roleIds, input.companyIds);
      const existingMember = await tx.membership.findFirst({
        where: { accountId: t.account.id, user: { email: input.email } },
      });
      if (existingMember) throw Errors.conflict('Diese Person ist bereits Mitglied');
      await tx.invitation.updateMany({
        where: { accountId: t.account.id, email: input.email, acceptedAt: null, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      const inv = await tx.invitation.create({
        data: {
          id: uuidv7(),
          accountId: t.account.id,
          email: input.email,
          tokenHash: hashToken(token),
          roleIds: input.roleIds,
          allCompanies: input.allCompanies,
          companyIds: input.companyIds,
          invitedBy: t.user.id,
          expiresAt: new Date(Date.now() + INVITE_TTL_MS),
        },
      });
      await this.audit.record(tx, {
        accountId: t.account.id,
        userId: t.user.id,
        action: 'member.invited',
        entityType: 'invitation',
        entityId: inv.id,
        data: { email: input.email, roleIds: input.roleIds },
        ip: t.ip,
      });
      return inv;
    });
    await this.mail.send({
      to: input.email,
      subject: `Einladung zu ${t.account.name} – FangEvo Wawi Pro`,
      text: `${t.user.name} hat Sie zu "${t.account.name}" in FangEvo Wawi Pro eingeladen.\n\nEinladung annehmen:\n${this.mail.link('/accept-invitation', token)}\n\nDie Einladung ist 7 Tage gültig.`,
    });
    return { id: invitation.id, email: invitation.email, expiresAt: invitation.expiresAt };
  }

  async listInvitations(t: TenantContext) {
    return this.run(t, (tx) =>
      tx.invitation.findMany({
        where: {
          accountId: t.account.id,
          acceptedAt: null,
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
        select: {
          id: true,
          email: true,
          roleIds: true,
          allCompanies: true,
          companyIds: true,
          expiresAt: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
      }),
    );
  }

  async revokeInvitation(t: TenantContext, id: string): Promise<void> {
    await this.run(t, async (tx) => {
      const r = await tx.invitation.updateMany({
        where: { id, acceptedAt: null, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      if (!r.count) throw Errors.notFound();
      await this.audit.record(tx, {
        accountId: t.account.id,
        userId: t.user.id,
        action: 'member.invitation_revoked',
        entityType: 'invitation',
        entityId: id,
        ip: t.ip,
      });
    });
  }

  private parseInviteToken(token: string): { accountId: string } {
    const [accountId, secret] = token.split('.');
    if (!accountId || !secret || !/^[0-9a-f-]{36}$/i.test(accountId)) throw Errors.invalidToken();
    return { accountId };
  }

  /** Vorschau für die Annahme-Seite (öffentlich, nur mit gültigem Token). */
  async previewInvitation(token: string) {
    const { accountId } = this.parseInviteToken(token);
    const inv = await this.db.tenant({ accountId, userId: null }, async (tx) => {
      const i = await tx.invitation.findUnique({ where: { tokenHash: hashToken(token) } });
      if (!i || i.acceptedAt || i.revokedAt || i.expiresAt < new Date())
        throw Errors.invalidToken();
      const account = await tx.account.findUniqueOrThrow({ where: { id: accountId } });
      return { email: i.email, accountName: account.name };
    });
    const userExists = !!(await this.db.global.user.findUnique({ where: { email: inv.email } }));
    return { ...inv, userExists };
  }

  /**
   * Einladung annehmen.
   * - Neue Person: Name und Passwort sind Pflicht; die E-Mail gilt durch den Link als bestätigt.
   * - Bestehender Zugang: Die Person muss mit genau dieser E-Mail angemeldet sein.
   */
  async acceptInvitation(
    token: string,
    input: { name?: string; password?: string },
    current: { userId: string; email: string } | null,
    ip: string | null,
  ): Promise<{ userId: string; accountId: string; newUser: boolean }> {
    const { accountId } = this.parseInviteToken(token);
    const preview = await this.previewInvitation(token);
    let userId: string;
    let newUser = false;
    const existing = await this.db.global.user.findUnique({ where: { email: preview.email } });
    if (existing) {
      if (!current || current.userId !== existing.id) {
        throw new AppError(
          401,
          'UNAUTHENTICATED',
          'Bitte melden Sie sich mit der eingeladenen E-Mail-Adresse an',
        );
      }
      userId = existing.id;
    } else {
      if (!input.name || !input.password)
        throw new AppError(422, 'VALIDATION_FAILED', 'Name und Passwort sind erforderlich');
      userId = uuidv7();
      newUser = true;
      await this.db.global.user.create({
        data: {
          id: userId,
          email: preview.email,
          name: input.name,
          passwordHash: await hashPassword(input.password),
          emailVerifiedAt: new Date(),
          lastAccountId: accountId,
        },
      });
    }
    await this.db.tenant({ accountId, userId }, async (tx) => {
      const inv = await tx.invitation.findUnique({ where: { tokenHash: hashToken(token) } });
      if (!inv || inv.acceptedAt || inv.revokedAt || inv.expiresAt < new Date())
        throw Errors.invalidToken();
      const claimed = await tx.invitation.updateMany({
        where: { id: inv.id, acceptedAt: null },
        data: { acceptedAt: new Date() },
      });
      if (claimed.count !== 1) throw Errors.invalidToken();
      const membershipId = uuidv7();
      await tx.membership.create({
        data: { id: membershipId, accountId, userId, allCompanies: inv.allCompanies },
      });
      // Nur noch existierende Rollen/Firmen übernehmen (können seit der Einladung gelöscht worden sein)
      const roles = await tx.role.findMany({
        where: { id: { in: inv.roleIds } },
        select: { id: true },
      });
      if (roles.length)
        await tx.membershipRole.createMany({
          data: roles.map((r) => ({ accountId, membershipId, roleId: r.id })),
        });
      const companies = await tx.company.findMany({
        where: { id: { in: inv.companyIds } },
        select: { id: true },
      });
      if (companies.length)
        await tx.companyAccess.createMany({
          data: companies.map((c) => ({ accountId, membershipId, companyId: c.id })),
        });
      await this.audit.record(tx, {
        accountId,
        userId,
        action: 'member.joined',
        entityType: 'membership',
        entityId: membershipId,
        data: { invitationId: inv.id },
        ip,
      });
    });
    return { userId, accountId, newUser };
  }

  async updateAccess(
    t: TenantContext,
    membershipId: string,
    input: UpdateMemberAccessInput,
  ): Promise<void> {
    await this.run(t, async (tx) => {
      const m = await tx.membership.findUnique({ where: { id: membershipId } });
      if (!m) throw Errors.notFound();
      if (m.isOwner && !t.account.isOwner)
        throw new AppError(403, 'PERMISSION_DENIED', 'Nur Inhaber können Inhaber bearbeiten');
      if (input.allCompanies && !t.account.allCompanies)
        throw new AppError(
          403,
          'PERMISSION_DENIED',
          'Sie haben selbst keinen Zugriff auf alle Firmen',
        );
      if (
        !t.account.allCompanies &&
        input.companyIds.some((c) => !t.account.companyIds.includes(c))
      ) {
        throw new AppError(
          403,
          'COMPANY_ACCESS_DENIED',
          'Sie können nur Zugriff auf eigene Firmen vergeben',
        );
      }
      await this.validateRolesAndCompanies(
        tx,
        t,
        input.roleIds,
        input.companyIds,
        input.permissions,
      );
      const before = await tx.membership.findUnique({
        where: { id: membershipId },
        include: { roles: true, permissions: true, companies: true },
      });
      await tx.membershipRole.deleteMany({ where: { membershipId } });
      await tx.membershipPermission.deleteMany({ where: { membershipId } });
      await tx.companyAccess.deleteMany({ where: { membershipId } });
      const accountId = t.account.id;
      if (input.roleIds.length)
        await tx.membershipRole.createMany({
          data: [...new Set(input.roleIds)].map((roleId) => ({ accountId, membershipId, roleId })),
        });
      if (input.permissions.length)
        await tx.membershipPermission.createMany({
          data: [...new Set(input.permissions)].map((permission) => ({
            accountId,
            membershipId,
            permission,
          })),
        });
      if (input.companyIds.length)
        await tx.companyAccess.createMany({
          data: [...new Set(input.companyIds)].map((companyId) => ({
            accountId,
            membershipId,
            companyId,
          })),
        });
      await tx.membership.update({
        where: { id: membershipId },
        data: { allCompanies: input.allCompanies },
      });
      await this.audit.record(tx, {
        accountId,
        userId: t.user.id,
        action: 'member.access_changed',
        entityType: 'membership',
        entityId: membershipId,
        data: {
          before: {
            roleIds: before?.roles.map((r) => r.roleId),
            permissions: before?.permissions.map((p) => p.permission),
            allCompanies: before?.allCompanies,
            companyIds: before?.companies.map((c) => c.companyId),
          },
          after: input,
        },
        ip: t.ip,
      });
    });
  }

  async setStatus(
    t: TenantContext,
    membershipId: string,
    status: 'ACTIVE' | 'DISABLED',
  ): Promise<void> {
    const userId = await this.run(t, async (tx) => {
      const m = await tx.membership.findUnique({ where: { id: membershipId } });
      if (!m) throw Errors.notFound();
      if (status === 'DISABLED') {
        if (m.userId === t.user.id)
          throw new AppError(409, 'CONFLICT', 'Sie können sich nicht selbst sperren');
        if (m.isOwner) {
          if (!t.account.isOwner)
            throw new AppError(403, 'PERMISSION_DENIED', 'Nur Inhaber können Inhaber sperren');
          const owners = await tx.membership.count({ where: { isOwner: true, status: 'ACTIVE' } });
          if (owners <= 1)
            throw new AppError(409, 'LAST_OWNER', 'Der letzte Inhaber kann nicht gesperrt werden');
        }
      } else if (
        m.status !== 'ACTIVE' &&
        !canAdd(t.account.entitlement, 'users', await this.seatsInUse(tx, t.account.id))
      ) {
        throw new AppError(403, 'LICENSE_LIMIT_REACHED', 'Benutzerlimit der Lizenz erreicht');
      }
      await tx.membership.update({ where: { id: membershipId }, data: { status } });
      await this.audit.record(tx, {
        accountId: t.account.id,
        userId: t.user.id,
        action: status === 'DISABLED' ? 'member.disabled' : 'member.enabled',
        entityType: 'membership',
        entityId: membershipId,
        ip: t.ip,
      });
      return m.userId;
    });
    if (status === 'DISABLED') await this.sessions.revokeForAccount(userId, t.account.id);
  }
}
