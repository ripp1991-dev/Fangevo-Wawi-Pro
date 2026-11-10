import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, FileText, Mail, PackageCheck, Plus, Send, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { PURCHASE_STATUSES, type ListFilter, type PurchaseStatus } from '@fangevo/shared';
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
import {
  SearchPicker,
  articleItem,
  searchArticles,
  searchSuppliers,
  supplierItem,
  type ArticlePick,
  type PickItem,
  type SupplierPick,
} from '../../components/pickers';
import { DataTable } from '../../components/table/data-table';
import { type Column } from '../../components/table/types';
import { Tabs } from '../../components/tabs';
import { useSubmit } from '../../components/use-form';
import { errorMessage, http } from '../../lib/api';
import { formatDate, formatDateTime } from '../../lib/format';
import { formatMoney, formatQty, toInput, useMasterData } from '../../lib/master-data';
import { PURCHASE_TONE, openPdf, purchaseStatusLabel } from '../../lib/sales';
import { useCan, useSession } from '../../lib/session';
import { SendDialog } from './documents';

interface PurchaseRow {
  id: string;
  number: string;
  status: PurchaseStatus;
  supplierId: string;
  supplier: { id: string; number: string; name: string } | null;
  expectedDate: string | null;
  orderedAt: string | null;
  totalNet: string;
  createdAt: string;
}

interface PurchaseLine {
  id: string;
  position: number;
  articleId: string;
  articleNumber: string;
  supplierSku: string | null;
  name: string;
  unit: string;
  quantity: string;
  receivedQuantity: string;
  unitPriceNet: string;
  lineNet: string;
}

interface PurchaseDetail extends Omit<PurchaseRow, 'supplier'> {
  supplier: { id: string; number: string; name: string; email: string | null } | null;
  warehouseId: string;
  warehouse: { id: string; code: string; name: string } | null;
  notes: string | null;
  version: number;
  lines: PurchaseLine[];
  receipts: {
    id: string;
    createdAt: string;
    note: string | null;
    lines: { articleNumber: string; quantity: string }[];
  }[];
}

interface Suggestion {
  articleId: string;
  number: string;
  name: string;
  unit: string;
  minStock: string;
  stock: string;
  reserved: string;
  incoming: string;
  suggested: string;
  supplierId: string | null;
  supplierName: string | null;
  supplierSku: string | null;
  purchasePriceNet: string | null;
}

function useCanManagePurchasing() {
  const can = useCan();
  const s = useSession();
  return can('purchasing.manage') && s.account?.accessMode === 'full';
}

export function PurchasingPage() {
  const manage = useCanManagePurchasing();
  const [tab, setTab] = useState<'orders' | 'suggestions'>('orders');
  const [open, setOpen] = useState<string | 'new' | null>(() =>
    new URLSearchParams(window.location.search).get('id'),
  );
  const columns = useMemo<Column<PurchaseRow>[]>(
    () => [
      {
        id: 'number',
        header: 'Bestellung',
        kind: 'string',
        sortable: true,
        width: 130,
        value: (r) => r.number,
      },
      {
        id: 'supplier',
        header: 'Lieferant',
        kind: 'string',
        filterable: false,
        width: 240,
        value: (r) => r.supplier?.name,
      },
      {
        id: 'status',
        header: 'Status',
        kind: 'enum',
        sortable: true,
        width: 170,
        options: Object.entries(PURCHASE_STATUSES).map(([value, label]) => ({ value, label })),
        value: (r) => r.status,
        cell: (r) => <Badge tone={PURCHASE_TONE[r.status]}>{purchaseStatusLabel(r.status)}</Badge>,
      },
      {
        id: 'totalNet',
        header: 'Netto',
        kind: 'number',
        sortable: true,
        width: 120,
        value: (r) => Number(r.totalNet),
        cell: (r) => <span className="tabular-nums">{formatMoney(r.totalNet)}</span>,
      },
      {
        id: 'orderedAt',
        header: 'Bestellt am',
        kind: 'date',
        sortable: true,
        width: 130,
        value: (r) => r.orderedAt,
        cell: (r) => formatDate(r.orderedAt),
      },
      {
        id: 'expectedDate',
        header: 'Liefertermin',
        kind: 'date',
        sortable: true,
        width: 130,
        value: (r) => r.expectedDate,
        cell: (r) => formatDate(r.expectedDate),
      },
    ],
    [],
  );
  return (
    <>
      <PageHeader
        title="Einkauf"
        description="Bestellvorschläge, Bestellungen an Lieferanten und Wareneingang."
        actions={
          manage && (
            <Button onClick={() => setOpen('new')}>
              <Plus /> Bestellung anlegen
            </Button>
          )
        }
      />
      <Tabs
        tabs={[
          { id: 'orders', label: 'Bestellungen' },
          { id: 'suggestions', label: 'Bestellvorschläge' },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'orders' && (
        <DataTable<PurchaseRow>
          tableKey="purchase_orders"
          mode="server"
          queryKey={['purchase-orders']}
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
            return http.get(`/purchase-orders?${q}`);
          }}
          columns={columns}
          rowId={(r) => r.id}
          exportName="bestellungen"
          onRowClick={(r) => setOpen(r.id)}
          initial={{ sort: 'createdAt:desc' }}
        />
      )}
      {tab === 'suggestions' && <Suggestions manage={manage} onCreated={(id) => setOpen(id)} />}
      {open === 'new' && (
        <PurchaseEditor po={null} onClose={() => setOpen(null)} onSaved={(id) => setOpen(id)} />
      )}
      {open && open !== 'new' && <PurchaseDialog id={open} onClose={() => setOpen(null)} />}
    </>
  );
}

