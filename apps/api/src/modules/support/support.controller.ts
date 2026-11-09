import { Body, Controller, Get, Inject, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { type z } from 'zod';
import {
  SUPPORT_CATEGORIES,
  SUPPORT_PRIORITIES,
  supportMessageSchema,
  supportTicketSchema,
} from '@fangevo/shared';
import {
  AllowReadOnly,
  RequirePermission,
  Tenant,
  type TenantContext,
} from '../../core/http/context';
import { ApiZodBody, uuidParam, zodPipe } from '../../core/http/zod';
import { SupportService } from './support.service';

/** Support-Anfragen an FangEvo. Auch bei gesperrtem Account möglich. */
@ApiTags('Support')
@Controller('support/tickets')
@AllowReadOnly()
export class SupportController {
  constructor(@Inject(SupportService) private readonly support: SupportService) {}

  @Get('meta')
  @RequirePermission('support.manage')
  meta() {
    return { categories: SUPPORT_CATEGORIES, priorities: SUPPORT_PRIORITIES };
  }

  @Get()
  @RequirePermission('support.manage')
  list(@Tenant() t: TenantContext) {
    return this.support.list(t);
  }

  @Post()
  @RequirePermission('support.manage')
  @ApiZodBody(supportTicketSchema)
  create(
    @Tenant() t: TenantContext,
    @Body(zodPipe(supportTicketSchema)) b: z.infer<typeof supportTicketSchema>,
  ) {
    return this.support.create(t, b);
  }

  @Get(':id')
  @RequirePermission('support.manage')
  get(@Tenant() t: TenantContext, @Param('id', uuidParam) id: string) {
    return this.support.get(t, id);
  }

  @Post(':id/messages')
  @RequirePermission('support.manage')
  @ApiZodBody(supportMessageSchema)
  reply(
    @Tenant() t: TenantContext,
    @Param('id', uuidParam) id: string,
    @Body(zodPipe(supportMessageSchema)) b: z.infer<typeof supportMessageSchema>,
  ) {
    return this.support.reply(t, id, b);
  }

  @Post(':id/close')
  @RequirePermission('support.manage')
  close(@Tenant() t: TenantContext, @Param('id', uuidParam) id: string) {
    return this.support.close(t, id);
  }
}
