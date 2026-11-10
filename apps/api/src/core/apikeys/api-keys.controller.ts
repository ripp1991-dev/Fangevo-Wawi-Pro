import { Body, Controller, Get, HttpCode, Inject, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { type z } from 'zod';
import { apiKeyInputSchema, PERMISSIONS } from '@fangevo/shared';
import {
  RequirePermission,
  RequiresCompany,
  RequiresModule,
  Tenant,
  type TenantContext,
} from '../http/context';
import { ApiZodBody, uuidParam, zodPipe } from '../http/zod';
import { API_KEY_PERMISSIONS, ApiKeysService } from './api-keys.service';

@ApiTags('API-Schlüssel')
@Controller('api-keys')
@RequiresModule('api')
@RequiresCompany()
export class ApiKeysController {
  constructor(@Inject(ApiKeysService) private readonly keys: ApiKeysService) {}

  @Get()
  @RequirePermission('api_keys.manage')
  list(@Tenant() t: TenantContext) {
    return this.keys.list(t);
  }

  /** Rechte, die einem Schlüssel gegeben werden können (nur eigene und gebuchte). */
  @Get('permissions')
  @RequirePermission('api_keys.manage')
  permissions(@Tenant() t: TenantContext) {
    return API_KEY_PERMISSIONS.filter((p) => t.account.permissions.has(p)).map((p) => ({
      key: p,
      label: PERMISSIONS[p].label,
      module: PERMISSIONS[p].module,
    }));
  }

  @Post()
  @RequirePermission('api_keys.manage')
  @ApiZodBody(apiKeyInputSchema)
  create(
    @Tenant() t: TenantContext,
    @Body(zodPipe(apiKeyInputSchema)) b: z.infer<typeof apiKeyInputSchema>,
  ) {
    return this.keys.create(t, b);
  }

  @Post(':id/revoke')
  @HttpCode(204)
  @RequirePermission('api_keys.manage')
  async revoke(@Tenant() t: TenantContext, @Param('id', uuidParam) id: string) {
    await this.keys.revoke(t, id);
  }
}