function Suggestions({ manage, onCreated }: { manage: boolean; onCreated: (id: string) => void }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['purchase-suggestions'],
    queryFn: () => http.get<Suggestion[]>('/purchase-orders/suggestions'),
  });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!q.data) return <Spinner />;
  if (!q.data.length)
    return (
      <p className="py-8 text-center text-sm text-muted">
        Keine Vorschläge: Alle Artikel liegen über dem Mindestbestand (inkl. offener Bestellungen).
      </p>
    );
  /** Je Lieferant eine Bestellung als Entwurf. */
  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const rows = q.data.filter((s) => selected.has(s.articleId));
      if (rows.some((r) => !r.supplierId))
        throw new Error('Für einige Artikel ist kein Lieferant hinterlegt.');
      const bySupplier = new Map<string, Suggestion[]>();
      for (const r of rows)
        bySupplier.set(r.supplierId!, [...(bySupplier.get(r.supplierId!) ?? []), r]);
      let last: string | null = null;
      for (const [supplierId, list] of bySupplier) {
        const po = await http.post<{ id: string }>('/purchase-orders', {
          supplierId,
          lines: list.map((r) => ({ articleId: r.articleId, quantity: r.suggested })),
        });
        last = po.id;
      }
      setSelected(new Set());
      await qc.invalidateQueries({ queryKey: ['purchase-orders'] });
      await qc.invalidateQueries({ queryKey: ['purchase-suggestions'] });
      if (last) onCreated(last);
    } catch (e) {
      setError(e instanceof Error && !('code' in e) ? e.message : errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-3">
      {error && <Alert tone="danger">{error}</Alert>}
      {manage && (
        <Button disabled={!selected.size} loading={busy} onClick={create}>
          <Plus /> Bestellentwürfe anlegen ({selected.size})
        </Button>
      )}
      <Table>
        <THead>
          <TR>
            {manage && <TH />}
            <TH>Artikel</TH>
            <TH className="text-right">Bestand</TH>
            <TH className="text-right">Reserviert</TH>
            <TH className="text-right">Bestellt</TH>
            <TH className="text-right">Mindestbestand</TH>
            <TH className="text-right">Vorschlag</TH>
            <TH>Lieferant</TH>
          </TR>
        </THead>
        <TBody>
          {q.data.map((s) => (
            <TR key={s.articleId}>
              {manage && (
                <TD>
                  <Checkbox
                    label={<span className="sr-only">{`${s.number} auswählen`}</span>}
                    checked={selected.has(s.articleId)}
                    disabled={!s.supplierId}
                    onChange={(e) => {
                      const next = new Set(selected);
                      if (e.target.checked) next.add(s.articleId);
                      else next.delete(s.articleId);
                      setSelected(next);
                    }}
                  />
                </TD>
              )}
              <TD>
                {s.number} · {s.name}
              </TD>
              <TD className="text-right tabular-nums">{formatQty(s.stock)}</TD>
              <TD className="text-right tabular-nums">{formatQty(s.reserved)}</TD>
              <TD className="text-right tabular-nums">{formatQty(s.incoming)}</TD>
              <TD className="text-right tabular-nums">{formatQty(s.minStock)}</TD>
              <TD className="text-right font-semibold tabular-nums">
                {formatQty(s.suggested)} {s.unit}
              </TD>
              <TD>
                {s.supplierName ?? <span className="text-warning">kein Lieferant hinterlegt</span>}
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </div>
  );
}

function PurchaseDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const q = useQuery({
    queryKey: ['purchase-order', id],
    queryFn: () => http.get<PurchaseDetail>(`/purchase-orders/${id}`),
  });
  const [editing, setEditing] = useState(false);
  if (!q.data)
    return (
      <Dialog open onClose={onClose} title="Bestellung">
        {q.isError ? <Alert tone="danger">{errorMessage(q.error)}</Alert> : <Spinner />}
      </Dialog>
    );
  if (editing)
    return (
      <PurchaseEditor
        po={q.data}
        onClose={() => setEditing(false)}
        onSaved={() => setEditing(false)}
      />
    );
  return <PurchaseView po={q.data} onClose={onClose} onEdit={() => setEditing(true)} />;
}

function PurchaseView({
  po,
  onClose,
  onEdit,
}: {
  po: PurchaseDetail;
  onClose: () => void;
  onEdit: () => void;
}) {
  const manage = useCanManagePurchasing();
  const qc = useQueryClient();
  const [tab, setTab] = useState<'lines' | 'history'>('lines');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [action, setAction] = useState<'send' | 'receive' | null>(null);
  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ['purchase-orders'] });
    await qc.invalidateQueries({ queryKey: ['purchase-order', po.id] });
    await qc.invalidateQueries({ queryKey: ['purchase-suggestions'] });
  };
  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  const open = ['ordered', 'partially_received'].includes(po.status);
  return (
    <Dialog
      open
      wide
      onClose={onClose}
      title={`Bestellung ${po.number}`}
      description={po.supplier ? `${po.supplier.name} (${po.supplier.number})` : undefined}
      footer={
        <Button variant="secondary" onClick={onClose}>
          Schließen
        </Button>
      }
    >
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Badge tone={PURCHASE_TONE[po.status]}>{purchaseStatusLabel(po.status)}</Badge>
        <Button
          size="sm"
          variant="secondary"
          loading={busy === 'pdf'}
          onClick={() => run('pdf', () => openPdf(`/purchase-orders/${po.id}/pdf`))}
        >
          <FileText /> PDF
        </Button>
        {manage && po.status === 'draft' && (
          <>
            <Button size="sm" variant="secondary" onClick={onEdit}>
              Bearbeiten
            </Button>
            <Button
              size="sm"
              variant="secondary"
              loading={busy === 'order'}
              onClick={() => run('order', () => http.post(`/purchase-orders/${po.id}/order`))}
            >
              <Send /> Als bestellt markieren
            </Button>
          </>
        )}
        {manage && ['draft', 'ordered', 'partially_received'].includes(po.status) && (
          <Button size="sm" variant="secondary" onClick={() => setAction('send')}>
            <Mail /> Per E-Mail bestellen
          </Button>
        )}
        {manage && open && (
          <Button size="sm" onClick={() => setAction('receive')}>
            <PackageCheck /> Wareneingang buchen
          </Button>
        )}
        {manage && ['draft', 'ordered'].includes(po.status) && (
          <Button
            size="sm"
            variant="ghost"
            loading={busy === 'cancel'}
            onClick={() => run('cancel', () => http.post(`/purchase-orders/${po.id}/cancel`))}
          >
            <Ban /> Stornieren
          </Button>
        )}
      </div>
      {error && (
        <div className="mb-3">
          <Alert tone="danger">{error}</Alert>
        </div>
      )}
      <Tabs
        tabs={[
          { id: 'lines', label: 'Positionen' },
          { id: 'history', label: 'Verlauf' },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'lines' && (
        <div className="space-y-4">
          <p className="text-sm text-muted">
            Lager: {po.warehouse ? `${po.warehouse.code} · ${po.warehouse.name}` : '–'}
            {po.expectedDate && ` · Liefertermin ${formatDate(po.expectedDate)}`}
            {po.orderedAt && ` · bestellt ${formatDateTime(po.orderedAt)}`}
          </p>
          <Table>
            <THead>
              <TR>
                <TH>Artikel</TH>
                <TH>Lief.-Art.-Nr.</TH>
                <TH className="text-right">Bestellt</TH>
                <TH className="text-right">Geliefert</TH>
                <TH className="text-right">Preis netto</TH>
                <TH className="text-right">Netto</TH>
              </TR>
            </THead>
            <TBody>
              {po.lines.map((l) => (
                <TR key={l.id}>
                  <TD>
                    {l.articleNumber} · {l.name}
                  </TD>
                  <TD>{l.supplierSku ?? '–'}</TD>
                  <TD className="text-right tabular-nums">
                    {formatQty(l.quantity)} {l.unit}
                  </TD>
                  <TD className="text-right tabular-nums">{formatQty(l.receivedQuantity)}</TD>
                  <TD className="text-right tabular-nums">{formatMoney(l.unitPriceNet)}</TD>
                  <TD className="text-right tabular-nums">{formatMoney(l.lineNet)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
          <p className="text-right text-sm font-semibold">Summe netto {formatMoney(po.totalNet)}</p>
          {po.notes && <p className="whitespace-pre-line text-sm text-muted">{po.notes}</p>}
          {po.receipts.length > 0 && (
            <div>
              <p className="mb-1 text-sm font-semibold">Wareneingänge</p>
              <ul className="text-sm">
                {po.receipts.map((r) => (
                  <li key={r.id}>
                    {formatDateTime(r.createdAt)} ·{' '}
                    {r.lines.map((l) => `${l.articleNumber}: ${formatQty(l.quantity)}`).join(', ')}
                    {r.note && <span className="text-muted"> · {r.note}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
      {tab === 'history' && <ActivityList entityType="purchase_order" entityId={po.id} />}
      {action === 'send' && (
        <SendDialog
          path={`/purchase-orders/${po.id}/send`}
          defaultTo={po.supplier?.email ?? ''}
          onClose={() => setAction(null)}
          onDone={refresh}
        />
      )}
      {action === 'receive' && (
        <ReceiveDialog po={po} onClose={() => setAction(null)} onDone={refresh} />
      )}
    </Dialog>
  );
}

function ReceiveDialog({
  po,
  onClose,
  onDone,
}: {
  po: PurchaseDetail;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const md = useMasterData().data;
  const openLines = po.lines.filter((l) => Number(l.receivedQuantity) < Number(l.quantity));
  const [qty, setQty] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      openLines.map((l) => [
        l.id,
        toInput(String(Number(l.quantity) - Number(l.receivedQuantity))),
      ]),
    ),
  );
  const [extra, setExtra] = useState<
    Record<string, { batch: string; bestBefore: string; locationId: string }>
  >({});
  const [note, setNote] = useState('');
  const locations = md?.locations.filter((l) => l.warehouseId === po.warehouseId) ?? [];
  const f = useSubmit(
    () =>
      http.post(`/purchase-orders/${po.id}/receipts`, {
        note: note || null,
        lines: openLines
          .filter((l) => qty[l.id] && Number(qty[l.id]!.replace(',', '.')) > 0)
          .map((l) => ({
            lineId: l.id,
            quantity: qty[l.id],
            locationId: extra[l.id]?.locationId || null,
            batch: extra[l.id]?.batch || null,
            bestBefore: extra[l.id]?.bestBefore || null,
          })),
      }),
    async () => {
      await onDone();
      onClose();
    },
  );
  return (
    <Dialog
      open
      wide
      onClose={onClose}
      title="Wareneingang buchen"
      description="Gelieferte Mengen eintragen. Der Bestand wird sofort gebucht; Teillieferungen sind möglich."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Abbrechen
          </Button>
          <Button loading={f.pending} onClick={() => f.submit(undefined)}>
            Einbuchen
          </Button>
        </>
      }
    >
      {f.error && (
        <div className="mb-3">
          <Alert tone="danger">{f.error}</Alert>
        </div>
      )}
      <div className="space-y-2">
        {openLines.map((l, i) => {
          const e = extra[l.id] ?? { batch: '', bestBefore: '', locationId: '' };
          const setE = (p: Partial<typeof e>) => setExtra({ ...extra, [l.id]: { ...e, ...p } });
          return (
            <div
              key={l.id}
              className="grid items-end gap-2 rounded-lg border border-border p-2 sm:grid-cols-5"
            >
              <p className="pb-2 text-sm sm:col-span-2">
                {l.articleNumber} · {l.name}{' '}
                <span className="text-muted">
                  (offen {formatQty(String(Number(l.quantity) - Number(l.receivedQuantity)))}{' '}
                  {l.unit})
                </span>
              </p>
              <Field label="Menge" error={f.fieldErrors[`lines.${i}.quantity`]}>
                {(p) => (
                  <Input
                    {...p}
                    value={qty[l.id] ?? ''}
                    onChange={(ev) => setQty({ ...qty, [l.id]: ev.target.value })}
                  />
                )}
              </Field>
              <Field label="Charge" error={f.fieldErrors.batch}>
                {(p) => (
                  <Input
                    {...p}
                    value={e.batch}
                    onChange={(ev) => setE({ batch: ev.target.value })}
                  />
                )}
              </Field>
              {locations.length > 0 ? (
                <Field label="Lagerplatz">
                  {(p) => (
                    <Select
                      {...p}
                      value={e.locationId}
                      onChange={(ev) => setE({ locationId: ev.target.value })}
                    >
                      <option value="">–</option>
                      {locations.map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.code}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              ) : (
                <Field label="MHD" error={f.fieldErrors.bestBefore}>
                  {(p) => (
                    <Input
                      {...p}
                      type="date"
                      value={e.bestBefore}
                      onChange={(ev) => setE({ bestBefore: ev.target.value })}
                    />
                  )}
                </Field>
              )}
            </div>
          );
        })}
        <Field label="Notiz (z. B. Lieferscheinnummer)">
          {(p) => <Input {...p} value={note} onChange={(e) => setNote(e.target.value)} />}
        </Field>
      </div>
    </Dialog>
  );
}

interface EditLine {
  key: string;
  articleId: string;
  label: string;
  quantity: string;
  unitPriceNet: string;
}

function PurchaseEditor({
  po,
  onClose,
  onSaved,
}: {
  po: PurchaseDetail | null;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const qc = useQueryClient();
  const md = useMasterData().data;
  const [supplier, setSupplier] = useState<PickItem | null>(
    po?.supplier
      ? { id: po.supplier.id, title: `${po.supplier.number} · ${po.supplier.name}` }
      : null,
  );
  const [warehouseId, setWarehouseId] = useState(po?.warehouseId ?? '');
  const [expectedDate, setExpectedDate] = useState(po?.expectedDate?.slice(0, 10) ?? '');
  const [notes, setNotes] = useState(po?.notes ?? '');
  const [lines, setLines] = useState<EditLine[]>(
    () =>
      po?.lines.map((l) => ({
        key: l.id,
        articleId: l.articleId,
        label: `${l.articleNumber} · ${l.name}`,
        quantity: toInput(l.quantity),
        unitPriceNet: toInput(l.unitPriceNet),
      })) ?? [],
  );
  const patch = (key: string, p: Partial<EditLine>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...p } : l)));
  const f = useSubmit(
    () => {
      const body = {
        supplierId: supplier?.id,
        warehouseId: warehouseId || null,
        expectedDate: expectedDate || null,
        notes: notes || null,
        lines: lines.map((l) => ({
          articleId: l.articleId,
          quantity: l.quantity,
          unitPriceNet: l.unitPriceNet || null,
        })),
      };
      return po
        ? http.put<PurchaseDetail>(`/purchase-orders/${po.id}`, { ...body, version: po.version })
        : http.post<PurchaseDetail>('/purchase-orders', body);
    },
    async (saved) => {
      await qc.invalidateQueries({ queryKey: ['purchase-orders'] });
      await qc.invalidateQueries({ queryKey: ['purchase-order', saved.id] });
      await qc.invalidateQueries({ queryKey: ['purchase-suggestions'] });
      onSaved(saved.id);
    },
  );
  return (
    <Dialog
      open
      wide
      onClose={onClose}
      title={po ? `Bestellung ${po.number} bearbeiten` : 'Bestellung anlegen'}
      description="Leere Preise werden aus den Lieferanten-Artikeldaten bzw. dem Einkaufspreis übernommen."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Abbrechen
          </Button>
          <Button loading={f.pending} onClick={() => f.submit(undefined)}>
            Speichern
          </Button>
        </>
      }
    >
      {f.error && (
        <div className="mb-4">
          <Alert tone="danger">{f.error}</Alert>
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-3">
        <SearchPicker<SupplierPick>
          label="Lieferant *"
          queryKey="suppliers"
          value={supplier}
          onChange={(s) => setSupplier(s ? supplierItem(s) : null)}
          search={searchSuppliers}
          toItem={supplierItem}
          error={f.fieldErrors.supplierId}
          autoFocus={!po}
        />
        <Field label="Lieferung an Lager">
          {(p) => (
            <Select {...p} value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
              <option value="">Standardlager</option>
              {md?.warehouses
                .filter((w) => !w.archivedAt)
                .map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.code} · {w.name}
                  </option>
                ))}
            </Select>
          )}
        </Field>
        <Field label="Liefertermin">
          {(p) => (
            <Input
              {...p}
              type="date"
              value={expectedDate}
              onChange={(e) => setExpectedDate(e.target.value)}
            />
          )}
        </Field>
      </div>
      <p className="mb-2 mt-5 text-sm font-semibold">Positionen</p>
      {f.fieldErrors.lines && <p className="mb-2 text-sm text-danger">{f.fieldErrors.lines}</p>}
      <div className="space-y-2">
        {lines.map((l, i) => (
          <div
            key={l.key}
            className="grid items-end gap-2 rounded-lg border border-border p-2 sm:grid-cols-12"
          >
            <div className="sm:col-span-6">
              <p className="pb-2 text-sm">{l.label}</p>
              {f.fieldErrors[`lines.${i}.articleId`] && (
                <p className="text-sm text-danger">{f.fieldErrors[`lines.${i}.articleId`]}</p>
              )}
            </div>
            <div className="sm:col-span-2">
              <Field label="Menge" error={f.fieldErrors[`lines.${i}.quantity`]}>
                {(p) => (
                  <Input
                    {...p}
                    value={l.quantity}
                    onChange={(e) => patch(l.key, { quantity: e.target.value })}
                  />
                )}
              </Field>
            </div>
            <div className="sm:col-span-3">
              <Field label="Preis netto" error={f.fieldErrors[`lines.${i}.unitPriceNet`]}>
                {(p) => (
                  <Input
                    {...p}
                    placeholder="automatisch"
                    value={l.unitPriceNet}
                    onChange={(e) => patch(l.key, { unitPriceNet: e.target.value })}
                  />
                )}
              </Field>
            </div>
            <div className="sm:col-span-1">
              <Button
                variant="ghost"
                size="icon"
                aria-label="Position entfernen"
                onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
              >
                <Trash2 />
              </Button>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-3">
        <SearchPicker<ArticlePick>
          label="Artikel hinzufügen"
          queryKey="articles-purchase"
          value={null}
          onChange={(a) =>
            a &&
            setLines((ls) => [
              ...ls,
              {
                key: crypto.randomUUID(),
                articleId: a.id,
                label: `${a.number} · ${a.name}`,
                quantity: '1',
                unitPriceNet: '',
              },
            ])
          }
          search={async (q) =>
            (await searchArticles(q)).filter((a) => a.stockTracked && a.kind !== 'set')
          }
          toItem={articleItem}
        />
      </div>
      <div className="mt-4">
        <Field label="Notiz an den Lieferanten">
          {(p) => (
            <textarea
              {...p}
              rows={3}
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          )}
        </Field>
      </div>
    </Dialog>
  );
}
