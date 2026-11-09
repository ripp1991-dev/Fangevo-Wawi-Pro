import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, PackageOpen, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  RETURN_CONDITIONS,
  RETURN_STATUSES,
  type ListFilter,
  type ReturnCondition,
  type ReturnStatus,
} from '@fangevo/shared';
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Dialog,
  Field,
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
import { ActivityList } from '../../components/activity-list';
import { DataTable } from '../../components/table/data-table';
import { type Column } from '../../components/table/types';
import { useSubmit } from '../../components/use-form';
import { errorMessage, http } from '../../lib/api';
import { formatDate, formatDateTime } from '../../lib/format';
import { formatQty, useMasterData } from '../../lib/master-data';
import { useCan, useSession } from '../../lib/session';
import { DocumentDialog } from './documents';

interface ReturnRow {
  id: string;
  number: string;
  status: ReturnStatus;
  orderId: string;
  orderNumber: string | null;
  customerName: string | null;
  reason: string | null;
  createdAt: string;
  receivedAt: string | null;
}

interface ReturnDetail extends Omit<ReturnRow, 'orderNumber' | 'customerName'> {
  warehouseId: string;
  notes: string | null;
  creditNoteId: string | null;
  order: { id: string; number: string; customerName: string } | null;
  lines: {
    id: string;
    articleNumber: string | null;
    name: string;
    quantity: string;
    condition: ReturnCondition | null;
    batch: string | null;
    serialNumber: string | null;
  }[];
}

const TONE: Record<ReturnStatus, 'primary' | 'success' | 'neutral'> = {
  open: 'primary',
  received: 'success',
  cancelled: 'neutral',
};

function useCanManage() {
  const can = useCan();
  const s = useSession();
  return can('returns.manage') && s.account?.accessMode === 'full';
}

export function ReturnsPage() {
  const manage = useCanManage();
  const [open, setOpen] = useState<string | 'new' | null>(() =>
    new URLSearchParams(window.location.search).get('id'),
  );
  const columns = useMemo<Column<ReturnRow>[]>(
    () => [
      {
        id: 'number',
        header: 'Retoure',
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
        options: Object.entries(RETURN_STATUSES).map(([value, label]) => ({ value, label })),
        value: (r) => r.status,
        cell: (r) => <Badge tone={TONE[r.status]}>{RETURN_STATUSES[r.status]}</Badge>,
      },
      {
        id: 'order',
        header: 'Auftrag',
        kind: 'string',
        filterable: false,
        width: 130,
        value: (r) => r.orderNumber,
      },
      {
        id: 'customer',
        header: 'Kunde',
        kind: 'string',
        filterable: false,
        width: 220,
        value: (r) => r.customerName,
      },
      { id: 'reason', header: 'Grund', kind: 'string', filterable: false, value: (r) => r.reason },
      {
        id: 'createdAt',
        header: 'Angemeldet',
        kind: 'date',
        sortable: true,
        width: 130,
        value: (r) => r.createdAt,
        cell: (r) => formatDate(r.createdAt),
      },
    ],
    [],
  );
  return (
    <>
      <PageHeader
        title="Retouren"
        description="Rücksendungen zu versendeten Aufträgen: Wareneingang mit Zustand, Einlagerung und Gutschrift."
        actions={
          manage && (
            <Button onClick={() => setOpen('new')}>
              <Plus /> Retoure anlegen
            </Button>
          )
        }
      />
      <DataTable<ReturnRow>
        tableKey="returns"
        mode="server"
        queryKey={['returns']}
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
          return http.get(`/returns?${q}`);
        }}
        columns={columns}
        rowId={(r) => r.id}
        exportName="retouren"
        onRowClick={(r) => setOpen(r.id)}
        initial={{ sort: 'createdAt:desc' }}
      />
      {open === 'new' && <NewReturn onClose={() => setOpen(null)} onCreated={setOpen} />}
      {open && open !== 'new' && <ReturnDialog id={open} onClose={() => setOpen(null)} />}
    </>
  );
}

