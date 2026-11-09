import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Bell, CheckCheck } from 'lucide-react';
import { Button, Popover, cn } from '@fangevo/ui';
import { http } from '../lib/api';
import { formatDateTime } from '../lib/format';

export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

export const notificationsQuery = {
  queryKey: ['notifications'],
  queryFn: () => http.get<{ items: NotificationItem[]; unread: number }>('/notifications?limit=20'),
  // Neue Benachrichtigungen erscheinen ohne Neuladen der Seite
  refetchInterval: 30_000,
  refetchIntervalInBackground: false,
};

export function NotificationList({
  items,
  onNavigate,
}: {
  items: NotificationItem[];
  onNavigate?: () => void;
}) {
  const qc = useQueryClient();
  if (!items.length)
    return <p className="px-1 py-6 text-center text-sm text-muted">Keine Benachrichtigungen</p>;
  const read = async (n: NotificationItem) => {
    if (!n.readAt) await http.post(`/notifications/${n.id}/read`);
    await qc.invalidateQueries({ queryKey: ['notifications'] });
    onNavigate?.();
  };
  return (
    <ul className="divide-y divide-border">
      {items.map((n) => {
        const content = (
          <div className="flex gap-3 py-2.5">
            <span
              className={cn(
                'mt-1.5 size-2 shrink-0 rounded-full',
                n.readAt ? 'bg-transparent' : 'bg-primary',
              )}
              aria-hidden
            />
            <div className="min-w-0">
              <p className={cn('text-sm', !n.readAt && 'font-semibold')}>{n.title}</p>
              {n.body && <p className="truncate text-xs text-muted">{n.body}</p>}
              <p className="text-xs text-muted">{formatDateTime(n.createdAt)}</p>
            </div>
          </div>
        );
        return (
          <li key={n.id}>
            {n.link ? (
              <Link
                to={n.link.split('?')[0]!}
                className="block rounded-md px-1 hover:bg-surface-2"
                onClick={() => read(n)}
              >
                {content}
              </Link>
            ) : (
              <button
                className="block w-full rounded-md px-1 text-left hover:bg-surface-2"
                onClick={() => read(n)}
              >
                {content}
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function NotificationBell() {
  const qc = useQueryClient();
  const q = useQuery(notificationsQuery);
  const unread = q.data?.unread ?? 0;
  return (
    <Popover
      align="right"
      className="w-96 max-w-[calc(100vw-2rem)]"
      trigger={(p) => (
        <Button
          variant="ghost"
          size="icon"
          aria-label={unread ? `Benachrichtigungen, ${unread} ungelesen` : 'Benachrichtigungen'}
          className="relative"
          {...p}
        >
          <Bell />
          {unread > 0 && (
            <span className="absolute -right-0.5 -top-0.5 grid min-w-4 place-items-center rounded-full bg-danger px-1 text-[10px] font-bold leading-4 text-white">
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </Button>
      )}
    >
      {(close) => (
        <div>
          <div className="mb-1 flex items-center justify-between">
            <p className="text-sm font-semibold">Benachrichtigungen</p>
            {unread > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={async () => {
                  await http.post('/notifications/read-all');
                  await qc.invalidateQueries({ queryKey: ['notifications'] });
                }}
              >
                <CheckCheck /> Alle gelesen
              </Button>
            )}
          </div>
          <div className="max-h-96 overflow-y-auto">
            <NotificationList items={q.data?.items ?? []} onNavigate={close} />
          </div>
          <Link
            to="/settings/security"
            hash="benachrichtigungen"
            className="mt-2 block border-t border-border pt-2 text-center text-xs text-primary hover:underline"
            onClick={close}
          >
            Einstellungen
          </Link>
        </div>
      )}
    </Popover>
  );
}
