import {
  Body,
  Controller,
  type CanActivate,
  type ExecutionContext,
  Get,
  Inject,
  Injectable,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { type FastifyReply, type FastifyRequest } from 'fastify';
import { type z } from 'zod';
import { platformLicenseSchema, platformSupportReplySchema } from '@fangevo/shared';
import { APP_CONFIG, type AppConfig } from '../../config';
import { AppError } from '../../core/http/errors';
import { AllowReadOnly, Auth, type AuthContext, NoAccount } from '../../core/http/context';
import { ApiZodBody, uuidParam, zodPipe } from '../../core/http/zod';
import { BillingService } from '../billing/billing.service';
import { PlatformService, type PlatformStaff } from './platform.service';

/**
 * Zugang zur Plattform-Verwaltung: nur angemeldete Personen (keine API-Schlüssel), deren E-Mail
 * in PLATFORM_ADMIN_EMAILS steht und die Zwei-Faktor-Anmeldung aktiviert haben.
 */
@Injectable()
export class PlatformAdminGuard implements CanActivate {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  canActivate(ctx: ExecutionContext): boolean {
    const auth = ctx.switchToHttp().getRequest<FastifyRequest>().fangevo;
    if (!auth || auth.sessionId.includes(':'))
      throw new AppError(403, 'FORBIDDEN', 'Nur für FangEvo-Mitarbeiter');
    if (!this.config.isPlatformAdmin(auth.user.email))
      throw new AppError(403, 'FORBIDDEN', 'Nur für FangEvo-Mitarbeiter');
    if (!auth.user.mfaEnabled)
      throw new AppError(
        403,
        'MFA_REQUIRED',
        'Für die Plattform-Verwaltung ist die Zwei-Faktor-Anmeldung Pflicht',
      );
    return true;
  }
}

const staffOf = (a: AuthContext): PlatformStaff => ({
  userId: a.user.id,
  email: a.user.email,
  name: a.user.name,
});

@ApiTags('Plattform-Verwaltung (FangEvo)')
@Controller('platform')
@NoAccount()
@AllowReadOnly()
@UseGuards(PlatformAdminGuard)
export class PlatformController {
  constructor(
    @Inject(PlatformService) private readonly platform: PlatformService,
    @Inject(BillingService) private readonly billing: BillingService,
  ) {}

  @Get('me')
  me(@Auth() a: AuthContext) {
    return { ok: true, email: a.user.email };
  }

  @Get('accounts')
  accounts(@Query('q') q?: string) {
    return this.platform.accounts(q?.slice(0, 100));
  }

  @Get('accounts/:id')
  account(@Param('id', uuidParam) id: string) {
    return this.platform.account(id);
  }

  @Post('accounts/:id/license')
  @ApiZodBody(platformLicenseSchema)
  license(
    @Auth() a: AuthContext,
    @Param('id', uuidParam) id: string,
    @Body(zodPipe(platformLicenseSchema)) b: z.infer<typeof platformLicenseSchema>,
  ) {
    return this.platform.changeLicense(staffOf(a), id, b);
  }

  @Post('accounts/:id/invoices/:invoiceId/paid')
  paid(
    @Auth() a: AuthContext,
    @Param('id', uuidParam) id: string,
    @Param('invoiceId', uuidParam) invoiceId: string,
  ) {
    return this.platform.markInvoicePaid(staffOf(a), id, invoiceId);
  }

  @Get('accounts/:id/invoices/:invoiceId/pdf')
  async pdf(
    @Param('id', uuidParam) id: string,
    @Param('invoiceId', uuidParam) invoiceId: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const r = await this.platform.invoicePdf(id, invoiceId);
    reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `inline; filename="${r.filename.replace(/[^\w.-]/g, '_')}"`);
    return r.pdf;
  }

  /** Abrechnungslauf sofort ausführen (läuft sonst automatisch im Worker). */
  @Post('billing-run')
  async billingRun() {
    return { changed: await this.billing.billingRun() };
  }

  @Get('support')
  inbox(@Query('status') status?: string) {
    return this.platform.supportInbox(status?.slice(0, 30));
  }

  @Get('support/:ticketId')
  ticket(@Param('ticketId', uuidParam) ticketId: string) {
    return this.platform.ticket(ticketId);
  }

  @Post('support/:ticketId/reply')
  @ApiZodBody(platformSupportReplySchema)
  reply(
    @Auth() a: AuthContext,
    @Param('ticketId', uuidParam) ticketId: string,
    @Body(zodPipe(platformSupportReplySchema)) b: z.infer<typeof platformSupportReplySchema>,
  ) {
    return this.platform.answer(staffOf(a), ticketId, b);
  }
}
