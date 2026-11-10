import { type Tx } from '@fangevo/database';
import { NO_CHANNEL, packingRulesSchema, type PackingRules } from '@fangevo/shared';

/** Was über einen Auftrag bekannt sein muss, um ihn gegen Packregeln zu prüfen. */
export interface RuleSubject {
  channelId: string | null;
  /** Kategorie je Artikelposition (null = Artikel ohne Kategorie). Positionen ohne Artikel fehlen. */
  categoryIds: (string | null)[];
}

export type RuleResult = { ok: true } | { ok: false; reason: 'channel' | 'category' };

/** Liest die Packregeln aus den Packplatz-Einstellungen (alte Packplätze ohne Regeln = alles erlaubt). */
export function readRules(settings: unknown): PackingRules {
  const raw = (settings ?? {}) as { rules?: unknown };
  const parsed = packingRulesSchema.safeParse(raw.rules ?? {});
  return parsed.success ? parsed.data : packingRulesSchema.parse({});
}

/** Erweitert Kategorie-IDs um alle Unterkategorien. */
export function expandCategories(
  ids: string[],
  all: { id: string; parentId: string | null }[],
): Set<string> {
  const children = new Map<string, string[]>();
  for (const c of all) {
    if (!c.parentId) continue;
    children.set(c.parentId, [...(children.get(c.parentId) ?? []), c.id]);
  }
  const out = new Set<string>();
  const stack = [...ids];
  while (stack.length) {
    const id = stack.pop()!;
    if (out.has(id)) continue;
    out.add(id);
    stack.push(...(children.get(id) ?? []));
  }
  return out;
}

/** Alle Positionen gehören zu den Kategorien (Aufträge ohne Artikelpositionen zählen nicht). */
function allIn(categoryIds: (string | null)[], set: Set<string>): boolean {
  return categoryIds.length > 0 && categoryIds.every((c) => c !== null && set.has(c));
}

/**
 * Prüft einen Auftrag gegen Packregeln.
 * include/exclude sind bereits um Unterkategorien erweiterte Mengen.
 */
export function checkRules(
  subject: RuleSubject,
  rules: Pick<PackingRules, 'channelIds'>,
  include: Set<string>,
  exclude: Set<string>,
): RuleResult {
  if (rules.channelIds.length) {
    const key = subject.channelId ?? NO_CHANNEL;
    if (!rules.channelIds.includes(key)) return { ok: false, reason: 'channel' };
  }
  if (include.size && !allIn(subject.categoryIds, include))
    return { ok: false, reason: 'category' };
  if (exclude.size && allIn(subject.categoryIds, exclude)) return { ok: false, reason: 'category' };
  return { ok: true };
}

/** Lädt Kategorien je Auftrag (über die Artikel der Positionen). */
export async function loadSubjects(
  tx: Tx,
  orders: { id: string; channelId: string | null }[],
): Promise<Map<string, RuleSubject>> {
  const ids = orders.map((o) => o.id);
  const lines = ids.length
    ? await tx.salesOrderLine.findMany({
        where: { orderId: { in: ids }, articleId: { not: null } },
        select: { orderId: true, articleId: true },
      })
    : [];
  const articles = lines.length
    ? await tx.article.findMany({
        where: { id: { in: [...new Set(lines.map((l) => l.articleId!))] } },
        select: { id: true, categoryId: true },
      })
    : [];
  const cat = new Map(articles.map((a) => [a.id, a.categoryId]));
  const out = new Map<string, RuleSubject>();
  for (const o of orders) out.set(o.id, { channelId: o.channelId, categoryIds: [] });
  for (const l of lines) out.get(l.orderId)!.categoryIds.push(cat.get(l.articleId!) ?? null);
  return out;
}

/** Bereitet die Kategoriemengen einer Regel vor (eine Abfrage für den ganzen Baum). */
export async function categorySets(tx: Tx, rules: PackingRules) {
  if (!rules.categoryIds.length && !rules.excludeCategoryIds.length)
    return { include: new Set<string>(), exclude: new Set<string>() };
  const all = await tx.category.findMany({ select: { id: true, parentId: true } });
  return {
    include: expandCategories(rules.categoryIds, all),
    exclude: expandCategories(rules.excludeCategoryIds, all),
  };
}

export function ruleMessage(reason: 'channel' | 'category', channelName: string | null): string {
  return reason === 'channel'
    ? `Dieser Auftrag gehört zum Kanal „${channelName ?? 'ohne Kanal'}“, der an diesem Packplatz nicht gepackt wird`
    : 'Die Artikel dieses Auftrags passen nicht zu den Kategorien dieses Packplatzes';
}
