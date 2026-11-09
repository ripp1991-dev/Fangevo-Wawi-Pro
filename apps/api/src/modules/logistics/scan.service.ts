import { Inject, Injectable } from '@nestjs/common';
import { uuidv7 } from '@fangevo/database';
import { AuditService } from '../../core/audit/audit.service';
import { AppError, Errors } from '../../core/http/errors';
import { type TenantContext } from '../../core/http/context';
import { CompanyDb } from '../common/company-db';

/**
 * Scannen: löst einen Code zu Artikel (GTIN, Artikelnummer, Zusatz-Barcode) oder Lagerplatz auf
 * und liefert den Bestand je Lagerort, Charge und Seriennummer. Pflege zusätzlicher Barcodes.
 */
@Injectable()
export class ScanService {
  constructor(
    @Inject(CompanyDb) private readonly cdb: CompanyDb,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  resolve(t: TenantContext, raw: string) {
    return this.cdb.run(t, async (tx) => {
      const code = raw.trim();
      if (!code) throw new AppError(422, 'VALIDATION_FAILED', 'Kein Code');
      const extra = await tx.articleBarcode.findFirst({ where: { code } });
      const article =
        (extra ? await tx.article.findUnique({ where: { id: extra.articleId } }) : null) ??
        (await tx.article.findFirst({
          where: {
            archivedAt: null,
            OR: [{ gtin: code }, { number: { equals: code, mode: 'insensitive' } }],
          },
        }));
      const warehouses = await tx.warehouse.findMany({
        select: { id: true, code: true, name: true },
      });
      if (article) {
        const levels = await tx.stockLevel.findMany({
          where: { articleId: article.id, NOT: { quantity: 0 } },
          orderBy: [{ bestBefore: 'asc' }, { quantity: 'desc' }],
        });
        const locations = await tx.storageLocation.findMany({
          where: { id: { in: levels.map((l) => l.locationId).filter((x): x is string => !!x) } },
          select: { id: true, code: true },
        });
        const reserved = await tx.stockReservation.aggregate({
          where: { articleId: article.id },
          _sum: { quantity: true },
        });
        return {
          type: 'article' as const,
          article: {
            id: article.id,
            number: article.number,
            name: article.name,
            unit: article.unit,
            gtin: article.gtin,
            kind: article.kind,
            trackBatches: article.trackBatches,
            trackSerials: article.trackSerials,
            trackBestBefore: article.trackBestBefore,
          },
          reserved: (reserved._sum.quantity ?? 0).toString(),
          levels: levels.map((l) => ({
            warehouse: warehouses.find((w) => w.id === l.warehouseId) ?? null,
            locationId: l.locationId,
            locationCode: locations.find((x) => x.id === l.locationId)?.code ?? null,
            batch: l.batch,
            serialNumber: l.serialNumber,
            bestBefore: l.bestBefore,
            quantity: l.quantity.toString(),
          })),
        };
      }
      const location = await tx.storageLocation.findFirst({
        where: { code: { equals: code, mode: 'insensitive' }, archivedAt: null },
      });
      if (location) {
        const levels = await tx.stockLevel.findMany({
          where: { locationId: location.id, NOT: { quantity: 0 } },
        });
        const articles = await tx.article.findMany({
          where: { id: { in: levels.map((l) => l.articleId) } },
          select: { id: true, number: true, name: true, unit: true },
        });
        return {
          type: 'location' as const,
          location: {
            id: location.id,
            code: location.code,
            warehouse: warehouses.find((w) => w.id === location.warehouseId) ?? null,
          },
          levels: levels.map((l) => ({
            article: articles.find((a) => a.id === l.articleId) ?? null,
            batch: l.batch,
            serialNumber: l.serialNumber,
            bestBefore: l.bestBefore,
            quantity: l.quantity.toString(),
          })),
        };
      }
      throw Errors.notFound(`Kein Artikel und kein Lagerplatz mit dem Code „${code}“`);
    });
  }

  barcodes(t: TenantContext, articleId: string) {
    return this.cdb.run(t, async (tx) => {
      if (!(await tx.article.count({ where: { id: articleId } }))) throw Errors.notFound();
      return tx.articleBarcode.findMany({ where: { articleId }, orderBy: { createdAt: 'asc' } });
    });
  }

  addBarcode(t: TenantContext, articleId: string, code: string) {
    return this.cdb.run(t, async (tx, c) => {
      const a = await tx.article.findUnique({ where: { id: articleId } });
      if (!a) throw Errors.notFound();
      const clash =
        (await tx.articleBarcode.findFirst({ where: { code } })) ??
        (await tx.article.findFirst({ where: { OR: [{ gtin: code }, { number: code }] } }));
      if (clash)
        throw new AppError(409, 'CONFLICT', 'Dieser Code ist bereits einem Artikel zugeordnet', [
          { path: 'code', message: 'Bereits vergeben' },
        ]);
      const b = await tx.articleBarcode.create({
        data: { id: uuidv7(), accountId: c.account.id, companyId: c.companyId, articleId, code },
      });
      await this.audit.record(tx, {
        accountId: c.account.id,
        userId: c.user.id,
        companyId: c.companyId,
        action: 'article.barcode_added',
        entityType: 'article',
        entityId: articleId,
        data: { code },
        ip: c.ip,
      });
      return b;
    });
  }

  removeBarcode(t: TenantContext, articleId: string, id: string) {
    return this.cdb.run(t, async (tx, c) => {
      const r = await tx.articleBarcode.deleteMany({ where: { id, articleId } });
      if (!r.count) throw Errors.notFound();
      await this.audit.record(tx, {
        accountId: c.account.id,
        userId: c.user.id,
        companyId: c.companyId,
        action: 'article.barcode_removed',
        entityType: 'article',
        entityId: articleId,
        data: { id },
        ip: c.ip,
      });
    });
  }
}
