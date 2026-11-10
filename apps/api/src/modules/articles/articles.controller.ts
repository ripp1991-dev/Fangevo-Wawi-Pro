import { Body, Controller, Get, Inject, Param, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { articleInputSchema, listQuerySchema } from '@fangevo/shared';
import {
  RequirePermission,
  RequiresCompany,
  RequiresModule,
  Tenant,
  type TenantContext,
} from '../../core/http/context';
import { ApiZodBody, uuidParam, zodPipe } from '../../core/http/zod';
import { ArticlesService } from './articles.service';

const updateSchema = articleInputSchema.extend({ version: z.number().int().min(1) });

@ApiTags('Artikel')
@Controller('articles')
@RequiresModule('articles')
@RequiresCompany()
export class ArticlesController {
  constructor(@Inject(ArticlesService) private readonly articles: ArticlesService) {}

  @Get()
  @RequirePermission('articles.read')
  list(
    @Tenant() t: TenantContext,
    @Query(zodPipe(listQuerySchema)) q: z.infer<typeof listQuerySchema>,
  ) {
    return this.articles.list(t, q);
  }

  @Get(':id')
  @RequirePermission('articles.read')
  get(@Tenant() t: TenantContext, @Param('id', uuidParam) id: string) {
    return this.articles.get(t, id);
  }

  @Post()
  @RequirePermission('articles.manage')
  @ApiZodBody(articleInputSchema)
  create(
    @Tenant() t: TenantContext,
    @Body(zodPipe(articleInputSchema)) b: z.infer<typeof articleInputSchema>,
  ) {
    return this.articles.create(t, b);
  }

  @Put(':id')
  @RequirePermission('articles.manage')
  @ApiZodBody(updateSchema)
  update(
    @Tenant() t: TenantContext,
    @Param('id', uuidParam) id: string,
    @Body(zodPipe(updateSchema)) b: z.infer<typeof updateSchema>,
  ) {
    const { version, ...input } = b;
    return this.articles.update(t, id, input, version);
  }

  @Post(':id/archive')
  @RequirePermission('articles.manage')
  archive(@Tenant() t: TenantContext, @Param('id', uuidParam) id: string) {
    return this.articles.setArchived(t, id, true);
  }

  @Post(':id/restore')
  @RequirePermission('articles.manage')
  restore(@Tenant() t: TenantContext, @Param('id', uuidParam) id: string) {
    return this.articles.setArchived(t, id, false);
  }

  @Post(':id/variants/generate')
  @RequirePermission('articles.manage')
  generate(@Tenant() t: TenantContext, @Param('id', uuidParam) id: string) {
    return this.articles.generateVariants(t, id);
  }
}
