import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { type FastifyRequest } from 'fastify';
import { type Permission } from '@fangevo/shared';
import { hasModule, type ModuleKey } from '@fangevo/licensing';
import { SESSION_COOKIE, SessionService } from '../auth/session.service';
import { AppError, Errors } from '../http/errors';
import { META, type AccountContext, type AuthContext } from '../http/context';
import { API_KEY_PREFIX } from '@fangevo/shared';
import { ApiKeysService } from '../apikeys/api-keys.service';
import { AccessService } from './access.service';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Zentrale, serverseitige Zugriffskontrolle für JEDE Route:
 * 1. Sitzung prüfen (außer @Public)
 * 2. Zwei-Faktor-Status prüfen
 * 3. Account-Kontext laden (Mitgliedschaft, Rechte, Lizenz)
 * 4. Lizenz: gesperrte Accounts nur lesend, Modul muss gebucht sein
 * 5. Rechte prüfen
 * 6. Firmenkontext (X-Company-Id) gegen Firmenrechte prüfen
 */
@Injectable()
export class AccessGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(AccessService) private readonly access: AccessService,
    @Inject(ApiKeysService) private readonly apiKeys: ApiKeysService,
  ) {}

  private meta<T>(key: string, ctx: ExecutionContext): T | undefined {
    return this.reflector.getAllAndOverride<T>(key, [ctx.getHandler(), ctx.getClass()]);
  }

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<FastifyRequest>();
    const isPublic = this.meta<boolean>(META.public, ctx) ?? false;

    const token = req.cookies?.[SESSION_COOKIE];
    const bearer = req.headers.authorization;
    if (!token && typeof bearer === 'string' && bearer.startsWith(`Bearer ${API_KEY_PREFIX}`)) {
      // Externe Systeme: Anmeldung per API-Schlüssel (Firma und Rechte aus dem Schlüssel)
      const auth = await this.apiKeys.authenticate(bearer.slice(7).trim(), req.ip ?? null);
      req.fangevo = auth;
      if (isPublic) return true;
      const header = req.headers['x-company-id'];
      if (typeof header === 'string' && header && header !== auth.companyId)
        throw new AppError(
          403,
          'COMPANY_ACCESS_DENIED',
          'Der API-Schlüssel gilt nur für seine Firma',
        );
      if (!hasModule(auth.account!.entitlement, 'api'))
        throw new AppError(403, 'MODULE_NOT_LICENSED', 'Das Modul "api" ist nicht gebucht');
      this.checkAccount(ctx, req, auth.account!);
      if (this.meta<boolean>(META.company, ctx) && !auth.companyId)
        throw new AppError(400, 'COMPANY_REQUIRED', 'Header X-Company-Id fehlt');
      return true;
    }
    const session = token ? await this.sessions.resolve(token) : null;
    if (!session) {
      if (isPublic) return true;
      throw new AppError(401, token ? 'SESSION_EXPIRED' : 'UNAUTHENTICATED', 'Bitte anmelden');
    }

    const auth: AuthContext = {
      sessionId: session.id,
      user: {
        id: session.user.id,
        email: session.user.email,
        name: session.user.name,
        mfaEnabled: session.user.mfaEnabled,
      },
      mfaPending: session.mfaPending,
      account: null,
      companyId: null,
      scope:
        session.scope === 'packing' && session.scopeCompanyId && session.deviceId
          ? { kind: 'packing', companyId: session.scopeCompanyId, deviceId: session.deviceId }
          : null,
    };
    req.fangevo = auth;
    if (isPublic) return true;

    // PIN-Sitzung am Packtisch: nur freigegebene Endpunkte und nur die Firma des Geräts
    if (session.scope) {
      if (!auth.scope || !this.meta<boolean>(META.packingScope, ctx))
        throw Errors.forbidden(
          'PERMISSION_DENIED',
          'Mit der PIN-Anmeldung ist nur der Packtisch erreichbar',
        );
      const h = req.headers['x-company-id'];
      if (typeof h === 'string' && h && h !== auth.scope.companyId)
        throw new AppError(403, 'COMPANY_ACCESS_DENIED', 'Kein Zugriff auf diese Firma');
      req.headers['x-company-id'] = auth.scope.companyId;
    }

    if (session.mfaPending) {
      if (this.meta<boolean>(META.allowMfaPending, ctx)) return true;
      throw new AppError(401, 'MFA_REQUIRED', 'Zwei-Faktor-Bestätigung erforderlich');
    }

    if (session.accountId) {
      auth.account = await this.access.loadAccountContext(session.user.id, session.accountId);
      if (!auth.account) await this.sessions.update(session.id, { accountId: null });
    }

    const noAccount = this.meta<boolean>(META.noAccount, ctx) ?? false;
    if (!auth.account) {
      if (noAccount) return true;
      throw Errors.forbidden('FORBIDDEN', 'Kein aktiver Account');
    }
    const account = auth.account;
    this.checkAccount(ctx, req, account);

    const header = req.headers['x-company-id'];
    const companyId = typeof header === 'string' && header ? header : null;
    if (companyId) {
      if (!UUID_RE.test(companyId))
        throw new AppError(400, 'VALIDATION_FAILED', 'Ungültige Firmen-ID');
      const allowed = account.allCompanies
        ? await this.access.companyExists(auth.user.id, account.id, companyId)
        : account.companyIds.includes(companyId);
      if (!allowed) {
        throw new AppError(403, 'COMPANY_ACCESS_DENIED', 'Kein Zugriff auf diese Firma');
      }
      auth.companyId = companyId;
    }
    if (this.meta<boolean>(META.company, ctx) && !auth.companyId) {
      throw new AppError(400, 'COMPANY_REQUIRED', 'Header X-Company-Id fehlt');
    }
    return true;
  }

  /** Lizenz (Lesemodus, Modul) und Rechte prüfen – gleich für Sitzung und API-Schlüssel. */
  private checkAccount(ctx: ExecutionContext, req: FastifyRequest, account: AccountContext): true {
    if (
      account.accessMode === 'read_only' &&
      !SAFE_METHODS.has(req.method) &&
      !this.meta<boolean>(META.allowReadOnly, ctx)
    ) {
      throw new AppError(
        403,
        'ACCOUNT_SUSPENDED',
        'Der Account ist gesperrt oder abgelaufen. Daten können gelesen und exportiert, aber nicht geändert werden.',
      );
    }
    const module = this.meta<ModuleKey>(META.module, ctx);
    if (module && !hasModule(account.entitlement, module)) {
      throw new AppError(403, 'MODULE_NOT_LICENSED', `Das Modul "${module}" ist nicht gebucht`);
    }
    const required = this.meta<Permission[]>(META.permissions, ctx) ?? [];
    const missing = required.filter((p) => !account.permissions.has(p));
    if (missing.length)
      throw new AppError(403, 'PERMISSION_DENIED', `Fehlende Berechtigung: ${missing.join(', ')}`);
    return true;
  }
}
