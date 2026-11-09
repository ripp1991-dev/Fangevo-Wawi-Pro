import { Inject, Injectable } from '@nestjs/common';
import { uuidv7, type AuthTokenType } from '@fangevo/database';
import { type LoginInput, type RegisterInput } from '@fangevo/shared';
import { AccessService } from '../access/access.service';
import { ProvisioningService } from '../accounts/provisioning.service';
import { AuditService } from '../audit/audit.service';
import { Database } from '../database/database.service';
import { AppError, Errors } from '../http/errors';
import { MailService } from '../mail/mail.service';
import { burnPasswordCheck, hashPassword, hashToken, randomToken, verifyPassword } from '../security/crypto';
import { MfaService } from './mfa.service';
import { SessionService } from './session.service';

const VERIFY_TTL_MS = 48 * 3600_000;
const RESET_TTL_MS = 3600_000;

export interface ClientInfo {
  ip: string | null;
  userAgent: string | null;
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(MfaService) private readonly mfa: MfaService,
    @Inject(MailService) private readonly mail: MailService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(ProvisioningService) private readonly provisioning: ProvisioningService,
    @Inject(AccessService) private readonly access: AccessService,
  ) {}

  /**
   * Registrierung. Antwortet immer gleich, damit nicht erkennbar ist, ob eine
   * E-Mail-Adresse bereits registriert ist.
   */
  async register(input: RegisterInput, client: ClientInfo): Promise<void> {
    const existing = await this.db.global.user.findUnique({ where: { email: input.email } });
    if (existing) {
      await this.mail.send({
        to: input.email,
        subject: 'Registrierung bei FangEvo Wawi Pro',
        text: `Für diese E-Mail-Adresse besteht bereits ein Zugang. Falls Sie Ihr Passwort vergessen haben: ${this.mail.link('/forgot-password', '')}`,
      });
      return;
    }
    const userId = uuidv7();
    await this.db.global.user.create({
      data: { id: userId, email: input.email, name: input.name, passwordHash: await hashPassword(input.password) },
    });
    const { accountId } = await this.provisioning.createAccount({ ownerUserId: userId, accountName: input.accountName, ip: client.ip });
    await this.db.global.user.update({ where: { id: userId }, data: { lastAccountId: accountId } });
    await this.sendVerification(userId, input.email);
    await this.audit.security({ type: 'user.registered', userId, email: input.email, ...client });
  }

  async sendVerification(userId: string, email: string): Promise<void> {
    const token = await this.issueToken(userId, 'EMAIL_VERIFY', VERIFY_TTL_MS);
    await this.mail.send({
      to: email,
      subject: 'Bitte bestätigen Sie Ihre E-Mail-Adresse',
      text: `Willkommen bei FangEvo Wawi Pro!\n\nBitte bestätigen Sie Ihre E-Mail-Adresse:\n${this.mail.link('/verify-email', token)}\n\nDer Link ist 48 Stunden gültig.`,
    });
  }

  async resendVerification(email: string): Promise<void> {
    const user = await this.db.global.user.findUnique({ where: { email } });
    if (user && !user.emailVerifiedAt) await this.sendVerification(user.id, user.email);
  }

  async verifyEmail(token: string): Promise<void> {
    const t = await this.consumeToken(token, 'EMAIL_VERIFY');
    await this.db.global.user.update({ where: { id: t.userId }, data: { emailVerifiedAt: new Date() } });
    await this.audit.security({ type: 'user.email_verified', userId: t.userId });
  }

  async login(input: LoginInput, client: ClientInfo): Promise<{ token: string; mfaRequired: boolean }> {
    const user = await this.db.global.user.findUnique({ where: { email: input.email } });
    if (!user) {
      await burnPasswordCheck(input.password);
      await this.audit.security({ type: 'auth.login_failed', email: input.email, ...client });
      throw new AppError(401, 'INVALID_CREDENTIALS', 'E-Mail oder Passwort ist falsch');
    }
    if (!(await verifyPassword(user.passwordHash, input.password))) {
      await this.audit.security({ type: 'auth.login_failed', userId: user.id, email: input.email, ...client });
      throw new AppError(401, 'INVALID_CREDENTIALS', 'E-Mail oder Passwort ist falsch');
    }
    if (!user.emailVerifiedAt) throw new AppError(403, 'EMAIL_NOT_VERIFIED', 'Bitte bestätigen Sie zuerst Ihre E-Mail-Adresse');

    const accountId = await this.pickAccount(user.id, user.lastAccountId);
    const { token, session } = await this.sessions.create({ userId: user.id, accountId, mfaPending: user.mfaEnabled, ...client });
    await this.audit.security({ type: user.mfaEnabled ? 'auth.login_password_ok' : 'auth.login', userId: user.id, ...client });
    if (!user.mfaEnabled && accountId) await this.auditLogin(user.id, accountId, session.id, client.ip);
    return { token, mfaRequired: user.mfaEnabled };
  }

  async completeMfa(sessionId: string, userId: string, code: string, client: ClientInfo): Promise<void> {
    if (!(await this.mfa.verify(userId, code))) {
      await this.audit.security({ type: 'auth.mfa_failed', userId, ...client });
      throw new AppError(401, 'MFA_INVALID', 'Der Code ist ungültig');
    }
    await this.sessions.update(sessionId, { mfaPending: false });
    await this.audit.security({ type: 'auth.login', userId, ...client });
    const s = await this.db.global.session.findUnique({ where: { id: sessionId } });
    if (s?.accountId) await this.auditLogin(userId, s.accountId, sessionId, client.ip);
  }

  private async auditLogin(userId: string, accountId: string, sessionId: string, ip: string | null): Promise<void> {
    await this.db.tenant({ accountId, userId }, (tx) =>
      this.audit.record(tx, { accountId, userId, action: 'auth.login', entityType: 'session', entityId: sessionId, ip }),
    );
  }

  private async pickAccount(userId: string, preferred: string | null): Promise<string | null> {
    const accounts = await this.access.listAccounts(userId);
    return accounts.find((a) => a.id === preferred)?.id ?? accounts[0]?.id ?? null;
  }

  async switchAccount(sessionId: string, userId: string, accountId: string): Promise<void> {
    const ctx = await this.access.loadAccountContext(userId, accountId);
    if (!ctx) throw Errors.forbidden('FORBIDDEN', 'Kein Zugriff auf diesen Account');
    await this.sessions.update(sessionId, { accountId });
    await this.db.global.user.update({ where: { id: userId }, data: { lastAccountId: accountId } });
  }

  async requestPasswordReset(email: string, client: ClientInfo): Promise<void> {
    const user = await this.db.global.user.findUnique({ where: { email } });
    if (!user) return;
    const token = await this.issueToken(user.id, 'PASSWORD_RESET', RESET_TTL_MS);
    await this.mail.send({
      to: user.email,
      subject: 'Passwort zurücksetzen',
      text: `Sie haben das Zurücksetzen Ihres Passworts angefordert:\n${this.mail.link('/reset-password', token)}\n\nDer Link ist 1 Stunde gültig. Falls Sie das nicht waren, ignorieren Sie diese E-Mail.`,
    });
    await this.audit.security({ type: 'auth.password_reset_requested', userId: user.id, ...client });
  }

  async resetPassword(token: string, password: string, client: ClientInfo): Promise<void> {
    const t = await this.consumeToken(token, 'PASSWORD_RESET');
    await this.db.global.user.update({
      where: { id: t.userId },
      // Wer das Postfach kontrolliert, hat die Adresse damit auch bestätigt.
      data: { passwordHash: await hashPassword(password), emailVerifiedAt: new Date() },
    });
    await this.sessions.revokeAllForUser(t.userId);
    await this.audit.security({ type: 'auth.password_reset', userId: t.userId, ...client });
  }

  async changePassword(userId: string, sessionId: string, current: string, next: string, client: ClientInfo): Promise<void> {
    const user = await this.db.global.user.findUniqueOrThrow({ where: { id: userId } });
    if (!(await verifyPassword(user.passwordHash, current))) throw new AppError(400, 'INVALID_CREDENTIALS', 'Das aktuelle Passwort ist falsch');
    await this.db.global.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(next) } });
    await this.sessions.revokeAllForUser(userId, sessionId);
    await this.audit.security({ type: 'auth.password_changed', userId, ...client });
  }

  async checkPassword(userId: string, password: string): Promise<boolean> {
    const user = await this.db.global.user.findUniqueOrThrow({ where: { id: userId } });
    return verifyPassword(user.passwordHash, password);
  }

  private async issueToken(userId: string, type: AuthTokenType, ttlMs: number): Promise<string> {
    const token = randomToken();
    await this.db.global.authToken.updateMany({ where: { userId, type, usedAt: null }, data: { usedAt: new Date() } });
    await this.db.global.authToken.create({
      data: { id: uuidv7(), userId, type, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + ttlMs) },
    });
    return token;
  }

  /** Token einmalig verbrauchen (atomar, daher auch bei gleichzeitigen Anfragen nur einmal gültig). */
  private async consumeToken(token: string, type: AuthTokenType): Promise<{ userId: string }> {
    const t = await this.db.global.authToken.findUnique({ where: { tokenHash: hashToken(token) } });
    if (!t || t.type !== type || t.usedAt || t.expiresAt < new Date()) throw Errors.invalidToken();
    const r = await this.db.global.authToken.updateMany({ where: { id: t.id, usedAt: null }, data: { usedAt: new Date() } });
    if (r.count !== 1) throw Errors.invalidToken();
    return { userId: t.userId };
  }
}
