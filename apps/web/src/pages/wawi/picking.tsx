import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, Check, ListChecks, Plus, Printer } from 'lucide-react';
import { useMemo, useState } from 'react';
import { PICK_LIST_STATUSES, type ListFilter, type PickListStatus } from '@fangevo/shared';
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Dialog,
  Input,
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
import { DataTable } from '../../components/table/data-table';
import { type Column } from '../../components/table/types';
import { Tabs } from '../../components/tabs';
import { errorMessage, http } from '../../lib/api';
import { formatDate, formatDateTime } from '../../lib/format';
import { formatMoney, formatQty, toInput } from '../../lib/master-data';
import { ORDER_TONE, orderStatusLabel } from '../../lib/sales';
import { useCan, useSession } from '../../lib/session';

interface PickListRow {
  id: string;
  number: string;
  status: PickListStatus;
  createdAt: string;
  completedAt: string | null;
  lineCount: number;
  quantity: string;
  picked: string;
}

interface PickListDetail extends Omit<PickListRow, 'lineCount' | 'quantity' | 'picked'> {
  warehouse: { code: string; name: string } | null;
  orders: { id: string; number: string; status: string; customerName: string }[];
  lines: {
    id: string;
    position: number;
    articleNumber: string;
    name: string;
    locationCode: string | null;
    batch: string | null;
    quantity: string;
    pickedQuantity: string;
    orderNumber: string | null;
  }[];
}

const TONE: Record<PickListStatus, 'neutral' | 'primary' | 'success' | 'warning'> = {
  open: 'primary',
  in_progress: 'warning',
  done: 'success',
  cancelled: 'neutral',
};

