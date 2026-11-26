import { Inject, Injectable, Logger } from '@nestjs/common';
import { type Prisma, uuidv7, type Tx } from '@fangevo/database';
import { type DhlAccountInput } from '@fangevo/shared';
import { APP_CONFIG, type AppConfig } from '../../../config';
import { AuditService } from '../../../core/audit/audit.service';
import { AppError } from '../../../core/http/errors';
import { type TenantContext } from '../../../core/http/context';
import { SecretBox } from '../../../core/security/crypto';
import { CompanyDb, type CompanyContext } from '../../common/company-db';
import { DocumentsService } from '../../documents/documents.service';
import { type CustomerSnapshot } from '../../orders/orders.service';
import {
  DHL_COUNTRIES,
  DhlClient,
  DhlError,
  type DhlAddress,
  type DhlShipmentRequest,
  type DhlUser,
  type FetchFn,
} from './dhl-client';

interface DhlConfig {
  active: boolean;
  gkpUser: string;
  billingNumber: string;
  billingNumberInternational: string | null;
  printFormat: string;
}

export interface DhlLabel {
  trackingNumber: string;
  labelPdf: Buffer;
  warnings: string[];
  /** Sendung bei DHL wieder stornieren (wenn der Versand in der Wawi doch nicht gebucht wird) */
  cancel: () => Promise<void>;
}

/**
 * DHL als Versanddienstleister (ADR-016): Zugang je Firma, Verbindungstest, Etikett fÃ¼r einen Auftrag.
 * Das Passwort des GeschÃ¤ftskundenportals liegt nur verschlÃ¼sselt in der Datenbank.
 */
