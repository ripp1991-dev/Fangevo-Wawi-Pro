import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Building2, CornerDownLeft, Search, ShieldCheck, User } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@fangevo/ui';
import { http } from '../lib/api';
import { type NavItem } from '../lib/navigation';

interface Hit {
  entityType: string;
  entityId: string;
  title: string;
  subtitle: string | null;
  url: string;
}

const ICONS: Record<string, typeof Building2> = {
  company: Building2,
  member: User,
  role: ShieldCheck,
};
const TYPE_LABEL: Record<string, string> = { company: 'Firma', member: 'Benutzer', role: 'Rolle' };

/** Globale Suche und Befehlspalette (Strg+K / ⌘K). */
export function CommandPalette({ items }: { items: NavItem[] }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [active, setActive] = useState(0);
  const navigate = useNavigate();
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => {
    const d = dialog.current;
    if (open && d && !d.open) d.showModal();
    if (!open && d?.open) d.close();
    if (!open) {
      setQ('');
      setDebounced('');
    }
  }, [open]);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 200);
    return () => clearTimeout(t);
  }, [q]);

  const search = useQuery({
    queryKey: ['search', debounced],
    queryFn: () =>
      http.get<{ items: Hit[] }>(`/search?q=${encodeURIComponent(debounced)}&limit=12`),
    enabled: open && debounced.length >= 2,
  });
  const menuHits = useMemo(() => {
    const n = q.trim().toLowerCase();
    return items
      .filter((i) => !n || `${i.label} ${i.keywords ?? ''}`.toLowerCase().includes(n))
      .slice(0, 6);
  }, [items, q]);
  const results = [
    ...menuHits.map((m) => ({
      key: `nav:${m.to}`,
      title: m.label,
      subtitle: 'Seite öffnen',
      to: m.to,
      Icon: m.icon,
    })),
    ...(search.data?.items ?? []).map((h) => ({
      key: `${h.entityType}:${h.entityId}`,
      title: h.title,
      subtitle: [TYPE_LABEL[h.entityType], h.subtitle].filter(Boolean).join(' · '),
      to: h.url,
      Icon: ICONS[h.entityType] ?? Search,
    })),
  ];
  useEffect(() => setActive(0), [q, search.data]);

  const go = async (to: string) => {
    setOpen(false);
    const [path, query] = to.split('?');
    await navigate({
      to: path!,
      search: query ? Object.fromEntries(new URLSearchParams(query)) : undefined,
    });
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex h-9 w-full max-w-xs items-center gap-2 rounded-lg border border-border bg-surface px-3 text-sm text-muted hover:border-fg/20"
        aria-label="Suchen (Strg+K)"
      >
        <Search className="size-4" />
        <span className="hidden flex-1 text-left sm:inline">Suchen …</span>
        <kbd className="hidden rounded border border-border px-1.5 text-[10px] font-medium sm:inline">
          Strg K
        </kbd>
      </button>
      <dialog
        ref={dialog}
        onClose={() => setOpen(false)}
        onCancel={(e) => {
          e.preventDefault();
          setOpen(false);
        }}
        onClick={(e) => e.target === dialog.current && setOpen(false)}
        className="mx-auto mt-[12vh] w-[calc(100%-2rem)] max-w-xl rounded-xl border border-border bg-surface p-0 text-fg shadow-2xl backdrop:bg-black/40 backdrop:backdrop-blur-sm"
      >
        {open && (
          <div>
            <div className="flex items-center gap-3 border-b border-border px-4">
              <Search className="size-4 text-muted" />
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Firmen, Personen, Rollen oder Seiten suchen …"
                aria-label="Suchbegriff"
                className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-muted"
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setActive((a) => Math.min(a + 1, results.length - 1));
                  }
                  if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setActive((a) => Math.max(a - 1, 0));
                  }
                  if (e.key === 'Enter' && results[active]) void go(results[active].to);
                }}
              />
            </div>
            <ul className="max-h-[50vh] overflow-y-auto p-2" role="listbox" aria-label="Ergebnisse">
              {results.map((r, i) => (
                <li key={r.key} role="option" aria-selected={i === active}>
                  <button
                    className={cn(
                      'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left',
                      i === active ? 'bg-primary/10' : 'hover:bg-surface-2',
                    )}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => go(r.to)}
                  >
                    <r.Icon className="size-4 shrink-0 text-muted" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{r.title}</span>
                      <span className="block truncate text-xs text-muted">{r.subtitle}</span>
                    </span>
                    {i === active && <CornerDownLeft className="size-3.5 text-muted" />}
                  </button>
                </li>
              ))}
              {!results.length && (
                <li className="px-3 py-6 text-center text-sm text-muted">
                  {debounced.length >= 2 && search.isFetching ? 'Sucht …' : 'Keine Treffer'}
                </li>
              )}
            </ul>
          </div>
        )}
      </dialog>
    </>
  );
}
