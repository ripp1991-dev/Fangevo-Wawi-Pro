import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDownToLine, ArrowRightLeft, ArrowUpFromLine, ClipboardCheck } from 'lucide-react';
import { useState } from 'react';
import { Alert, Badge, Button, Dialog, Field, Input, PageHeader, Select } from '@fangevo/ui';
import { DataTable } from '../../components/table/data-table';
import { type Column } from '../../components/table/types';
import { Tabs } from '../../components/tabs';
import { useSubmit } from '../../components/use-form';
import { http } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import { formatQty, useMasterData, type MasterData } from '../../lib/master-data';
import { useCan, useSession } from '../../lib/session';
import { type ArticleRow } from './articles';

interface Level {
  id: string;
  articleId: string;
  warehouseId: string;
  locationId: string | null;
  quantity: string;
  reserved: string;
  available: string;
  article: { number: string; name: string; unit: string; minStock: string } | null;
  warehouse: { code: string; name: string } | null;
  location: { code: string } | null;
}
interface Movement {
  id: string;
  type: 'receipt' | 'issue' | 'transfer_out' | 'transfer_in' | 'correction';
  quantity: string;
  balanceAfter: string;
  batch: string | null;
  serialNumber: string | null;
  bestBefore: string | null;
  note: string | null;
  createdAt: string;
  article: { number: string; name: string } | null;
  warehouse: { code: string; name: string } | null;
}

const TYPES: Record<Movement['type'], string> = {
  receipt: 'Zugang',
  issue: 'Abgang',
  transfer_out: 'Umlagerung (ab)',
  transfer_in: 'Umlagerung (zu)',
  correction: 'Korrektur / Inventur',
};

export function InventoryPage() {
  const can = useCan();
  const s = useSession();
  const md = useMasterData();
  const [tab, setTab] = useState<'levels' | 'journal'>('levels');
  const [booking, setBooking] = useState<null | 'receipt' | 'issue' | 'transfer' | 'correction'>(
    null,
  );
  const manage = can('inventory.manage') && s.account?.accessMode === 'full';
  return (
    <>
      <PageHeader
        title="Lager & Bestand"
        description="Jede Bestandsänderung wird unveränderlich im Journal gebucht."
        actions={
          manage && (
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => setBooking('receipt')}>
                <ArrowDownToLine /> Zugang
              </Button>
              <Button variant="secondary" onClick={() => setBooking('issue')}>
                <ArrowUpFromLine /> Abgang
              </Button>
              <Button variant="secondary" onClick={() => setBooking('transfer')}>
                <ArrowRightLeft /> Umlagern
              </Button>
              <Button variant="secondary" onClick={() => setBooking('correction')}>
                <ClipboardCheck /> Inventur
              </Button>
            </div>
          )
        }
      />
      <Tabs
        tabs={[
          { id: 'levels', label: 'Bestände' },
          { id: 'journal', label: 'Journal' },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'levels' ? <Levels /> : <Journal />}
      {booking && md.data && (
        <BookingDialog kind={booking} md={md.data} onClose={() => setBooking(null)} />
      )}
    </>
  );
}

function Levels() {
  const q = useQuery({
    queryKey: ['stock-levels'],
    queryFn: () => http.get<Level[]>('/inventory/levels'),
  });
  const columns: Column<Level>[] = [
    {
      id: 'number',
      header: 'Art.-Nr.',
      kind: 'string',
      sortable: true,
      width: 130,
      value: (r) => r.article?.number,
    },
    {
      id: 'name',
      header: 'Artikel',
      kind: 'string',
      sortable: true,
      width: 260,
      value: (r) => r.article?.name,
    },
    {
      id: 'warehouse',
      header: 'Lager',
      kind: 'string',
      sortable: true,
      groupable: true,
      value: (r) => r.warehouse?.name,
    },
    {
      id: 'location',
      header: 'Lagerplatz',
      kind: 'string',
      sortable: true,
      value: (r) => r.location?.code ?? '',
    },
    {
      id: 'quantity',
      header: 'Bestand',
      kind: 'number',
      sortable: true,
      width: 120,
      value: (r) => Number(r.quantity),
      cell: (r) => (
        <span className={Number(r.quantity) < 0 ? 'font-medium text-danger' : ''}>
          {formatQty(r.quantity)} {r.article?.unit}
        </span>
      ),
    },
    {
      id: 'reserved',
      header: 'Reserviert',
      kind: 'number',
      sortable: true,
      width: 110,
      value: (r) => Number(r.reserved),
      text: (r) => formatQty(r.reserved),
    },
    {
      id: 'available',
      header: 'Verfügbar',
      kind: 'number',
      sortable: true,
      width: 110,
      value: (r) => Number(r.available),
      text: (r) => formatQty(r.available),
    },
  ];
  return (
    <DataTable<Level>
      tableKey="stock"
      mode="client"
      rows={q.data}
      loading={q.isPending}
      error={q.error}
      columns={columns}
      rowId={(r) => r.id}
      exportName="bestand"
      initial={{ sort: 'number:asc' }}
      emptyTitle="Noch kein Bestand gebucht"
    />
  );
}

