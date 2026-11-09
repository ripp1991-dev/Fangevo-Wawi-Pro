import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Check,
  LayoutGrid,
  Pencil,
  Plus,
  RotateCcw,
  Settings2,
  Share2,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import GridLayout, { type Layout } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import {
  GRID_COLUMNS,
  WIDGETS,
  WIDGET_TYPES,
  type WidgetInstance,
  type WidgetType,
} from '@fangevo/shared';
import { Alert, Button, Card, Dialog, Field, Input, PageHeader, Spinner, cn } from '@fangevo/ui';
import { errorMessage, http } from '../../lib/api';
import { useCan, useSession } from '../../lib/session';
import { WIDGET_COMPONENTS } from './widgets';

/** Breite des Containers selbst messen (zuverlässiger als WidthProvider bei Layout-Änderungen). */
function useWidth<T extends HTMLElement>(): [(el: T | null) => void, number] {
  const [el, setEl] = useState<T | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!el) return;
    setWidth(Math.floor(el.getBoundingClientRect().width));
    const ro = new ResizeObserver(([e]) => setWidth(Math.floor(e!.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [setEl, width];
}

interface Page {
  id: string;
  name: string;
  position: number;
  widgets: WidgetInstance[];
}

function newId(): string {
  return Math.random().toString(36).slice(2, 10);
}

/** Startseite: frei anpassbares Dashboard mit mehreren Seiten. */
export function DashboardPage() {
  const s = useSession();
  const can = useCan();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['dashboards'],
    queryFn: () =>
      http.get<{ source: 'personal' | 'account' | 'builtin'; pages: Page[] }>('/dashboards'),
  });
  const [pageId, setPageId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<WidgetInstance[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState<'new' | 'rename' | null>(null);
  const [configure, setConfigure] = useState<WidgetInstance | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [isNarrow, setIsNarrow] = useState(() => window.matchMedia('(max-width: 767px)').matches);
  useEffect(() => {
    const m = window.matchMedia('(max-width: 767px)');
    const on = () => setIsNarrow(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);

  const [gridRef, gridWidth] = useWidth<HTMLDivElement>();
  const pages = q.data?.pages ?? [];
  const page = pages.find((p) => p.id === pageId) ?? pages[0];
  const widgets = useMemo(() => draft ?? page?.widgets ?? [], [draft, page]);

  const save = useMutation({
    mutationFn: async (input: { name?: string; widgets: WidgetInstance[] }) => {
      const r = await http.put<{ id: string }>(`/dashboards/${page!.id}`, {
        name: input.name ?? page!.name,
        widgets: input.widgets,
      });
      return r;
    },
    onSuccess: async (r) => {
      setPageId(r.id);
      await qc.invalidateQueries({ queryKey: ['dashboards'] });
    },
    onError: (e) => setErr(errorMessage(e)),
  });

  const layout: Layout[] = useMemo(
    () =>
      widgets.map((w) => ({
        i: w.id,
        x: w.x,
        y: w.y,
        w: w.w,
        h: w.h,
        minW: WIDGETS[w.type].minW,
        minH: WIDGETS[w.type].minH,
      })),
    [widgets],
  );

  if (q.isPending) return <Spinner />;
  if (q.isError) return <Alert tone="danger">{errorMessage(q.error)}</Alert>;

  const first = s.user.name.split(' ')[0];
  const startEdit = () => {
    setDraft(page?.widgets ?? []);
    setEditing(true);
  };
  const finish = async () => {
    if (draft) await save.mutateAsync({ widgets: draft });
    setDraft(null);
    setEditing(false);
  };
  const act = async (fn: () => Promise<unknown>) => {
    setErr(null);
    try {
      await fn();
      await qc.invalidateQueries({ queryKey: ['dashboards'] });
    } catch (e) {
      setErr(errorMessage(e));
    }
  };

  return (
    <>
      <PageHeader
        title={`Hallo ${first}`}
        description={
          q.data.source === 'account'
            ? 'Standard-Ansicht Ihres Accounts. Änderungen gelten nur für Sie.'
            : q.data.source === 'builtin'
              ? 'Passen Sie Ihre Startseite mit „Bearbeiten“ an.'
              : `Account ${s.account?.name}`
        }
        actions={
          editing ? (
            <>
              <Button variant="secondary" onClick={() => setAdding(true)}>
                <Plus /> Widget
              </Button>
              <Button onClick={finish} loading={save.isPending}>
                <Check /> Fertig
              </Button>
            </>
          ) : (
            <Button variant="secondary" onClick={startEdit}>
              <Pencil /> Bearbeiten
            </Button>
          )
        }
      />
      {err && (
        <div className="mb-4">
          <Alert tone="danger">{err}</Alert>
        </div>
      )}

      <div
        className="mb-4 flex flex-wrap items-center gap-1 border-b border-border"
        role="tablist"
        aria-label="Dashboard-Seiten"
      >
        {pages.map((p) => (
          <button
            key={p.id}
            role="tab"
            aria-selected={p.id === page?.id}
            className={cn(
              '-mb-px border-b-2 px-3 py-2 text-sm font-medium',
              p.id === page?.id
                ? 'border-primary text-primary'
                : 'border-transparent text-muted hover:text-fg',
            )}
            onClick={() => {
              if (!editing) setPageId(p.id);
            }}
          >
            {p.name}
          </button>
        ))}
        {editing && (
          <>
            <Button variant="ghost" size="sm" onClick={() => setRenaming('rename')}>
              <Pencil /> Umbenennen
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setRenaming('new')}>
              <Plus /> Seite
            </Button>
            {pages.length > 1 && q.data.source === 'personal' && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  act(async () => {
                    await http.del(`/dashboards/${page!.id}`);
                    setPageId(null);
                    setEditing(false);
                    setDraft(null);
                  })
                }
              >
                <Trash2 /> Seite löschen
              </Button>
            )}
            <div className="flex-1" />
            {q.data.source === 'personal' && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  act(async () => {
                    await http.post('/dashboards/reset');
                    setEditing(false);
                    setDraft(null);
                    setPageId(null);
                  })
                }
              >
                <RotateCcw /> Auf Standard zurücksetzen
              </Button>
            )}
            {can('account.manage') && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  act(async () => {
                    if (draft) await save.mutateAsync({ widgets: draft });
                    await http.post('/admin/dashboards/template');
                  })
                }
              >
                <Share2 /> Als Standard für alle
              </Button>
            )}
          </>
        )}
      </div>

      <div
        ref={gridRef}
        className={cn(save.isPending && editing && 'pointer-events-none opacity-60')}
        aria-busy={save.isPending || undefined}
      >
        {!widgets.length ? (
          <Card className="flex flex-col items-center gap-3 py-16 text-center">
            <LayoutGrid className="size-8 text-muted" />
            <p className="font-medium">Diese Seite ist leer</p>
            <Button
              onClick={() => {
                if (!editing) startEdit();
                setAdding(true);
              }}
            >
              <Plus /> Widget hinzufügen
            </Button>
          </Card>
        ) : isNarrow ? (
          <div className="space-y-4">
            {[...widgets]
              .sort((a, b) => a.y - b.y || a.x - b.x)
              .map((w) => (
                <WidgetFrame
                  key={w.id}
                  w={w}
                  editing={editing}
                  onRemove={() => setDraft(widgets.filter((x) => x.id !== w.id))}
                  onConfigure={() => setConfigure(w)}
                  onConfig={(c) =>
                    save.mutate({
                      widgets: widgets.map((x) => (x.id === w.id ? { ...x, config: c } : x)),
                    })
                  }
                  style={{ minHeight: w.h * 80 }}
                />
              ))}
          </div>
        ) : gridWidth > 0 ? (
          <GridLayout
            width={gridWidth}
            layout={layout}
            cols={GRID_COLUMNS}
            rowHeight={72}
            margin={[16, 16]}
            containerPadding={[0, 0]}
            isDraggable={editing}
            isResizable={editing}
            draggableHandle=".widget-drag"
            onLayoutChange={(l) => {
              if (!editing) return;
              setDraft(
                widgets.map((w) => {
                  const p = l.find((x) => x.i === w.id);
                  return p ? { ...w, x: p.x, y: p.y, w: p.w, h: p.h } : w;
                }),
              );
            }}
          >
            {widgets.map((w) => (
              <div key={w.id}>
                <WidgetFrame
                  w={w}
                  editing={editing}
                  onRemove={() => setDraft(widgets.filter((x) => x.id !== w.id))}
                  onConfigure={() => setConfigure(w)}
                  onConfig={(c) =>
                    editing
                      ? setDraft(widgets.map((x) => (x.id === w.id ? { ...x, config: c } : x)))
                      : save.mutate({
                          widgets: widgets.map((x) => (x.id === w.id ? { ...x, config: c } : x)),
                        })
                  }
                />
              </div>
            ))}
          </GridLayout>
        ) : null}
      </div>

      {adding && (
        <AddWidget
          onClose={() => setAdding(false)}
          onAdd={(type) => {
            const def = WIDGETS[type];
            const y = widgets.reduce((m, w) => Math.max(m, w.y + w.h), 0);
            const next: WidgetInstance = {
              id: newId(),
              type,
              x: 0,
              y,
              w: def.defaultW,
              h: def.defaultH,
              config: def.config.parse({}) as Record<string, unknown>,
            };
            setDraft([...widgets, next]);
            setEditing(true);
            setAdding(false);
          }}
        />
      )}
      {configure && (
        <ConfigureWidget
          w={configure}
          onClose={() => setConfigure(null)}
          onSave={(config) => {
            setDraft(widgets.map((x) => (x.id === configure.id ? { ...x, config } : x)));
            setConfigure(null);
          }}
        />
      )}
      {renaming && (
        <RenamePage
          initial={renaming === 'rename' ? (page?.name ?? '') : ''}
          title={renaming === 'rename' ? 'Seite umbenennen' : 'Neue Dashboard-Seite'}
          onClose={() => setRenaming(null)}
          onSave={(name) =>
            act(async () => {
              if (renaming === 'rename') await save.mutateAsync({ name, widgets });
              else {
                if (draft) await save.mutateAsync({ widgets: draft });
                const r = await http.post<{ id: string }>('/dashboards', { name, widgets: [] });
                setPageId(r.id);
                setDraft([]);
              }
              setRenaming(null);
            })
          }
        />
      )}
    </>
  );
}

