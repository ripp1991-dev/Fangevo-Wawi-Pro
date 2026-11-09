import { Link, Outlet, useNavigate, useRouterState } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowDown,
  ArrowUp,
  Building2,
  ChevronsUpDown,
  KeyRound,
  LogOut,
  Menu,
  PanelLeft,
  Star,
  X,
} from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { Alert, Badge, Button, Checkbox, Dialog, Select, cn } from '@fangevo/ui';
import { http } from '../lib/api';
import { daysUntil } from '../lib/format';
import {
  NAV_GROUPS,
  allowedItems,
  applyOrder,
  type NavItem,
  type NavPreference,
} from '../lib/navigation';
import { resolveActiveCompany, storeActiveCompany, useCan, useSession } from '../lib/session';
import { CommandPalette } from './command-palette';
import { Logo } from './logo';
import { NotificationBell } from './notification-bell';
import { ThemeToggle } from './theme-toggle';

const EMPTY_NAV: NavPreference = { hidden: [], order: [], favorites: [] };

function useNav() {
  const s = useSession();
  const q = useQuery({
    queryKey: ['preferences', 'nav'],
    queryFn: () =>
      http.get<{
        value: NavPreference | null;
        personal: NavPreference | null;
        accountDefault: NavPreference | null;
      }>('/preferences/nav'),
    enabled: !!s.account,
  });
  const pref = { ...EMPTY_NAV, ...(q.data?.value ?? {}) };
  const allowed = allowedItems(
    new Set(s.account?.permissions ?? []),
    new Set((s.account?.license.modules ?? []).map((m) => m.key)),
  );
  const ordered = applyOrder(allowed, pref.order);
  const visible = ordered.filter((i) => !pref.hidden.includes(i.to) || i.to === '/');
  const favorites = pref.favorites
    .map((f) => allowed.find((i) => i.to === f))
    .filter((i): i is NavItem => !!i);
  return { allowed, ordered, visible, favorites, pref, data: q.data };
}

export function AppShell() {
  const [open, setOpen] = useState(false);
  const [customize, setCustomize] = useState(false);
  const path = useRouterState({ select: (r) => r.location.pathname });
  const nav = useNav();

  const link = (it: NavItem, key: string) => {
    const active = it.to === '/' ? path === '/' : path.startsWith(it.to);
    return (
      <li key={key}>
        <Link
          to={it.to}
          onClick={() => setOpen(false)}
          className={cn(
            'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
            active ? 'bg-primary/10 text-primary' : 'text-fg/80 hover:bg-surface-2 hover:text-fg',
          )}
          aria-current={active ? 'page' : undefined}
        >
          <it.icon className="size-4" />
          {it.label}
        </Link>
      </li>
    );
  };

  const navEl = (
    <nav
      className="flex flex-1 flex-col gap-6 overflow-y-auto px-3 py-4"
      aria-label="Hauptnavigation"
    >
      {nav.favorites.length > 0 && (
        <div>
          <p className="mb-1.5 flex items-center gap-1 px-3 text-xs font-medium uppercase tracking-wider text-muted">
            <Star className="size-3" /> Favoriten
          </p>
          <ul className="space-y-0.5">{nav.favorites.map((it) => link(it, `fav:${it.to}`))}</ul>
        </div>
      )}
      {(Object.keys(NAV_GROUPS) as (keyof typeof NAV_GROUPS)[]).map((g) => {
        const items = nav.visible.filter((i) => i.group === g);
        if (!items.length) return null;
        return (
          <div key={g}>
            {NAV_GROUPS[g] && (
              <p className="mb-1.5 px-3 text-xs font-medium uppercase tracking-wider text-muted">
                {NAV_GROUPS[g]}
              </p>
            )}
            <ul className="space-y-0.5">{items.map((it) => link(it, it.to))}</ul>
          </div>
        );
      })}
      <button
        onClick={() => setCustomize(true)}
        className="mt-auto flex items-center gap-2 rounded-lg px-3 py-2 text-xs text-muted hover:bg-surface-2 hover:text-fg"
      >
        <PanelLeft className="size-3.5" /> Menü anpassen
      </button>
    </nav>
  );

  return (
    <div className="flex min-h-full">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-border bg-surface lg:flex">
        <div className="flex h-16 items-center border-b border-border px-5">
          <Logo />
        </div>
        <AccountSwitcher />
        {navEl}
        <UserMenu />
      </aside>

      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-72 flex-col bg-surface shadow-xl">
            <div className="flex h-16 items-center justify-between border-b border-border px-5">
              <Logo />
              <button
                onClick={() => setOpen(false)}
                aria-label="Menü schließen"
                className="rounded-md p-1 hover:bg-surface-2"
              >
                <X className="size-5" />
              </button>
            </div>
            <AccountSwitcher />
            {navEl}
            <UserMenu />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-2 border-b border-border bg-surface/80 px-4 backdrop-blur lg:px-8">
          <button
            className="rounded-md p-1.5 hover:bg-surface-2 lg:hidden"
            onClick={() => setOpen(true)}
            aria-label="Menü öffnen"
          >
            <Menu className="size-5" />
          </button>
          <div className="min-w-0 flex-1">
            <CommandPalette items={nav.visible} />
          </div>
          <CompanySwitcher />
          <NotificationBell />
          <ThemeToggle />
        </header>
        <LicenseBanner />
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 lg:px-8">
          <Outlet />
        </main>
      </div>
      {customize && <CustomizeNav onClose={() => setCustomize(false)} />}
    </div>
  );
}