function Journal() {
  const q = useInfiniteQuery({
    queryKey: ['stock-movements'],
    initialPageParam: '',
    queryFn: ({ pageParam }) =>
      http.get<{ items: Movement[]; nextCursor: string | null }>(
        `/inventory/movements?limit=200${pageParam ? `&cursor=${pageParam}` : ''}`,
      ),
    getNextPageParam: (p) => p.nextCursor ?? undefined,
  });
  const columns: Column<Movement>[] = [
    {
      id: 'createdAt',
      header: 'Zeitpunkt',
      kind: 'date',
      sortable: true,
      width: 170,
      value: (r) => r.createdAt,
      text: (r) => formatDateTime(r.createdAt),
    },
    {
      id: 'type',
      header: 'Art',
      kind: 'enum',
      groupable: true,
      width: 170,
      options: Object.entries(TYPES).map(([value, label]) => ({ value, label })),
      value: (r) => r.type,
      cell: (r) => (
        <Badge tone={Number(r.quantity) > 0 ? 'success' : 'warning'}>{TYPES[r.type]}</Badge>
      ),
    },
    {
      id: 'article',
      header: 'Artikel',
      kind: 'string',
      sortable: true,
      width: 240,
      value: (r) => (r.article ? `${r.article.number} · ${r.article.name}` : ''),
    },
    {
      id: 'warehouse',
      header: 'Lager',
      kind: 'string',
      groupable: true,
      value: (r) => r.warehouse?.name,
    },
    {
      id: 'quantity',
      header: 'Menge',
      kind: 'number',
      sortable: true,
      width: 100,
      value: (r) => Number(r.quantity),
      text: (r) => (Number(r.quantity) > 0 ? '+' : '') + formatQty(r.quantity),
    },
    {
      id: 'balanceAfter',
      header: 'Bestand danach',
      kind: 'number',
      width: 130,
      value: (r) => Number(r.balanceAfter),
      text: (r) => formatQty(r.balanceAfter),
    },
    {
      id: 'batch',
      header: 'Charge / SN / MHD',
      kind: 'string',
      defaultHidden: true,
      value: (r) =>
        [r.batch, r.serialNumber, r.bestBefore?.slice(0, 10)].filter(Boolean).join(' · '),
    },
    { id: 'note', header: 'Notiz', kind: 'string', value: (r) => r.note },
  ];
  return (
    <DataTable<Movement>
      tableKey="movements"
      mode="client"
      rows={q.data?.pages.flatMap((p) => p.items)}
      loading={q.isPending}
      error={q.error}
      columns={columns}
      rowId={(r) => r.id}
      exportName="lagerjournal"
      initial={{ sort: 'createdAt:desc' }}
      footer={
        q.hasNextPage && (
          <Button
            size="sm"
            variant="secondary"
            loading={q.isFetchingNextPage}
            onClick={() => q.fetchNextPage()}
          >
            Ältere laden
          </Button>
        )
      }
    />
  );
}

