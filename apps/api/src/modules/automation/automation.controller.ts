import { Body, Controller, Get, HttpCode, Inject, Param, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { type z } from 'zod';
import {
  CONDITION_FIELDS,
  CONDITION_OPS,
  SCHEDULE_CHECKS,
  WEBHOOK_EVENTS,
  WORKFLOW_ACTIONS,
  WORKFLOW_TRIGGERS,
  listQuerySchema,
  webhookInputSchema,
  workflowInputSchema,
  workflowTestSchema,
} from '@fangevo/shared';
import {
  RequirePermission,
  RequiresCompany,
  RequiresModule,
  Tenant,
  type TenantContext,
} from '../../core/http/context';
import { ApiZodBody, uuidParam, zodPipe } from '../../core/http/zod';
import { WebhooksService } from './webhooks.service';
import { WorkflowsService } from './workflows.service';

@ApiTags('Webhooks')
@Controller('webhooks')
@RequiresModule('api')
@RequiresCompany()
export class WebhooksController {
  constructor(@Inject(WebhooksService) private readonly hooks: WebhooksService) {}

  @Get('events')
  @RequirePermission('webhooks.manage')
  events() {
    return Object.entries(WEBHOOK_EVENTS).map(([key, label]) => ({ key, label }));
  }

  @Get()
  @RequirePermission('webhooks.manage')
  list(@Tenant() t: TenantContext) {
    return this.hooks.list(t);
  }

  @Post()
  @RequirePermission('webhooks.manage')
  @ApiZodBody(webhookInputSchema)
  create(
    @Tenant() t: TenantContext,
    @Body(zodPipe(webhookInputSchema)) b: z.infer<typeof webhookInputSchema>,
  ) {
    return this.hooks.create(t, b);
  }

  @Put(':id')
  @RequirePermission('webhooks.manage')
  update(
    @Tenant() t: TenantContext,
    @Param('id', uuidParam) id: string,
    @Body(zodPipe(webhookInputSchema)) b: z.infer<typeof webhookInputSchema>,
  ) {
    return this.hooks.update(t, id, b);
  }

  @Post(':id/rotate-secret')
  @RequirePermission('webhooks.manage')
  rotate(@Tenant() t: TenantContext, @Param('id', uuidParam) id: string) {
    return this.hooks.rotate(t, id);
  }

  @Post(':id/archive')
  @HttpCode(204)
  @RequirePermission('webhooks.manage')
  async archive(@Tenant() t: TenantContext, @Param('id', uuidParam) id: string) {
    await this.hooks.archive(t, id);
  }

  @Post(':id/ping')
  @RequirePermission('webhooks.manage')
  ping(@Tenant() t: TenantContext, @Param('id', uuidParam) id: string) {
    return this.hooks.ping(t, id);
  }

  @Get(':id/deliveries')
  @RequirePermission('webhooks.manage')
  deliveries(@Tenant() t: TenantContext, @Param('id', uuidParam) id: string) {
    return this.hooks.deliveries(t, id);
  }

  @Post(':id/deliveries/:deliveryId/redeliver')
  @RequirePermission('webhooks.manage')
  redeliver(
    @Tenant() t: TenantContext,
    @Param('id', uuidParam) id: string,
    @Param('deliveryId', uuidParam) deliveryId: string,
  ) {
    return this.hooks.redeliver(t, id, deliveryId);
  }
}

@ApiTags('Automatisierung')
@Controller('workflows')
@RequiresModule('automation')
@RequiresCompany()
export class WorkflowsController {
  constructor(@Inject(WorkflowsService) private readonly wf: WorkflowsService) {}

  /** Bausteine für den Regel-Editor */
  @Get('catalog')
  @RequirePermission('workflows.read')
  catalog() {
    return {
      triggers: WORKFLOW_TRIGGERS,
      checks: SCHEDULE_CHECKS,
      fields: CONDITION_FIELDS,
      ops: CONDITION_OPS,
      actions: WORKFLOW_ACTIONS,
    };
  }

  @Get()
  @RequirePermission('workflows.read')
  list(
    @Tenant() t: TenantContext,
    @Query(zodPipe(listQuerySchema)) q: z.infer<typeof listQuerySchema>,
  ) {
    return this.wf.list(t, q);
  }

  @Get(':id')
  @RequirePermission('workflows.read')
  get(@Tenant() t: TenantContext, @Param('id', uuidParam) id: string) {
    return this.wf.get(t, id);
  }

  @Post()
  @RequirePermission('workflows.manage')
  @ApiZodBody(workflowInputSchema)
  create(
    @Tenant() t: TenantContext,
    @Body(zodPipe(workflowInputSchema)) b: z.infer<typeof workflowInputSchema>,
  ) {
    return this.wf.save(t, null, b);
  }

  @Put(':id')
  @RequirePermission('workflows.manage')
  update(
    @Tenant() t: TenantContext,
    @Param('id', uuidParam) id: string,
    @Body(zodPipe(workflowInputSchema)) b: z.infer<typeof workflowInputSchema>,
  ) {
    return this.wf.save(t, id, b);
  }

  @Post(':id/archive')
  @HttpCode(204)
  @RequirePermission('workflows.manage')
  async archive(@Tenant() t: TenantContext, @Param('id', uuidParam) id: string) {
    await this.wf.archive(t, id);
  }

  @Post(':id/test')
  @RequirePermission('workflows.manage')
  @ApiZodBody(workflowTestSchema)
  test(
    @Tenant() t: TenantContext,
    @Param('id', uuidParam) id: string,
    @Body(zodPipe(workflowTestSchema)) b: z.infer<typeof workflowTestSchema>,
  ) {
    return this.wf.test(t, id, b.entityId);
  }
}