function WidgetFrame({
  w,
  editing,
  onRemove,
  onConfigure,
  onConfig,
  style,
}: {
  w: WidgetInstance;
  editing: boolean;
  onRemove: () => void;
  onConfigure: () => void;
  onConfig: (c: Record<string, unknown>) => void;
  style?: React.CSSProperties;
}) {
  const def = WIDGETS[w.type];
  const C = WIDGET_COMPONENTS[w.type];
  return (
    <section
      className={cn(
        'flex h-full flex-col overflow-hidden rounded-xl border bg-surface shadow-xs',
        editing ? 'border-primary/40 border-dashed' : 'border-border',
      )}
      style={style}
      aria-label={def.title}
    >
      <header
        className={cn(
          'flex items-center gap-2 border-b border-border px-4 py-2.5',
          editing && 'widget-drag cursor-move bg-surface-2/50',
        )}
      >
        <h2 className="flex-1 truncate text-sm font-semibold">{def.title}</h2>
        {editing && (
          <>
            {w.type === 'activity' && (
              <button
                className="rounded p-1 text-muted hover:text-fg"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={onConfigure}
                aria-label={`${def.title} einstellen`}
              >
                <Settings2 className="size-4" />
              </button>
            )}
            <button
              className="rounded p-1 text-muted hover:text-danger"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={onRemove}
              aria-label={`${def.title} entfernen`}
            >
              <X className="size-4" />
            </button>
          </>
        )}
      </header>
      <div className="min-h-0 flex-1 overflow-auto p-4">
        <C config={w.config} onConfig={onConfig} editing={editing} />
      </div>
    </section>
  );
}

