import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { type FastifyReply, type FastifyRequest } from 'fastify';
import { type z } from 'zod';
import {
  acceptInvitationSchema,
  changePasswordSchema,
  loginSchema,
  mfaDisableSchema,
  mfaEnableSchema,
  mfaVerifySchema,
  registerSchema,
  requestPasswordResetSchema,
  resetPasswordSchema,
  switchAccountSchema,
  tokenSchema,
  updateProfileSchema,
} from '@fangevo/shared';
import { MODULES, isModuleKey } from '@fangevo/licensing';
import { APP_CONFIG, type AppConfig } from '../../config';
import { AccessService } from '../access/access.service';
import { AuditService } from '../audit/audit.service';
import { Database } from '../database/database.service';
import { AppError } from '../http/errors';
import { AllowMfaPending, AllowReadOnly, Auth, NoAccount, Public, RateLimit, Req, type AuthContext, clientIp } from '../http/context';
import { ApiZodBody, uuidParam, zodPipe } from '../http/zod';
import { MembersService } from '../members/members.service';
import { AuthService, type ClientInfo } from './auth.service';
import { MfaService } from './mfa.service';
import { SESSION_COOKIE, SessionService } from './session.service';

function client(req: FastifyRequest): ClientInfo {
  return { ip: clientIp(req), userAgent: (req.headers['user-agent'] as string | undefined) ?? null };
}