export function PickingPage() {
  const [tab, setTab] = useState<'lists' | 'new'>('lists');
  const [open, setOpen] = useState<string | null>(() =>
    new URLSearchParams(window.location.search).get('id'),
  );
  const columns = useMemo<Column<PickListRow>[]>(
    () => [
      {
        id: 'number',
        header: 'Pickliste',
        kind: 'string',
        sortable: true,
        width: 130,
        value: (r) => r.number,
      },
      {
        id: 'status',
        header: 'Status',
        kind: 'enum',
        sortable: true,
        width: 140,
        options: Object.entries(PICK_LIST_STATUSES).map(([value, label]) => ({ value, label })),
        value: (r) => r.status,
        cell: (r) => <Badge tone={TONE[r.status]}>{PICK_LIST_STATUSES[r.status]}</Badge>,
      },
      {
        id: 'progress',
        header: 'Fortschritt',
        kind: 'string',
        filterable: false,
        width: 160,
        value: (r) => `${formatQty(r.picked)} / ${formatQty(r.quantity)}`,
      },
      {
        id: 'lineCount',
        header: 'Positionen',
        kind: 'number',
        filterable: false,
        width: 110,
        value: (r) => r.lineCount,
      },
      {
        id: 'createdAt',
        header: 'Erstellt',
        kind: 'date',
        sortable: true,
        width: 160,
        value: (r) => r.createdAt,
        cell: (r) => formatDateTime(r.createdAt),
      },
    ],
    [],
  );
  return (
    <>
      <PageHeader
        title="Kommissionierung"
        description="Picklisten fassen Aufträge zu einem Rundgang durchs Lager zusammen – sortiert nach Lagerplatz, Chargen mit frühestem MHD zuerst."
      />
      <Tabs
        tabs={[
          { id: 'lists', label: 'Picklisten' },
          { id: 'new', label: 'Neue Pickliste' },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'lists' && (
        <DataTable<PickListRow>
          tableKey="pick_lists"
          mode="server"
          queryKey={['pick-lists']}
          fetch={(p: {
            q: string;
            sort: string | null;
            filters: ListFilter[];
            page: number;
            pageSize: number;
          }) => {
            const q = new URLSearchParams({ page: String(p.page), pageSize: String(p.pageSize) });
            if (p.q) q.set('q', p.q);
            if (p.sort) q.set('sort', p.sort);
            if (p.filters.length) q.set('filters', JSON.stringify(p.filters));
            return http.get(`/pick-lists?${q}`);
          }}
          columns={columns}
          rowId={(r) => r.id}
          exportName="picklisten"
          onRowClick={(r) => setOpen(r.id)}
          initial={{ sort: 'createdAt:desc' }}
        />
      )}
      {tab === 'new' && (
        <NewPickList
          onCreated={(id) => {
            setTab('lists');
            setOpen(id);
          }}
        />
      )}
      {open && <PickListDialog id={open} onClose={() => setOpen(null)} />}
    </>
  );
}

interface OrderRow {
  id: string;
  number: string;
  status: string;
  customerName: string;
  orderDate: string;
  totalGross: string;
}

function NewPickList({ onCreated }: { onCreated: (id: string) => void }) {
  const qc = useQueryClient();
  const s = useSession();
  const filters = [
    {
      field: 'status',
      op: 'in',
      value: [
        'new',
        'unchecked',
        'in_progress',
        'awaiting_payment',
        'awaiting_stock',
        'ready_to_ship',
      ],
    },
  ];
  const q = useQuery({
    queryKey: ['orders', 'pickable'],
    queryFn: () =>
      http.get<{ items: OrderRow[]; total: number }>(
        `/orders?pageSize=200&sort=orderDate:asc&filters=${encodeURIComponent(JSON.stringify(filters))}`,
      ),
  });
  const can = useCan();
  const withRules = can('packing.execute');
  const stations = useQuery({
    queryKey: ['packing-stations'],
    enabled: withRules,
    retry: false,
    queryFn: () =>
      http.get<{ id: string; name: string; archivedAt: string | null }[]>('/packing/stations'),
  });
  const [stationId, setStationId] = useState('');
  // Packregeln eines Packplatzes (Kanal/Kategorie) auf die kommissionierbaren Aufträge anwenden
  const allowed = useQuery({
    queryKey: ['packing-queue', 'pickable', stationId],
    enabled: !!stationId,
    queryFn: () =>
      http.get<{ items: { id: string }[] }>(
        `/packing/queue?stage=pickable&stationId=${encodeURIComponent(stationId)}`,
      ),
  });
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!q.data || (stationId && !allowed.data)) return <Spinner />;
  const allowedIds = stationId ? new Set(allowed.data!.items.map((o) => o.id)) : null;
  const items = allowedIds ? q.data.items.filter((o) => allowedIds.has(o.id)) : q.data.items;
  const activeStations = (stations.data ?? []).filter((x) => !x.archivedAt);
  const stationSelect = activeStations.length > 0 && (
    <Select
      aria-label="Nach Packregeln filtern"
      className="w-64"
      value={stationId}
      onChange={(e) => {
        setStationId(e.target.value);
        setSel(new Set());
      }}
    >
      <option value="">Alle Aufträge</option>
      {activeStations.map((x) => (
        <option key={x.id} value={x.id}>
          Regeln von {x.name}
        </option>
      ))}
    </Select>
  );
  if (!items.length)
    return (
      <div className="space-y-3">
        {stationSelect}
        <p className="py-8 text-center text-sm text-muted">
          Keine Aufträge, die kommissioniert werden können.
        </p>
      </div>
    );
  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const pl = await http.post<{ id: string }>('/pick-lists', { orderIds: [...sel] });
      setSel(new Set());
      await qc.invalidateQueries({ queryKey: ['pick-lists'] });
      await qc.invalidateQueries({ queryKey: ['orders'] });
      onCreated(pl.id);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-3">
      {error && <Alert tone="danger">{error}</Alert>}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          disabled={!sel.size || s.account?.accessMode !== 'full'}
          loading={busy}
          onClick={create}
        >
          <ListChecks /> Pickliste erstellen ({sel.size})
        </Button>
        <Button variant="secondary" onClick={() => setSel(new Set(items.map((o) => o.id)))}>
          Alle auswählen
        </Button>
        {stationSelect}
      </div>
      <p className="text-sm text-muted">
        Aufträge ohne ausreichenden Bestand werden abgelehnt (ältere Aufträge haben Vorrang).
      </p>
      <Table>
        <THead>
          <TR>
            <TH />
            <TH>Auftrag</TH>
            <TH>Datum</TH>
            <TH>Kunde</TH>
            <TH>Status</TH>
            <TH className="text-right">Brutto</TH>
          </TR>
        </THead>
        <TBody>
          {items.map((o) => (
            <TR key={o.id}>
              <TD>
                <Checkbox
                  label={<span className="sr-only">{o.number} auswählen</span>}
                  checked={sel.has(o.id)}
                  onChange={(e) => {
                    const n = new Set(sel);
                    if (e.target.checked) n.add(o.id);
                    else n.delete(o.id);
                    setSel(n);
                  }}
                />
              </TD>
              <TD>{o.number}</TD>
              <TD>{formatDate(o.orderDate)}</TD>
              <TD>{o.customerName}</TD>
              <TD>
                <Badge tone={ORDER_TONE[o.status as keyof typeof ORDER_TONE]}>
                  {orderStatusLabel(o.status)}
                </Badge>
              </TD>
              <TD className="text-right tabular-nums">{formatMoney(o.totalGross)}</TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </div>
  );
}

export function PickListDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient();
  const s = useSession();
  const q = useQuery({
    queryKey: ['pick-list', id],
    queryFn: () => http.get<PickListDetail>(`/pick-lists/${id}`),
  });
  const [qty, setQty] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    setInfo(null);
    try {
      await fn();
      await qc.invalidateQueries({ queryKey: ['pick-list', id] });
      await qc.invalidateQueries({ queryKey: ['pick-lists'] });
      await qc.invalidateQueries({ queryKey: ['orders'] });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  const pl = q.data;
  const active =
    pl && ['open', 'in_progress'].includes(pl.status) && s.account?.accessMode === 'full';
  return (
    <Dialog
      open
      wide
      onClose={onClose}
      title={pl ? `Pickliste ${pl.number}` : 'Pickliste'}
      description={pl?.warehouse ? `${pl.warehouse.code} · ${pl.warehouse.name}` : undefined}
      footer={
        <Button variant="secondary" onClick={onClose}>
          Schließen
        </Button>
      }
    >
      {!pl ? (
        q.isError ? (
          <Alert tone="danger">{errorMessage(q.error)}</Alert>
        ) : (
          <Spinner />
        )
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 print:hidden">
            <Badge tone={TONE[pl.status]}>{PICK_LIST_STATUSES[pl.status]}</Badge>
            <Button size="sm" variant="secondary" onClick={() => window.print()}>
              <Printer /> Drucken
            </Button>
            {active && (
              <>
                <Button
                  size="sm"
                  loading={busy === 'complete'}
                  onClick={() =>
                    run('complete', async () => {
                      const r = await http.post<{ incompleteOrders: number }>(
                        `/pick-lists/${id}/complete`,
                      );
                      setInfo(
                        r.incompleteOrders
                          ? `${r.incompleteOrders} Auftrag/Aufträge mit Fehlmengen bleiben in „Kommissionierung“.`
                          : 'Alle Aufträge sind bereit zum Packen.',
                      );
                    })
                  }
                >
                  <Check /> Abschließen
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  loading={busy === 'cancel'}
                  onClick={() => run('cancel', () => http.post(`/pick-lists/${id}/cancel`))}
                >
                  <Ban /> Stornieren
                </Button>
              </>
            )}
          </div>
          {error && <Alert tone="danger">{error}</Alert>}
          {info && <Alert tone="success">{info}</Alert>}
          <p className="text-sm text-muted">
            Aufträge:{' '}
            {pl.orders
              .map((o) => `${o.number} (${o.customerName}, ${orderStatusLabel(o.status)})`)
              .join(' · ')}
          </p>
          <Table>
            <THead>
              <TR>
                <TH>Platz</TH>
                <TH>Artikel</TH>
                <TH>Charge</TH>
                <TH>Auftrag</TH>
                <TH className="text-right">Menge</TH>
                <TH className="text-right">Gepickt</TH>
                {active && <TH className="print:hidden" />}
              </TR>
            </THead>
            <TBody>
              {pl.lines.map((l) => {
                const open = Number(l.quantity) - Number(l.pickedQuantity);
                return (
                  <TR key={l.id} className={open <= 0 ? 'opacity-60' : ''}>
                    <TD className="font-semibold">{l.locationCode ?? '–'}</TD>
                    <TD>
                      {l.articleNumber} · {l.name}
                    </TD>
                    <TD>{l.batch ?? ''}</TD>
                    <TD>{l.orderNumber}</TD>
                    <TD className="text-right tabular-nums">{formatQty(l.quantity)}</TD>
                    <TD className="text-right tabular-nums">{formatQty(l.pickedQuantity)}</TD>
                    {active && (
                      <TD className="print:hidden">
                        {open > 0 && (
                          <div className="flex items-center justify-end gap-1">
                            <Input
                              aria-label={`Menge ${l.articleNumber}`}
                              className="w-20"
                              value={qty[l.id] ?? toInput(String(open))}
                              onChange={(e) => setQty({ ...qty, [l.id]: e.target.value })}
                            />
                            <Button
                              size="sm"
                              loading={busy === l.id}
                              onClick={() =>
                                run(l.id, () =>
                                  http.post(`/pick-lists/${id}/confirm`, {
                                    lineId: l.id,
                                    quantity: qty[l.id] ?? String(open),
                                  }),
                                )
                              }
                            >
                              <Plus /> Gepickt
                            </Button>
                          </div>
                        )}
                      </TD>
                    )}
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </div>
      )}
    </Dialog>
  );
}
