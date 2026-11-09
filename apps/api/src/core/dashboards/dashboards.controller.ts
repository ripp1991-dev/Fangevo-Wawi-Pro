import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { type z } from 'zod';
import {
  DEFAULT_DASHBOARD,
  WIDGETS,
  dashboardInputSchema,
  type WidgetInstance,
} from '@fangevo/shared';
import { uuidv7, type Tx } from '@fangevo/database';
import { AuditService } from '../audit/audit.service';
import { Database } from '../database/database.service';
import { AppError, Errors } from '../http/errors';
import { AllowReadOnly, RequirePermission, Tenant, type TenantContext } from '../http/context';
import { ApiZodBody, uuidParam, zodPipe } from '../http/zod';

const MAX_PAGES = 10;

/**
 * Dashboards: persönliche Seiten (user_id gesetzt) und Account-Vorlage (user_id leer).
 * Wer noch keine eigenen Seiten hat, sieht die Vorlage; bei der ersten Änderung entsteht eine
 * persönliche Kopie. Widgets ohne passendes Recht werden beim Ausliefern ausgeblendet.
 */
@ApiTags('Dashboard')
@Controller()
export class DashboardsController {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  private run<T>(t: TenantContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.db.tenant({ accountId: t.account.id, userId: t.user.id }, fn);
  }

  private visible(t: TenantContext, widgets: WidgetInstance[]): WidgetInstance[] {
    return widgets.filter((w) => {
      const def = WIDGETS[w.type];
      return def && (!def.permission || t.account.permissions.has(def.permission));
    });
  }

  @Get('dashboards')
  list(@Tenant() t: TenantContext) {
    return this.run(t, async (tx) => {
      const mine = await tx.dashboard.findMany({
        where: { userId: t.user.id },
        orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      });
      const template = mine.length
        ? []
        : await tx.dashboard.findMany({
            where: { userId: null },
            orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
          });
      const source = mine.length ? 'personal' : template.length ? 'account' : 'builtin';
      const pages = mine.length
        ? mine
        : template.length
          ? template
          : [
              {
                id: 'builtin',
                name: DEFAULT_DASHBOARD.name,
                position: 0,
                widgets: DEFAULT_DASHBOARD.widgets,
              },
            ];
      return {
        source,
        pages: pages.map((p) => ({
          id: p.id,
          name: p.name,
          position: p.position,
          widgets: this.visible(t, p.widgets as WidgetInstance[]),
        })),
      };
    });
  }

  /** Legt beim ersten Bearbeiten eine persönliche Kopie der angezeigten Seiten an. */
  private async ensurePersonal(tx: Tx, t: TenantContext): Promise<Map<string, string>> {
    const mapping = new Map<string, string>();
    if (await tx.dashboard.count({ where: { userId: t.user.id } })) return mapping;
    const template = await tx.dashboard.findMany({
      where: { userId: null },
      orderBy: { position: 'asc' },
    });
    const source = template.length
      ? template
      : [
          {
            id: 'builtin',
            name: DEFAULT_DASHBOARD.name,
            position: 0,
            widgets: DEFAULT_DASHBOARD.widgets,
          },
        ];
    for (const p of source) {
      const id = uuidv7();
      mapping.set(p.id, id);
      await tx.dashboard.create({
        data: {
          id,
          accountId: t.account.id,
          userId: t.user.id,
          name: p.name,
          position: p.position,
          widgets: p.widgets as object,
        },
      });
    }
    return mapping;
  }

  @Put('dashboards/:id')
  @AllowReadOnly()
  @ApiZodBody(dashboardInputSchema)
  update(
    @Tenant() t: TenantContext,
    @Param('id') rawId: string,
    @Body(zodPipe(dashboardInputSchema)) body: z.infer<typeof dashboardInputSchema>,
  ) {
    return this.run(t, async (tx) => {
      const mapping = await this.ensurePersonal(tx, t);
      const id = mapping.get(rawId) ?? rawId;
      if (!/^[0-9a-f-]{36}$/i.test(id)) throw Errors.notFound();
      const r = await tx.dashboard.updateMany({
        where: { id, userId: t.user.id },
        data: { name: body.name, widgets: body.widgets as object },
      });
      if (!r.count) throw Errors.notFound();
      return { id };
    });
  }

  @Post('dashboards')
  @AllowReadOnly()
  @ApiZodBody(dashboardInputSchema)
  create(
    @Tenant() t: TenantContext,
    @Body(zodPipe(dashboardInputSchema)) body: z.infer<typeof dashboardInputSchema>,
  ) {
    return this.run(t, async (tx) => {
      await this.ensurePersonal(tx, t);
      const count = await tx.dashboard.count({ where: { userId: t.user.id } });
      if (count >= MAX_PAGES)
        throw new AppError(409, 'CONFLICT', `Maximal ${MAX_PAGES} Dashboard-Seiten`);
      const id = uuidv7();
      await tx.dashboard.create({
        data: {
          id,
          accountId: t.account.id,
          userId: t.user.id,
          name: body.name,
          position: count,
          widgets: body.widgets as object,
        },
      });
      return { id };
    });
  }

  @Delete('dashboards/:id')
  @HttpCode(204)
  @AllowReadOnly()
  async remove(@Tenant() t: TenantContext, @Param('id', uuidParam) id: string) {
    await this.run(t, async (tx) => {
      if ((await tx.dashboard.count({ where: { userId: t.user.id } })) <= 1)
        throw new AppError(409, 'CONFLICT', 'Die letzte Seite kann nicht gelöscht werden');
      const r = await tx.dashboard.deleteMany({ where: { id, userId: t.user.id } });
      if (!r.count) throw Errors.notFound();
    });
  }

  /** Persönliche Anpassungen verwerfen → wieder die Account-Vorlage. */
  @Post('dashboards/reset')
  @HttpCode(204)
  @AllowReadOnly()
  async reset(@Tenant() t: TenantContext) {
    await this.run(t, (tx) => tx.dashboard.deleteMany({ where: { userId: t.user.id } }));
  }

  /** Die eigenen Seiten als Vorlage für alle im Account übernehmen. */
  @Post('admin/dashboards/template')
  @HttpCode(204)
  @RequirePermission('account.manage')
  async publishTemplate(@Tenant() t: TenantContext) {
    await this.run(t, async (tx) => {
      await this.ensurePersonal(tx, t);
      const mine = await tx.dashboard.findMany({
        where: { userId: t.user.id },
        orderBy: { position: 'asc' },
      });
      await tx.dashboard.deleteMany({ where: { userId: null } });
      for (const p of mine) {
        const widgets = (p.widgets as WidgetInstance[]).map((w) =>
          w.type === 'note' ? { ...w, config: { text: '' } } : w,
        );
        await tx.dashboard.create({
          data: {
            id: uuidv7(),
            accountId: t.account.id,
            userId: null,
            name: p.name,
            position: p.position,
            widgets: widgets as object,
          },
        });
      }
      await this.audit.record(tx, {
        accountId: t.account.id,
        userId: t.user.id,
        action: 'dashboard.template_published',
        entityType: 'dashboard',
        data: { pages: mine.length },
        ip: t.ip,
      });
    });
  }
}
