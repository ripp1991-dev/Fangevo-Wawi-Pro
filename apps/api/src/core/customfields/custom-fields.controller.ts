import { Body, Controller, Get, HttpCode, Inject, Param, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  CUSTOM_FIELD_ENTITIES,
  customFieldCreateSchema,
  customFieldUpdateSchema,
  type CustomFieldEntity,
} from '@fangevo/shared';
import { RequirePermission, Tenant, type TenantContext } from '../http/context';
import { ApiZodBody, uuidParam, zodPipe } from '../http/zod';
import { CustomFieldsService } from './custom-fields.service';

const listSchema = z.object({
  entityType: z.enum(Object.keys(CUSTOM_FIELD_ENTITIES) as [CustomFieldEntity]),
  archived: z.enum(['true', 'false']).optional(),
});

@ApiTags('Eigene Felder')
@Controller('custom-fields')
export class CustomFieldsController {
  constructor(@Inject(CustomFieldsService) private readonly fields: CustomFieldsService) {}

  /** Definitionen sind für alle Mitglieder lesbar (werden für Formulare und Tabellen gebraucht). */
  @Get()
  list(@Tenant() t: TenantContext, @Query(zodPipe(listSchema)) q: z.infer<typeof listSchema>) {
    return this.fields.list(
      t,
      q.entityType,
      q.archived === 'true' && t.account.permissions.has('custom_fields.manage'),
    );
  }

  @Post()
  @RequirePermission('custom_fields.manage')
  @ApiZodBody(customFieldCreateSchema)
  create(
    @Tenant() t: TenantContext,
    @Body(zodPipe(customFieldCreateSchema)) body: z.infer<typeof customFieldCreateSchema>,
  ) {
    return this.fields.create(t, body);
  }

  @Put(':id')
  @HttpCode(204)
  @RequirePermission('custom_fields.manage')
  @ApiZodBody(customFieldUpdateSchema)
  async update(
    @Tenant() t: TenantContext,
    @Param('id', uuidParam) id: string,
    @Body(zodPipe(customFieldUpdateSchema)) body: z.infer<typeof customFieldUpdateSchema>,
  ) {
    await this.fields.update(t, id, body);
  }

  @Post(':id/archive')
  @HttpCode(204)
  @RequirePermission('custom_fields.manage')
  async archive(@Tenant() t: TenantContext, @Param('id', uuidParam) id: string) {
    await this.fields.setArchived(t, id, true);
  }

  @Post(':id/restore')
  @HttpCode(204)
  @RequirePermission('custom_fields.manage')
  async restore(@Tenant() t: TenantContext, @Param('id', uuidParam) id: string) {
    await this.fields.setArchived(t, id, false);
  }
}
