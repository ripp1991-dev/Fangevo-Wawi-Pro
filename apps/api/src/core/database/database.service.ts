import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import {
  createPrismaClient,
  withTenant,
  type DbContext,
  type PrismaClient,
  type Tx,
} from '@fangevo/database';
import { APP_CONFIG, type AppConfig } from '../../config';

/**
 * Zentraler Datenbankzugang.
 * - `tenant(ctx, fn)`: Zugriff auf mandantenbezogene Daten (RLS-Kontext gesetzt).
 * - `global`: NUR für globale Tabellen (users, sessions, auth_tokens, security_events).
 *   Mandantentabellen liefern ohne Kontext keine Zeilen (RLS), daher ist ein
 *   versehentlicher mandantenübergreifender Zugriff technisch ausgeschlossen.
 */
@Injectable()
export class Database implements OnModuleDestroy {
  readonly global: PrismaClient;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.global = createPrismaClient(config.DATABASE_URL);
  }

  tenant<T>(ctx: DbContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return withTenant(this.global, ctx, fn);
  }

  async onModuleDestroy(): Promise<void> {
    await this.global.$disconnect();
  }
}
