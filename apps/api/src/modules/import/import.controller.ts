import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { type FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  EXPORT_ENTITIES,
  importConfigSchema,
  importTemplateSchema,
  importUploadSchema,
  listQuerySchema,
  type ExportEntity,
} from '@fangevo/shared';
import {
  RequirePermission,
  RequiresCompany,
  RequiresModule,
  Tenant,
  type TenantContext,
} from '../../core/http/context';
import { AppError } from '../../core/http/errors';
import { ApiZodBody, uuidParam, zodPipe } from '../../core/http/zod';
import { ImportService } from './import.service';

const entityQuery = z.object({ entity: z.string().max(40).optional() });

@ApiTags('FangEvo Import')
@Controller('imports')
@RequiresModule('import')
@RequiresCompany()
export class ImportController {
  constructor(@Inject(ImportService) private readonly imports: ImportService) {}

  @Get()
  @RequirePermission('import.execute')
  list(
    @Tenant() t: TenantContext,
    @Query(zodPipe(listQuerySchema)) q: z.infer<typeof listQuerySchema>,
  ) {
    return this.imports.list(t, q);
  }

  @Get('templates')
  @RequirePermission('import.execute')
  templates(
    @Tenant() t: TenantContext,
    @Query(zodPipe(entityQuery)) q: z.infer<typeof entityQuery>,
  ) {
    return this.imports.templates(t, q.entity);
  }

  @Post('templates')
  @RequirePermission('import.execute')
  @ApiZodBody(importTemplateSchema)
  saveTemplate(
    @Tenant() t: TenantContext,
    @Body(zodPipe(importTemplateSchema)) b: z.infer<typeof importTemplateSchema>,
  ) {
    return this.imports.saveTemplate(t, b);
  }

  @Delete('templates/:id')
  @HttpCode(204)
  @RequirePermission('import.execute')
  async deleteTemplate(@Tenant() t: TenantContext, @Param('id', uuidParam) id: string) {
    await this.imports.deleteTemplate(t, id);
  }

  @Get('export/:entity')
  @RequirePermission('import.execute')
  async export(
    @Tenant() t: TenantContext,
    @Param('entity') entity: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    if (!(entity in EXPORT_ENTITIES)) throw new AppError(404, 'NOT_FOUND', 'Unbekannte Datenart');
    const csv = await this.imports.export(t, entity as ExportEntity);
    reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header(
        'Content-Disposition',
        `attachment; filename="${entity}-${new Date().toISOString().slice(0, 10)}.csv"`,
      )
      .header('Cache-Control', 'private, no-store');
    return csv;
  }

  @Post()
  @RequirePermission('import.execute')
  @ApiZodBody(importUploadSchema)
  upload(
    @Tenant() t: TenantContext,
    @Body(zodPipe(importUploadSchema)) b: z.infer<typeof importUploadSchema>,
  ) {
    return this.imports.upload(t, b);
  }

  @Get(':id')
  @RequirePermission('import.execute')
  get(@Tenant() t: TenantContext, @Param('id', uuidParam) id: string) {
    return this.imports.get(t, id);
  }

  @Post(':id/validate')
  @RequirePermission('import.execute')
  @ApiZodBody(importConfigSchema)
  validate(
    @Tenant() t: TenantContext,
    @Param('id', uuidParam) id: string,
    @Body(zodPipe(importConfigSchema)) b: z.infer<typeof importConfigSchema>,
  ) {
    return this.imports.validate(t, id, b);
  }

  @Post(':id/start')
  @RequirePermission('import.execute')
  start(@Tenant() t: TenantContext, @Param('id', uuidParam) id: string) {
    return this.imports.start(t, id);
  }

  @Post(':id/rollback')
  @RequirePermission('import.execute')
  rollback(@Tenant() t: TenantContext, @Param('id', uuidParam) id: string) {
    return this.imports.rollback(t, id);
  }
}