function AddWidget({ onClose, onAdd }: { onClose: () => void; onAdd: (t: WidgetType) => void }) {
  const can = useCan();
  const available = WIDGET_TYPES.filter(
    (t) => !WIDGETS[t].permission || can(WIDGETS[t].permission!),
  );
  return (
    <Dialog
      open
      onClose={onClose}
      title="Widget hinzufügen"
      description="Weitere Widgets mit Umsätzen, Aufträgen und Beständen folgen mit den Fachmodulen."
    >
      <ul className="grid gap-2 sm:grid-cols-2">
        {available.map((t) => (
          <li key={t}>
            <button
              className="h-full w-full rounded-lg border border-border p-3 text-left hover:border-primary hover:bg-primary/5"
              onClick={() => onAdd(t)}
            >
              <p className="text-sm font-medium">{WIDGETS[t].title}</p>
              <p className="text-xs text-muted">{WIDGETS[t].description}</p>
            </button>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}

function ConfigureWidget({
  w,
  onClose,
  onSave,
}: {
  w: WidgetInstance;
  onClose: () => void;
  onSave: (c: Record<string, unknown>) => void;
}) {
  const [limit, setLimit] = useState(Number(w.config.limit ?? 8));
  return (
    <Dialog
      open
      onClose={onClose}
      title={`${WIDGETS[w.type].title} einstellen`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Abbrechen
          </Button>
          <Button onClick={() => onSave({ ...w.config, limit })}>Übernehmen</Button>
        </>
      }
    >
      <Field label="Anzahl Einträge" hint="3 bis 30">
        {(p) => (
          <Input
            {...p}
            type="number"
            min={3}
            max={30}
            value={limit}
            onChange={(e) => setLimit(Math.min(30, Math.max(3, Number(e.target.value))))}
          />
        )}
      </Field>
    </Dialog>
  );
}

function RenamePage({
  initial,
  title,
  onClose,
  onSave,
}: {
  initial: string;
  title: string;
  onClose: () => void;
  onSave: (n: string) => void;
}) {
  const [name, setName] = useState(initial);
  return (
    <Dialog
      open
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Abbrechen
          </Button>
          <Button disabled={!name.trim()} onClick={() => onSave(name.trim())}>
            Speichern
          </Button>
        </>
      }
    >
      <Field label="Name">
        {(p) => (
          <Input
            {...p}
            value={name}
            maxLength={60}
            autoFocus
            onChange={(e) => setName(e.target.value)}
          />
        )}
      </Field>
    </Dialog>
  );
}