/** Menü anpassen: ausblenden, sortieren, Favoriten; Admins können es als Standard festlegen. */
function CustomizeNav({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const can = useCan();
  const nav = useNav();
  const [pref, setPref] = useState<NavPreference>(nav.pref);
  const [msg, setMsg] = useState<string | null>(null);
  const items = applyOrder(
    nav.allowed,
    pref.order.length ? pref.order : nav.ordered.map((i) => i.to),
  );
  const ids = items.map((i) => i.to);
  const move = (i: number, d: -1 | 1) => {
    const n = [...ids];
    const j = i + d;
    if (j < 0 || j >= n.length) return;
    [n[i], n[j]] = [n[j]!, n[i]!];
    setPref({ ...pref, order: n });
  };
  const toggle = (list: 'hidden' | 'favorites', id: string, on: boolean) =>
    setPref({
      ...pref,
      [list]: on ? [...new Set([...pref[list], id])] : pref[list].filter((x) => x !== id),
    });
  const done = async (fn: () => Promise<unknown>, text: string) => {
    await fn();
    await qc.invalidateQueries({ queryKey: ['preferences', 'nav'] });
    setMsg(text);
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title="Menü anpassen"
      description="Blenden Sie Einträge aus, ändern Sie die Reihenfolge und heften Sie Favoriten oben an."
      footer={
        <>
          {nav.data?.personal && (
            <Button
              variant="ghost"
              onClick={() =>
                done(
                  () => http.put('/preferences/nav/reset', {}),
                  'Persönliche Anpassung verworfen.',
                ).then(onClose)
              }
            >
              Auf Standard zurücksetzen
            </Button>
          )}
          <Button
            onClick={() =>
              done(() => http.put('/preferences/nav', pref), 'Gespeichert.').then(onClose)
            }
          >
            Speichern
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {msg && <Alert tone="success">{msg}</Alert>}
        <ul className="divide-y divide-border rounded-lg border border-border">
          {items.map((it, i) => (
            <li key={it.to} className="flex items-center gap-3 px-3 py-2">
              <it.icon className="size-4 text-muted" />
              <span className="flex-1 text-sm">{it.label}</span>
              <button
                className={cn(
                  'rounded p-1',
                  pref.favorites.includes(it.to) ? 'text-warning' : 'text-muted hover:text-fg',
                )}
                aria-label={`${it.label} als Favorit`}
                aria-pressed={pref.favorites.includes(it.to)}
                onClick={() => toggle('favorites', it.to, !pref.favorites.includes(it.to))}
              >
                <Star
                  className="size-4"
                  fill={pref.favorites.includes(it.to) ? 'currentColor' : 'none'}
                />
              </button>
              {it.to !== '/' && (
                <Checkbox
                  label={<span className="sr-only">{it.label} anzeigen</span>}
                  checked={!pref.hidden.includes(it.to)}
                  onChange={(e) => toggle('hidden', it.to, !e.target.checked)}
                />
              )}
              <button
                className="rounded p-1 text-muted hover:text-fg disabled:opacity-30"
                disabled={i === 0}
                onClick={() => move(i, -1)}
                aria-label={`${it.label} nach oben`}
              >
                <ArrowUp className="size-4" />
              </button>
              <button
                className="rounded p-1 text-muted hover:text-fg disabled:opacity-30"
                disabled={i === items.length - 1}
                onClick={() => move(i, 1)}
                aria-label={`${it.label} nach unten`}
              >
                <ArrowDown className="size-4" />
              </button>
            </li>
          ))}
        </ul>
        {can('account.manage') && (
          <div className="rounded-lg bg-surface-2 p-3 text-sm">
            <p className="font-medium">Für alle im Account</p>
            <p className="mb-2 text-xs text-muted">
              Legt diese Einstellung als Standard fest. Jede Person kann sie für sich weiter
              anpassen.
            </p>
            <Button
              size="sm"
              variant="secondary"
              onClick={() =>
                done(
                  () => http.put('/admin/preferences/nav', pref),
                  'Als Standard für alle festgelegt.',
                )
              }
            >
              Als Standard festlegen
            </Button>
          </div>
        )}
      </div>
    </Dialog>
  );
}

function LicenseBanner(): ReactNode {
  const s = useSession();
  const acc = s.account;
  if (!acc) return null;
  if (acc.accessMode === 'read_only') {
    return (
      <div className="px-4 pt-4 lg:px-8">
        <Alert tone="warning" title="Nur-Lese-Modus">
          Ihr Account ist gesperrt oder die Lizenz ist abgelaufen. Sie können alle Daten weiterhin
          ansehen und exportieren, aber nichts ändern. Ihre Daten bleiben vollständig erhalten.
        </Alert>
      </div>
    );
  }
  const days = acc.license.status === 'TRIAL' ? daysUntil(acc.license.trialEndsAt) : null;
  if (days !== null && days <= 14) {
    return (
      <div className="border-b border-border bg-primary/5 px-4 py-2 text-center text-sm text-fg lg:px-8">
        Testzeitraum: noch <strong>{Math.max(days, 0)} Tage</strong>.
      </div>
    );
  }
  return null;
}

function AccountSwitcher() {
  const s = useSession();
  const qc = useQueryClient();
  const navigate = useNavigate();
  if (!s.accounts || s.accounts.length < 2) {
    return s.account ? (
      <div className="border-b border-border px-5 py-3">
        <p className="text-xs text-muted">Account</p>
        <p className="truncate text-sm font-medium">{s.account.name}</p>
      </div>
    ) : null;
  }
  return (
    <div className="border-b border-border px-4 py-3">
      <label className="mb-1 block text-xs text-muted" htmlFor="account-switch">
        Account
      </label>
      <Select
        id="account-switch"
        value={s.account?.id ?? ''}
        onChange={async (e) => {
          await http.post('/auth/switch-account', { accountId: e.target.value });
          await qc.invalidateQueries();
          await navigate({ to: '/' });
        }}
      >
        {s.accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </Select>
    </div>
  );
}

function CompanySwitcher() {
  const s = useSession();
  const qc = useQueryClient();
  const [active, setActive] = useState(() => resolveActiveCompany(s));
  const companies = s.account?.companies ?? [];
  if (!companies.length) return null;
  return (
    <div className="relative flex items-center">
      <Building2 className="pointer-events-none absolute left-3 size-4 text-muted" aria-hidden />
      <label htmlFor="company-switch" className="sr-only">
        Aktive Firma
      </label>
      <select
        id="company-switch"
        className="h-9 appearance-none rounded-lg border border-border bg-surface pl-9 pr-8 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        value={active ?? ''}
        onChange={async (e) => {
          storeActiveCompany(s.account!.id, e.target.value);
          setActive(e.target.value);
          await qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== 'session' });
        }}
      >
        {companies.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <ChevronsUpDown
        className="pointer-events-none absolute right-2.5 size-4 text-muted"
        aria-hidden
      />
    </div>
  );
}

function UserMenu() {
  const s = useSession();
  const qc = useQueryClient();
  const navigate = useNavigate();
  return (
    <div className="border-t border-border p-3">
      <div className="flex items-center gap-3 rounded-lg px-2 py-2">
        <div
          className="grid size-8 shrink-0 place-items-center rounded-full bg-surface-3 text-xs font-semibold"
          aria-hidden
        >
          {s.user.name.slice(0, 2).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{s.user.name}</p>
          <p className="truncate text-xs text-muted">{s.user.email}</p>
        </div>
        {s.account?.isOwner && <Badge tone="primary">Inhaber</Badge>}
      </div>
      <div className="mt-1 grid gap-0.5">
        <Link
          to="/settings/security"
          className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-fg/80 hover:bg-surface-2"
        >
          <KeyRound className="size-4" /> Profil & Sicherheit
        </Link>
        <button
          className="flex items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-fg/80 hover:bg-surface-2"
          onClick={async () => {
            await http.post('/auth/logout');
            qc.clear();
            await navigate({ to: '/login' });
          }}
        >
          <LogOut className="size-4" /> Abmelden
        </button>
      </div>
    </div>
  );
}
