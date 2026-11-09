import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { type z } from 'zod';
import { uuidv7 } from '@fangevo/database';
import {
  API_KEY_PREFIX,
  isPermission,
  PERMISSIONS,
  type apiKeyInputSchema,
  type Permission,
} from '@fangevo/shared';
import { AccessService } from '../access/access.service';
import { assertCanGrant } from '../access/escalation';
import { AuditService } from '../audit/audit.service';
import { Database } from '../database/database.service';
import { RedisService } from '../database/redis.service';
import { AppError, Errors } from '../http/errors';
import { type AuthContext, type TenantContext } from '../http/context';

export const hashKey = (token: string) => createHash('sha256').update(token).digest('hex');

/** Rechte, die ein API-Schlüssel erhalten darf: Fachmodule, keine Administration. */
export const API_KEY_PERMISSIONS = (Object.keys(PERMISSIONS) as Permission[]).filter(
  (p) => PERMISSIONS[p].module !== 'core' && p !== 'api_keys.manage',
);

const RATE_PER_MINUTE = 600;

/**
 * API-Schlüssel für externe Systeme. Ein Schlüssel gehört zu einer Firma, trägt ausgewählte Rechte
 * und handelt im Namen der Person, die ihn angelegt hat: Wirksam sind nur Rechte, die diese Person
 * noch besitzt. Gespeichert wird nur der SHA-256-Hash; der Schlüssel wird einmalig angezeigt.
 */
@Injectable()
export class ApiKeysService {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(AccessService) private readonly access: AccessService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(RedisService) private readonly redis: RedisService,
  ) {}

  private ctx(t: TenantContext) {
    if (!t.companyId)
      throw new AppError(400, 'COMPANY_REQUIRED', 'Bitte zuerst eine Firma auswählen');
    return { accountId: t.account.id, userId: t.user.id, companyId: t.companyId };
  }

  list(t: TenantContext) {
    return this.db.tenant(this.ctx(t), (tx) =>
      tx.apiKey.findMany({ orderBy: { createdAt: 'desc' } }),
    );
  }

  async create(t: TenantContext, input: z.infer<typeof apiKeyInputSchema>) {
    const bad = input.permissions.filter(
      (p) => !isPermission(p) || !API_KEY_PERMISSIONS.includes(p),
    );
    if (bad.length)
      throw new AppError(
        422,
        'VALIDATION_FAILED',
        `Nicht erlaubte Rechte für API-Schlüssel: ${bad.join(', ')}`,
      );
    assertCanGrant(t.account, input.permissions);
    const token = `${API_KEY_PREFIX}${randomBytes(24).toString('base64url')}`;
    const ctx = this.ctx(t);
    const key = await this.db.tenant(ctx, async (tx) => {
      const id = uuidv7();
      const k = await tx.apiKey.create({
        data: {
          id,
          accountId: ctx.accountId,
          companyId: ctx.companyId,
          name: input.name,
          prefix: token.slice(0, API_KEY_PREFIX.length + 4),
          permissions: [...new Set(input.permissions)],
          createdBy: t.user.id,
          expiresAt: input.expiresAt ? new Date(`${input.expiresAt}T23:59:59Z`) : null,
        },
      });
      await tx.apiKeyIndex.create({
        data: {
          hash: hashKey(token),
          keyId: id,
          accountId: ctx.accountId,
          companyId: ctx.companyId,
        },
      });
      await this.audit.record(tx, {
        accountId: ctx.accountId,
        userId: t.user.id,
        companyId: ctx.companyId,
        action: 'api_key.created',
        entityType: 'api_key',
        entityId: id,
        data: { name: input.name, permissions: k.permissions },
        ip: t.ip,
      });
      return k;
    });
    return { ...key, token };
  }

  revoke(t: TenantContext, id: string) {
    const ctx = this.ctx(t);
    return this.db.tenant(ctx, async (tx) => {
      const k = await tx.apiKey.findUnique({ where: { id } });
      if (!k) throw Errors.notFound();
      await tx.apiKey.update({ where: { id }, data: { revokedAt: k.revokedAt ?? new Date() } });
      await tx.apiKeyIndex.deleteMany({ where: { keyId: id } });
      await this.audit.record(tx, {
        accountId: ctx.accountId,
        userId: t.user.id,
        companyId: ctx.companyId,
        action: 'api_key.revoked',
        entityType: 'api_key',
        entityId: id,
        data: { name: k.name },
        ip: t.ip,
      });
    });
  }

  /** Anmeldung per Schlüssel (Authorization: Bearer fe_live_…). Ergebnis wie eine Sitzung. */
  async authenticate(token: string, ip: string | null): Promise<AuthContext> {
    const invalid = () =>
      new AppError(401, 'UNAUTHENTICATED', 'API-Schlüssel ungültig oder gesperrt');
    const idx = await this.db.global.apiKeyIndex.findUnique({ where: { hash: hashKey(token) } });
    if (!idx) throw invalid();
    const ctx = { accountId: idx.accountId, userId: null, companyId: idx.companyId };
    const key = await this.db.tenant(ctx, (tx) =>
      tx.apiKey.findUnique({ where: { id: idx.keyId } }),
    );
    if (!key || key.revokedAt || (key.expiresAt && key.expiresAt < new Date())) throw invalid();

    // Rate-Limit je Schlüssel
    const bucket = `rl-apikey:${key.id}:${Math.floor(Date.now() / 60_000)}`;
    const n = await this.redis.client.incr(bucket);
    if (n === 1) await this.redis.client.expire(bucket, 70);
    if (n > RATE_PER_MINUTE)
      throw new AppError(
        429,
        'RATE_LIMITED',
        `Höchstens ${RATE_PER_MINUTE} Anfragen pro Minute je API-Schlüssel`,
      );

    const account = await this.access.loadAccountContext(key.createdBy, key.accountId);
    if (!account) throw invalid();
    if (!account.allCompanies && !account.companyIds.includes(key.companyId)) throw invalid();
    const permissions = new Set(
      key.permissions.filter((p): p is Permission => isPermission(p) && account.permissions.has(p)),
    );
    const user = await this.db.global.user.findUnique({
      where: { id: key.createdBy },
      select: { id: true, email: true, name: true, mfaEnabled: true },
    });
    if (!user) throw invalid();

    if (!key.lastUsedAt || Date.now() - key.lastUsedAt.getTime() > 60_000)
      await this.db.tenant(ctx, (tx) =>
        tx.apiKey.update({
          where: { id: key.id },
          data: { lastUsedAt: new Date(), lastUsedIp: ip },
        }),
      );
    return {
      sessionId: `apikey:${key.id}`,
      user,
      mfaPending: false,
      account: { ...account, permissions, grantable: new Set(permissions) },
      companyId: key.companyId,
    };
  }
}
