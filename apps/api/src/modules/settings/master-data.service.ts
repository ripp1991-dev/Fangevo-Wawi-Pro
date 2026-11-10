import { Inject, Injectable } from '@nestjs/common';
import { uuidv7, type Tx } from '@fangevo/database';
import { AuditService } from '../../core/audit/audit.service';
import { type CompanyContext } from '../common/company-db';

/**
 * Auswahllisten der Firma, die andere Module (z. B. FangEvo Import) bei Bedarf anlegen dürfen.
 * Gleiche Regeln und Protokollierung wie in den Firmeneinstellungen.
 */
@Injectable()
export class MasterDataService {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  /** Kategoriepfad „A > B > C“ finden; fehlende Ebenen auf Wunsch anlegen. */
  async categoryPath(
    tx: Tx,
    c: CompanyContext,
    path: string,
    create: boolean,
  ): Promise<string | null> {
    const parts = path
      .split(/\s*[>/|]\s*/)
      .map((p) => p.trim())
      .filter(Boolean)
      .slice(0, 10);
    let parentId: string | null = null;
    for (const name of parts) {
      const found: { id: string } | null = await tx.category.findFirst({
        where: { parentId, name: { equals: name, mode: 'insensitive' }, archivedAt: null },
        select: { id: true },
      });
      if (found) {
        parentId = found.id;
        continue;
      }
      if (!create) return null;
      const id = uuidv7();
      await tx.category.create({
        data: { id, accountId: c.account.id, companyId: c.companyId, name, parentId, position: 0 },
      });
      await this.log(tx, c, 'category.created', 'category', id, {
        name,
        parentId,
        source: 'import',
      });
      parentId = id;
    }
    return parentId;
  }

  async manufacturer(
    tx: Tx,
    c: CompanyContext,
    name: string,
    create: boolean,
  ): Promise<string | null> {
    const found = await tx.manufacturer.findFirst({
      where: { name: { equals: name.trim(), mode: 'insensitive' } },
      select: { id: true },
    });
    if (found || !create) return found?.id ?? null;
    const id = uuidv7();
    await tx.manufacturer.create({
      data: { id, accountId: c.account.id, companyId: c.companyId, name: name.trim() },
    });
    await this.log(tx, c, 'manufacturer.created', 'manufacturer', id, { name, source: 'import' });
    return id;
  }

  async location(
    tx: Tx,
    c: CompanyContext,
    warehouseId: string,
    code: string,
    create: boolean,
  ): Promise<string | null> {
    const found = await tx.storageLocation.findFirst({
      where: { warehouseId, code: { equals: code.trim(), mode: 'insensitive' }, archivedAt: null },
      select: { id: true },
    });
    if (found || !create) return found?.id ?? null;
    const id = uuidv7();
    await tx.storageLocation.create({
      data: { id, accountId: c.account.id, companyId: c.companyId, warehouseId, code: code.trim() },
    });
    await this.log(tx, c, 'storage_location.created', 'storage_location', id, {
      warehouseId,
      code,
      source: 'import',
    });
    return id;
  }

  private log(
    tx: Tx,
    c: CompanyContext,
    action: string,
    entityType: string,
    entityId: string,
    data: Record<string, unknown>,
  ) {
    return this.audit.record(tx, {
      accountId: c.account.id,
      userId: c.user.id,
      companyId: c.companyId,
      action,
      entityType,
      entityId,
      data,
      ip: c.ip,
    });
  }
}
