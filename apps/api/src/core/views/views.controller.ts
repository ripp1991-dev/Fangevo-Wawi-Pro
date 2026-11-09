import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { TABLE_KEYS, savedViewInputSchema } from '@fangevo/shared';
import { uuidv7 } from '@fangevo/database';
import { Database } from '../database/database.service';
import { AppError, Errors } from '../http/errors';
import { Tenant, type TenantContext } from '../http/context';
import { ApiZodBody, uuidParam, zodPipe } from '../http/zod';

const listSchema = z.object({ table: z.enum(TABLE_KEYS) });

/** Gespeicherte Tabellenansichten: persönlich oder für alle im Account freigegeben. */
@ApiTags('Gespeicherte Ansichten')
@Controller('views')
export class ViewsController {
  constructor(@Inject(Database) private readonly db: Database) {}

  @Get()
  list(@Tenant() t: TenantContext, @Query(zodPipe(listSchema)) q: z.infer<typeof listSchema>) {
    return this.db.tenant({ accountId: t.account.id, userId: t.user.id }, async (tx) => {
      const rows = await tx.savedView.findMany({
        where: { tableKey: q.table, OR: [{ userId: t.user.id }, { shared: true }] },
        orderBy: { name: 'asc' },
      });
      return rows.map((v) => ({ ...v, mine: v.userId === t.user.id }));
    });
  }

  @Post()
  @ApiZodBody(savedViewInputSchema)
  create(
    @Tenant() t: TenantContext,
    @Body(zodPipe(savedViewInputSchema)) body: z.infer<typeof savedViewInputSchema>,
  ) {
    return this.db.tenant({ accountId: t.account.id, userId: t.user.id }, async (tx) => {
      const count = await tx.savedView.count({ where: { userId: t.user.id } });
      if (count >= 200)
        throw new AppError(409, 'CONFLICT', 'Maximal 200 gespeicherte Ansichten je Person');
      return tx.savedView.create({
        data: {
          id: uuidv7(),
          accountId: t.account.id,
          userId: t.user.id,
          tableKey: body.tableKey,
          name: body.name,
          state: body.state as object,
          shared: body.shared,
        },
      });
    });
  }

  /** Nur die erstellende Person darf ändern; löschen dürfen zusätzlich Personen mit account.manage. */
  @Put(':id')
  @ApiZodBody(savedViewInputSchema)
  update(
    @Tenant() t: TenantContext,
    @Param('id', uuidParam) id: string,
    @Body(zodPipe(savedViewInputSchema)) body: z.infer<typeof savedViewInputSchema>,
  ) {
    return this.db.tenant({ accountId: t.account.id, userId: t.user.id }, async (tx) => {
      const r = await tx.savedView.updateMany({
        where: { id, userId: t.user.id },
        data: { name: body.name, state: body.state as object, shared: body.shared },
      });
      if (!r.count) throw Errors.notFound();
      return tx.savedView.findUniqueOrThrow({ where: { id } });
    });
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Tenant() t: TenantContext, @Param('id', uuidParam) id: string) {
    await this.db.tenant({ accountId: t.account.id, userId: t.user.id }, async (tx) => {
      const canAll = t.account.permissions.has('account.manage');
      const r = await tx.savedView.deleteMany({
        where: {
          id,
          ...(canAll ? { OR: [{ userId: t.user.id }, { shared: true }] } : { userId: t.user.id }),
        },
      });
      if (!r.count) throw Errors.notFound();
    });
  }
}
