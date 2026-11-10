import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, Pencil, Plus, Trash2, Truck } from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  ORDER_EDITABLE,
  ORDER_SHIPPABLE,
  ORDER_STATUSES,
  ORDER_TRANSITIONS,
  type ListFilter,
  type OrderStatus,
} from '@fangevo/shared';
import {
  Alert,
  Badge,
  Button,
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
  customerItem,
  searchArticles,
  searchCustomers,
  type ArticlePick,
  type CustomerPick,
  type PickItem,
} from '../../components/pickers';
import { DataTable } from '../../components/table/data-table';
import { type Column } from '../../components/table/types';
import { Tabs } from '../../components/tabs';
import { useSubmit } from '../../components/use-form';
import { errorMessage, http } from '../../lib/api';
import { formatDate, formatDateTime } from '../../lib/format';
import { formatMoney, formatQty, toInput, useMasterData } from '../../lib/master-data';
import { ORDER_TONE, orderStatusLabel, type AddressSnapshot } from '../../lib/sales';
import { useCan, useSession } from '../../lib/session';
import { OrderDocuments, ReasonDialog } from './documents';

interface OrderRow {
  id: string;
  number: string;
  status: OrderStatus;
  customerId: string;
  customerName: string;
  customerNumber: string;
  orderDate: string;
  externalNumber: string | null;
  paymentMethod: string | null;
  shippingMethod: string | null;
  totalNet: string;
  totalGross: string;
  shippedAt: string | null;
}

interface OrderLine {
  id: string;
  position: number;
  articleId: string | null;
  articleNumber: string | null;
  name: string;
  unit: string;
  quantity: string;
  unitPriceNet: string;
  discountPercent: string;
  taxRate: string;
  lineNet: string;
  lineGross: string;
}

interface OrderDetail extends Omit<OrderRow, 'customerName' | 'customerNumber'> {
  warehouseId: string;
  warehouse: { id: string; code: string; name: string } | null;
  customerSnapshot: {
    number: string;
    displayName: string;
    email: string | null;
    priceDisplay: 'gross' | 'net';
    billing: AddressSnapshot | null;
    shipping: AddressSnapshot | null;
  };
  shippingNet: string;
  totalTax: string;
  notes: string | null;
  cancelReason: string | null;
  version: number;
  lines: OrderLine[];
  history: {
    id: string;
    fromStatus: string | null;
    toStatus: string;
    note: string | null;
    createdAt: string;
  }[];
  shortages: {
    articleId: string;
    number: string;
    name: string;
    needed: string;
    available: string;
  }[];
}

function useCanManageOrders() {
  const can = useCan();
  const s = useSession();
  return can('orders.manage') && s.account?.accessMode === 'full';
}

export function OrdersPage() {
  const manage = useCanManageOrders();
  const [open, setOpen] = useState<string | 'new' | null>(() =>
    new URLSearchParams(window.location.search).get('id'),
  );
  const columns = useMemo<Column<OrderRow>[]>(
    () => [
      {
        id: 'number',
        header: 'Auftrag',
        kind: 'string',
        sortable: true,
        width: 120,
        value: (r) => r.number,
      },
      {
        id: 'orderDate',
        header: 'Datum',
        kind: 'date',
        sortable: true,
        width: 120,
        value: (r) => r.orderDate,
        cell: (r) => formatDate(r.orderDate),
      },
      {
        id: 'customer',
        header: 'Kunde',
        kind: 'string',
        filterable: false,
        width: 240,
        value: (r) => `${r.customerNumber} ${r.customerName}`,
        cell: (r) => (
          <span>
            {r.customerName} <span className="text-muted">{r.customerNumber}</span>
          </span>
        ),
      },
      {
        id: 'status',
        header: 'Status',
        kind: 'enum',
        sortable: true,
        width: 170,
        options: Object.entries(ORDER_STATUSES).map(([value, label]) => ({ value, label })),
        value: (r) => r.status,
        cell: (r) => <Badge tone={ORDER_TONE[r.status]}>{orderStatusLabel(r.status)}</Badge>,
      },
      {
        id: 'totalGross',
        header: 'Brutto',
        kind: 'number',
        sortable: true,
        width: 120,
        value: (r) => Number(r.totalGross),
        cell: (r) => <span className="tabular-nums">{formatMoney(r.totalGross)}</span>,
      },
      {
        id: 'externalNumber',
        header: 'Externe Nr.',
        kind: 'string',
        sortable: true,
        defaultHidden: true,
        value: (r) => r.externalNumber,
      },
      {
        id: 'shippingMethod',
        header: 'Versandart',
        kind: 'string',
        sortable: true,
        defaultHidden: true,
        value: (r) => r.shippingMethod,
      },
      {
        id: 'shippedAt',
        header: 'Versendet',
        kind: 'date',
        sortable: true,
        defaultHidden: true,
        value: (r) => r.shippedAt,
        cell: (r) => formatDate(r.shippedAt),
      },
    ],
    [],
  );
  return (
    <>
      <PageHeader
        title="Aufträge"
        description="Kundenaufträge mit automatischer Preisermittlung, Bestandsreservierung und Versand."
        actions={
          manage && (
            <Button onClick={() => setOpen('new')}>
              <Plus /> Auftrag anlegen
            </Button>
          )
        }
      />
      <DataTable<OrderRow>
        tableKey="orders"
        mode="server"
        queryKey={['orders']}
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
          return http.get(`/orders?${q}`);
        }}
        columns={columns}
        rowId={(r) => r.id}
        exportName="auftraege"
        onRowClick={(r) => setOpen(r.id)}
        initial={{ sort: 'orderDate:desc' }}
      />
      {open === 'new' && (
        <OrderEditor order={null} onClose={() => setOpen(null)} onSaved={(id) => setOpen(id)} />
      )}
      {open && open !== 'new' && <OrderDialog id={open} onClose={() => setOpen(null)} />}
    </>
  );
}

function OrderDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const q = useQuery({
    queryKey: ['order', id],
    queryFn: () => http.get<OrderDetail>(`/orders/${id}`),
  });
  const [editing, setEditing] = useState(false);
  if (!q.data)
    return (
      <Dialog open onClose={onClose} title="Auftrag">
        {q.isError ? <Alert tone="danger">{errorMessage(q.error)}</Alert> : <Spinner />}
      </Dialog>
    );
  if (editing)
    return (
      <OrderEditor
        order={q.data}
        onClose={() => setEditing(false)}
        onSaved={() => setEditing(false)}
      />
    );
  return <OrderView order={q.data} onClose={onClose} onEdit={() => setEditing(true)} />;
}

function OrderView({
  order: o,
  onClose,
  onEdit,
}: {
  order: OrderDetail;
  onClose: () => void;
  onEdit: () => void;
}) {
  const manage = useCanManageOrders();
  const qc = useQueryClient();
  const [tab, setTab] = useState<'lines' | 'documents' | 'history'>('lines');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [cancel, setCancel] = useState(false);
  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ['orders'] });
    await qc.invalidateQueries({ queryKey: ['order', o.id] });
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
  const next = ORDER_TRANSITIONS[o.status] ?? [];
  const editable = (ORDER_EDITABLE as string[]).includes(o.status);
  const shippable = (ORDER_SHIPPABLE as string[]).includes(o.status);
  const cancellable = !['shipped', 'completed', 'cancelled'].includes(o.status);
  const s = o.customerSnapshot;
  const addr = (a: AddressSnapshot | null) =>
    a
      ? [a.name, a.street, [a.postalCode, a.city].filter(Boolean).join(' ')]
          .filter(Boolean)
          .join(', ')
      : '–';
  return (
    <Dialog
      open
      wide
      onClose={onClose}
      title={`Auftrag ${o.number}`}
      description={`${s.displayName} (${s.number})`}
      footer={
        <Button variant="secondary" onClick={onClose}>
          Schließen
        </Button>
      }
    >
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Badge tone={ORDER_TONE[o.status]}>{orderStatusLabel(o.status)}</Badge>
        {manage && editable && (
          <Button size="sm" variant="secondary" onClick={onEdit}>
            <Pencil /> Bearbeiten
          </Button>
        )}
        {manage &&
          next.map((to) => (
            <Button
              key={to}
              size="sm"
              variant="secondary"
              loading={busy === to}
              onClick={() => run(to, () => http.post(`/orders/${o.id}/status`, { to }))}
            >
              → {ORDER_STATUSES[to]}
            </Button>
          ))}
        {manage && shippable && (
          <Button
            size="sm"
            loading={busy === 'ship'}
            onClick={() => run('ship', () => http.post(`/orders/${o.id}/ship`, {}))}
          >
            <Truck /> Versenden (Bestand abbuchen)
          </Button>
        )}
        {manage && cancellable && (
          <Button size="sm" variant="ghost" onClick={() => setCancel(true)}>
            <Ban /> Stornieren
          </Button>
        )}
      </div>
      {error && (
        <div className="mb-3">
          <Alert tone="danger">{error}</Alert>
        </div>
      )}
      {o.shortages.length > 0 && (
        <div className="mb-3">
          <Alert tone="warning">
            Nicht genug Bestand:{' '}
            {o.shortages
              .map(
                (x) =>
                  `${x.number} ${x.name} (benötigt ${formatQty(x.needed)}, verfügbar ${formatQty(x.available)})`,
              )
              .join('; ')}
          </Alert>
        </div>
      )}
      {o.cancelReason && (
        <div className="mb-3">
          <Alert tone="info">Storniert: {o.cancelReason}</Alert>
        </div>
      )}
      <Tabs
        tabs={[
          { id: 'lines', label: 'Positionen' },
          { id: 'documents', label: 'Belege' },
          { id: 'history', label: 'Verlauf' },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'lines' && (
        <div className="space-y-4">
          <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
            <Info label="Rechnungsadresse" value={addr(s.billing)} />
            <Info label="Lieferadresse" value={addr(s.shipping)} />
            <Info
              label="Lager"
              value={o.warehouse ? `${o.warehouse.code} · ${o.warehouse.name}` : '–'}
            />
            <Info label="Datum" value={formatDateTime(o.orderDate)} />
            <Info label="Zahlungsart" value={o.paymentMethod ?? '–'} />
            <Info label="Versandart" value={o.shippingMethod ?? '–'} />
            {o.externalNumber && <Info label="Externe Nummer" value={o.externalNumber} />}
          </dl>
          <LinesTable lines={o.lines} />
          <Totals o={o} />
          {o.notes && <p className="whitespace-pre-line text-sm text-muted">{o.notes}</p>}
        </div>
      )}
      {tab === 'documents' && (
        <OrderDocuments orderId={o.id} orderCancelled={o.status === 'cancelled'} />
      )}
      {tab === 'history' && (
        <div className="space-y-4">
          <ul className="space-y-1 text-sm">
            {o.history.map((h) => (
              <li key={h.id}>
                <span className="text-muted">{formatDateTime(h.createdAt)}</span> ·{' '}
                {h.fromStatus ? `${orderStatusLabel(h.fromStatus)} → ` : ''}
                <strong>{orderStatusLabel(h.toStatus)}</strong>
                {h.note && <span className="text-muted"> · {h.note}</span>}
              </li>
            ))}
          </ul>
          <ActivityList entityType="order" entityId={o.id} />
        </div>
      )}
      {cancel && (
        <ReasonDialog
          title="Auftrag stornieren"
          description="Reservierter Bestand wird freigegeben. Gibt es eine Rechnung, muss sie vorher storniert werden."
          confirm="Stornieren"
          onClose={() => setCancel(false)}
          onSubmit={async (reason) => {
            await http.post(`/orders/${o.id}/cancel`, { reason });
            await refresh();
          }}
        />
      )}
    </Dialog>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function LinesTable({ lines }: { lines: OrderLine[] }) {
  return (
    <Table>
      <THead>
        <TR>
          <TH>Pos.</TH>
          <TH>Artikel</TH>
          <TH className="text-right">Menge</TH>
          <TH className="text-right">Einzelpreis netto</TH>
          <TH className="text-right">Rabatt</TH>
          <TH className="text-right">USt</TH>
          <TH className="text-right">Netto</TH>
        </TR>
      </THead>
      <TBody>
        {lines.map((l) => (
          <TR key={l.id}>
            <TD>{l.position}</TD>
            <TD>
              {l.articleNumber && <span className="text-muted">{l.articleNumber} · </span>}
              {l.name}
            </TD>
            <TD className="text-right tabular-nums">
              {formatQty(l.quantity)} {l.unit}
            </TD>
            <TD className="text-right tabular-nums">{formatMoney(l.unitPriceNet)}</TD>
            <TD className="text-right tabular-nums">
              {Number(l.discountPercent) ? `${formatQty(l.discountPercent)} %` : ''}
            </TD>
            <TD className="whitespace-nowrap text-right tabular-nums">{formatQty(l.taxRate)} %</TD>
            <TD className="text-right tabular-nums">{formatMoney(l.lineNet)}</TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}

function Totals({
  o,
}: {
  o: Pick<OrderDetail, 'shippingNet' | 'totalNet' | 'totalTax' | 'totalGross'>;
}) {
  return (
    <div className="ml-auto max-w-xs space-y-1 text-sm">
      {Number(o.shippingNet) > 0 && (
        <div className="flex justify-between">
          <span>Versandkosten netto</span>
          <span className="tabular-nums">{formatMoney(o.shippingNet)}</span>
        </div>
      )}
      <div className="flex justify-between">
        <span>Summe netto</span>
        <span className="tabular-nums">{formatMoney(o.totalNet)}</span>
      </div>
      <div className="flex justify-between">
        <span>Umsatzsteuer</span>
        <span className="tabular-nums">{formatMoney(o.totalTax)}</span>
      </div>
      <div className="flex justify-between font-semibold">
        <span>Gesamt brutto</span>
        <span className="tabular-nums">{formatMoney(o.totalGross)}</span>
      </div>
    </div>
  );
}

interface EditLine {
  key: string;
  articleId: string | null;
  label: string;
  name: string;
  quantity: string;
  unitPriceNet: string;
  discountPercent: string;
  taxRateId: string;
}

function OrderEditor({
  order,
  onClose,
  onSaved,
}: {
  order: OrderDetail | null;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const qc = useQueryClient();
  const md = useMasterData().data;
  const [customer, setCustomer] = useState<PickItem | null>(
    order
      ? {
          id: order.customerId,
          title: `${order.customerSnapshot.number} · ${order.customerSnapshot.displayName}`,
        }
      : null,
  );
  const [warehouseId, setWarehouseId] = useState(order?.warehouseId ?? '');
  const [v, setV] = useState({
    externalNumber: order?.externalNumber ?? '',
    paymentMethod: order?.paymentMethod ?? '',
    shippingMethod: order?.shippingMethod ?? '',
    shippingNet: toInput(order?.shippingNet ?? '0'),
    notes: order?.notes ?? '',
  });
  const [lines, setLines] = useState<EditLine[]>(
    () =>
      order?.lines.map((l) => ({
        key: l.id,
        articleId: l.articleId,
        label: l.articleNumber ? `${l.articleNumber} · ${l.name}` : l.name,
        name: l.articleId ? '' : l.name,
        quantity: toInput(l.quantity),
        unitPriceNet: toInput(l.unitPriceNet),
        discountPercent: Number(l.discountPercent) ? toInput(l.discountPercent) : '',
        taxRateId: '',
      })) ?? [],
  );
  const defaultTax = md?.taxRates.find((t) => t.isDefault)?.id ?? '';
  const patch = (key: string, p: Partial<EditLine>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...p } : l)));
  const addArticle = (a: ArticlePick | null) => {
    if (!a) return;
    setLines((ls) => [
      ...ls,
      {
        key: crypto.randomUUID(),
        articleId: a.id,
        label: `${a.number} · ${a.name}`,
        name: '',
        quantity: '1',
        unitPriceNet: '',
        discountPercent: '',
        taxRateId: '',
      },
    ]);
  };
  const f = useSubmit(
    () => {
      const body = {
        customerId: customer?.id,
        warehouseId: warehouseId || null,
        externalNumber: v.externalNumber || null,
        paymentMethod: v.paymentMethod || null,
        shippingMethod: v.shippingMethod || null,
        shippingNet: v.shippingNet || '0',
        notes: v.notes || null,
        lines: lines.map((l) => ({
          articleId: l.articleId,
          name: l.articleId ? null : l.name,
          quantity: l.quantity,
          unitPriceNet: l.unitPriceNet || null,
          discountPercent: l.discountPercent || null,
          taxRateId: l.articleId ? null : l.taxRateId || defaultTax,
        })),
      };
      return order
        ? http.put<OrderDetail>(`/orders/${order.id}`, { ...body, version: order.version })
        : http.post<OrderDetail>('/orders', body);
    },
    async (saved) => {
      await qc.invalidateQueries({ queryKey: ['orders'] });
      await qc.invalidateQueries({ queryKey: ['order', saved.id] });
      onSaved(saved.id);
    },
  );
  return (
    <Dialog
      open
      wide
      onClose={onClose}
      title={order ? `Auftrag ${order.number} bearbeiten` : 'Auftrag anlegen'}
      description="Leere Preisfelder werden automatisch ermittelt (Kundengruppe, Staffel, Verkaufspreis)."
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
      <div className="grid gap-4 sm:grid-cols-2">
        <SearchPicker<CustomerPick>
          label="Kunde *"
          queryKey="customers"
          value={customer}
          onChange={(c) => setCustomer(c ? customerItem(c) : null)}
          search={searchCustomers}
          toItem={customerItem}
          error={f.fieldErrors.customerId}
          autoFocus={!order}
        />
        <Field label="Lager">
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
      </div>

      <p className="mb-2 mt-5 text-sm font-semibold">Positionen</p>
      {f.fieldErrors.lines && <p className="mb-2 text-sm text-danger">{f.fieldErrors.lines}</p>}
      <div className="space-y-2">
        {lines.map((l, i) => (
          <div
            key={l.key}
            className="grid items-end gap-2 rounded-lg border border-border p-2 sm:grid-cols-12"
          >
            <div className="sm:col-span-4">
              {l.articleId ? (
                <p className="pb-2 text-sm">{l.label}</p>
              ) : (
                <Field label="Bezeichnung" error={f.fieldErrors[`lines.${i}.name`]}>
                  {(p) => (
                    <Input
                      {...p}
                      value={l.name}
                      onChange={(e) => patch(l.key, { name: e.target.value })}
                    />
                  )}
                </Field>
              )}
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
            <div className="sm:col-span-2">
              <Field label="Preis netto" error={f.fieldErrors[`lines.${i}.unitPriceNet`]}>
                {(p) => (
                  <Input
                    {...p}
                    placeholder={l.articleId ? 'automatisch' : '0,00'}
                    value={l.unitPriceNet}
                    onChange={(e) => patch(l.key, { unitPriceNet: e.target.value })}
                  />
                )}
              </Field>
            </div>
            <div className="sm:col-span-2">
              <Field label="Rabatt %">
                {(p) => (
                  <Input
                    {...p}
                    placeholder={l.articleId ? 'Gruppe' : '0'}
                    value={l.discountPercent}
                    onChange={(e) => patch(l.key, { discountPercent: e.target.value })}
                  />
                )}
              </Field>
            </div>
            <div className="flex items-end gap-1 sm:col-span-2">
              {!l.articleId && (
                <Field label="USt">
                  {(p) => (
                    <Select
                      {...p}
                      value={l.taxRateId || defaultTax}
                      onChange={(e) => patch(l.key, { taxRateId: e.target.value })}
                    >
                      {md?.taxRates
                        .filter((t) => !t.archivedAt)
                        .map((t) => (
                          <option key={t.id} value={t.id}>
                            {formatQty(t.rate)} %
                          </option>
                        ))}
                    </Select>
                  )}
                </Field>
              )}
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
      <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
        <SearchPicker<ArticlePick>
          label="Artikel hinzufügen"
          hint="Artikelnummer, EAN oder Bezeichnung"
          queryKey="articles"
          value={null}
          onChange={addArticle}
          search={searchArticles}
          toItem={articleItem}
        />
        <Button
          variant="secondary"
          onClick={() =>
            setLines((ls) => [
              ...ls,
              {
                key: crypto.randomUUID(),
                articleId: null,
                label: '',
                name: '',
                quantity: '1',
                unitPriceNet: '',
                discountPercent: '',
                taxRateId: '',
              },
            ])
          }
        >
          <Plus /> Freitextposition
        </Button>
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <Field label="Versandkosten netto" error={f.fieldErrors.shippingNet}>
          {(p) => (
            <Input
              {...p}
              value={v.shippingNet}
              onChange={(e) => setV({ ...v, shippingNet: e.target.value })}
            />
          )}
        </Field>
        <Field label="Versandart">
          {(p) => (
            <Input
              {...p}
              value={v.shippingMethod}
              onChange={(e) => setV({ ...v, shippingMethod: e.target.value })}
            />
          )}
        </Field>
        <Field label="Zahlungsart">
          {(p) => (
            <Input
              {...p}
              value={v.paymentMethod}
              onChange={(e) => setV({ ...v, paymentMethod: e.target.value })}
            />
          )}
        </Field>
        <Field label="Externe Bestellnummer">
          {(p) => (
            <Input
              {...p}
              value={v.externalNumber}
              onChange={(e) => setV({ ...v, externalNumber: e.target.value })}
            />
          )}
        </Field>
        <div className="sm:col-span-2">
          <Field label="Notizen">
            {(p) => (
              <textarea
                {...p}
                rows={3}
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm"
                value={v.notes}
                onChange={(e) => setV({ ...v, notes: e.target.value })}
              />
            )}
          </Field>
        </div>
      </div>
    </Dialog>
  );
}
