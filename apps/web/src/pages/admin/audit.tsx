import { useInfiniteQuery } from '@tanstack/react-query';
import { Button, PageHeader } from '@fangevo/ui';
import { ACTION_LABELS, changeSummary } from '../../components/activity-list';
import { DataTable } from '../../components/table/data-table';
import { type Column } from '../../components/table/types';
import { http } from '../../lib/api';
import { formatDateTime } from '../../lib/format';

interface AuditItem {
  id: string;
  action: string;
  entityType: string | null;
  entityId: string | null;
  data: Record<string, unknown> | null;
  ip: string | null;
  createdAt: string;
  user: { name: string; email: string } | null;
}

const AREAS = [
  { value: 'auth', label: 'Anmeldung' },
  { value: 'company', label: 'Firmen' },
  { value: 'member', label: 'Benutzer' },
  { value: 'role', label: 'Rollen' },
  { value: 'custom_field', label: 'Eigene Felder' },
  { value: 'account', label: 'Account' },
  { value: 'dashboard', label: 'Dashboard' },
  { value: 'security', label: 'Sicherheit' },
];

const columns: Column<AuditItem>[] = [
  {
    id: 'createdAt',
    header: 'Zeitpunkt',
    kind: 'date',
    sortable: true,
    width: 170,
    value: (i) => i.createdAt,
    text: (i) => formatDateTime(i.createdAt),
  },
  {
    id: 'area',
    header: 'Bereich',
    kind: 'enum',
    groupable: true,
    width: 130,
    options: AREAS,
    value: (i) => i.action.split('.')[0],
    text: (i) => AREAS.find((a) => a.value === i.action.split('.')[0])?.label ?? i.action,
  },
  {
    id: 'action',
    header: 'Aktion',
    kind: 'string',
    sortable: true,
    width: 260,
    value: (i) => i.action,
    text: (i) => ACTION_LABELS[i.action] ?? i.action,
  },
  {
    id: 'user',
    header: 'Person',
    kind: 'string',
    sortable: true,
    groupable: true,
    width: 200,
    value: (i) => i.user?.name ?? 'System',
    cell: (i) =>
      i.user ? (
        <div className="truncate">
          <p className="truncate">{i.user.name}</p>
          <p className="truncate text-xs text-muted">{i.user.email}</p>
        </div>
      ) : (
        <span className="text-muted">System</span>
      ),
  },
  {
    id: 'details',
    header: 'Details',
    kind: 'string',
    filterable: false,
    width: 320,
    value: (i) => changeSummary(i.data).join(' · '),
    cell: (i) => {
      const c = changeSummary(i.data);
      return c.length ? (
        <span title={c.join('\n')}>{c.join(' · ')}</span>
      ) : i.data ? (
        <details onClick={(e) => e.stopPropagation()}>
          <summary className="cursor-pointer text-primary">anzeigen</summary>
          <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-surface-2 p-2 text-xs">
            {JSON.stringify(i.data, null, 2)}
          </pre>
        </details>
      ) : (
        '–'
      );
    },
  },
  { id: 'ip', header: 'IP', kind: 'string', defaultHidden: true, width: 130, value: (i) => i.ip },
];

export function AuditPage() {
  const q = useInfiniteQuery({
    queryKey: ['audit'],
    initialPageParam: '',
    queryFn: ({ pageParam }) =>
      http.get<{ items: AuditItem[]; nextCursor: string | null }>(
        `/admin/audit?limit=200${pageParam ? `&cursor=${pageParam}` : ''}`,
      ),
    getNextPageParam: (p) => p.nextCursor ?? undefined,
  });
  const rows = q.data?.pages.flatMap((p) => p.items);
  return (
    <>
      <PageHeader
        title="Audit-Log"
        description="Lückenloses, unveränderliches Protokoll aller wichtigen Änderungen in diesem Account."
      />
      <DataTable<AuditItem>
        tableKey="audit"
        mode="client"
        rows={rows}
        loading={q.isPending}
        error={q.error}
        columns={columns}
        rowId={(i) => i.id}
        exportName="audit-log"
        initial={{ sort: 'createdAt:desc' }}
        footer={
          q.hasNextPage && (
            <Button
              variant="secondary"
              size="sm"
              loading={q.isFetchingNextPage}
              onClick={() => q.fetchNextPage()}
            >
              Ältere Einträge laden
            </Button>
          )
        }
      />
    </>
  );
}
