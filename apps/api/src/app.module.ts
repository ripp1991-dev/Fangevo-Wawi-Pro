import { type DynamicModule, Logger, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { APP_CONFIG, type AppConfig } from './config';
import { AccessGuard } from './core/access/access.guard';
import { AccessService } from './core/access/access.service';
import { AccountController } from './core/accounts/account.controller';
import { ProvisioningService } from './core/accounts/provisioning.service';
import { AuditController } from './core/audit/audit.controller';
import { AuditService } from './core/audit/audit.service';
import { AuthController } from './core/auth/auth.controller';
import { AuthService } from './core/auth/auth.service';
import { MfaService } from './core/auth/mfa.service';
import { SessionService } from './core/auth/session.service';
import { CompaniesController } from './core/companies/companies.controller';
import { CompaniesService } from './core/companies/companies.service';
import { Database } from './core/database/database.service';
import { RedisService } from './core/database/redis.service';
import { HealthController } from './core/health/health.controller';
import { ProblemFilter } from './core/http/problem.filter';
import { LicenseController } from './core/licensing/license.controller';
import { MailService } from './core/mail/mail.service';
import { MembersController } from './core/members/members.controller';
import { MembersService } from './core/members/members.service';
import { RolesController } from './core/roles/roles.controller';
import { RolesService } from './core/roles/roles.service';
import { RateLimitGuard } from './core/security/rate-limit.guard';
import { ActivityController } from './core/activity/activity.controller';
import { CustomFieldsController } from './core/customfields/custom-fields.controller';
import { CustomFieldsService } from './core/customfields/custom-fields.service';
import { DashboardsController } from './core/dashboards/dashboards.controller';
import { EventDispatcher } from './core/events/dispatcher.service';
import { EVENT_HANDLERS } from './core/events/event-types';
import { NotificationHandler } from './core/notifications/notification.handler';
import { NotificationsController } from './core/notifications/notifications.controller';
import { NotificationsService } from './core/notifications/notifications.service';
import { PreferencesController } from './core/preferences/preferences.controller';
import { SearchController } from './core/search/search.controller';
import { SearchService } from './core/search/search.service';
import { ViewsController } from './core/views/views.controller';
import { ArticlesController } from './modules/articles/articles.controller';
import { ArticlesService } from './modules/articles/articles.service';
import { CompanyDb } from './modules/common/company-db';
import { CustomersController } from './modules/customers/customers.controller';
import { CustomersService } from './modules/customers/customers.service';
import { InventoryController } from './modules/inventory/inventory.controller';
import { InventoryService } from './modules/inventory/inventory.service';
import { DocumentsController } from './modules/documents/documents.controller';
import { DocumentsService } from './modules/documents/documents.service';
import { OrdersController } from './modules/orders/orders.controller';
import { OrdersService } from './modules/orders/orders.service';
import { PurchasingController } from './modules/purchasing/purchasing.controller';
import { PurchasingService } from './modules/purchasing/purchasing.service';
import {
  BarcodesController,
  PackingController,
  PickListsController,
  ReturnsController,
  ScanController,
} from './modules/logistics/logistics.controller';
import { PackingService } from './modules/logistics/packing.service';
import { PickingService } from './modules/logistics/picking.service';
import { ReturnsService } from './modules/logistics/returns.service';
import { ScanService } from './modules/logistics/scan.service';
import { SettingsController } from './modules/settings/settings.controller';
import { SuppliersController } from './modules/suppliers/suppliers.controller';
import { SuppliersService } from './modules/suppliers/suppliers.service';

/**
 * FangEvo Core (Phase 1). Fachmodule (Artikel, Aufträge, …) werden ab Phase 3
 * als eigene Nest-Module unter modules/ ergänzt und hier importiert.
 */
@Module({})
export class AppModule {
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [
        LoggerModule.forRoot({
          pinoHttp: {
            level: config.NODE_ENV === 'test' ? 'silent' : config.LOG_LEVEL,
            transport:
              config.isProd || config.NODE_ENV === 'test'
                ? undefined
                : { target: 'pino/file', options: { destination: 1 } },
            redact: {
              paths: [
                'req.headers.cookie',
                'req.headers.authorization',
                'res.headers["set-cookie"]',
                '*.password',
                '*.newPassword',
                '*.currentPassword',
                '*.token',
                '*.code',
              ],
              censor: '[entfernt]',
            },
            customProps: (req) => ({
              userId: (req as { fangevo?: { user?: { id?: string } } }).fangevo?.user?.id,
            }),
          },
        }),
      ],
      controllers: [
        HealthController,
        AuthController,
        AccountController,
        CompaniesController,
        MembersController,
        RolesController,
        AuditController,
        LicenseController,
        NotificationsController,
        ActivityController,
        CustomFieldsController,
        SearchController,
        ViewsController,
        PreferencesController,
        DashboardsController,
        // Phase 3a: Warenwirtschaft
        SettingsController,
        ArticlesController,
        CustomersController,
        SuppliersController,
        InventoryController,
        // Phase 3b: Aufträge, Belege, Einkauf
        OrdersController,
        DocumentsController,
        PurchasingController,
        // Phase 4: Logistik
        ScanController,
        BarcodesController,
        PickListsController,
        PackingController,
        ReturnsController,
      ],
      providers: [
        { provide: APP_CONFIG, useValue: config },
        { provide: Logger, useValue: new Logger('FangEvo') },
        Database,
        RedisService,
        MailService,
        AuditService,
        SessionService,
        AccessService,
        MfaService,
        ProvisioningService,
        AuthService,
        CompaniesService,
        MembersService,
        RolesService,
        CustomFieldsService,
        SearchService,
        NotificationsService,
        NotificationHandler,
        {
          provide: EVENT_HANDLERS,
          useFactory: (n: NotificationHandler) => [n],
          inject: [NotificationHandler],
        },
        EventDispatcher,
        CompanyDb,
        ArticlesService,
        CustomersService,
        SuppliersService,
        InventoryService,
        OrdersService,
        DocumentsService,
        PurchasingService,
        ScanService,
        PickingService,
        PackingService,
        ReturnsService,
        { provide: APP_FILTER, useClass: ProblemFilter },
        // Reihenfolge wichtig: zuerst Rate-Limit, dann Zugriffskontrolle
        { provide: APP_GUARD, useClass: RateLimitGuard },
        { provide: APP_GUARD, useClass: AccessGuard },
      ],
    };
  }
}
