import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Columns3,
  Download,
  Filter,
  Group,
  Search,
  X,
} from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { type ListFilter, type TableState } from '@fangevo/shared';
import {
  Alert,
  Button,
  Checkbox,
  EmptyState,
  Input,
  Popover,
  Select,
  Spinner,
  cn,
} from '@fangevo/ui';
import { errorMessage } from '../../lib/api';
import { applyClient, download, toCsv } from './client-ops';
import { OPS_BY_KIND, type Column, EMPTY_STATE } from './types';
import { SavedViews } from './saved-views';

type Fetcher<T> = (p: {
  q: string;
  sort: string | null;
  filters: ListFilter[];
  page: number;
  pageSize: number;
}) => Promise<{ items: T[]; total: number }>;

interface BaseProps<T> {
  tableKey: 'companies' | 'members' | 'audit';
  columns: Column<T>[];
  rowId: (r: T) => string;
  exportName: string;
  bulkActions?: {
    label: string;
    icon?: ReactNode;
    danger?: boolean;
    run: (rows: T[]) => Promise<void>;
  }[];
  toolbar?: ReactNode;
  emptyTitle?: string;
  onRowClick?: (r: T) => void;
  initial?: Partial<TableState>;
  pageSize?: number;
}

type Props<T> = BaseProps<T> &
  (
    | {
        mode: 'client';
        rows: T[] | undefined;
        loading?: boolean;
        error?: unknown;
        footer?: ReactNode;
      }
    | { mode: 'server'; queryKey: unknown[]; fetch: Fetcher<T> }
  );

/**
 * Tabellen-Baukasten: Spalten ein-/ausblenden, verschieben, Breite ändern, sortieren, filtern,
 * gruppieren, Mehrfachauswahl mit Massenaktionen, CSV-Export und gespeicherte Ansichten.
 * - mode "server": Suche/Filter/Sortierung/Seiten in der API (große Listen)
 * - mode "client": alles im Browser (kleine Listen)
 */
