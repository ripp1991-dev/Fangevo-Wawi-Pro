import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ArrowRight, Building2, Mail, ShieldCheck, Users } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { ORDER_STATUSES, type OrderStatus, type WidgetType } from '@fangevo/shared';
import { Badge, Spinner } from '@fangevo/ui';
import { ActivityList } from '../../components/activity-list';
import { NotificationList, notificationsQuery } from '../../components/notification-bell';
import { http } from '../../lib/api';
import { daysUntil, formatDate } from '../../lib/format';
import { type Invitation, type Member } from '../../lib/types';
import { useCan, useSession } from '../../lib/session';

export interface WidgetProps {
  config: Record<string, unknown>;
  onConfig: (c: Record<string, unknown>) => void;
  editing: boolean;
}

function QuickLinks() {
  const can = useCan();
  const s = useSession();
  const links = [
    {
      to: '/admin/companies',
      label: 'Firmen verwalten',
      icon: Building2,
      ok: can('companies.read'),
    },
    { to: '/admin/members', label: 'Team einladen', icon: Users, ok: can('users.manage') },
    {
      to: '/settings/security',
      label: s.user.mfaEnabled ? 'Sicherheit' : 'Zwei-Faktor einrichten',
      icon: ShieldCheck,
      ok: true,
    },
  ].filter((l) => l.ok);
  return (
    <div className="grid h-full gap-2 sm:grid-cols-3">
      {links.map((l) => (
        <Link
          key={l.to}
          to={l.to}
          className="group flex items-center gap-3 rounded-lg border border-border px-3 py-2.5 text-sm font-medium hover:bg-surface-2"
        >
          <l.icon className="size-4 text-primary" />
          <span className="flex-1">{l.label}</span>
          <ArrowRight className="size-3.5 text-muted transition-transform group-hover:translate-x-0.5" />
        </Link>
      ))}
    </div>
  );
}

function Notifications() {
  const q = useQuery(notificationsQuery);
  if (q.isPending) return <Spinner />;
  const unread = (q.data?.items ?? []).filter((n) => !n.readAt);
  return unread.length ? (
    <NotificationList items={unread.slice(0, 8)} />
  ) : (
    <p className="py-6 text-center text-sm text-muted">Alles gelesen</p>
  );
}

interface License {
  planName: string;
  status: string;
  trialEndsAt: string | null;
  limits: { companies: number; users: number | null };
  usage: { companies: number; users: number; openInvitations: number };
}

function LicenseWidget() {
  const q = useQuery({ queryKey: ['license'], queryFn: () => http.get<License>('/admin/license') });
  if (!q.data) return <Spinner />;
  const l = q.data;
  const days = l.status === 'TRIAL' ? daysUntil(l.trialEndsAt) : null;
  return (
    <div className="space-y-3 text-sm">
      <p>
        Paket <strong>{l.planName}</strong>{' '}
        <Badge tone={l.status === 'ACTIVE' || l.status === 'TRIAL' ? 'success' : 'warning'}>
          {l.status === 'TRIAL' ? 'Testphase' : l.status}
        </Badge>
      </p>
      {days !== null && (
        <p className="text-muted">
          Test endet am {formatDate(l.trialEndsAt)} ({Math.max(days, 0)} Tage)
        </p>
      )}
      <Meter label="Firmen" used={l.usage.companies} limit={l.limits.companies} />
      <Meter
        label="Benutzer"
        used={l.usage.users + l.usage.openInvitations}
        limit={l.limits.users}
      />
    </div>
  );
}

function Meter({ label, used, limit }: { label: string; used: number; limit: number | null }) {
  const pct = limit ? Math.min(100, (used / limit) * 100) : 0;
  return (
    <div>
      <div className="flex justify-between text-xs">
        <span>{label}</span>
        <span>
          {used} / {limit ?? '∞'}
        </span>
      </div>
      <div className="mt-1 h-1.5 rounded-full bg-surface-2">
        {limit !== null && (
          <div className="h-1.5 rounded-full bg-primary" style={{ width: `${pct}%` }} />
        )}
      </div>
    </div>
  );
}

