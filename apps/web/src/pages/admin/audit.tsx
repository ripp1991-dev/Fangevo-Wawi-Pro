import { useInfiniteQuery } from '@tanstack/react-query';
import { FileClock } from 'lucide-react';
import { useState } from 'react';
import {
  Alert,
  Button,
  Card,
  EmptyState,
  PageHeader,
  Select,
  Spinner,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
} from '@fangevo/ui';
import { errorMessage, http } from '../../lib/api';
import { formatDateTime } from '../../lib/format';

interface AuditItem {
  id: string;
  action: string;
  entityType: string | null;
  entityId: string | null;
  data: unknown;
  ip: string | null;
  createdAt: string;
  user: { name: string; email: string } | null;
}

const ACTIONS: Record<string, string> = {
  'account.created': 'Account angelegt',
  'account.updated': 'Account geändert',
  'auth.login': 'Anmeldung',
  'company.created': 'Firma angelegt',
  'company.updated': 'Firma geändert',
  'company.archived': 'Firma archiviert',
  'company.restored': 'Firma wiederhergestellt',
  'member.invited': 'Person eingeladen',
  'member.invitation_revoked': 'Einladung widerrufen',
  'member.joined': 'Person beigetreten',
  'member.access_changed': 'Rechte geändert',
  'member.disabled': 'Person gesperrt',
  'member.enabled': 'Person entsperrt',
  'role.created': 'Rolle angelegt',
  'role.updated': 'Rolle geändert',
  'role.deleted': 'Rolle gelöscht',
};

export function AuditPage() {
  const [filter, setFilter] = useState('');
  const q = useInfiniteQuery({
    queryKey: ['audit', filter],
    initialPageParam: '',
    queryFn: ({ pageParam }) =>
      http.get<{ items: AuditItem[]; nextCursor: string | null }>(
        `/admin/audit?limit=50${pageParam ? `&cursor=${pageParam}` : ''}${filter ? `&action=${filter}` : ''}`,
      ),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <>
      <PageHeader
        title="Audit-Log"
        description="Lückenloses, unveränderliches Protokoll aller wichtigen Änderungen in diesem Account."
      />
      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
          <label htmlFor="audit-filter" className="text-sm text-muted">
            Bereich
          </label>
          <Select
            id="audit-filter"
            className="w-56"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="">Alle</option>
            <option value="auth.">Anmeldungen</option>
            <option value="company.">Firmen</option>
            <option value="member.">Benutzer</option>
            <option value="role.">Rollen</option>
            <option value="account.">Account</option>
          </Select>
        </div>
        {q.isPending ? (
          <Spinner />
        ) : q.isError ? (
          <div className="p-4">
            <Alert tone="danger">{errorMessage(q.error)}</Alert>
          </div>
        ) : !items.length ? (
          <EmptyState icon={<FileClock />} title="Keine Einträge" />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Zeitpunkt</TH>
                <TH>Aktion</TH>
                <TH>Person</TH>
                <TH>Details</TH>
              </tr>
            </THead>
            <TBody>
              {items.map((i) => (
                <TR key={i.id}>
                  <TD className="whitespace-nowrap text-muted">{formatDateTime(i.createdAt)}</TD>
                  <TD className="font-medium">{ACTIONS[i.action] ?? i.action}</TD>
                  <TD>
                    {i.user ? (
                      <>
                        {i.user.name}
                        <p className="text-xs text-muted">{i.user.email}</p>
                      </>
                    ) : (
                      <span className="text-muted">System</span>
                    )}
                  </TD>
                  <TD className="max-w-md">
                    {i.data ? (
                      <details>
                        <summary className="cursor-pointer text-sm text-primary">anzeigen</summary>
                        <pre className="mt-2 max-h-48 overflow-auto rounded bg-surface-2 p-2 text-xs">
                          {JSON.stringify(i.data, null, 2)}
                        </pre>
                      </details>
                    ) : (
                      <span className="text-muted">–</span>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
        {q.hasNextPage && (
          <div className="border-t border-border p-3 text-center">
            <Button
              variant="secondary"
              loading={q.isFetchingNextPage}
              onClick={() => q.fetchNextPage()}
            >
              Ältere laden
            </Button>
          </div>
        )}
      </Card>
    </>
  );
}
