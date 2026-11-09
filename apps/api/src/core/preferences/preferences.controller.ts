import { Body, Controller, Get, HttpCode, Inject, Param, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PREFERENCE_SCHEMAS, type PreferenceKey } from '@fangevo/shared';
import { uuidv7, type Tx } from '@fangevo/database';
import { Database } from '../database/database.service';
import { AppError } from '../http/errors';
import { RequirePermission, Tenant, type TenantContext } from '../http/context';

function parse(key: string, body: unknown): { key: PreferenceKey; value: object } {
  if (!(key in PREFERENCE_SCHEMAS)) throw new AppError(404, 'NOT_FOUND', 'Unbekannte Einstellung');
  const r = PREFERENCE_SCHEMAS[key as PreferenceKey].safeParse(body);
  if (!r.success)
    throw new AppError(
      422,
      'VALIDATION_FAILED',
      'Ungültige Einstellung',
      r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  return { key: key as PreferenceKey, value: r.data };
}

async function put(
  tx: Tx,
  accountId: string,
  userId: string | null,
  key: string,
  value: object,
): Promise<void> {
  const existing = await tx.preference.findFirst({ where: { accountId, userId, key } });
  if (existing) await tx.preference.update({ where: { id: existing.id }, data: { value } });
  else await tx.preference.create({ data: { id: uuidv7(), accountId, userId, key, value } });
}

/**
 * Einstellungen (z. B. Menü). Persönliche Werte überschreiben den Account-Standard,
 * den Personen mit account.manage festlegen.
 */
@ApiTags('Einstellungen')
@Controller()
export class PreferencesController {
  constructor(@Inject(Database) private readonly db: Database) {}

  @Get('preferences/:key')
  get(@Tenant() t: TenantContext, @Param('key') key: string) {
    parse(key, {});
    return this.db.tenant({ accountId: t.account.id, userId: t.user.id }, async (tx) => {
      const rows = await tx.preference.findMany({
        where: { key, OR: [{ userId: t.user.id }, { userId: null }] },
      });
      const mine = rows.find((r) => r.userId === t.user.id)?.value ?? null;
      const accountDefault = rows.find((r) => r.userId === null)?.value ?? null;
      return { value: mine ?? accountDefault, personal: mine, accountDefault };
    });
  }

  @Put('preferences/:key')
  @HttpCode(204)
  async set(@Tenant() t: TenantContext, @Param('key') key: string, @Body() body: unknown) {
    const p = parse(key, body);
    await this.db.tenant({ accountId: t.account.id, userId: t.user.id }, (tx) =>
      put(tx, t.account.id, t.user.id, p.key, p.value),
    );
  }

  /** Persönliche Anpassung verwerfen und wieder den Account-Standard verwenden. */
  @Put('preferences/:key/reset')
  @HttpCode(204)
  async reset(@Tenant() t: TenantContext, @Param('key') key: string) {
    parse(key, {});
    await this.db.tenant({ accountId: t.account.id, userId: t.user.id }, (tx) =>
      tx.preference.deleteMany({ where: { userId: t.user.id, key } }),
    );
  }

  @Put('admin/preferences/:key')
  @HttpCode(204)
  @RequirePermission('account.manage')
  async setDefault(@Tenant() t: TenantContext, @Param('key') key: string, @Body() body: unknown) {
    const p = parse(key, body);
    await this.db.tenant({ accountId: t.account.id, userId: t.user.id }, (tx) =>
      put(tx, t.account.id, null, p.key, p.value),
    );
  }
}
