import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { type z } from 'zod';
import { PERMISSIONS, roleInputSchema } from '@fangevo/shared';
import { MODULES, isModuleKey } from '@fangevo/licensing';
import { RequirePermission, RequiresModule, Tenant, type TenantContext } from '../http/context';
import { ApiZodBody, uuidParam, zodPipe } from '../http/zod';
import { RolesService } from './roles.service';

@ApiTags('Administration: Rollen')
@Controller('admin/roles')
@RequiresModule('core')
export class RolesController {
  constructor(@Inject(RolesService) private readonly roles: RolesService) {}

  @Get()
  @RequirePermission('roles.read')
  list(@Tenant() t: TenantContext) {
    return this.roles.list(t);
  }

  /** Rechtekatalog für die Oberfläche, gruppiert nach Modul. */
  @Get('permissions')
  @RequirePermission('roles.read')
  catalog() {
    return Object.entries(PERMISSIONS).map(([key, v]) => ({
      key,
      label: v.label,
      module: v.module,
      moduleName: isModuleKey(v.module) ? MODULES[v.module].name : v.module,
    }));
  }

  @Post()
  @RequirePermission('roles.manage')
  @ApiZodBody(roleInputSchema)
  create(@Tenant() t: TenantContext, @Body(zodPipe(roleInputSchema)) body: z.infer<typeof roleInputSchema>) {
    return this.roles.create(t, body);
  }

  @Put(':id')
  @HttpCode(204)
  @RequirePermission('roles.manage')
  @ApiZodBody(roleInputSchema)
  async update(@Tenant() t: TenantContext, @Param('id', uuidParam) id: string, @Body(zodPipe(roleInputSchema)) body: z.infer<typeof roleInputSchema>) {
    await this.roles.update(t, id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('roles.manage')
  async remove(@Tenant() t: TenantContext, @Param('id', uuidParam) id: string) {
    await this.roles.remove(t, id);
  }
}