export function DataTable<T>(props: Props<T>) {
  const { columns, rowId, tableKey } = props;
  const [state, setState] = useState<TableState>({ ...EMPTY_STATE, ...props.initial });
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [qInput, setQInput] = useState(state.q);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const pageSize = props.pageSize ?? 50;

  // Sucheingabe verzögert übernehmen
  useEffect(() => {
    const t = setTimeout(() => {
      setState((s) => (s.q === qInput ? s : { ...s, q: qInput }));
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [qInput]);

  const ordered = useMemo(() => {
    const order = state.columnOrder.filter((id) => columns.some((c) => c.id === id));
    const rest = columns.filter((c) => !order.includes(c.id)).map((c) => c.id);
    return [...order, ...rest].map((id) => columns.find((c) => c.id === id)!);
  }, [columns, state.columnOrder]);
  const hidden = new Set(
    state.hidden.length || state.columnOrder.length
      ? state.hidden
      : columns.filter((c) => c.defaultHidden).map((c) => c.id),
  );
  const visible = ordered.filter((c) => !hidden.has(c.id));

  const server = useQuery({
    queryKey:
      props.mode === 'server'
        ? [...props.queryKey, state.q, state.sort, state.filters, page, pageSize]
        : ['__none'],
    queryFn: () =>
      props.mode === 'server'
        ? props.fetch({ q: state.q, sort: state.sort, filters: state.filters, page, pageSize })
        : Promise.resolve({ items: [], total: 0 }),
    enabled: props.mode === 'server',
    placeholderData: keepPreviousData,
  });

  const clientRows = useMemo(
    () =>
      props.mode === 'client' && props.rows
        ? applyClient(props.rows, columns, state.q, state.filters, state.sort)
        : [],
    [props, columns, state.q, state.filters, state.sort],
  );
  const allRows = props.mode === 'server' ? (server.data?.items ?? []) : clientRows;
  const total = props.mode === 'server' ? (server.data?.total ?? 0) : clientRows.length;
  const rows =
    props.mode === 'server' ? allRows : allRows.slice((page - 1) * pageSize, page * pageSize);
  const loading = props.mode === 'server' ? server.isPending : !!props.loading && !props.rows;
  const error = props.mode === 'server' ? server.error : props.error;
  const pages = Math.max(1, Math.ceil(total / pageSize));

  const set = (patch: Partial<TableState>) => {
    setState((s) => ({ ...s, ...patch }));
    setPage(1);
  };

  const toggleSort = (c: Column<T>) => {
    if (!c.sortable) return;
    const cur = state.sort?.split(':');
    set({ sort: cur?.[0] !== c.id ? `${c.id}:asc` : cur[1] === 'asc' ? `${c.id}:desc` : null });
  };

  const selectedRows = allRows.filter((r) => selected.has(rowId(r)));

  const exportCsv = async () => {
    setBusy(true);
    try {
      let data: T[] = clientRows;
      if (props.mode === 'server') {
        data = [];
        for (let p = 1; p <= 50; p++) {
          const r = await props.fetch({
            q: state.q,
            sort: state.sort,
            filters: state.filters,
            page: p,
            pageSize: 1000,
          });
          data.push(...r.items);
          if (data.length >= r.total || !r.items.length) break;
        }
      }
      download(
        `${props.exportName}-${new Date().toISOString().slice(0, 10)}.csv`,
        toCsv(data, visible),
      );
    } catch (e) {
      setActionError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  // Gruppierung (auf der aktuellen Seite)
  const groupCol = state.groupBy ? columns.find((c) => c.id === state.groupBy) : undefined;
  const groups: { key: string; rows: T[] }[] = groupCol
    ? Object.entries(
        rows.reduce<Record<string, T[]>>((acc, r) => {
          const k = String(groupCol.text?.(r) ?? groupCol.value(r) ?? '–') || '–';
          (acc[k] ??= []).push(r);
          return acc;
        }, {}),
      ).map(([key, rs]) => ({ key, rows: rs }))
    : [{ key: '', rows }];

  return (
    <div className="rounded-xl border border-border bg-surface shadow-xs">
      {/* Werkzeugleiste */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
        <div className="relative min-w-48 flex-1 sm:max-w-xs">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted"
            aria-hidden
          />
          <Input
            aria-label="In Tabelle suchen"
            placeholder="Suchen …"
            className="h-9 pl-9"
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
          />
        </div>
        <FilterButton
          columns={columns}
          filters={state.filters}
          onChange={(filters) => set({ filters })}
        />
        <ColumnsButton
          columns={ordered}
          hidden={hidden}
          onChange={(columnOrder, h) => set({ columnOrder, hidden: h })}
        />
        <GroupButton
          columns={columns}
          value={state.groupBy}
          onChange={(groupBy) => set({ groupBy })}
        />
        <Button variant="secondary" size="sm" onClick={exportCsv} loading={busy}>
          <Download /> Export
        </Button>
        <SavedViews
          tableKey={tableKey}
          state={{ ...state }}
          onApply={(s) => {
            setState({ ...EMPTY_STATE, ...s });
            setQInput(s.q ?? '');
            setPage(1);
          }}
        />
        <div className="flex-1" />
        {props.toolbar}
      </div>

      {state.filters.length > 0 && (
        <div className="flex flex-wrap gap-2 border-b border-border px-3 py-2">
          {state.filters.map((f, i) => {
            const c = columns.find((x) => x.id === f.field);
            const op = c ? OPS_BY_KIND[c.kind].find((o) => o.op === f.op)?.label : f.op;
            const val =
              c?.options?.find((o) => o.value === f.value)?.label ??
              (typeof f.value === 'boolean' ? (f.value ? 'Ja' : 'Nein') : f.value);
            return (
              <span
                key={i}
                className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary"
              >
                {c?.header ?? f.field} {op}{' '}
                {f.op !== 'empty' && f.op !== 'notEmpty' ? String(val ?? '') : ''}
                <button
                  aria-label="Filter entfernen"
                  onClick={() => set({ filters: state.filters.filter((_, j) => j !== i) })}
                >
                  <X className="size-3" />
                </button>
              </span>
            );
          })}
        </div>
      )}

      {selectedRows.length > 0 && props.bulkActions && (
        <div className="flex flex-wrap items-center gap-2 border-b border-border bg-primary/5 px-3 py-2 text-sm">
          <strong>{selectedRows.length} ausgewählt</strong>
          {props.bulkActions.map((a) => (
            <Button
              key={a.label}
              size="sm"
              variant={a.danger ? 'danger' : 'secondary'}
              loading={busy}
              onClick={async () => {
                setBusy(true);
                setActionError(null);
                try {
                  await a.run(selectedRows);
                  setSelected(new Set());
                } catch (e) {
                  setActionError(errorMessage(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              {a.icon}
              {a.label}
            </Button>
          ))}
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            Auswahl aufheben
          </Button>
        </div>
      )}
      {actionError && (
        <div className="p-3">
          <Alert tone="danger">{actionError}</Alert>
        </div>
      )}

      {loading ? (
        <Spinner />
      ) : error ? (
        <div className="p-4">
          <Alert tone="danger">{errorMessage(error)}</Alert>
        </div>
      ) : !rows.length ? (
        <EmptyState
          title={
            state.q || state.filters.length
              ? 'Keine Treffer'
              : (props.emptyTitle ?? 'Keine Einträge')
          }
          description={
            state.q || state.filters.length ? 'Passen Sie Suche oder Filter an.' : undefined
          }
        />
      ) : (
        <div className="w-full overflow-x-auto">
          <table
            className="w-full border-collapse text-sm"
            style={{
              tableLayout: 'fixed',
              minWidth: visible.reduce(
                (s, c) => s + (state.widths[c.id] ?? c.width ?? 160),
                props.bulkActions ? 44 : 0,
              ),
            }}
          >
            <thead className="bg-surface-2/60 text-left text-xs uppercase tracking-wide text-muted">
              <tr>
                {props.bulkActions && (
                  <th className="w-11 px-3 py-2.5">
                    <input
                      type="checkbox"
                      aria-label="Alle auf dieser Seite auswählen"
                      className="size-4 accent-[var(--color-primary)]"
                      checked={rows.length > 0 && rows.every((r) => selected.has(rowId(r)))}
                      onChange={(e) =>
                        setSelected(
                          e.target.checked
                            ? new Set([...selected, ...rows.map(rowId)])
                            : new Set(
                                [...selected].filter((id) => !rows.some((r) => rowId(r) === id)),
                              ),
                        )
                      }
                    />
                  </th>
                )}
                {visible.map((c) => (
                  <HeaderCell
                    key={c.id}
                    col={c}
                    sort={state.sort}
                    width={state.widths[c.id] ?? c.width ?? 160}
                    onSort={() => toggleSort(c)}
                    onResize={(w) =>
                      setState((s) => ({ ...s, widths: { ...s.widths, [c.id]: w } }))
                    }
                  />
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {groups.map((g) => (
                <GroupRows
                  key={g.key}
                  label={groupCol ? `${groupCol.header}: ${g.key}` : null}
                  span={visible.length + (props.bulkActions ? 1 : 0)}
                >
                  {g.rows.map((r) => {
                    const id = rowId(r);
                    return (
                      <tr
                        key={id}
                        className={cn(
                          'transition-colors hover:bg-surface-2/40',
                          props.onRowClick && 'cursor-pointer',
                          selected.has(id) && 'bg-primary/5',
                        )}
                        onClick={() => props.onRowClick?.(r)}
                      >
                        {props.bulkActions && (
                          <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              aria-label="Zeile auswählen"
                              className="size-4 accent-[var(--color-primary)]"
                              checked={selected.has(id)}
                              onChange={(e) => {
                                const n = new Set(selected);
                                if (e.target.checked) n.add(id);
                                else n.delete(id);
                                setSelected(n);
                              }}
                            />
                          </td>
                        )}
                        {visible.map((c) => (
                          <td key={c.id} className="truncate px-4 py-3 align-middle text-fg">
                            {c.cell ? c.cell(r) : formatValue(c, r)}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </GroupRows>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-3 py-2 text-sm text-muted">
        <span>
          {total} {total === 1 ? 'Eintrag' : 'Einträge'}
          {server.isFetching && props.mode === 'server' ? ' · lädt …' : ''}
        </span>
        <div className="flex items-center gap-1">
          {props.mode === 'client' && props.footer}
          <Button
            variant="ghost"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
            aria-label="Vorherige Seite"
          >
            <ChevronLeft />
          </Button>
          <span>
            Seite {page} von {pages}
          </span>
          <Button
            variant="ghost"
            size="sm"
            disabled={page >= pages}
            onClick={() => setPage(page + 1)}
            aria-label="Nächste Seite"
          >
            <ChevronRight />
          </Button>
        </div>
      </div>
    </div>
  );
}

function GroupRows({
  label,
  span,
  children,
}: {
  label: string | null;
  span: number;
  children: ReactNode;
}) {
  return (
    <>
      {label && (
        <tr className="bg-surface-2/50">
          <td
            colSpan={span}
            className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted"
          >
            {label}
          </td>
        </tr>
      )}
      {children}
    </>
  );
}

function formatValue<T>(c: Column<T>, r: T): ReactNode {
  const v = c.value(r);
  if (c.text) return c.text(r) || '–';
  if (v === null || v === undefined || v === '') return '–';
  if (c.kind === 'boolean') return v ? 'Ja' : 'Nein';
  if (c.kind === 'date') return new Date(String(v)).toLocaleDateString('de-DE');
  if (c.kind === 'number') return Number(v).toLocaleString('de-DE');
  if (c.kind === 'enum') return c.options?.find((o) => o.value === v)?.label ?? String(v);
  if (Array.isArray(v))
    return v.map((x) => c.options?.find((o) => o.value === x)?.label ?? x).join(', ');
  return String(v);
}

function HeaderCell<T>({
  col,
  sort,
  width,
  onSort,
  onResize,
}: {
  col: Column<T>;
  sort: string | null;
  width: number;
  onSort: () => void;
  onResize: (w: number) => void;
}) {
  const [id, dir] = sort?.split(':') ?? [];
  const active = id === col.id;
  const start = useRef<{ x: number; w: number } | null>(null);
  return (
    <th
      scope="col"
      className="relative px-4 py-2.5 font-medium"
      style={{ width }}
      aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : undefined}
    >
      {col.sortable ? (
        <button className="inline-flex items-center gap-1 uppercase hover:text-fg" onClick={onSort}>
          {col.header}
          {active ? (
            dir === 'asc' ? (
              <ArrowUp className="size-3" />
            ) : (
              <ArrowDown className="size-3" />
            )
          ) : (
            <ArrowUpDown className="size-3 opacity-40" />
          )}
        </button>
      ) : (
        col.header
      )}
      <span
        role="separator"
        aria-orientation="vertical"
        aria-label={`Breite von ${col.header} ändern`}
        className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-primary/40"
        onMouseDown={(e) => {
          start.current = { x: e.clientX, w: width };
          const move = (ev: MouseEvent) =>
            start.current &&
            onResize(Math.max(60, Math.min(800, start.current.w + ev.clientX - start.current.x)));
          const up = () => {
            start.current = null;
            window.removeEventListener('mousemove', move);
            window.removeEventListener('mouseup', up);
          };
          window.addEventListener('mousemove', move);
          window.addEventListener('mouseup', up);
        }}
      />
    </th>
  );
}

function FilterButton<T>({
  columns,
  filters,
  onChange,
}: {
  columns: Column<T>[];
  filters: ListFilter[];
  onChange: (f: ListFilter[]) => void;
}) {
  const filterable = columns.filter((c) => c.filterable !== false);
  const [field, setField] = useState(filterable[0]?.id ?? '');
  const col = filterable.find((c) => c.id === field);
  const ops = col ? OPS_BY_KIND[col.kind] : [];
  const [op, setOp] = useState(ops[0]?.op ?? 'eq');
  const [value, setValue] = useState('');
  useEffect(() => {
    setOp(ops[0]?.op ?? 'eq');
    setValue(col?.options?.[0]?.value ?? (col?.kind === 'boolean' ? 'true' : ''));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [field]);
  const needsValue = op !== 'empty' && op !== 'notEmpty';
  return (
    <Popover
      trigger={(p) => (
        <Button variant="secondary" size="sm" {...p}>
          <Filter /> Filter{filters.length ? ` (${filters.length})` : ''}
        </Button>
      )}
      className="w-80"
    >
      {(close) => (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!col) return;
            const v =
              col.kind === 'boolean'
                ? value === 'true'
                : col.kind === 'number'
                  ? Number(value.replace(',', '.'))
                  : value;
            onChange([...filters, { field, op, value: needsValue ? v : null }]);
            close();
          }}
        >
          <p className="text-sm font-semibold">Filter hinzufügen</p>
          <Select aria-label="Feld" value={field} onChange={(e) => setField(e.target.value)}>
            {filterable.map((c) => (
              <option key={c.id} value={c.id}>
                {c.header}
              </option>
            ))}
          </Select>
          <Select
            aria-label="Bedingung"
            value={op}
            onChange={(e) => setOp(e.target.value as typeof op)}
          >
            {ops.map((o) => (
              <option key={o.op} value={o.op}>
                {o.label}
              </option>
            ))}
          </Select>
          {needsValue &&
            (col?.kind === 'boolean' ? (
              <Select aria-label="Wert" value={value} onChange={(e) => setValue(e.target.value)}>
                <option value="true">Ja</option>
                <option value="false">Nein</option>
              </Select>
            ) : col?.options ? (
              <Select aria-label="Wert" value={value} onChange={(e) => setValue(e.target.value)}>
                {col.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            ) : (
              <Input
                aria-label="Wert"
                type={col?.kind === 'date' ? 'date' : col?.kind === 'number' ? 'number' : 'text'}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                required
              />
            ))}
          <div className="flex justify-between pt-1">
            {filters.length > 0 ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  onChange([]);
                  close();
                }}
              >
                Alle entfernen
              </Button>
            ) : (
              <span />
            )}
            <Button type="submit" size="sm">
              Anwenden
            </Button>
          </div>
        </form>
      )}
    </Popover>
  );
}

function ColumnsButton<T>({
  columns,
  hidden,
  onChange,
}: {
  columns: Column<T>[];
  hidden: Set<string>;
  onChange: (order: string[], hidden: string[]) => void;
}) {
  const ids = columns.map((c) => c.id);
  const move = (i: number, d: -1 | 1) => {
    const n = [...ids];
    const j = i + d;
    if (j < 0 || j >= n.length) return;
    [n[i], n[j]] = [n[j]!, n[i]!];
    onChange(n, [...hidden]);
  };
  return (
    <Popover
      trigger={(p) => (
        <Button variant="secondary" size="sm" {...p}>
          <Columns3 /> Spalten
        </Button>
      )}
      className="w-72"
    >
      <p className="mb-2 text-sm font-semibold">Spalten anzeigen und anordnen</p>
      <ul className="max-h-80 space-y-1 overflow-y-auto">
        {columns.map((c, i) => (
          <li
            key={c.id}
            className="flex items-center justify-between gap-2 rounded-md px-1 py-0.5 hover:bg-surface-2"
          >
            <Checkbox
              label={c.header}
              checked={!hidden.has(c.id)}
              onChange={(e) => {
                const h = new Set(hidden);
                if (e.target.checked) h.delete(c.id);
                else h.add(c.id);
                if (h.size >= columns.length) return;
                onChange(ids, [...h]);
              }}
            />
            <span className="flex">
              <button
                className="rounded p-1 text-muted hover:text-fg disabled:opacity-30"
                disabled={i === 0}
                onClick={() => move(i, -1)}
                aria-label={`${c.header} nach oben`}
              >
                <ArrowUp className="size-3.5" />
              </button>
              <button
                className="rounded p-1 text-muted hover:text-fg disabled:opacity-30"
                disabled={i === columns.length - 1}
                onClick={() => move(i, 1)}
                aria-label={`${c.header} nach unten`}
              >
                <ArrowDown className="size-3.5" />
              </button>
            </span>
          </li>
        ))}
      </ul>
    </Popover>
  );
}

function GroupButton<T>({
  columns,
  value,
  onChange,
}: {
  columns: Column<T>[];
  value: string | null;
  onChange: (v: string | null) => void;
}) {
  const groupable = columns.filter((c) => c.groupable);
  if (!groupable.length) return null;
  return (
    <Popover
      trigger={(p) => (
        <Button variant="secondary" size="sm" {...p}>
          <Group />{' '}
          {value ? `Gruppiert: ${columns.find((c) => c.id === value)?.header}` : 'Gruppieren'}{' '}
          <ChevronDown className="size-3" />
        </Button>
      )}
      className="w-56"
    >
      {(close) => (
        <ul className="space-y-0.5 text-sm">
          {[{ id: null as string | null, header: 'Keine Gruppierung' }, ...groupable].map((c) => (
            <li key={c.id ?? 'none'}>
              <button
                className={cn(
                  'w-full rounded-md px-2 py-1.5 text-left hover:bg-surface-2',
                  value === c.id && 'font-semibold text-primary',
                )}
                onClick={() => {
                  onChange(c.id);
                  close();
                }}
              >
                {c.header}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Popover>
  );
}