@ApiTags('Authentifizierung')
@Controller('auth')
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(MfaService) private readonly mfa: MfaService,
    @Inject(AccessService) private readonly access: AccessService,
    @Inject(MembersService) private readonly members: MembersService,
    @Inject(Database) private readonly db: Database,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  private setCookie(reply: FastifyReply, token: string): void {
    void reply.setCookie(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: this.config.isProd,
      sameSite: 'lax',
      path: '/',
      maxAge: this.sessions.maxAgeSec,
    });
  }

  @Post('register')
  @Public()
  @HttpCode(202)
  @RateLimit({ key: 'register', limit: 10, windowSec: 3600 })
  @ApiOperation({ summary: 'Neuen Account registrieren (sendet Bestätigungs-E-Mail)' })
  @ApiZodBody(registerSchema)
  async register(@Body(zodPipe(registerSchema)) body: z.infer<typeof registerSchema>, @Req() req: FastifyRequest) {
    await this.auth.register(body, client(req));
    return { status: 'verification_sent' };
  }

  @Post('verify-email')
  @Public()
  @HttpCode(200)
  @RateLimit({ key: 'verify', limit: 30, windowSec: 3600 })
  @ApiZodBody(tokenSchema)
  async verifyEmail(@Body(zodPipe(tokenSchema)) body: z.infer<typeof tokenSchema>) {
    await this.auth.verifyEmail(body.token);
    return { status: 'verified' };
  }

  @Post('resend-verification')
  @Public()
  @HttpCode(202)
  @RateLimit({ key: 'resend', limit: 5, windowSec: 3600, byBodyField: 'email' })
  @ApiZodBody(requestPasswordResetSchema)
  async resend(@Body(zodPipe(requestPasswordResetSchema)) body: z.infer<typeof requestPasswordResetSchema>) {
    await this.auth.resendVerification(body.email);
    return { status: 'ok' };
  }

  @Post('login')
  @Public()
  @HttpCode(200)
  @RateLimit({ key: 'login-ip', limit: 50, windowSec: 900 }, { key: 'login', limit: 10, windowSec: 900, byBodyField: 'email' })
  @ApiOperation({ summary: 'Anmelden. Setzt ein HttpOnly-Sitzungscookie.' })
  @ApiZodBody(loginSchema)
  async login(@Body(zodPipe(loginSchema)) body: z.infer<typeof loginSchema>, @Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    const r = await this.auth.login(body, client(req));
    this.setCookie(reply, r.token);
    return { mfaRequired: r.mfaRequired };
  }

  @Post('mfa/verify')
  @AllowMfaPending()
  @NoAccount()
  @AllowReadOnly()
  @HttpCode(200)
  @RateLimit({ key: 'mfa', limit: 10, windowSec: 900 })
  @ApiZodBody(mfaVerifySchema)
  async verifyMfa(@Auth() a: AuthContext, @Body(zodPipe(mfaVerifySchema)) body: z.infer<typeof mfaVerifySchema>, @Req() req: FastifyRequest) {
    if (!a.mfaPending) return { status: 'ok' };
    await this.auth.completeMfa(a.sessionId, a.user.id, body.code, client(req));
    return { status: 'ok' };
  }

  @Post('logout')
  @AllowMfaPending()
  @NoAccount()
  @AllowReadOnly()
  @HttpCode(204)
  async logout(@Auth() a: AuthContext, @Res({ passthrough: true }) reply: FastifyReply) {
    await this.sessions.revoke(a.sessionId);
    void reply.clearCookie(SESSION_COOKIE, { path: '/' });
  }

  @Get('session')
  @AllowMfaPending()
  @NoAccount()
  @ApiOperation({ summary: 'Aktuelle Sitzung: Benutzer, Accounts, Rechte, Lizenz, Firmen' })
  async session(@Auth() a: AuthContext) {
    if (a.mfaPending) return { user: a.user, mfaPending: true };
    const accounts = await this.access.listAccounts(a.user.id);
    const acc = a.account;
    let companies: { id: string; name: string }[] = [];
    if (acc) {
      companies = await this.db.tenant({ accountId: acc.id, userId: a.user.id }, (tx) =>
        tx.company.findMany({ where: { id: { in: acc.companyIds } }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      );
    }
    return {
      user: a.user,
      mfaPending: false,
      accounts,
      account: acc && {
        id: acc.id,
        name: acc.name,
        isOwner: acc.isOwner,
        permissions: [...acc.permissions].sort(),
        accessMode: acc.accessMode,
        license: {
          plan: acc.entitlement.plan,
          status: acc.entitlement.status,
          trialEndsAt: acc.entitlement.trialEndsAt,
          modules: acc.entitlement.modules.filter(isModuleKey).map((k) => ({ key: k, name: MODULES[k].name, available: MODULES[k].available })),
        },
        companies,
      },
    };
  }

  @Post('switch-account')
  @NoAccount()
  @HttpCode(200)
  @ApiZodBody(switchAccountSchema)
  async switchAccount(@Auth() a: AuthContext, @Body(zodPipe(switchAccountSchema)) body: z.infer<typeof switchAccountSchema>) {
    await this.auth.switchAccount(a.sessionId, a.user.id, body.accountId);
    return { status: 'ok' };
  }

  @Post('password/forgot')
  @Public()
  @HttpCode(202)
  @RateLimit({ key: 'forgot', limit: 5, windowSec: 3600, byBodyField: 'email' })
  @ApiZodBody(requestPasswordResetSchema)
  async forgot(@Body(zodPipe(requestPasswordResetSchema)) body: z.infer<typeof requestPasswordResetSchema>, @Req() req: FastifyRequest) {
    await this.auth.requestPasswordReset(body.email, client(req));
    return { status: 'ok' };
  }

  @Post('password/reset')
  @Public()
  @HttpCode(200)
  @RateLimit({ key: 'reset', limit: 20, windowSec: 3600 })
  @ApiZodBody(resetPasswordSchema)
  async reset(@Body(zodPipe(resetPasswordSchema)) body: z.infer<typeof resetPasswordSchema>, @Req() req: FastifyRequest) {
    await this.auth.resetPassword(body.token, body.password, client(req));
    return { status: 'ok' };
  }

  @Post('password/change')
  @NoAccount()
  @AllowReadOnly()
  @HttpCode(200)
  @RateLimit({ key: 'change-pw', limit: 10, windowSec: 900 })
  @ApiZodBody(changePasswordSchema)
  async change(@Auth() a: AuthContext, @Body(zodPipe(changePasswordSchema)) body: z.infer<typeof changePasswordSchema>, @Req() req: FastifyRequest) {
    await this.auth.changePassword(a.user.id, a.sessionId, body.currentPassword, body.newPassword, client(req));
    return { status: 'ok' };
  }

  @Patch('profile')
  @NoAccount()
  @AllowReadOnly()
  @ApiZodBody(updateProfileSchema)
  async profile(@Auth() a: AuthContext, @Body(zodPipe(updateProfileSchema)) body: z.infer<typeof updateProfileSchema>) {
    await this.db.global.user.update({ where: { id: a.user.id }, data: { name: body.name } });
    return { status: 'ok' };
  }

  @Post('mfa/setup')
  @NoAccount()
  @AllowReadOnly()
  @HttpCode(200)
  @ApiOperation({ summary: 'Zwei-Faktor einrichten: liefert QR-Code für die Authenticator-App' })
  async mfaSetup(@Auth() a: AuthContext) {
    if (a.user.mfaEnabled) throw new AppError(409, 'CONFLICT', 'Zwei-Faktor ist bereits aktiv');
    return this.mfa.startSetup(a.user);
  }

  @Post('mfa/enable')
  @NoAccount()
  @AllowReadOnly()
  @HttpCode(200)
  @RateLimit({ key: 'mfa-enable', limit: 10, windowSec: 900 })
  @ApiZodBody(mfaEnableSchema)
  async mfaEnable(@Auth() a: AuthContext, @Body(zodPipe(mfaEnableSchema)) body: z.infer<typeof mfaEnableSchema>, @Req() req: FastifyRequest) {
    const codes = await this.mfa.confirmSetup(a.user.id, body.code);
    if (!codes) throw new AppError(400, 'MFA_INVALID', 'Der Code ist ungültig oder die Einrichtung ist abgelaufen');
    await this.sessions.revokeAllForUser(a.user.id, a.sessionId);
    await this.auditSecurity('auth.mfa_enabled', a, req);
    return { recoveryCodes: codes };
  }

  @Post('mfa/disable')
  @NoAccount()
  @AllowReadOnly()
  @HttpCode(200)
  @RateLimit({ key: 'mfa-disable', limit: 10, windowSec: 900 })
  @ApiZodBody(mfaDisableSchema)
  async mfaDisable(@Auth() a: AuthContext, @Body(zodPipe(mfaDisableSchema)) body: z.infer<typeof mfaDisableSchema>, @Req() req: FastifyRequest) {
    if (!(await this.auth.checkPassword(a.user.id, body.password))) throw new AppError(400, 'INVALID_CREDENTIALS', 'Passwort ist falsch');
    await this.mfa.disable(a.user.id);
    await this.auditSecurity('auth.mfa_disabled', a, req);
    return { status: 'ok' };
  }

  @Get('sessions')
  @NoAccount()
  async listSessions(@Auth() a: AuthContext) {
    const list = await this.sessions.listActive(a.user.id);
    return list.map((s) => ({ id: s.id, ip: s.ip, userAgent: s.userAgent, createdAt: s.createdAt, lastSeenAt: s.lastSeenAt, current: s.id === a.sessionId }));
  }

  @Delete('sessions/:id')
  @NoAccount()
  @AllowReadOnly()
  @HttpCode(204)
  async revokeSession(@Auth() a: AuthContext, @Param('id', uuidParam) id: string) {
    const s = await this.db.global.session.findUnique({ where: { id } });
    if (s?.userId === a.user.id) await this.sessions.revoke(id);
  }

  @Get('invitations/:token')
  @Public()
  @RateLimit({ key: 'invite-preview', limit: 30, windowSec: 900 })
  async previewInvitation(@Param('token') token: string) {
    return this.members.previewInvitation(token);
  }

  @Post('invitations/accept')
  @Public()
  @HttpCode(200)
  @RateLimit({ key: 'invite-accept', limit: 20, windowSec: 900 })
  @ApiZodBody(acceptInvitationSchema)
  async acceptInvitation(@Body(zodPipe(acceptInvitationSchema)) body: z.infer<typeof acceptInvitationSchema>, @Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    const current = req.fangevo && !req.fangevo.mfaPending ? { userId: req.fangevo.user.id, email: req.fangevo.user.email } : null;
    const r = await this.members.acceptInvitation(body.token, { name: body.name, password: body.password }, current, clientIp(req));
    if (r.newUser) {
      const { token } = await this.sessions.create({ userId: r.userId, accountId: r.accountId, mfaPending: false, ...client(req) });
      this.setCookie(reply, token);
    } else if (req.fangevo) {
      await this.auth.switchAccount(req.fangevo.sessionId, r.userId, r.accountId);
    }
    return { accountId: r.accountId };
  }

  private async auditSecurity(type: string, a: AuthContext, req: FastifyRequest): Promise<void> {
    await this.audit.security({ type, userId: a.user.id, ...client(req) });
  }
}