function Team() {
  const members = useQuery({
    queryKey: ['members'],
    queryFn: () => http.get<Member[]>('/admin/members'),
  });
  const inv = useQuery({
    queryKey: ['invitations'],
    queryFn: () => http.get<Invitation[]>('/admin/members/invitations'),
  });
  if (!members.data) return <Spinner />;
  const active = members.data.filter((m) => m.status === 'ACTIVE');
  return (
    <div className="space-y-3 text-sm">
      <div className="flex gap-6">
        <Stat value={active.length} label="aktive Personen" />
        <Stat value={inv.data?.length ?? 0} label="offene Einladungen" />
        <Stat value={active.filter((m) => m.user.mfaEnabled).length} label="mit Zwei-Faktor" />
      </div>
      <ul className="space-y-1">
        {(inv.data ?? []).slice(0, 3).map((i) => (
          <li key={i.id} className="flex items-center gap-2 text-muted">
            <Mail className="size-3.5" /> {i.email}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div>
      <p className="text-2xl font-semibold tabular-nums">{value}</p>
      <p className="text-xs text-muted">{label}</p>
    </div>
  );
}

function Companies() {
  const s = useSession();
  const list = s.account?.companies ?? [];
  return (
    <ul className="space-y-1.5 text-sm">
      {list.map((c) => (
        <li key={c.id} className="flex items-center gap-2">
          <Building2 className="size-3.5 text-muted" /> {c.name}
        </li>
      ))}
    </ul>
  );
}

/** Notiz: wird nach kurzer Tipp-Pause und beim Verlassen des Feldes gespeichert. */
function Note({ config, onConfig }: WidgetProps) {
  const [text, setText] = useState(String(config.text ?? ''));
  const saved = useRef(String(config.text ?? ''));
  const latest = useRef(onConfig);
  latest.current = onConfig;
  const flush = (value: string) => {
    if (value === saved.current) return;
    saved.current = value;
    latest.current({ text: value });
  };
  useEffect(() => {
    const t = setTimeout(() => flush(text), 800);
    return () => clearTimeout(t);
  }, [text]);
  return (
    <textarea
      aria-label="Notiztext"
      className="h-full w-full resize-none rounded-lg bg-warning/5 p-2 text-sm outline-none focus:ring-2 focus:ring-ring"
      placeholder="Notizen …"
      maxLength={4000}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => flush(text)}
    />
  );
}

function LowStock() {
  const q = useQuery({
    queryKey: ['low-stock'],
    queryFn: () =>
      http.get<
        {
          id: string;
          number: string;
          name: string;
          unit: string;
          minStock: string;
          stock: string;
        }[]
      >('/inventory/low-stock'),
  });
  if (!q.data) return <Spinner />;
  if (!q.data.length)
    return <p className="py-6 text-center text-sm text-muted">Alle Artikel über Mindestbestand</p>;
  return (
    <ul className="divide-y divide-border text-sm">
      {q.data.slice(0, 12).map((a) => (
        <li key={a.id} className="flex items-center justify-between gap-2 py-1.5">
          <Link to="/articles" search={{ id: a.id }} className="truncate hover:underline">
            {a.number} · {a.name}
          </Link>
          <span className="shrink-0 tabular-nums text-warning">
            {Number(a.stock).toLocaleString('de-DE')} / {Number(a.minStock).toLocaleString('de-DE')}{' '}
            {a.unit}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Revenue() {
  const q = useQuery({
    queryKey: ['revenue-stats'],
    queryFn: () =>
      http.get<{
        today: { net: string };
        week: { net: string };
        month: { net: string };
        openInvoices: { count: number; totalGross: string };
      }>('/documents/stats'),
  });
  if (!q.data) return <Spinner />;
  const eur = (v: string) =>
    Number(v).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
  const cells = [
    { label: 'Heute', value: eur(q.data.today.net) },
    { label: 'Diese Woche', value: eur(q.data.week.net) },
    { label: 'Dieser Monat', value: eur(q.data.month.net) },
    {
      label: `Offene Rechnungen (${q.data.openInvoices.count})`,
      value: eur(q.data.openInvoices.totalGross),
    },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {cells.map((c) => (
        <div key={c.label}>
          <p className="text-xs text-muted">{c.label}</p>
          <p className="text-lg font-semibold tabular-nums">{c.value}</p>
        </div>
      ))}
      <p className="col-span-full text-xs text-muted">
        Netto, aus festgeschriebenen Rechnungen abzüglich Gutschriften und Stornos.
      </p>
    </div>
  );
}

interface OrderStats {
  open: { status: string; count: number; totalGross: string }[];
  openCount: number;
  topSellers: { articleId: string; number: string; name: string; quantity: string; net: string }[];
}
const orderStatsQuery = {
  queryKey: ['order-stats'],
  queryFn: () => http.get<OrderStats>('/orders/stats'),
};

function OpenOrders() {
  const q = useQuery(orderStatsQuery);
  if (!q.data) return <Spinner />;
  if (!q.data.openCount)
    return <p className="py-6 text-center text-sm text-muted">Keine offenen Aufträge</p>;
  return (
    <div className="space-y-2 text-sm">
      <p>
        <Link to="/orders" className="text-2xl font-semibold hover:underline">
          {q.data.openCount}
        </Link>{' '}
        offene Aufträge
      </p>
      <ul className="divide-y divide-border">
        {q.data.open.map((g) => (
          <li key={g.status} className="flex justify-between gap-2 py-1">
            <span>{ORDER_STATUSES[g.status as OrderStatus] ?? g.status}</span>
            <span className="tabular-nums text-muted">{g.count}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function TopSellers() {
  const q = useQuery(orderStatsQuery);
  if (!q.data) return <Spinner />;
  if (!q.data.topSellers.length)
    return (
      <p className="py-6 text-center text-sm text-muted">
        Noch keine Verkäufe in den letzten 30 Tagen
      </p>
    );
  return (
    <ol className="divide-y divide-border text-sm">
      {q.data.topSellers.map((a, i) => (
        <li key={a.articleId} className="flex items-center justify-between gap-2 py-1.5">
          <Link to="/articles" search={{ id: a.articleId }} className="truncate hover:underline">
            {i + 1}. {a.number} · {a.name}
          </Link>
          <span className="shrink-0 tabular-nums text-muted">
            {Number(a.quantity).toLocaleString('de-DE')} ·{' '}
            {Number(a.net).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}
          </span>
        </li>
      ))}
    </ol>
  );
}

function OpenReturns() {
  const q = useQuery({
    queryKey: ['open-returns'],
    queryFn: () =>
      http.get<{
        items: {
          id: string;
          number: string;
          orderNumber: string | null;
          customerName: string | null;
        }[];
        total: number;
      }>(
        `/returns?pageSize=8&filters=${encodeURIComponent(JSON.stringify([{ field: 'status', op: 'eq', value: 'open' }]))}`,
      ),
  });
  if (!q.data) return <Spinner />;
  if (!q.data.total)
    return <p className="py-6 text-center text-sm text-muted">Keine offenen Retouren</p>;
  return (
    <div className="space-y-2 text-sm">
      <p>
        <Link to="/returns" className="text-2xl font-semibold hover:underline">
          {q.data.total}
        </Link>{' '}
        angemeldet, Ware noch nicht da
      </p>
      <ul className="divide-y divide-border">
        {q.data.items.map((r) => (
          <li key={r.id} className="flex justify-between gap-2 py-1">
            <span>{r.number}</span>
            <span className="truncate text-muted">
              {r.orderNumber} · {r.customerName}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Activity({ config }: WidgetProps) {
  return <ActivityList limit={Number(config.limit ?? 8)} compact />;
}

export const WIDGET_COMPONENTS: Record<WidgetType, (p: WidgetProps) => ReactNode> = {
  quicklinks: QuickLinks,
  activity: Activity,
  notifications: Notifications,
  license: LicenseWidget,
  team: Team,
  companies: Companies,
  low_stock: LowStock,
  revenue: Revenue,
  open_orders: OpenOrders,
  top_sellers: TopSellers,
  open_returns: OpenReturns,
  note: Note,
};

export function useInvalidateDashboards() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ['dashboards'] });
}
