import { Inject, Injectable } from '@nestjs/common';
import { type Tx, uuidv7 } from '@fangevo/database';
import { AccessService } from '../../core/access/access.service';
import { AuditService } from '../../core/audit/audit.service';
import { SessionService } from '../../core/auth/session.service';
import { Database } from '../../core/database/database.service';
import { AppError, Errors } from '../../core/http/errors';
import { type TenantContext } from '../../core/http/context';
import {
  burnPasswordCheck,
  hashPassword,
  hashToken,
  randomToken,
  safeEqual,
  verifyPassword,
} from '../../core/security/crypto';
import { CompanyDb } from '../common/company-db';

/** Cookie für freigegebene Lagerrechner (httpOnly, nur der Server kann es lesen). */
export const DEVICE_COOKIE = 'fe_packing_device';
export const DEVICE_COOKIE_MAX_AGE_SEC = 365 * 24 * 3600;
/** PIN-Sitzungen laufen spätestens nach einer Schicht ab. */
export const PIN_SESSION_MAX_AGE_SEC = 12 * 3600;
/** Nach so vielen falschen PINs wird die PIN der Person gesperrt … */
export const PIN_MAX_ATTEMPTS = 5;
/** … für diese Dauer. */
export const PIN_LOCK_MS = 15 * 60 * 1000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface DeviceRef {
  accountId: string;
  companyId: string;
  deviceId: string;
  secret: string;
}

/** Cookie-Wert: Account, Firma und Gerät (nicht geheim) plus Zufallstoken (geheim, nur als Hash gespeichert). */
function parseDeviceCookie(value: string | undefined): DeviceRef | null {
  if (!value || value.length > 300) return null;
  const [accountId, companyId, deviceId, secret] = value.split('.');
  if (!accountId || !companyId || !deviceId || !secret) return null;
  if (![accountId, companyId, deviceId].every((x) => UUID.test(x))) return null;
  if (!/^[\w-]{20,100}$/.test(secret)) return null;
  return { accountId, companyId, deviceId, secret };
}

const invalidDevice = () =>
  new AppError(
    401,
    'UNAUTHENTICATED',
    'Dieses Gerät ist nicht für die PIN-Anmeldung freigegeben. Bitte den Lagerleiter, das Gerät freizugeben.',
  );

/**
 * Touch-Packtisch: Lagerrechner für die PIN-Anmeldung freigeben und Packer per PIN anmelden.
 * Die PIN-Sitzung ist eine normale Sitzung mit Einschränkung (scope "packing"): nur die Firma
 * des Geräts und nur Endpunkte mit @AllowPackingScope (Prüfung im AccessGuard).
 */
