/**
 * Plattform-Werkzeug (nur für FangEvo-Mitarbeiter): Lizenz eines Accounts setzen.
 * Seit Phase 7 ist das Abo die Quelle der Lizenz. Das Werkzeug ändert deshalb das Abo
 * (Paket, Status, Zusatzmodule, zusätzliche Firmen) und berechnet die Lizenz daraus neu –
 * genau wie die Plattform-Verwaltung in der Web-App. Es erstellt keine Rechnungen.
 *
 *   pnpm --filter @fangevo/database license:set -- --account <uuid> --plan business \
 *     [--status ACTIVE|TRIAL|SUSPENDED|CANCELED] [--max-companies 5] [--add-module crm]
 */
import {
  PLANS,
  addInterval,
  computeEntitlement,
  isModuleKey,
  type PlanKey,
} from '@fangevo/licensing';
import { createPrismaClient } from '../src/client';
import { withTenant } from '../src/tenant';
import { uuidv7 } from '../src/uuid';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const accountId = arg('account');
const planKey = arg('plan') as PlanKey | undefined;
const status = arg('status');
if (!accountId) throw new Error('--account fehlt');
if (planKey && !(planKey in PLANS)) throw new Error(`Unbekanntes Paket ${planKey}`);
if (status && !['ACTIVE', 'TRIAL', 'SUSPENDED', 'CANCELED'].includes(status))
  throw new Error(`Unbekannter Status ${status}`);

const prisma = createPrismaClient(process.env.DATABASE_URL);
await withTenant(prisma, { accountId, userId: null }, async (tx) => {
  const current = await tx.entitlement.findUnique({ where: { accountId } });
  if (!current) throw new Error('Account nicht gefunden');
  const now = new Date();
  const plan = planKey ?? (current.plan in PLANS ? (current.plan as PlanKey) : 'starter');
  let sub = await tx.subscription.findUnique({ where: { accountId } });
  sub ??= await tx.subscription.create({
    data: { accountId, plan, status: current.status === 'TRIAL' ? 'trialing' : 'active' },
  });
  const data: Record<string, unknown> = { plan };
  if (status === 'ACTIVE' || (status === undefined && sub.status === 'active')) {
    data.status = 'active';
    data.suspendedAt = null;
    data.cancelAtPeriodEnd = false;
    if (!sub.currentPeriodEnd || sub.currentPeriodEnd <= now) {
      data.currentPeriodStart = now;
      data.currentPeriodEnd = addInterval(now, 'month');
    }
  }
  if (status === 'TRIAL') data.status = 'trialing';
  if (status === 'CANCELED') data.status = 'canceled';
  if (status === 'SUSPENDED') data.suspendedAt = now;
  const maxCompanies = arg('max-companies');
  if (maxCompanies)
    data.extraCompanies = Math.max(0, Number(maxCompanies) - PLANS[plan].maxCompanies);
  sub = await tx.subscription.update({ where: { accountId }, data });

  const add = arg('add-module');
  if (add) {
    if (!isModuleKey(add)) throw new Error(`Unbekanntes Modul ${add}`);
    await tx.subscriptionAddon.upsert({
      where: { accountId_module: { accountId, module: add } },
      create: { id: uuidv7(), accountId, module: add, status: 'active', startedAt: now },
      update: { status: 'active', endsAt: null },
    });
  }
  const addons = await tx.subscriptionAddon.findMany({ where: { accountId } });
  const next = computeEntitlement(sub, addons, now);
  await tx.entitlement.update({ where: { accountId }, data: next });
  await tx.platformAccount.updateMany({
    where: { accountId },
    data: { plan: next.plan, status: next.status },
  });
  await tx.entitlementEvent.create({
    data: {
      id: uuidv7(),
      accountId,
      actor: 'platform-cli',
      change: { before: current, after: next } as object,
    },
  });
  console.warn('Lizenz aktualisiert:', next);
});
await prisma.$disconnect();
