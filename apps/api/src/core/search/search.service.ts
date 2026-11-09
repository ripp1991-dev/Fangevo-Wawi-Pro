import { Inject, Injectable } from '@nestjs/common';
import { Prisma, type Tx } from '@fangevo/database';
import { type Permission } from '@fangevo/shared';
import { Database } from '../database/database.service';
import { type TenantContext } from '../http/context';

export interface SearchDoc {
  entityType: 'company' | 'member' | 'role';
  entityId: string;
  companyId?: string | null;
  permission: Permission;
  title: string;
  subtitle?: string | null;
  body?: string | null;
  url: string;
  archived?: boolean;
}

export interface SearchHit {
  entityType: string;
  entityId: string;
  title: string;
  subtitle: string | null;
  url: string;
}

/** Wörter für die Präfixsuche (nur Buchstaben/Ziffern, keine tsquery-Sonderzeichen). */
export function toPrefixQuery(q: string): string | null {
  const words = q
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 0)
    .slice(0, 8);
  return words.length ? words.map((w) => `${w}:*`).join(' & ') : null;
}

/**
 * Globale Suche. Der Index wird in derselben Transaktion wie die Änderung gepflegt.
 * Abfragen beachten Mandant (RLS), Rechte und Firmenzugriff.
 */
@Injectable()
export class SearchService {
  constructor(@Inject(Database) private readonly db: Database) {}

  async upsert(tx: Tx, accountId: string, d: SearchDoc): Promise<void> {
    const data = {
      companyId: d.companyId ?? null,
      permission: d.permission,
      title: d.title,
      subtitle: d.subtitle ?? null,
      body: d.body ?? null,
      url: d.url,
      archived: d.archived ?? false,
    };
    await tx.searchDocument.upsert({
      where: {
        accountId_entityType_entityId: {
          accountId,
          entityType: d.entityType,
          entityId: d.entityId,
        },
      },
      create: { accountId, entityType: d.entityType, entityId: d.entityId, ...data },
      update: data,
    });
  }

  indexMember(
    tx: Tx,
    accountId: string,
    m: { id: string; disabled: boolean; user: { name: string; email: string } },
  ): Promise<void> {
    return this.upsert(tx, accountId, {
      entityType: 'member',
      entityId: m.id,
      permission: 'users.read',
      title: m.user.name,
      subtitle: m.user.email,
      url: `/admin/members?id=${m.id}`,
      archived: m.disabled,
    });
  }

  indexRole(
    tx: Tx,
    accountId: string,
    r: { id: string; name: string; description: string | null },
  ): Promise<void> {
    return this.upsert(tx, accountId, {
      entityType: 'role',
      entityId: r.id,
      permission: 'roles.read',
      title: r.name,
      subtitle: r.description,
      url: `/admin/roles?id=${r.id}`,
    });
  }

  indexCompanyBasic(tx: Tx, accountId: string, c: { id: string; name: string }): Promise<void> {
    return this.upsert(tx, accountId, {
      entityType: 'company',
      entityId: c.id,
      companyId: c.id,
      permission: 'companies.read',
      title: c.name,
      url: `/admin/companies?id=${c.id}`,
    });
  }

  async remove(
    tx: Tx,
    accountId: string,
    entityType: SearchDoc['entityType'],
    entityId: string,
  ): Promise<void> {
    await tx.searchDocument.deleteMany({ where: { accountId, entityType, entityId } });
  }

  async search(t: TenantContext, q: string, limit = 20): Promise<SearchHit[]> {
    const prefix = toPrefixQuery(q);
    if (!prefix) return [];
    const perms = [...t.account.permissions];
    if (!perms.length) return [];
    const companies = t.account.companyIds;
    const needle = q.toLowerCase().slice(0, 100);
    return this.db.tenant(
      { accountId: t.account.id, userId: t.user.id },
      (tx) =>
        tx.$queryRaw<SearchHit[]>`
        SELECT entity_type AS "entityType", entity_id::text AS "entityId", title, subtitle, url
        FROM search_documents
        WHERE NOT archived
          AND permission = ANY(${perms}::text[])
          AND (company_id IS NULL OR company_id = ANY(${companies}::uuid[]))
          AND (
            to_tsvector('german', coalesce(title, '') || ' ' || coalesce(subtitle, '') || ' ' || coalesce(body, '')) @@ to_tsquery('german', ${prefix})
            OR to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(subtitle, '') || ' ' || coalesce(body, '')) @@ to_tsquery('simple', ${prefix})
            OR lower(title) % ${needle}
          )
        ORDER BY (lower(title) LIKE ${needle + '%'}) DESC, similarity(lower(title), ${needle}) DESC, title
        LIMIT ${Prisma.raw(String(Math.min(Math.max(limit, 1), 50)))}`,
    );
  }
}
