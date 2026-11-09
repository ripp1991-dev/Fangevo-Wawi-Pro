import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { listQuerySchema, supplierArticleInputSchema, supplierInputSchema } from '@fangevo/shared';
import { RequirePermission, RequiresCompany, RequiresModule, Tenant, type TenantContext } from '../../core/http/context';
import { ApiZodBody, uuidParam, zodPipe } from '../../core/http/zod';
import { SuppliersService } from './suppliers.service';

const updateSchema = supplierInputSchema.extend({ version: z.number().int().min(1) });

@ApiTags('Lieferanten')
@Controller('suppliers')
@RequiresModule('suppliers')
@RequiresCompany()
export class SuppliersController {
  constructor(@Inject(SuppliersService) private readonly suppliers: SuppliersService) {}

  @Get()
  @RequirePermission('suppliers.read')
  list(@Tenant() t: TenantContext, @Query(zodPipe(listQuerySchema)) q: z.infer<typeof listQuerySchema>) {
    return this.suppliers.list(t, q);
  }

  @Get(':id')
  @RequirePermission('suppliers.read')
  get(@Tenant() t: TenantContext, @Param('id', uuidParam) id: string) {
    return this.suppliers.get(t, id);
  }

  @Post()
  @RequirePermission('suppliers.manage')
  @ApiZodBody(supplierInputSchema)
  create(@Tenant() t: TenantContext, @Body(zodPipe(supplierInputSchema)) b: z.infer<typeof supplierInputSchema>) {
    return this.suppliers.create(t, b);
  }

  @Put(':id')
  @RequirePermission('suppliers.manage')
  @ApiZodBody(updateSchema)
  update(@Tenant() t: TenantContext, @Param('id', uuidParam) id: string, @Body(zodPipe(updateSchema)) b: z.infer<typeof updateSchema>) {
    const { version, ...input } = b;
    return this.suppliers.update(t, id, input, version);
  }

  @Post(':id/archive')
  @RequirePermission('suppliers.manage')
  archive(@Tenant() t: TenantContext, @Param('id', uuidParam) id: string) {
    return this.suppliers.setArchived(t, id, true);
  }

  @Post(':id/restore')
  @RequirePermission('suppliers.manage')
  restore(@Tenant() t: TenantContext, @Param('id', uuidParam) id: string) {
    return this.suppliers.setArchived(t, id, false);
  }

  @Put(':id/articles')
  @RequirePermission('suppliers.manage')
  @ApiZodBody(supplierArticleInputSchema)
  upsertArticle(@Tenant() t: TenantContext, @Param('id', uuidParam) id: string, @Body(zodPipe(supplierArticleInputSchema)) b: z.infer<typeof supplierArticleInputSchema>) {
    return this.suppliers.upsertArticle(t, id, b);
  }

  @Delete(':id/articles/:articleId')
  @HttpCode(204)
  @RequirePermission('suppliers.manage')
  async removeArticle(@Tenant() t: TenantContext, @Param('id', uuidParam) id: string, @Param('articleId', uuidParam) articleId: string) {
    await this.suppliers.removeArticle(t, id, articleId);
  }
}
