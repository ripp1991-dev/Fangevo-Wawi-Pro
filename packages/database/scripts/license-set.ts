/**
 * Plattform-Werkzeug (nur für FangEvo-Mitarbeiter): Lizenz eines Accounts setzen.
 * Bis zum Kundenportal (Phase 7) ist das der einzige Weg, Lizenzen zu ändern.
 *
 *   pnpm --filter @fangevo/database license:set -- --account <uuid> --plan business \
 *     [--status ACTIVE] [--max-companies 5] [--add-module crm]
 */
import { PLANS, isModuleKey, type PlanKey } from '@fangevo/licensing';
import { createPrismaClient } from '../src/client';
import { withTenant } from '../src/tenant';
import { uuidv7 } from '../src/uuid';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const accountId = arg('account');
const planKey = arg('plan') as PlanKey | undefined;
if (!accountId) throw new Error('--account fehlt');

const prisma = createPrismaClient(process.env.DATABASE_URL);
await withTenant(prisma, { accountId, userId: null }, async (tx) => {
  const current = await tx.entitlement.findUnique({ where: { accountId } });
  if (!current) throw new Error('Account nicht gefunden');
  const plan = planKey ? PLANS[planKey] : undefined;
  if (planKey && !plan) throw new Error(`Unbekanntes Paket ${planKey}`);
  const modules = new Set<string>(plan ? plan.modules : current.modules);
  const add = arg('add-module');
  if (add) {
    if (!isModuleKey(add)) throw new Error(`Unbekanntes Modul ${add}`);
    modules.add(add);
  }
  const data = {
    plan: planKey ?? current.plan,
    status: (arg('status') as typeof current.status | undefined) ?? current.status,
    modules: [...modules],
    maxCompanies: arg('max-companies') ? Number(arg('max-companies')) : current.maxCompanies,
  };
  await tx.entitlement.update({ where: { accountId }, data });
  await tx.entitlementEvent.create({
    data: { id: uuidv7(), accountId, actor: 'platform-cli', change: { before: current, after: data } as object },
  });
  console.warn('Lizenz aktualisiert:', data);
});
await prisma.$disconnect();