function ArticlePicker({
  value,
  onChange,
}: {
  value: ArticleRow | null;
  onChange: (a: ArticleRow | null) => void;
}) {
  const [q, setQ] = useState('');
  const search = useQuery({
    queryKey: ['article-pick', q],
    queryFn: () =>
      http.get<{ items: ArticleRow[] }>(`/articles?pageSize=10&q=${encodeURIComponent(q)}`),
    enabled: q.length >= 2,
  });
  if (value) {
    return (
      <p className="text-sm">
        <strong>
          {value.number} · {value.name}
        </strong>{' '}
        <span className="text-muted">
          Bestand {formatQty(value.stock)} {value.unit}
        </span>{' '}
        <Button variant="link" size="sm" onClick={() => onChange(null)}>
          ändern
        </Button>
      </p>
    );
  }
  return (
    <div>
      <Field label="Artikel" hint="Artikelnummer, EAN oder Bezeichnung eingeben">
        {(p) => <Input {...p} autoFocus value={q} onChange={(e) => setQ(e.target.value)} />}
      </Field>
      <ul className="mt-1 max-h-48 space-y-0.5 overflow-y-auto">
        {search.data?.items
          .filter((a) => a.stockTracked && (a.kind === 'standard' || a.kind === 'variant'))
          .map((a) => (
            <li key={a.id}>
              <button
                type="button"
                className="w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-surface-2"
                onClick={() => onChange(a)}
              >
                {a.number} · {a.name}{' '}
                <span className="text-muted">
                  ({formatQty(a.stock)} {a.unit})
                </span>
              </button>
            </li>
          ))}
      </ul>
    </div>
  );
}

function WarehouseSelect({
  md,
  label,
  value,
  onChange,
  location,
  onLocation,
}: {
  md: MasterData;
  label: string;
  value: string;
  onChange: (v: string) => void;
  location: string;
  onLocation: (v: string) => void;
}) {
  const locs = md.locations.filter((l) => l.warehouseId === value);
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label={label}>
        {(p) => (
          <Select
            {...p}
            value={value}
            onChange={(e) => {
              onChange(e.target.value);
              onLocation('');
            }}
          >
            {md.warehouses
              .filter((w) => !w.archivedAt)
              .map((w) => (
                <option key={w.id} value={w.id}>
                  {w.code} · {w.name}
                </option>
              ))}
          </Select>
        )}
      </Field>
      <Field label="Lagerplatz">
        {(p) => (
          <Select
            {...p}
            value={location}
            onChange={(e) => onLocation(e.target.value)}
            disabled={!locs.length}
          >
            <option value="">{locs.length ? '– ohne Lagerplatz –' : 'keine Lagerplätze'}</option>
            {locs.map((l) => (
              <option key={l.id} value={l.id}>
                {l.code}
              </option>
            ))}
          </Select>
        )}
      </Field>
    </div>
  );
}