@Injectable()
export class DhlService {
  private readonly logger = new Logger('DHL');
  private readonly box: SecretBox;
  private client: DhlClient | null = null;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(CompanyDb) private readonly cdb: CompanyDb,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(DocumentsService) private readonly documents: DocumentsService,
  ) {
    this.box = new SecretBox(config.APP_ENCRYPTION_KEY);
    this.useFetch();
  }

  /** Netzwerkzugriff austauschen (nur Tests: simuliertes DHL). */
  useFetch(fetchImpl?: FetchFn): void {
    this.client =
      this.config.DHL_API_KEY && this.config.DHL_API_SECRET
        ? new DhlClient(
            {
              apiKey: this.config.DHL_API_KEY,
              apiSecret: this.config.DHL_API_SECRET,
              env: this.config.DHL_ENV,
            },
            fetchImpl,
          )
        : null;
  }

  private api(): DhlClient {
    if (!this.client)
      throw new AppError(
        503,
        'INTEGRATION_NOT_CONFIGURED',
        'DHL ist auf diesem Server noch nicht eingerichtet (DHL_API_KEY/DHL_API_SECRET)',
      );
    return this.client;
  }

  private asAppError(e: unknown): AppError {
    if (e instanceof AppError) return e;
    if (e instanceof DhlError)
      return new AppError(e.kind === 'network' ? 502 : 422, 'UPSTREAM_ERROR', e.message);
    return new AppError(502, 'UPSTREAM_ERROR', `DHL: ${String(e)}`);
  }

  private async load(tx: Tx): Promise<{ cfg: DhlConfig; user: DhlUser } | null> {
    const row = await tx.carrierAccount.findFirst({ where: { carrier: 'dhl' } });
    if (!row?.secretsEnc) return null;
    const cfg = row.config as unknown as DhlConfig;
    const secrets = JSON.parse(this.box.decrypt(row.secretsEnc)) as { gkpPassword: string };
    return { cfg, user: { user: cfg.gkpUser, password: secrets.gkpPassword } };
  }

  /** Einstellungen fÃ¼r die OberflÃ¤che (ohne Passwort). */
  account(t: TenantContext) {
    return this.cdb.run(t, async (tx) => {
      const row = await tx.carrierAccount.findFirst({ where: { carrier: 'dhl' } });
      return {
        configured: !!this.client,
        env: this.config.DHL_ENV,
        account: row
          ? {
              ...(row.config as unknown as DhlConfig),
              hasPassword: !!row.secretsEnc,
              lastCheckedAt: row.lastCheckedAt,
              lastError: row.lastError,
            }
          : null,
      };
    });
  }

  save(t: TenantContext, input: DhlAccountInput) {
    return this.cdb.run(t, async (tx, c) => {
      const row = await tx.carrierAccount.findFirst({ where: { carrier: 'dhl' } });
      if (!input.gkpPassword && !row?.secretsEnc)
        throw new AppError(422, 'VALIDATION_FAILED', 'Passwort fehlt', [
          { path: 'gkpPassword', message: 'Passwort fehlt' },
        ]);
      const cfg: DhlConfig = {
        active: input.active,
        gkpUser: input.gkpUser,
        billingNumber: input.billingNumber,
        billingNumberInternational: input.billingNumberInternational ?? null,
        printFormat: input.printFormat,
      };
      const secretsEnc = input.gkpPassword
        ? this.box.encrypt(JSON.stringify({ gkpPassword: input.gkpPassword }))
        : row!.secretsEnc;
      const data = {
        config: cfg as unknown as Prisma.InputJsonValue,
        secretsEnc,
        updatedBy: c.user.id,
        lastError: null,
      };
      if (row) await tx.carrierAccount.update({ where: { id: row.id }, data });
      else
        await tx.carrierAccount.create({
          data: {
            ...data,
            id: uuidv7(),
            accountId: c.account.id,
            companyId: c.companyId,
            carrier: 'dhl',
          },
        });
      this.client?.forget(cfg.gkpUser);
      await this.audit.record(tx, {
        accountId: c.account.id,
        userId: c.user.id,
        companyId: c.companyId,
        action: 'carrier_account.saved',
        entityType: 'carrier_account',
        entityId: c.companyId,
        // Nie Zugangsdaten protokollieren
        data: { carrier: 'dhl', gkpUser: cfg.gkpUser, passwordChanged: !!input.gkpPassword },
        ip: c.ip,
      });
      return { ok: true };
    });
  }

  private async shipper(tx: Tx, c: CompanyContext): Promise<DhlAddress> {
    const s = await this.documents.sender(tx, c);
    if (!s.street || !s.postalCode || !s.city)
      throw new AppError(
        422,
        'VALIDATION_FAILED',
        'FÃ¼r DHL fehlt die Anschrift der Firma. Bitte unter Firmeneinstellungen ergÃ¤nzen',
      );
    if ((s.country ?? 'DE') !== 'DE')
      throw new AppError(422, 'VALIDATION_FAILED', 'DHL-Versand ist nur ab Deutschland mÃ¶glich');
    return {
      name1: (s.legalName || s.name).slice(0, 50),
      addressStreet: s.street,
      postalCode: s.postalCode,
      city: s.city,
      country: 'DEU',
      email: s.email ?? null,
    };
  }

  /** Verbindung prÃ¼fen: Anmeldung und eine Probe-Sendung im PrÃ¼fmodus (es entsteht nichts). */
  async test(t: TenantContext) {
    const ctx = await this.cdb.run(t, async (tx, c) => {
      const acc = await this.load(tx);
      if (!acc)
        throw new AppError(422, 'VALIDATION_FAILED', 'Bitte zuerst die DHL-Zugangsdaten speichern');
      return { acc, shipper: await this.shipper(tx, c) };
    });
    let error: string | null = null;
    let warnings: string[] = [];
    try {
      const r = await this.api().createShipment(
        ctx.acc.user,
        {
          product: 'V01PAK',
          billingNumber: ctx.acc.cfg.billingNumber,
          refNo: 'FangEvo-Verbindungstest',
          shipper: ctx.shipper,
          consignee: ctx.shipper,
          weightKg: '1',
        },
        { printFormat: ctx.acc.cfg.printFormat, validateOnly: true },
      );
      warnings = r.warnings;
    } catch (e) {
      error = this.asAppError(e).message;
    }
    await this.cdb.run(t, (tx) =>
      tx.carrierAccount.updateMany({
        where: { carrier: 'dhl' },
        data: { lastCheckedAt: new Date(), lastError: error },
      }),
    );
    return { ok: !error, env: this.config.DHL_ENV, error, warnings };
  }

  /**
   * DHL-Etikett fÃ¼r einen Auftrag anlegen (ein Paket). LÃ¤uft auÃŸerhalb der Versand-Transaktion;
   * scheitert der Versand danach, storniert der Aufrufer die Sendung Ã¼ber `cancel`.
   */
  async createLabel(
    t: TenantContext,
    orderId: string,
    parcel: {
      weightKg: string;
      lengthCm?: number | null;
      widthCm?: number | null;
      heightCm?: number | null;
    },
  ): Promise<DhlLabel> {
    const ctx = await this.cdb.run(t, async (tx, c) => {
      const acc = await this.load(tx);
      if (!acc || !acc.cfg.active)
        throw new AppError(
          422,
          'VALIDATION_FAILED',
          'DHL ist fÃ¼r diese Firma nicht eingerichtet (Packtisch â€º Versanddienstleister)',
        );
      const order = await tx.salesOrder.findUnique({ where: { id: orderId } });
      if (!order) throw new AppError(404, 'NOT_FOUND', 'Auftrag nicht gefunden');
      return { acc, order, shipper: await this.shipper(tx, c) };
    });
    const snap = ctx.order.customerSnapshot as unknown as CustomerSnapshot;
    const to = snap.shipping ?? snap.billing;
    if (!to?.street || !to.postalCode || !to.city)
      throw new AppError(422, 'VALIDATION_FAILED', 'FÃ¼r das DHL-Etikett fehlt die Lieferadresse');
    const country = DHL_COUNTRIES[(to.country ?? 'DE').toUpperCase()];
    if (!country)
      throw new AppError(
        422,
        'VALIDATION_FAILED',
        `DHL-Versand nach ${to.country} braucht Zollangaben und wird noch nicht unterstÃ¼tzt. Bitte â€žManuellâ€œ wÃ¤hlen und das Etikett im DHL-GeschÃ¤ftskundenportal erstellen`,
      );
    const national = country === 'DEU';
    const billingNumber = national
      ? ctx.acc.cfg.billingNumber
      : ctx.acc.cfg.billingNumberInternational;
    if (!billingNumber)
      throw new AppError(
        422,
        'VALIDATION_FAILED',
        'FÃ¼r den EU-Versand fehlt die Abrechnungsnummer â€žDHL Paket Internationalâ€œ in den DHL-Einstellungen',
      );
    if (Number(parcel.weightKg) <= 0)
      throw new AppError(422, 'VALIDATION_FAILED', 'FÃ¼r DHL bitte das Gewicht des Pakets angeben');
    const dims = parcel.lengthCm && parcel.widthCm && parcel.heightCm;
    const req: DhlShipmentRequest = {
      product: national ? 'V01PAK' : 'V53WPAK',
      billingNumber,
      refNo: `Auftrag ${ctx.order.number}`.padEnd(8, ' ').slice(0, 35),
      shipper: ctx.shipper,
      consignee: {
        name1: (to.name ?? snap.displayName ?? '').slice(0, 50),
        name2: to.name2?.slice(0, 50) ?? null,
        addressStreet: to.street,
        postalCode: to.postalCode,
        city: to.city,
        country,
        // E-Mail nur fÃ¼r die PaketankÃ¼ndigung von DHL an den EmpfÃ¤nger
        email: snap.email ?? null,
      },
      weightKg: parcel.weightKg,
      dimCm: dims
        ? { length: parcel.lengthCm!, width: parcel.widthCm!, height: parcel.heightCm! }
        : null,
    };
    try {
      const r = await this.api().createShipment(ctx.acc.user, req, {
        printFormat: ctx.acc.cfg.printFormat,
      });
      return {
        trackingNumber: r.shipmentNo,
        labelPdf: r.labelPdf,
        warnings: r.warnings,
        cancel: async () => {
          try {
            await this.api().deleteShipment(ctx.acc.user, r.shipmentNo);
          } catch (e) {
            // Nicht stornierbar: sichtbar machen, die Sendung wird bei DHL ohne Einlieferung nicht berechnet
            this.logger.error(
              `DHL-Sendung ${r.shipmentNo} konnte nicht storniert werden: ${String(e)}`,
            );
          }
        },
      };
    } catch (e) {
      throw this.asAppError(e);
    }
  }
}
