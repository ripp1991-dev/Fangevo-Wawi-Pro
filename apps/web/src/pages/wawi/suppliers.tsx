import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { type ListFilter } from '@fangevo/shared';
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Dialog,
  Field,
  Input,
  PageHeader,
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
import { Tabs } from '../../components/tabs';
import { useSubmit } from '../../components/use-form';
import { errorMessage, http } from '../../lib/api';
import { CustomFieldInputs, customFieldColumns, useCustomFields } from '../../lib/custom-fields';
import { formatMoney, toInput } from '../../lib/master-data';
import { useCan, useSession } from '../../lib/session';
import { type ArticleRow } from './articles';
import { AddressesEditor, ContactsEditor, toAddressValue, toContactValue } from './party-editor';

interface SupplierRow {
  id: string;
  number: string;
  name: string;
  email: string | null;
  phone: string | null;
  website: string | null;
  vatId: string | null;
  customerNumber: string | null;
  paymentTermsDays: number;
  defaultDeliveryDays: number | null;
  notes: string | null;
  articleCount: number;
  customFields: Record<string, unknown>;
  archivedAt: string | null;
  version: number;
}
interface SupplierDetail extends Omit<SupplierRow, 'articleCount'> {
  addresses: Record<string, unknown>[];
  contacts: Record<string, unknown>[];
  articles: {
    articleId: string;
    supplierSku: string | null;
    purchasePriceNet?: string;
    deliveryDays: number | null;
    minOrderQuantity: string;
    isPreferred: boolean;
    article: { number: string; name: string; unit: string } | null;
  }[];
}

export function SuppliersPage() {
  const can = useCan();
  const s = useSession();
  const qc = useQueryClient();
  const fields = useCustomFields('supplier');
  const [archived, setArchived] = useState(false);
  const [open, setOpen] = useState<string | 'new' | null>(() =>
    new URLSearchParams(window.location.search).get('id'),
  );
  const manage = can('suppliers.manage') && s.account?.accessMode === 'full';
  const columns = useMemo<Column<SupplierRow>[]>(
    () => [
      {
        id: 'number',
        header: 'Lief.-Nr.',
        kind: 'string',
        sortable: true,
        width: 120,
        value: (r) => r.number,
      },
      {
        id: 'name',
        header: 'Name',
        kind: 'string',
        sortable: true,
        width: 260,
        value: (r) => r.name,
      },
      { id: 'email', header: 'E-Mail', kind: 'string', sortable: true, value: (r) => r.email },
      {
        id: 'customerNumber',
        header: 'Unsere Kd.-Nr.',
        kind: 'string',
        sortable: true,
        defaultHidden: true,
        value: (r) => r.customerNumber,
      },
      {
        id: 'defaultDeliveryDays',
        header: 'Lieferzeit (Tage)',
        kind: 'number',
        sortable: true,
        width: 140,
        value: (r) => r.defaultDeliveryDays,
      },
      {
        id: 'articleCount',
        header: 'Artikel',
        kind: 'number',
        filterable: false,
        width: 100,
        value: (r) => r.articleCount,
      },
      {
        id: 'vatId',
        header: 'USt-IdNr.',
        kind: 'string',
        sortable: true,
        defaultHidden: true,
        value: (r) => r.vatId,
      },
      ...customFieldColumns<SupplierRow>(fields.data ?? []),
    ],
    [fields.data],
  );
  const archive = async (rows: SupplierRow[], a: boolean) => {
    for (const r of rows) await http.post(`/suppliers/${r.id}/${a ? 'archive' : 'restore'}`);
    await qc.invalidateQueries({ queryKey: ['suppliers'] });
  };
  return (
    <>
      <PageHeader
        title="Lieferanten"
        description="Bezugsquellen mit Lieferanten-Artikelnummern, Einkaufspreisen und Lieferzeiten."
        actions={
          manage && (
            <Button onClick={() => setOpen('new')}>
              <Plus /> Lieferant anlegen
            </Button>
          )
        }
      />
      <DataTable<SupplierRow>
        key={String(fields.data?.length ?? 0)}
        tableKey="suppliers"
        mode="server"
        queryKey={['suppliers', archived]}
        fetch={(p: {
          q: string;
          sort: string | null;
          filters: ListFilter[];
          page: number;
          pageSize: number;
        }) => {
          const q = new URLSearchParams({
            page: String(p.page),
            pageSize: String(p.pageSize),
            archived: String(archived),
          });
          if (p.q) q.set('q', p.q);
          if (p.sort) q.set('sort', p.sort);
          if (p.filters.length) q.set('filters', JSON.stringify(p.filters));
          return http.get(`/suppliers?${q}`);
        }}
        columns={columns}
        rowId={(r) => r.id}
        exportName="lieferanten"
        onRowClick={(r) => setOpen(r.id)}
        initial={{ sort: 'name:asc' }}
        toolbar={
          <Checkbox
            label="Archivierte anzeigen"
            checked={archived}
            onChange={(e) => setArchived(e.target.checked)}
          />
        }
        bulkActions={
          manage
            ? [
                {
                  label: 'Archivieren',
                  icon: <Archive />,
                  run: (rows) =>
                    archive(
                      rows.filter((r) => !r.archivedAt),
                      true,
                    ),
                },
                {
                  label: 'Wiederherstellen',
                  icon: <RotateCcw />,
                  run: (rows) =>
                    archive(
                      rows.filter((r) => r.archivedAt),
                      false,
                    ),
                },
              ]
            : undefined
        }
      />
      {open && (
        <SupplierDialog
          id={open === 'new' ? null : open}
          canManage={manage}
          onClose={() => setOpen(null)}
          onOpen={setOpen}
        />
      )}
    </>
  );
}