function NewReturn({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const qc = useQueryClient();
  const [orderNo, setOrderNo] = useState('');
  const [order, setOrder] = useState<{ id: string; number: string } | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('');
  const lines = useQuery({
    queryKey: ['returnable', order?.id],
    queryFn: () =>
      http.get<
        {
          orderLineId: string;
          articleNumber: string | null;
          name: string;
          unit: string;
          ordered: string;
          returnable: string;
        }[]
      >(`/returns/returnable/${order!.id}`),
    enabled: !!order,
  });
  const find = async () => {
    setLookupError(null);
    try {
      const r = await http.get<{ items: { id: string; number: string; status: string }[] }>(
        `/orders?pageSize=5&q=${encodeURIComponent(orderNo.trim())}`,
      );
      const o =
        r.items.find((x) => x.number.toLowerCase() === orderNo.trim().toLowerCase()) ?? r.items[0];
      if (!o) setLookupError('Auftrag nicht gefunden');
      else if (!['shipped', 'completed'].includes(o.status))
        setLookupError(`Auftrag ${o.number} ist noch nicht versendet`);
      else setOrder(o);
    } catch (e) {
      setLookupError(errorMessage(e));
    }
  };
  const f = useSubmit(
    () =>
      http.post<{ id: string }>('/returns', {
        orderId: order!.id,
        reason: reason || null,
        lines: Object.entries(qty)
          .filter(([, v]) => v && Number(v.replace(',', '.')) > 0)
          .map(([orderLineId, quantity]) => ({ orderLineId, quantity })),
      }),
    async (r) => {
      await qc.invalidateQueries({ queryKey: ['returns'] });
      onCreated(r.id);
    },
  );
  return (
    <Dialog
      open
      wide
      onClose={onClose}
      title="Retoure anlegen"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Abbrechen
          </Button>
          <Button disabled={!order} loading={f.pending} onClick={() => f.submit(undefined)}>
            Anlegen
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {f.error && <Alert tone="danger">{f.error}</Alert>}
        {!order ? (
          <div className="flex items-end gap-2">
            <Field label="Auftragsnummer" error={lookupError ?? undefined}>
              {(p) => (
                <Input
                  {...p}
                  autoFocus
                  value={orderNo}
                  onChange={(e) => setOrderNo(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && find()}
                />
              )}
            </Field>
            <Button onClick={find}>Suchen</Button>
          </div>
        ) : (
          <>
            <p className="text-sm">
              Auftrag <strong>{order.number}</strong>{' '}
              <Button size="sm" variant="link" onClick={() => setOrder(null)}>
                ändern
              </Button>
            </p>
            {!lines.data ? (
              <Spinner />
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Position</TH>
                    <TH className="text-right">Bestellt</TH>
                    <TH className="text-right">Retournierbar</TH>
                    <TH className="text-right">Menge Retoure</TH>
                  </TR>
                </THead>
                <TBody>
                  {lines.data.map((l, i) => (
                    <TR key={l.orderLineId}>
                      <TD>
                        {l.articleNumber && (
                          <span className="text-muted">{l.articleNumber} · </span>
                        )}
                        {l.name}
                      </TD>
                      <TD className="text-right tabular-nums">
                        {formatQty(l.ordered)} {l.unit}
                      </TD>
                      <TD className="text-right tabular-nums">{formatQty(l.returnable)}</TD>
                      <TD className="text-right">
                        <Input
                          aria-label={`Menge ${l.name}`}
                          className="ml-auto w-24"
                          disabled={Number(l.returnable) <= 0}
                          value={qty[l.orderLineId] ?? ''}
                          onChange={(e) => setQty({ ...qty, [l.orderLineId]: e.target.value })}
                        />
                        {f.fieldErrors[`lines.${i}.quantity`] && (
                          <p className="text-xs text-danger">
                            {f.fieldErrors[`lines.${i}.quantity`]}
                          </p>
                        )}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
            <Field label="Grund">
              {(p) => <Input {...p} value={reason} onChange={(e) => setReason(e.target.value)} />}
            </Field>
          </>
        )}
      </div>
    </Dialog>
  );
}

function ReturnDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const manage = useCanManage();
  const can = useCan();
  const qc = useQueryClient();
  const md = useMasterData().data;
  const q = useQuery({
    queryKey: ['return', id],
    queryFn: () => http.get<ReturnDetail>(`/returns/${id}`),
  });
  const [sel, setSel] = useState<
    Record<string, { condition: ReturnCondition; batch: string; serialNumber: string }>
  >({});
  const [locationId, setLocationId] = useState('');
  const [credit, setCredit] = useState(false);
  const [doc, setDoc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ['return', id] });
    await qc.invalidateQueries({ queryKey: ['returns'] });
  };
  const receive = useSubmit(
    () =>
      http.post(`/returns/${id}/receive`, {
        createCreditNote: credit,
        lines: q.data!.lines.map((l) => ({
          lineId: l.id,
          condition: sel[l.id]?.condition ?? 'resell',
          locationId: locationId || null,
          batch: sel[l.id]?.batch || null,
          serialNumber: sel[l.id]?.serialNumber || null,
        })),
      }),
    refresh,
  );
  const r = q.data;
  const locations = md?.locations.filter((l) => l.warehouseId === r?.warehouseId) ?? [];
  return (
    <Dialog
      open
      wide
      onClose={onClose}
      title={r ? `Retoure ${r.number}` : 'Retoure'}
      description={r?.order ? `Auftrag ${r.order.number} · ${r.order.customerName}` : undefined}
      footer={
        r?.status === 'open' && manage ? (
          <>
            <Button
              variant="ghost"
              onClick={async () => {
                setError(null);
                try {
                  await http.post(`/returns/${id}/cancel`);
                  await refresh();
                } catch (e) {
                  setError(errorMessage(e));
                }
              }}
            >
              <Ban /> Stornieren
            </Button>
            <Button loading={receive.pending} onClick={() => receive.submit(undefined)}>
              <PackageOpen /> Wareneingang buchen
            </Button>
          </>
        ) : (
          <Button variant="secondary" onClick={onClose}>
            Schließen
          </Button>
        )
      }
    >
      {!r ? (
        <Spinner />
      ) : (
        <div className="space-y-4">
          {(error || receive.error) && <Alert tone="danger">{error ?? receive.error}</Alert>}
          <p className="text-sm">
            <Badge tone={TONE[r.status]}>{RETURN_STATUSES[r.status]}</Badge>
            {r.reason && <span className="ml-2 text-muted">Grund: {r.reason}</span>}
            {r.receivedAt && (
              <span className="ml-2 text-muted">Eingang {formatDateTime(r.receivedAt)}</span>
            )}
          </p>
          <Table>
            <THead>
              <TR>
                <TH>Position</TH>
                <TH className="text-right">Menge</TH>
                <TH>Zustand</TH>
                <TH>Charge / SN</TH>
              </TR>
            </THead>
            <TBody>
              {r.lines.map((l) => {
                const v = sel[l.id] ?? {
                  condition: 'resell' as ReturnCondition,
                  batch: '',
                  serialNumber: '',
                };
                const set = (p: Partial<typeof v>) => setSel({ ...sel, [l.id]: { ...v, ...p } });
                return (
                  <TR key={l.id}>
                    <TD>
                      {l.articleNumber && <span className="text-muted">{l.articleNumber} · </span>}
                      {l.name}
                    </TD>
                    <TD className="text-right tabular-nums">{formatQty(l.quantity)}</TD>
                    <TD>
                      {r.status === 'open' && manage ? (
                        <Select
                          aria-label={`Zustand ${l.name}`}
                          value={v.condition}
                          onChange={(e) => set({ condition: e.target.value as ReturnCondition })}
                        >
                          {Object.entries(RETURN_CONDITIONS).map(([k, label]) => (
                            <option key={k} value={k}>
                              {label}
                            </option>
                          ))}
                        </Select>
                      ) : l.condition ? (
                        RETURN_CONDITIONS[l.condition]
                      ) : (
                        '–'
                      )}
                    </TD>
                    <TD>
                      {r.status === 'open' && manage ? (
                        <div className="flex gap-1">
                          <Input
                            aria-label="Charge"
                            placeholder="Charge"
                            className="w-24"
                            value={v.batch}
                            onChange={(e) => set({ batch: e.target.value })}
                          />
                          <Input
                            aria-label="Seriennummer"
                            placeholder="SN"
                            className="w-28"
                            value={v.serialNumber}
                            onChange={(e) => set({ serialNumber: e.target.value })}
                          />
                        </div>
                      ) : (
                        [l.batch, l.serialNumber].filter(Boolean).join(' · ')
                      )}
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
          {r.status === 'open' && manage && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Einlagern auf Lagerplatz" hint="Für wieder verkaufbare Ware">
                {(p) => (
                  <Select {...p} value={locationId} onChange={(e) => setLocationId(e.target.value)}>
                    <option value="">– ohne Lagerplatz –</option>
                    {locations.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.code}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              {can('documents.manage') && (
                <Checkbox
                  label="Gutschrift zur Rechnung anlegen (Entwurf)"
                  description="Für alle Positionen dieser Retoure"
                  checked={credit}
                  onChange={(e) => setCredit(e.target.checked)}
                />
              )}
            </div>
          )}
          {r.creditNoteId && (
            <Button variant="secondary" size="sm" onClick={() => setDoc(r.creditNoteId)}>
              Gutschrift öffnen
            </Button>
          )}
          {r.notes && <p className="text-sm text-muted">{r.notes}</p>}
          <ActivityList entityType="order" entityId={r.orderId} limit={8} />
        </div>
      )}
      {doc && <DocumentDialog id={doc} onClose={() => setDoc(null)} onOpen={setDoc} />}
    </Dialog>
  );
}