function BookingDialog({
  kind,
  md,
  onClose,
}: {
  kind: 'receipt' | 'issue' | 'transfer' | 'correction';
  md: MasterData;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const def = md.warehouses.find((w) => w.isDefault)?.id ?? md.warehouses[0]?.id ?? '';
  const [article, setArticle] = useState<ArticleRow | null>(null);
  const [v, setV] = useState({
    warehouseId: def,
    locationId: '',
    toWarehouseId: md.warehouses.find((w) => w.id !== def)?.id ?? def,
    toLocationId: '',
    quantity: '',
    batch: '',
    serialNumber: '',
    bestBefore: '',
    note: '',
  });
  const [result, setResult] = useState<string | null>(null);
  const set = (k: keyof typeof v, val: string) => setV({ ...v, [k]: val });
  const titles = {
    receipt: 'Wareneingang buchen',
    issue: 'Warenabgang buchen',
    transfer: 'Umlagern',
    correction: 'Inventur / Bestandskorrektur',
  };
  const f = useSubmit(
    () => {
      const base = { articleId: article?.id, note: v.note || null };
      if (kind === 'transfer')
        return http.post<Record<string, string>>('/inventory/transfers', {
          ...base,
          fromWarehouseId: v.warehouseId,
          fromLocationId: v.locationId || null,
          toWarehouseId: v.toWarehouseId,
          toLocationId: v.toLocationId || null,
          quantity: v.quantity,
        });
      if (kind === 'correction')
        return http.post<Record<string, string>>('/inventory/corrections', {
          ...base,
          warehouseId: v.warehouseId,
          locationId: v.locationId || null,
          countedQuantity: v.quantity,
        });
      return http.post<Record<string, string>>('/inventory/bookings', {
        ...base,
        type: kind,
        warehouseId: v.warehouseId,
        locationId: v.locationId || null,
        quantity: v.quantity,
        batch: v.batch || null,
        serialNumber: v.serialNumber || null,
        bestBefore: v.bestBefore || null,
      });
    },
    async (r) => {
      await Promise.all(
        ['stock-levels', 'stock-movements', 'articles', 'low-stock'].map((k) =>
          qc.invalidateQueries({ queryKey: [k] }),
        ),
      );
      setResult(
        kind === 'transfer'
          ? `Umgelagert. Bestand Quelle ${formatQty(r.fromBalance)}, Ziel ${formatQty(r.toBalance)}.`
          : kind === 'correction'
            ? `Korrigiert um ${formatQty(r.delta)}. Neuer Bestand ${formatQty(r.balance)}.`
            : `Gebucht. Neuer Bestand ${formatQty(r.balance)}.`,
      );
      setArticle(null);
      setV({ ...v, quantity: '', batch: '', serialNumber: '', bestBefore: '', note: '' });
    },
  );
  return (
    <Dialog
      open
      onClose={onClose}
      title={titles[kind]}
      description="Nach dem Buchen können Sie direkt die nächste Buchung erfassen."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Fertig
          </Button>
          <Button
            loading={f.pending}
            disabled={!article}
            onClick={() => {
              setResult(null);
              f.submit(undefined);
            }}
          >
            Buchen
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {result && <Alert tone="success">{result}</Alert>}
        {f.error && <Alert tone="danger">{f.error}</Alert>}
        <ArticlePicker value={article} onChange={setArticle} />
        <WarehouseSelect
          md={md}
          label={kind === 'transfer' ? 'Von Lager' : 'Lager'}
          value={v.warehouseId}
          onChange={(x) => set('warehouseId', x)}
          location={v.locationId}
          onLocation={(x) => set('locationId', x)}
        />
        {kind === 'transfer' && (
          <WarehouseSelect
            md={md}
            label="Nach Lager"
            value={v.toWarehouseId}
            onChange={(x) => set('toWarehouseId', x)}
            location={v.toLocationId}
            onLocation={(x) => set('toLocationId', x)}
          />
        )}
        <Field
          label={kind === 'correction' ? 'Gezählter Bestand' : 'Menge'}
          error={f.fieldErrors.quantity ?? f.fieldErrors.countedQuantity}
        >
          {(p) => (
            <Input
              {...p}
              inputMode="decimal"
              value={v.quantity}
              onChange={(e) => set('quantity', e.target.value)}
            />
          )}
        </Field>
        {(kind === 'receipt' || kind === 'issue') &&
          article &&
          (article.trackBatches || article.trackSerials || article.trackBestBefore) && (
            <div className="grid gap-3 sm:grid-cols-3">
              {article.trackBatches && (
                <Field label="Charge *" error={f.fieldErrors.batch}>
                  {(p) => (
                    <Input {...p} value={v.batch} onChange={(e) => set('batch', e.target.value)} />
                  )}
                </Field>
              )}
              {article.trackSerials && (
                <Field label="Seriennummer *" error={f.fieldErrors.serialNumber}>
                  {(p) => (
                    <Input
                      {...p}
                      value={v.serialNumber}
                      onChange={(e) => set('serialNumber', e.target.value)}
                    />
                  )}
                </Field>
              )}
              {article.trackBestBefore && (
                <Field
                  label={kind === 'receipt' ? 'MHD *' : 'MHD'}
                  error={f.fieldErrors.bestBefore}
                >
                  {(p) => (
                    <Input
                      {...p}
                      type="date"
                      value={v.bestBefore}
                      onChange={(e) => set('bestBefore', e.target.value)}
                    />
                  )}
                </Field>
              )}
            </div>
          )}
        <Field label="Notiz">
          {(p) => (
            <Input
              {...p}
              value={v.note}
              onChange={(e) => set('note', e.target.value)}
              placeholder={
                kind === 'correction' ? 'z. B. Inventur 2026' : 'z. B. Lieferschein 4711'
              }
            />
          )}
        </Field>
      </div>
    </Dialog>
  );
}