function SupplierDialog({
  id,
  canManage,
  onClose,
  onOpen,
}: {
  id: string | null;
  canManage: boolean;
  onClose: () => void;
  onOpen: (id: string) => void;
}) {
  const q = useQuery({
    queryKey: ['supplier', id],
    queryFn: () => http.get<SupplierDetail>(`/suppliers/${id}`),
    enabled: !!id,
  });
  if (id && q.isPending)
    return (
      <Dialog open onClose={onClose} title="Lieferant">
        <Spinner />
      </Dialog>
    );
  if (id && q.isError)
    return (
      <Dialog open onClose={onClose} title="Lieferant">
        <Alert tone="danger">{errorMessage(q.error)}</Alert>
      </Dialog>
    );
  return (
    <SupplierForm
      key={id ?? 'new'}
      s={q.data ?? null}
      canManage={canManage}
      onClose={onClose}
      onOpen={onOpen}
    />
  );
}

function SupplierForm({
  s,
  canManage,
  onClose,
  onOpen,
}: {
  s: SupplierDetail | null;
  canManage: boolean;
  onClose: () => void;
  onOpen: (id: string) => void;
}) {
  const qc = useQueryClient();
  const defs = useCustomFields('supplier').data ?? [];
  const [tab, setTab] = useState<'data' | 'articles' | 'addresses' | 'contacts' | 'history'>(
    'data',
  );
  const [v, setV] = useState({
    number: s?.number ?? '',
    name: s?.name ?? '',
    email: s?.email ?? '',
    phone: s?.phone ?? '',
    website: s?.website ?? '',
    vatId: s?.vatId ?? '',
    customerNumber: s?.customerNumber ?? '',
    paymentTermsDays: s?.paymentTermsDays ?? 30,
    defaultDeliveryDays: s?.defaultDeliveryDays ?? '',
    notes: s?.notes ?? '',
  });
  const [addresses, setAddresses] = useState(() => (s?.addresses ?? []).map(toAddressValue));
  const [contacts, setContacts] = useState(() => (s?.contacts ?? []).map(toContactValue));
  const [custom, setCustom] = useState<Record<string, unknown>>(s?.customFields ?? {});
  const set = (k: keyof typeof v, val: unknown) => setV({ ...v, [k]: val });
  const f = useSubmit(
    () => {
      const body = {
        ...v,
        number: v.number || null,
        paymentTermsDays: Number(v.paymentTermsDays),
        defaultDeliveryDays: v.defaultDeliveryDays === '' ? null : Number(v.defaultDeliveryDays),
        addresses: addresses.filter((a) => a.street || a.city || a.name),
        contacts: contacts.filter((x) => x.name),
        customFields: custom,
      };
      return s
        ? http.put<SupplierRow>(`/suppliers/${s.id}`, { ...body, version: s.version })
        : http.post<SupplierRow>('/suppliers', body);
    },
    async (saved) => {
      await qc.invalidateQueries({ queryKey: ['suppliers'] });
      await qc.invalidateQueries({ queryKey: ['supplier'] });
      if (!s) onOpen(saved.id);
      else onClose();
    },
  );
  const readOnly = !canManage || !!s?.archivedAt;
  return (
    <Dialog
      open
      wide
      onClose={onClose}
      title={s ? `${s.number} · ${s.name}` : 'Lieferant anlegen'}
      footer={
        !readOnly && ['data', 'addresses', 'contacts'].includes(tab) ? (
          <>
            <Button variant="secondary" onClick={onClose}>
              Abbrechen
            </Button>
            <Button loading={f.pending} onClick={() => f.submit(undefined)}>
              Speichern
            </Button>
          </>
        ) : (
          <Button variant="secondary" onClick={onClose}>
            Schließen
          </Button>
        )
      }
    >
      <Tabs
        tabs={[
          { id: 'data', label: 'Stammdaten' },
          { id: 'articles', label: `Artikel (${s?.articles.length ?? 0})`, hidden: !s },
          { id: 'addresses', label: 'Adressen' },
          { id: 'contacts', label: 'Ansprechpartner' },
          { id: 'history', label: 'Verlauf', hidden: !s },
        ]}
        value={tab}
        onChange={setTab}
      />
      {f.error && (
        <div className="mb-4">
          <Alert tone="danger">{f.error}</Alert>
        </div>
      )}
      <fieldset disabled={readOnly} className="contents">
        {tab === 'data' && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name *" error={f.fieldErrors.name}>
              {(p) => <Input {...p} value={v.name} onChange={(e) => set('name', e.target.value)} />}
            </Field>
            <Field
              label="Lieferantennummer"
              hint={s ? undefined : 'Leer lassen = automatisch vergeben'}
              error={f.fieldErrors.number}
            >
              {(p) => (
                <Input {...p} value={v.number} onChange={(e) => set('number', e.target.value)} />
              )}
            </Field>
            <Field label="E-Mail" error={f.fieldErrors.email}>
              {(p) => (
                <Input
                  {...p}
                  type="email"
                  value={v.email}
                  onChange={(e) => set('email', e.target.value)}
                />
              )}
            </Field>
            <Field label="Telefon">
              {(p) => (
                <Input {...p} value={v.phone} onChange={(e) => set('phone', e.target.value)} />
              )}
            </Field>
            <Field label="Website">
              {(p) => (
                <Input {...p} value={v.website} onChange={(e) => set('website', e.target.value)} />
              )}
            </Field>
            <Field label="USt-IdNr.">
              {(p) => (
                <Input {...p} value={v.vatId} onChange={(e) => set('vatId', e.target.value)} />
              )}
            </Field>
            <Field label="Unsere Kundennummer beim Lieferanten">
              {(p) => (
                <Input
                  {...p}
                  value={v.customerNumber}
                  onChange={(e) => set('customerNumber', e.target.value)}
                />
              )}
            </Field>
            <Field label="Zahlungsziel (Tage)">
              {(p) => (
                <Input
                  {...p}
                  type="number"
                  min={0}
                  value={v.paymentTermsDays}
                  onChange={(e) => set('paymentTermsDays', e.target.value)}
                />
              )}
            </Field>
            <Field label="Standard-Lieferzeit (Tage)">
              {(p) => (
                <Input
                  {...p}
                  type="number"
                  min={0}
                  value={v.defaultDeliveryDays}
                  onChange={(e) => set('defaultDeliveryDays', e.target.value)}
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
                    onChange={(e) => set('notes', e.target.value)}
                  />
                )}
              </Field>
            </div>
            {defs.length > 0 && (
              <p className="pt-2 text-sm font-semibold sm:col-span-2">Eigene Felder</p>
            )}
            <CustomFieldInputs
              defs={defs}
              values={custom}
              onChange={setCustom}
              errors={f.fieldErrors}
              references={{}}
            />
          </div>
        )}
        {tab === 'addresses' && <AddressesEditor value={addresses} onChange={setAddresses} />}
        {tab === 'contacts' && <ContactsEditor value={contacts} onChange={setContacts} />}
      </fieldset>
      {tab === 'articles' && s && <SupplierArticles s={s} canManage={!readOnly} />}
      {tab === 'history' && s && <ActivityList entityType="supplier" entityId={s.id} />}
    </Dialog>
  );
}

