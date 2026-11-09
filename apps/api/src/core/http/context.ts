import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import { type FastifyRequest } from 'fastify';
import { type Permission } from '@fangevo/shared';
import { type AccessMode, type EntitlementSnapshot, type ModuleKey } from '@fangevo/licensing';
import { Errors } from './errors';

export interface AccountContext {
  id: string;
  name: string;
  membershipId: string;
  isOwner: boolean;
  permissions: Set<Permission>;
  entitlement: EntitlementSnapshot;
  accessMode: AccessMode;
  allCompanies: boolean;
  /** Zugängliche aktive Firmen. Nur gefüllt, wenn allCompanies = false. */
  companyIds: string[];
}

export interface AuthContext {
  sessionId: string;
  user: { id: string; email: string; name: string; mfaEnabled: boolean };
  mfaPending: boolean;
  account: AccountContext | null;
  companyId: string | null;
}

/** Kontext einer Anfrage, der für Mandantenzugriffe benötigt wird (Account garantiert). */
export interface TenantContext {
  sessionId: string;
  user: AuthContext['user'];
  account: AccountContext;
  companyId: string | null;
  ip: string | null;
}

declare module 'fastify' {
  interface FastifyRequest {
    fangevo?: AuthContext;
  }
}

export const META = {
  public: 'fangevo:public',
  allowMfaPending: 'fangevo:allowMfaPending',
  noAccount: 'fangevo:noAccount',
  allowReadOnly: 'fangevo:allowReadOnly',
  permissions: 'fangevo:permissions',
  module: 'fangevo:module',
  company: 'fangevo:company',
  rateLimit: 'fangevo:rateLimit',
} as const;

/** Kein Login nötig. */
export const Public = () => SetMetadata(META.public, true);
/** Erreichbar, während die Zwei-Faktor-Prüfung noch aussteht. */
export const AllowMfaPending = () => SetMetadata(META.allowMfaPending, true);
/** Login nötig, aber kein aktiver Account (z. B. Profil, Account-Wechsel). */
export const NoAccount = () => SetMetadata(META.noAccount, true);
/** Schreibender Zugriff auch bei gesperrtem Account erlaubt (z. B. Logout, Export). */
export const AllowReadOnly = () => SetMetadata(META.allowReadOnly, true);
/** Alle genannten Rechte werden benötigt. */
export const RequirePermission = (...p: Permission[]) => SetMetadata(META.permissions, p);
/** Modul muss lizenziert sein. */
export const RequiresModule = (m: ModuleKey) => SetMetadata(META.module, m);
/** Header X-Company-Id ist Pflicht und wird gegen die Firmenrechte geprüft. */
export const RequiresCompany = () => SetMetadata(META.company, true);

export interface RateLimitRule {
  key: string;
  limit: number;
  windowSec: number;
  /** Zusätzlich zum Client-IP nach diesem Body-Feld unterscheiden (z. B. email). */
  byBodyField?: string;
}
export const RateLimit = (...rules: RateLimitRule[]) => SetMetadata(META.rateLimit, rules);

export function clientIp(req: FastifyRequest): string | null {
  return req.ip ?? null;
}

export const Auth = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthContext => {
  const req = ctx.switchToHttp().getRequest<FastifyRequest>();
  if (!req.fangevo) throw Errors.unauthenticated();
  return req.fangevo;
});

/** Liefert den Mandantenkontext; wirft, wenn kein Account aktiv ist. */
export const Tenant = createParamDecorator((_: unknown, ctx: ExecutionContext): TenantContext => {
  const req = ctx.switchToHttp().getRequest<FastifyRequest>();
  const a = req.fangevo;
  if (!a?.account) throw Errors.forbidden('FORBIDDEN', 'Kein aktiver Account');
  return {
    sessionId: a.sessionId,
    user: a.user,
    account: a.account,
    companyId: a.companyId,
    ip: clientIp(req),
  };
});

export const Req = createParamDecorator((_: unknown, ctx: ExecutionContext) =>
  ctx.switchToHttp().getRequest<FastifyRequest>(),
);
