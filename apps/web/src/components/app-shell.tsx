import { Link, Outlet, useNavigate, useRouterState } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import {
  Building2,
  ChevronsUpDown,
  FileClock,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Menu,
  ShieldCheck,
  Users,
  X,
  BadgeCheck,
  Settings,
} from 'lucide-react';
import { type ComponentType, type ReactNode, useState } from 'react';
import { type Permission } from '@fangevo/shared';
import { Alert, Badge, Select, cn } from '@fangevo/ui';
import { http } from '../lib/api';
import { daysUntil } from '../lib/format';
import { resolveActiveCompany, storeActiveCompany, useSession } from '../lib/session';
import { Logo } from './logo';
import { ThemeToggle } from './theme-toggle';

interface NavItem {
  to: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  permission?: Permission;
}

const NAV: { title?: string; items: NavItem[] }[] = [
  { items: [{ to: '/', label: 'Übersicht', icon: LayoutDashboard }] },
  {
    title: 'Administration',
    items: [
      { to: '/admin/companies', label: 'Firmen', icon: Building2, permission: 'companies.read' },
      { to: '/admin/members', label: 'Benutzer', icon: Users, permission: 'users.read' },
      { to: '/admin/roles', label: 'Rollen & Rechte', icon: ShieldCheck, permission: 'roles.read' },
      { to: '/admin/audit', label: 'Audit-Log', icon: FileClock, permission: 'audit.read' },
      { to: '/admin/license', label: 'Lizenz', icon: BadgeCheck, permission: 'license.read' },
      { to: '/admin/account', label: 'Account', icon: Settings, permission: 'account.manage' },
    ],
  },
];

export function AppShell() {
  const s = useSession();
  const [open, setOpen] = useState(false);
  const path = useRouterState({ select: (r) => r.location.pathname });
  const perms = new Set(s.account?.permissions ?? []);

  const nav = (
    <nav
      className="flex flex-1 flex-col gap-6 overflow-y-auto px-3 py-4"
      aria-label="Hauptnavigation"
    >
      {NAV.map((g, i) => {
        const items = g.items.filter((it) => !it.permission || perms.has(it.permission));
        if (!items.length) return null;
        return (
          <div key={i}>
            {g.title && (
              <p className="mb-1.5 px-3 text-xs font-medium uppercase tracking-wider text-muted">
                {g.title}
              </p>
            )}
            <ul className="space-y-0.5">
              {items.map((it) => {
                const active = it.to === '/' ? path === '/' : path.startsWith(it.to);
                return (
                  <li key={it.to}>
                    <Link
                      to={it.to}
                      onClick={() => setOpen(false)}
                      className={cn(
                        'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                        active
                          ? 'bg-primary/10 text-primary'
                          : 'text-fg/80 hover:bg-surface-2 hover:text-fg',
                      )}
                      aria-current={active ? 'page' : undefined}
                    >
                      <it.icon className="size-4" />
                      {it.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );

  return (
    <div className="flex min-h-full">
      {/* Seitenleiste Desktop */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-border bg-surface lg:flex">
        <div className="flex h-16 items-center border-b border-border px-5">
          <Logo />
        </div>
        <AccountSwitcher />
        {nav}
        <UserMenu />
      </aside>

      {/* Seitenleiste Mobil */}
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
            {nav}
            <UserMenu />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border bg-surface/80 px-4 backdrop-blur lg:px-8">
          <button
            className="rounded-md p-1.5 hover:bg-surface-2 lg:hidden"
            onClick={() => setOpen(true)}
            aria-label="Menü öffnen"
          >
            <Menu className="size-5" />
          </button>
          <div className="lg:hidden">
            <Logo compact />
          </div>
          <div className="flex-1" />
          <CompanySwitcher />
          <ThemeToggle />
        </header>
        <LicenseBanner />
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 lg:px-8">
          <Outlet />
        </main>
      </div>
    </div>
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