function SupplierArticles({ s, canManage }: { s: SupplierDetail; canManage: boolean }) {
  const qc = useQueryClient();
  const can = useCan();
  const canPrices = can('articles.prices');
  const [q, setQ] = useState('');
  const [pick, setPick] = useState<ArticleRow | null>(null);
  const [form, setForm] = useState({
    supplierSku: '',
    purchasePriceNet: '',
    deliveryDays: '',
    minOrderQuantity: '1',
    isPreferred: false,
  });
  const [err, setErr] = useState<string | null>(null);
  const search = useQuery({
    queryKey: ['article-pick', q],
    queryFn: () =>
      http.get<{ items: ArticleRow[] }>(`/articles?pageSize=10&q=${encodeURIComponent(q)}`),
    enabled: q.length >= 2,
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['supplier', s.id] });
  const save = async () => {
    setErr(null);
    try {
      await http.put(`/suppliers/${s.id}/articles`, {
        articleId: pick!.id,
        supplierSku: form.supplierSku || null,
        purchasePriceNet: form.purchasePriceNet,
        deliveryDays: form.deliveryDays === '' ? null : Number(form.deliveryDays),
        minOrderQuantity: form.minOrderQuantity || '1',
        isPreferred: form.isPreferred,
      });
      setPick(null);
      setQ('');
      await refresh();
    } catch (e) {
      setErr(errorMessage(e));
    }
  };
  return (
    <div className="space-y-4">
      {err && <Alert tone="danger">{err}</Alert>}
      {s.articles.length ? (
        <Table>
          <THead>
            <tr>
              <TH>Artikel</TH>
              <TH>Lief.-Art.-Nr.</TH>
              {canPrices && <TH>EK netto</TH>}
              <TH>Lieferzeit</TH>
              <TH>Mindestmenge</TH>
              <TH />
            </tr>
          </THead>
          <TBody>
            {s.articles.map((a) => (
              <TR key={a.articleId}>
                <TD>
                  {a.article ? `${a.article.number} · ${a.article.name}` : '–'}{' '}
                  {a.isPreferred && <Badge tone="primary">Bevorzugt</Badge>}
                </TD>
                <TD>{a.supplierSku ?? '–'}</TD>
                {canPrices && <TD>{formatMoney(a.purchasePriceNet)}</TD>}
                <TD>{a.deliveryDays !== null ? `${a.deliveryDays} Tage` : '–'}</TD>
                <TD>{toInput(a.minOrderQuantity)}</TD>
                <TD>
                  {canManage && (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Zuordnung entfernen"
                      onClick={async () => {
                        await http.del(`/suppliers/${s.id}/articles/${a.articleId}`);
                        await refresh();
                      }}
                    >
                      <Trash2 />
                    </Button>
                  )}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      ) : (
        <p className="text-sm text-muted">Diesem Lieferanten sind noch keine Artikel zugeordnet.</p>
      )}
      {canManage && canPrices && (
        <div className="rounded-lg border border-border p-3">
          <p className="mb-2 text-sm font-semibold">Artikel zuordnen</p>
          {!pick ? (
            <>
              <Input
                aria-label="Artikel suchen"
                placeholder="Artikelnummer oder Bezeichnung"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
              <ul className="mt-2 space-y-1">
                {search.data?.items
                  .filter((a) => a.kind === 'standard' || a.kind === 'variant')
                  .map((a) => (
                    <li key={a.id}>
                      <button
                        type="button"
                        className="w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-surface-2"
                        onClick={() => setPick(a)}
                      >
                        {a.number} · {a.name}
                      </button>
                    </li>
                  ))}
              </ul>
            </>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              <p className="text-sm sm:col-span-2">
                <strong>
                  {pick.number} · {pick.name}
                </strong>{' '}
                <Button variant="link" size="sm" onClick={() => setPick(null)}>
                  ändern
                </Button>
              </p>
              <Field label="Lieferanten-Artikelnummer">
                {(p) => (
                  <Input
                    {...p}
                    value={form.supplierSku}
                    onChange={(e) => setForm({ ...form, supplierSku: e.target.value })}
                  />
                )}
              </Field>
              <Field label="Einkaufspreis netto (€) *">
                {(p) => (
                  <Input
                    {...p}
                    inputMode="decimal"
                    value={form.purchasePriceNet}
                    onChange={(e) => setForm({ ...form, purchasePriceNet: e.target.value })}
                  />
                )}
              </Field>
              <Field label="Lieferzeit (Tage)">
                {(p) => (
                  <Input
                    {...p}
                    type="number"
                    min={0}
                    value={form.deliveryDays}
                    onChange={(e) => setForm({ ...form, deliveryDays: e.target.value })}
                  />
                )}
              </Field>
              <Field label="Mindestbestellmenge">
                {(p) => (
                  <Input
                    {...p}
                    inputMode="decimal"
                    value={form.minOrderQuantity}
                    onChange={(e) => setForm({ ...form, minOrderQuantity: e.target.value })}
                  />
                )}
              </Field>
              <Checkbox
                label="Bevorzugter Lieferant für diesen Artikel"
                checked={form.isPreferred}
                onChange={(e) => setForm({ ...form, isPreferred: e.target.checked })}
              />
              <div className="flex justify-end sm:col-span-2">
                <Button size="sm" onClick={save}>
                  Zuordnen
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