@Injectable()
export class PackingPinService {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(CompanyDb) private readonly cdb: CompanyDb,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(AccessService) private readonly access: AccessService,
  ) {}

  // ───── Geräte (Lagerleiter) ─────

  /** Gerät freigeben. Liefert einmalig den Cookie-Wert (das Token wird nur als Hash gespeichert). */
  registerDevice(t: TenantContext, input: { stationId: string; name: string }) {
    return this.cdb.run(t, async (tx, c) => {
      const station = await tx.packingStation.findUnique({ where: { id: input.stationId } });
      if (!station || station.archivedAt)
        throw new AppError(422, 'VALIDATION_FAILED', 'Packplatz nicht gefunden', [
          { path: 'stationId', message: 'Packplatz nicht gefunden' },
        ]);
      const secret = randomToken();
      const device = await tx.packingDevice.create({
        data: {
          id: uuidv7(),
          accountId: c.account.id,
          companyId: c.companyId,
          stationId: station.id,
          name: input.name,
          tokenHash: hashToken(secret),
          createdBy: c.user.id,
        },
      });
      await this.audit.record(tx, {
        accountId: c.account.id,
        userId: c.user.id,
        companyId: c.companyId,
        action: 'packing_device.registered',
        entityType: 'packing_device',
        entityId: device.id,
        data: { name: device.name, station: station.name },
        ip: c.ip,
      });
      return {
        device: this.publicDevice(device),
        cookie: [c.account.id, c.companyId, device.id, secret].join('.'),
      };
    });
  }

  listDevices(t: TenantContext) {
    return this.cdb.run(t, async (tx) => {
      const devices = await tx.packingDevice.findMany({
        orderBy: [{ revokedAt: 'asc' }, { createdAt: 'desc' }],
        take: 200,
      });
      const stations = await tx.packingStation.findMany({
        where: { id: { in: [...new Set(devices.map((d) => d.stationId))] } },
        select: { id: true, name: true },
      });
      return devices.map((d) => ({
        ...this.publicDevice(d),
        stationName: stations.find((s) => s.id === d.stationId)?.name ?? null,
      }));
    });
  }

  async revokeDevice(t: TenantContext, id: string) {
    await this.cdb.run(t, async (tx, c) => {
      const d = await tx.packingDevice.findUnique({ where: { id } });
      if (!d) throw Errors.notFound();
      if (!d.revokedAt)
        await tx.packingDevice.update({ where: { id }, data: { revokedAt: new Date() } });
      await this.audit.record(tx, {
        accountId: c.account.id,
        userId: c.user.id,
        companyId: c.companyId,
        action: 'packing_device.revoked',
        entityType: 'packing_device',
        entityId: id,
        data: { name: d.name },
        ip: c.ip,
      });
    });
    await this.sessions.revokeForDevice(id);
  }

  /** Packplatz der aktuellen PIN-Sitzung (bzw. des Geräts). */
  currentDevice(t: TenantContext) {
    if (!t.scope) throw Errors.notFound('Keine Anmeldung über ein Packtisch-Gerät');
    return this.cdb.run(t, async (tx) => {
      const d = await tx.packingDevice.findUnique({ where: { id: t.scope!.deviceId } });
      if (!d || d.revokedAt) throw invalidDevice();
      const station = await tx.packingStation.findUnique({ where: { id: d.stationId } });
      return {
        device: this.publicDevice(d),
        station: station && !station.archivedAt ? station : null,
      };
    });
  }

  // ───── Anmeldung am Gerät (öffentlich, nur mit gültigem Geräte-Cookie) ─────

  private async resolveDevice(cookie: string | undefined) {
    const ref = parseDeviceCookie(cookie);
    if (!ref) throw invalidDevice();
    const ctx = { accountId: ref.accountId, userId: null, companyId: ref.companyId };
    const found = await this.db.tenant(ctx, async (tx) => {
      const d = await tx.packingDevice.findUnique({ where: { id: ref.deviceId } });
      if (!d || d.revokedAt || !safeEqual(d.tokenHash, hashToken(ref.secret))) return null;
      const [station, company] = await Promise.all([
        tx.packingStation.findUnique({ where: { id: d.stationId } }),
        tx.company.findUnique({
          where: { id: d.companyId },
          select: { name: true, archivedAt: true },
        }),
      ]);
      if (!station || station.archivedAt || !company || company.archivedAt) return null;
      if (!d.lastSeenAt || Date.now() - d.lastSeenAt.getTime() > 5 * 60_000)
        await tx.packingDevice.update({ where: { id: d.id }, data: { lastSeenAt: new Date() } });
      return { device: d, station, companyName: company.name };
    });
    if (!found) throw invalidDevice();
    return { ref, ...found };
  }

  /** Darf die Person an diesem Gerät packen (aktives Mitglied, Recht, Firmenzugriff)? */
  private async canPackHere(userId: string, accountId: string, companyId: string) {
    const acc = await this.access.loadAccountContext(userId, accountId);
    if (!acc || !acc.permissions.has('packing.execute')) return false;
    if (acc.accessMode === 'none') return false;
    return acc.allCompanies
      ? this.access.companyExists(userId, accountId, companyId)
      : acc.companyIds.includes(companyId);
  }

  /** Startbildschirm am Gerät: Packplatz und Personen mit PIN, die hier packen dürfen. */
  async deviceInfo(cookie: string | undefined) {
    const { ref, device, station, companyName } = await this.resolveDevice(cookie);
    const pins = await this.db.tenant({ accountId: ref.accountId, userId: null }, (tx) =>
      tx.packerPin.findMany({ select: { userId: true }, take: 500 }),
    );
    const users = await this.db.global.user.findMany({
      where: { id: { in: pins.map((p) => p.userId) } },
      select: { id: true, name: true },
    });
    const allowed: { userId: string; name: string }[] = [];
    for (const u of users)
      if (await this.canPackHere(u.id, ref.accountId, ref.companyId))
        allowed.push({ userId: u.id, name: u.name });
    allowed.sort((a, b) => a.name.localeCompare(b.name, 'de'));
    return {
      device: { id: device.id, name: device.name },
      station: { id: station.id, name: station.name },
      companyName,
      packers: allowed,
    };
  }

  /** PIN prüfen und eine PIN-Sitzung für den Packtisch anlegen. */
  async login(
    cookie: string | undefined,
    input: { userId: string; pin: string },
    client: { ip: string | null; userAgent: string | null },
  ) {
    const { ref, device } = await this.resolveDevice(cookie);
    const ctx = { accountId: ref.accountId, userId: null, companyId: ref.companyId };
    const wrong = () => new AppError(401, 'INVALID_CREDENTIALS', 'PIN falsch');

    const pin = await this.db.tenant(ctx, (tx) =>
      tx.packerPin.findUnique({
        where: { accountId_userId: { accountId: ref.accountId, userId: input.userId } },
      }),
    );
    if (!pin) {
      await burnPasswordCheck(input.pin); // gleiche Antwortzeit wie bei falscher PIN
      throw wrong();
    }
    if (pin.lockedUntil && pin.lockedUntil.getTime() > Date.now())
      throw new AppError(
        429,
        'RATE_LIMITED',
        `Zu viele falsche Eingaben. Die PIN ist bis ${pin.lockedUntil.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' })} Uhr gesperrt.`,
      );

    const ok = await verifyPassword(pin.pinHash, input.pin);
    if (!ok) {
      const attempts = pin.failedAttempts + 1;
      const lock = attempts >= PIN_MAX_ATTEMPTS;
      await this.db.tenant(ctx, async (tx) => {
        await tx.packerPin.update({
          where: { id: pin.id },
          data: lock
            ? { failedAttempts: 0, lockedUntil: new Date(Date.now() + PIN_LOCK_MS) }
            : { failedAttempts: attempts },
        });
        await this.auditLogin(tx, ref, input.userId, device.id, 'packer_pin.failed', client.ip, {
          locked: lock,
        });
      });
      if (lock)
        throw new AppError(
          429,
          'RATE_LIMITED',
          'Zu viele falsche Eingaben. Die PIN ist für 15 Minuten gesperrt.',
        );
      throw wrong();
    }

    if (!(await this.canPackHere(input.userId, ref.accountId, ref.companyId)))
      throw new AppError(403, 'PERMISSION_DENIED', 'Keine Berechtigung für diesen Packtisch');

    await this.db.tenant(ctx, async (tx) => {
      if (pin.failedAttempts || pin.lockedUntil)
        await tx.packerPin.update({
          where: { id: pin.id },
          data: { failedAttempts: 0, lockedUntil: null },
        });
      await this.auditLogin(tx, ref, input.userId, device.id, 'packer_pin.login', client.ip, {});
    });
    const { token } = await this.sessions.create({
      userId: input.userId,
      accountId: ref.accountId,
      mfaPending: false,
      ip: client.ip,
      userAgent: client.userAgent,
      scope: { kind: 'packing', companyId: ref.companyId, deviceId: device.id },
      maxAgeSec: PIN_SESSION_MAX_AGE_SEC,
    });
    return { token, companyId: ref.companyId, maxAgeSec: PIN_SESSION_MAX_AGE_SEC };
  }

  private auditLogin(
    tx: Tx,
    ref: DeviceRef,
    userId: string,
    deviceId: string,
    action: string,
    ip: string | null,
    data: Record<string, unknown>,
  ) {
    return this.audit.record(tx, {
      accountId: ref.accountId,
      userId,
      companyId: ref.companyId,
      action,
      entityType: 'packing_device',
      entityId: deviceId,
      data,
      ip,
    });
  }

  // ───── PIN festlegen ─────

  /** Eigene PIN festlegen (mit Passwort bestätigt). */
  async setOwnPin(t: TenantContext, pin: string, password: string) {
    const user = await this.db.global.user.findUnique({
      where: { id: t.user.id },
      select: { passwordHash: true },
    });
    if (!user?.passwordHash || !(await verifyPassword(user.passwordHash, password)))
      throw new AppError(422, 'VALIDATION_FAILED', 'Passwort falsch', [
        { path: 'password', message: 'Passwort falsch' },
      ]);
    await this.storePin(t, t.user.id, pin);
  }

  /** PIN für ein Mitglied festlegen (Administration). */
  async setMemberPin(t: TenantContext, membershipId: string, pin: string) {
    const m = await this.db.tenant({ accountId: t.account.id, userId: t.user.id }, (tx) =>
      tx.membership.findFirst({ where: { id: membershipId, accountId: t.account.id } }),
    );
    if (!m) throw Errors.notFound();
    await this.storePin(t, m.userId, pin);
  }

  async removeMemberPin(t: TenantContext, membershipId: string) {
    await this.db.tenant({ accountId: t.account.id, userId: t.user.id }, async (tx) => {
      const m = await tx.membership.findFirst({
        where: { id: membershipId, accountId: t.account.id },
      });
      if (!m) throw Errors.notFound();
      await tx.packerPin.deleteMany({ where: { userId: m.userId } });
      await this.audit.record(tx, {
        accountId: t.account.id,
        userId: t.user.id,
        companyId: null,
        action: 'packer_pin.removed',
        entityType: 'user',
        entityId: m.userId,
        data: {},
        ip: t.ip,
      });
    });
  }

  /** Hat die Person eine PIN? (für die Anzeige, nie die PIN selbst) */
  async hasPin(t: TenantContext, userId: string) {
    return this.db.tenant(
      { accountId: t.account.id, userId: t.user.id },
      async (tx) =>
        !!(await tx.packerPin.findUnique({
          where: { accountId_userId: { accountId: t.account.id, userId } },
          select: { id: true },
        })),
    );
  }

  private async storePin(t: TenantContext, userId: string, pin: string) {
    const pinHash = await hashPassword(pin);
    await this.db.tenant({ accountId: t.account.id, userId: t.user.id }, async (tx) => {
      await tx.packerPin.upsert({
        where: { accountId_userId: { accountId: t.account.id, userId } },
        create: {
          id: uuidv7(),
          accountId: t.account.id,
          userId,
          pinHash,
          updatedBy: t.user.id,
        },
        update: { pinHash, failedAttempts: 0, lockedUntil: null, updatedBy: t.user.id },
      });
      await this.audit.record(tx, {
        accountId: t.account.id,
        userId: t.user.id,
        companyId: null,
        action: 'packer_pin.set',
        entityType: 'user',
        entityId: userId,
        data: {},
        ip: t.ip,
      });
    });
  }

  private publicDevice(d: {
    id: string;
    name: string;
    stationId: string;
    createdAt: Date;
    lastSeenAt: Date | null;
    revokedAt: Date | null;
  }) {
    return {
      id: d.id,
      name: d.name,
      stationId: d.stationId,
      createdAt: d.createdAt,
      lastSeenAt: d.lastSeenAt,
      revokedAt: d.revokedAt,
    };
  }
}
