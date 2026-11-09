import { useInfiniteQuery } from '@tanstack/react-query';
import { History } from 'lucide-react';
import { Alert, Button, EmptyState, Spinner } from '@fangevo/ui';
import { errorMessage, http } from '../lib/api';
import { formatDateTime } from '../lib/format';

export interface ActivityItem {
  id: string;
  action: string;
  entityType: string | null;
  entityId: string | null;
  data: Record<string, unknown> | null;
  createdAt: string;
  actor: string;
}

export const ACTION_LABELS: Record<string, string> = {
  'account.created': 'hat den Account angelegt',
  'account.updated': 'hat den Account geändert',
  'auth.login': 'hat sich angemeldet',
  'company.created': 'hat eine Firma angelegt',
  'company.updated': 'hat eine Firma geändert',
  'company.archived': 'hat eine Firma archiviert',
  'company.restored': 'hat eine Firma wiederhergestellt',
  'member.invited': 'hat eine Person eingeladen',
  'member.invitation_revoked': 'hat eine Einladung widerrufen',
  'member.joined': 'ist beigetreten',
  'member.access_changed': 'hat Rechte geändert',
  'member.disabled': 'hat eine Person gesperrt',
  'member.enabled': 'hat eine Person entsperrt',
  'role.created': 'hat eine Rolle angelegt',
  'role.updated': 'hat eine Rolle geändert',
  'role.deleted': 'hat eine Rolle gelöscht',
  'custom_field.created': 'hat ein eigenes Feld angelegt',
  'custom_field.updated': 'hat ein eigenes Feld geändert',
  'custom_field.archived': 'hat ein eigenes Feld archiviert',
  'custom_field.restored': 'hat ein eigenes Feld wiederhergestellt',
  'dashboard.template_published': 'hat die Dashboard-Vorlage für alle festgelegt',
  'security.new_device': 'hat sich von einem neuen Gerät angemeldet',
};

const FIELD_LABELS: Record<string, string> = {
  name: 'Name',
  legalName: 'Rechtlicher Name',
  vatId: 'USt-IdNr.',
  street: 'Straße',
  postalCode: 'PLZ',
  city: 'Ort',
  country: 'Land',
  email: 'E-Mail',
  phone: 'Telefon',
};

/** Änderungen „Feld: alt → neu“, falls im Eintrag vorhanden. */
export function changeSummary(
  data: Record<string, unknown> | null,
  fieldLabel?: (k: string) => string | undefined,
): string[] {
  if (!data) return [];
  const out: string[] = [];
  for (const [k, v] of Object.entries(data)) {
    if (v && typeof v === 'object' && 'from' in v && 'to' in v) {
      const c = v as { from: unknown; to: unknown };
      const label = fieldLabel?.(k) ?? FIELD_LABELS[k] ?? k;
      const fmt = (x: unknown) =>
        x === null || x === undefined || x === ''
          ? '–'
          : Array.isArray(x)
            ? x.join(', ')
            : String(x);
      out.push(`${label}: ${fmt(c.from)} → ${fmt(c.to)}`);
    }
  }
  return out;
}

/** Verlauf (gesamt oder je Datensatz) mit „Ältere laden“. */
export function ActivityList({
  entityType,
  entityId,
  limit = 15,
  compact,
  fieldLabel,
}: {
  entityType?: string;
  entityId?: string;
  limit?: number;
  compact?: boolean;
  fieldLabel?: (k: string) => string | undefined;
}) {
  const q = useInfiniteQuery({
    queryKey: ['activity', entityType, entityId, limit],
    initialPageParam: '',
    queryFn: ({ pageParam }) =>
      http.get<{ items: ActivityItem[]; nextCursor: string | null }>(
        `/activity?limit=${limit}${entityType ? `&entityType=${entityType}&entityId=${entityId}` : ''}${pageParam ? `&cursor=${pageParam}` : ''}`,
      ),
    getNextPageParam: (p) => p.nextCursor ?? undefined,
  });
  if (q.isPending) return <Spinner />;
  if (q.isError) return <Alert tone="danger">{errorMessage(q.error)}</Alert>;
  const items = q.data.pages.flatMap((p) => p.items);
  if (!items.length) return <EmptyState icon={<History />} title="Noch keine Aktivitäten" />;
  return (
    <div>
      <ol className="relative space-y-4 border-l border-border pl-5">
        {items.map((i) => (
          <li key={i.id} className="relative">
            <span
              className="absolute -left-[25px] top-1.5 size-2.5 rounded-full border-2 border-surface bg-primary"
              aria-hidden
            />
            <p className="text-sm">
              <strong>{i.actor}</strong> {ACTION_LABELS[i.action] ?? i.action}
            </p>
            {!compact &&
              changeSummary(i.data, fieldLabel).map((c) => (
                <p key={c} className="text-xs text-muted">
                  {c}
                </p>
              ))}
            <p className="text-xs text-muted">{formatDateTime(i.createdAt)}</p>
          </li>
        ))}
      </ol>
      {q.hasNextPage && !compact && (
        <Button
          variant="secondary"
          size="sm"
          className="mt-4"
          loading={q.isFetchingNextPage}
          onClick={() => q.fetchNextPage()}
        >
          Ältere laden
        </Button>
      )}
    </div>
  );
}
