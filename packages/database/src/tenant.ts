import { type Prisma, type PrismaClient } from '@prisma/client';

export type Tx = Prisma.TransactionClient;

export interface DbContext {
  /** Aktiver Mandant. null nur für Abfragen über die eigenen Mitgliedschaften. */
  accountId: string | null;
  userId: string | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Führt `fn` in einer Transaktion aus, in der der Mandantenkontext für die
 * Row-Level-Security-Policies gesetzt ist. Der Kontext gilt nur für diese Transaktion
 * (set_config(..., true)) und kann daher nicht in andere Anfragen "durchsickern".
 *
 * Das ist der EINZIGE vorgesehene Weg, auf mandantenbezogene Tabellen zuzugreifen.
 */
export async function withTenant<T>(
  prisma: PrismaClient,
  ctx: DbContext,
  fn: (tx: Tx) => Promise<T>,
  options?: { isolationLevel?: Prisma.TransactionIsolationLevel; timeout?: number },
): Promise<T> {
  for (const v of [ctx.accountId, ctx.userId]) {
    if (v !== null && !UUID_RE.test(v)) throw new Error('Ungültiger Mandantenkontext');
  }
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.account_id', ${ctx.accountId ?? ''}, true), set_config('app.user_id', ${ctx.userId ?? ''}, true)`;
      return fn(tx);
    },
    { timeout: options?.timeout ?? 15_000, isolationLevel: options?.isolationLevel },
  );
}
