import { Inject, Injectable } from '@nestjs/common';
import { authenticator } from 'otplib';
import QRCode from 'qrcode';
import { uuidv7 } from '@fangevo/database';
import { APP_CONFIG, type AppConfig } from '../../config';
import { Database } from '../database/database.service';
import { SecretBox, hashToken, randomToken, safeEqual } from '../security/crypto';

authenticator.options = { window: 1, step: 30, digits: 6 };

const SETUP_TTL_MS = 15 * 60 * 1000;
const RECOVERY_CODES = 10;

/** Zwei-Faktor-Authentifizierung per TOTP (Authenticator-App) plus Wiederherstellungscodes. */
@Injectable()
export class MfaService {
  private readonly box: SecretBox;
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(APP_CONFIG) config: AppConfig,
  ) {
    this.box = new SecretBox(config.APP_ENCRYPTION_KEY);
  }

  async startSetup(user: { id: string; email: string }): Promise<{ secret: string; otpauthUrl: string; qrDataUrl: string }> {
    const secret = authenticator.generateSecret(20);
    await this.db.global.authToken.deleteMany({ where: { userId: user.id, type: 'MFA_SETUP' } });
    await this.db.global.authToken.create({
      data: {
        id: uuidv7(),
        userId: user.id,
        type: 'MFA_SETUP',
        tokenHash: hashToken(randomToken()),
        payload: this.box.encrypt(secret),
        expiresAt: new Date(Date.now() + SETUP_TTL_MS),
      },
    });
    const otpauthUrl = authenticator.keyuri(user.email, 'FangEvo Wawi Pro', secret);
    return { secret, otpauthUrl, qrDataUrl: await QRCode.toDataURL(otpauthUrl) };
  }

  /** Aktiviert MFA, wenn der Code zum vorbereiteten Secret passt. Gibt die Wiederherstellungscodes einmalig zurück. */
  async confirmSetup(userId: string, code: string): Promise<string[] | null> {
    const pending = await this.db.global.authToken.findFirst({
      where: { userId, type: 'MFA_SETUP', usedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    if (!pending?.payload) return null;
    const secret = this.box.decrypt(pending.payload);
    if (!authenticator.check(code, secret)) return null;
    const codes = Array.from({ length: RECOVERY_CODES }, () => randomToken(8).replace(/[-_]/g, 'x').slice(0, 10).toUpperCase());
    await this.db.global.$transaction([
      this.db.global.user.update({ where: { id: userId }, data: { mfaEnabled: true, mfaSecretEnc: this.box.encrypt(secret) } }),
      this.db.global.authToken.update({ where: { id: pending.id }, data: { usedAt: new Date() } }),
      this.db.global.mfaRecoveryCode.deleteMany({ where: { userId } }),
      this.db.global.mfaRecoveryCode.createMany({ data: codes.map((c) => ({ id: uuidv7(), userId, codeHash: hashToken(c) })) }),
    ]);
    return codes;
  }

  /** Prüft einen TOTP-Code oder einen (einmal verwendbaren) Wiederherstellungscode. */
  async verify(userId: string, code: string): Promise<boolean> {
    const user = await this.db.global.user.findUnique({ where: { id: userId } });
    if (!user?.mfaEnabled || !user.mfaSecretEnc) return false;
    const clean = code.replace(/\s/g, '');
    if (/^\d{6}$/.test(clean)) return authenticator.check(clean, this.box.decrypt(user.mfaSecretEnc));
    const codes = await this.db.global.mfaRecoveryCode.findMany({ where: { userId, usedAt: null } });
    const h = hashToken(clean.toUpperCase());
    const match = codes.find((c) => safeEqual(c.codeHash, h));
    if (!match) return false;
    const r = await this.db.global.mfaRecoveryCode.updateMany({ where: { id: match.id, usedAt: null }, data: { usedAt: new Date() } });
    return r.count === 1;
  }

  async disable(userId: string): Promise<void> {
    await this.db.global.$transaction([
      this.db.global.user.update({ where: { id: userId }, data: { mfaEnabled: false, mfaSecretEnc: null } }),
      this.db.global.mfaRecoveryCode.deleteMany({ where: { userId } }),
    ]);
  }
}
