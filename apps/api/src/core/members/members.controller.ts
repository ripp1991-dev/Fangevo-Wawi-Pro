import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { type z } from 'zod';
import { inviteUserSchema, updateMemberAccessSchema } from '@fangevo/shared';
import { RequirePermission, RequiresModule, Tenant, type TenantContext } from '../http/context';
import { ApiZodBody, uuidParam, zodPipe } from '../http/zod';
import { MembersService } from './members.service';

@ApiTags('Administration: Benutzer')
@Controller('admin/members')
@RequiresModule('core')
export class MembersController {
  constructor(@Inject(MembersService) private readonly members: MembersService) {}

  @Get()
  @RequirePermission('users.read')
  list(@Tenant() t: TenantContext) {
    return this.members.list(t);
  }

  @Put(':id/access')
  @HttpCode(204)
  @RequirePermission('users.manage')
  @ApiZodBody(updateMemberAccessSchema)
  async updateAccess(
    @Tenant() t: TenantContext,
    @Param('id', uuidParam) id: string,
    @Body(zodPipe(updateMemberAccessSchema)) body: z.infer<typeof updateMemberAccessSchema>,
  ) {
    await this.members.updateAccess(t, id, body);
  }

  @Post(':id/disable')
  @HttpCode(204)
  @RequirePermission('users.manage')
  async disable(@Tenant() t: TenantContext, @Param('id', uuidParam) id: string) {
    await this.members.setStatus(t, id, 'DISABLED');
  }

  @Post(':id/enable')
  @HttpCode(204)
  @RequirePermission('users.manage')
  async enable(@Tenant() t: TenantContext, @Param('id', uuidParam) id: string) {
    await this.members.setStatus(t, id, 'ACTIVE');
  }

  @Get('invitations')
  @RequirePermission('users.read')
  invitations(@Tenant() t: TenantContext) {
    return this.members.listInvitations(t);
  }

  @Post('invitations')
  @RequirePermission('users.manage')
  @ApiZodBody(inviteUserSchema)
  invite(
    @Tenant() t: TenantContext,
    @Body(zodPipe(inviteUserSchema)) body: z.infer<typeof inviteUserSchema>,
  ) {
    return this.members.invite(t, body);
  }

  @Delete('invitations/:id')
  @HttpCode(204)
  @RequirePermission('users.manage')
  async revoke(@Tenant() t: TenantContext, @Param('id', uuidParam) id: string) {
    await this.members.revokeInvitation(t, id);
  }
}
