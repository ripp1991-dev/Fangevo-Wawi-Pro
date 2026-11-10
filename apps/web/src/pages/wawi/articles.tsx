import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, Plus, RotateCcw, Trash2, Wand2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { ARTICLE_KINDS, type ListFilter } from '@fangevo/shared';
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
import { Tabs } from '../../components/tabs';
import { useSubmit } from '../../components/use-form';
import { errorMessage, http } from '../../lib/api';
import {
  CustomFieldInputs,
  customFieldColumns,
  useCustomFields,
  type CustomFieldDef,
} from '../../lib/custom-fields';
import {
  categoryPaths,
  formatMoney,
  formatQty,
  gross,
  toInput,
  useMasterData,
  type MasterData,
} from '../../lib/master-data';
import { useCan, useSession } from '../../lib/session';

export interface ArticleRow {
  id: string;
  number: string;
  kind: 'standard' | 'parent' | 'variant' | 'set';
  parentId: string | null;
  name: string;
  shortDescription: string | null;
  description: string | null;
  gtin: string | null;
  manufacturerId: string | null;
  brand: string | null;
  categoryId: string | null;
  unit: string;
  taxRateId: string;
  purchasePriceNet?: string;
  salePriceNet: string;
  weightKg: string | null;
  minStock: string;
  stockTracked: boolean;
  trackBatches: boolean;
  trackSerials: boolean;
  trackBestBefore: boolean;
  active: boolean;
  variantAttributes: unknown;
  customFields: Record<string, unknown>;
  archivedAt: string | null;
  version: number;
  stock?: string;
  reserved?: string;
}

interface ArticleDetail extends Omit<ArticleRow, 'stock'> {
  parent: { id: string; number: string; name: string } | null;
  prices: { customerGroupId: string | null; minQuantity: string; priceNet?: string }[];
  setComponents: {
    articleId: string;
    quantity: string;
    article: { number: string; name: string; unit: string } | null;
  }[];
  variants: ArticleRow[];
  supplierArticles: {
    supplierId: string;
    supplierSku: string | null;
    purchasePriceNet?: string;
    deliveryDays: number | null;
    isPreferred: boolean;
    supplier: { number: string; name: string } | null;
  }[];
  stock: { warehouseId: string; locationId: string | null; quantity: string; reserved: string }[];
}

function listUrl(
  p: { q: string; sort: string | null; filters: ListFilter[]; page: number; pageSize: number },
  archived: boolean,
) {
  const s = new URLSearchParams({
    page: String(p.page),
    pageSize: String(p.pageSize),
    archived: String(archived),
  });
  if (p.q) s.set('q', p.q);
  if (p.sort) s.set('sort', p.sort);
  if (p.filters.length) s.set('filters', JSON.stringify(p.filters));
  return `/articles?${s}`;
}

export function ArticlesPage() {
  const can = useCan();
  const s = useSession();
  const qc = useQueryClient();
  const md = useMasterData();
  const fields = useCustomFields('article');
  const [archived, setArchived] = useState(false);
  const [open, setOpen] = useState<string | 'new' | null>(() =>
    new URLSearchParams(window.location.search).get('id'),
  );
  const manage = can('articles.manage') && s.account?.accessMode === 'full';
  const prices = can('articles.prices');
  const cats = useMemo(() => categoryPaths(md.data?.categories ?? []), [md.data?.categories]);

  const columns = useMemo<Column<ArticleRow>[]>(
    () => [
      {
        id: 'number',
        header: 'Art.-Nr.',
        kind: 'string',
        sortable: true,
        width: 130,
        value: (r) => r.number,
      },
      {
        id: 'name',
        header: 'Bezeichnung',
        kind: 'string',
        sortable: true,
        width: 280,
        value: (r) => r.name,
        cell: (r) => (
          <div className="truncate">
            <p className="truncate font-medium">{r.name}</p>
            {r.kind !== 'standard' && <Badge>{ARTICLE_KINDS[r.kind]}</Badge>}
          </div>
        ),
      },
      {
        id: 'gtin',
        header: 'EAN/GTIN',
        kind: 'string',
        sortable: true,
        width: 140,
        value: (r) => r.gtin,
      },
      {
        id: 'categoryId',
        header: 'Kategorie',
        kind: 'enum',
        groupable: true,
        options: [...cats].map(([value, label]) => ({ value, label })),
        value: (r) => r.categoryId,
        text: (r) => (r.categoryId ? (cats.get(r.categoryId) ?? '') : ''),
      },
      {
        id: 'brand',
        header: 'Marke',
        kind: 'string',
        sortable: true,
        groupable: true,
        defaultHidden: true,
        value: (r) => r.brand,
      },
      {
        id: 'salePriceNet',
        header: 'VK netto',
        kind: 'number',
        sortable: true,
        width: 120,
        value: (r) => r.salePriceNet,
        text: (r) => formatMoney(r.salePriceNet),
      },
      ...(prices
        ? [
            {
              id: 'purchasePriceNet',
              header: 'EK netto',
              kind: 'number' as const,
              sortable: true,
              width: 120,
              defaultHidden: true,
              value: (r: ArticleRow) => r.purchasePriceNet,
              text: (r: ArticleRow) => formatMoney(r.purchasePriceNet),
            },
          ]
        : []),
      {
        id: 'stock',
        header: 'Bestand',
        kind: 'number',
        filterable: false,
        width: 110,
        value: (r) => r.stock,
        cell: (r) =>
          r.kind === 'parent' || r.kind === 'set' ? (
            <span className="text-muted">–</span>
          ) : (
            <span
              className={Number(r.stock) < Number(r.minStock) ? 'font-medium text-warning' : ''}
            >
              {formatQty(r.stock)} {r.unit}
            </span>
          ),
      },
      {
        id: 'minStock',
        header: 'Mindestbestand',
        kind: 'number',
        sortable: true,
        defaultHidden: true,
        value: (r) => r.minStock,
        text: (r) => formatQty(r.minStock),
      },
      {
        id: 'kind',
        header: 'Art',
        kind: 'enum',
        groupable: true,
        defaultHidden: true,
        options: Object.entries(ARTICLE_KINDS).map(([value, label]) => ({ value, label })),
        value: (r) => r.kind,
      },
      {
        id: 'active',
        header: 'Aktiv',
        kind: 'boolean',
        sortable: true,
        groupable: true,
        width: 90,
        value: (r) => r.active,
        cell: (r) =>
          r.archivedAt ? (
            <Badge>Archiviert</Badge>
          ) : r.active ? (
            <Badge tone="success">Aktiv</Badge>
          ) : (
            <Badge>Inaktiv</Badge>
          ),
      },
      ...customFieldColumns<ArticleRow>(fields.data ?? []),
    ],
    [cats, fields.data, prices],
  );

  const setArchivedMany = async (rows: ArticleRow[], a: boolean) => {
    for (const r of rows) await http.post(`/articles/${r.id}/${a ? 'archive' : 'restore'}`);
    await qc.invalidateQueries({ queryKey: ['articles'] });
  };

  return (
    <>
      <PageHeader
        title="Artikel"
        description="Ihr Sortiment mit Preisen, Beständen und Bezugsquellen."
        actions={
          manage && (
            <Button onClick={() => setOpen('new')}>
              <Plus /> Artikel anlegen
            </Button>
          )
        }
      />
      <DataTable<ArticleRow>
        key={`${fields.data?.length ?? 0}-${cats.size}`}
        tableKey="articles"
        mode="server"
        queryKey={['articles', archived]}
        fetch={(p) => http.get(listUrl(p, archived))}
        columns={columns}
        rowId={(r) => r.id}
        exportName="artikel"
        onRowClick={(r) => setOpen(r.id)}
        initial={{ sort: 'number:asc' }}
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
                    setArchivedMany(
                      rows.filter((r) => !r.archivedAt),
                      true,
                    ),
                },
                {
                  label: 'Wiederherstellen',
                  icon: <RotateCcw />,
                  run: (rows) =>
                    setArchivedMany(
                      rows.filter((r) => r.archivedAt),
                      false,
                    ),
                },
              ]
            : undefined
        }
      />
      {open && md.data && (
        <ArticleDialog
          id={open === 'new' ? null : open}
          md={md.data}
          onClose={() => setOpen(null)}
          onOpen={setOpen}
        />
      )}
    </>
  );
}

type Tab = 'data' | 'prices' | 'stock' | 'suppliers' | 'structure' | 'history' | 'barcodes';

function ArticleDialog({
  id,
  md,
  onClose,
  onOpen,
}: {
  id: string | null;
  md: MasterData;
  onClose: () => void;
  onOpen: (id: string) => void;
}) {
  const can = useCan();
  const qc = useQueryClient();
  const fields = useCustomFields('article');
  const q = useQuery({
    queryKey: ['article', id],
    queryFn: () => http.get<ArticleDetail>(`/articles/${id}`),
    enabled: !!id,
  });
  if (id && q.isPending)
    return (
      <Dialog open onClose={onClose} title="Artikel">
        <Spinner />
      </Dialog>
    );
  if (id && q.isError)
    return (
      <Dialog open onClose={onClose} title="Artikel">
        <Alert tone="danger">{errorMessage(q.error)}</Alert>
      </Dialog>
    );
  return (
    <ArticleForm
      key={id ?? 'new'}
      a={q.data ?? null}
      md={md}
      defs={fields.data ?? []}
      canManage={can('articles.manage')}
      canPrices={can('articles.prices')}
      canStock={can('inventory.read')}
      onClose={onClose}
      onOpen={onOpen}
      onSaved={() => qc.invalidateQueries({ queryKey: ['articles'] })}
    />
  );
}

function ArticleForm({
  a,
  md,
  defs,
  canManage,
  canPrices,
  canStock,
  onClose,
  onOpen,
  onSaved,
}: {
  a: ArticleDetail | null;
  md: MasterData;
  defs: CustomFieldDef[];
  canManage: boolean;
  canPrices: boolean;
  canStock: boolean;
  onClose: () => void;
  onOpen: (id: string) => void;
  onSaved: () => Promise<unknown>;
}) {
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('data');
  const [v, setV] = useState(() => ({
    number: a?.number ?? '',
    kind: (a?.kind === 'variant' ? 'standard' : (a?.kind ?? 'standard')) as
      'standard' | 'parent' | 'set',
    name: a?.name ?? '',
    shortDescription: a?.shortDescription ?? '',
    description: a?.description ?? '',
    gtin: a?.gtin ?? '',
    brand: a?.brand ?? '',
    manufacturerId: a?.manufacturerId ?? '',
    categoryId: a?.categoryId ?? '',
    unit: a?.unit ?? 'Stück',
    taxRateId: a?.taxRateId ?? md.taxRates.find((t) => t.isDefault)?.id ?? '',
    purchasePriceNet: toInput(a?.purchasePriceNet ?? '0'),
    salePriceNet: toInput(a?.salePriceNet ?? '0'),
    weightKg: toInput(a?.weightKg),
    minStock: toInput(a?.minStock ?? '0'),
    stockTracked: a?.stockTracked ?? true,
    trackBatches: a?.trackBatches ?? false,
    trackSerials: a?.trackSerials ?? false,
    trackBestBefore: a?.trackBestBefore ?? false,
    active: a?.active ?? true,
  }));
  const [custom, setCustom] = useState<Record<string, unknown>>(a?.customFields ?? {});
  const [priceRows, setPriceRows] = useState(() =>
    (a?.prices ?? []).map((p) => ({
      customerGroupId: p.customerGroupId ?? '',
      minQuantity: toInput(p.minQuantity),
      priceNet: toInput(p.priceNet ?? ''),
    })),
  );
  const [components, setComponents] = useState(() =>
    (a?.setComponents ?? []).map((c) => ({
      articleId: c.articleId,
      quantity: toInput(c.quantity),
      label: c.article ? `${c.article.number} · ${c.article.name}` : c.articleId,
    })),
  );
  const [attrs, setAttrs] = useState(() =>
    (
      (a?.kind === 'parent'
        ? (a.variantAttributes as { name: string; values: string[] }[])
        : null) ?? [{ name: 'Größe', values: [] as string[] }]
    ).map((x) => ({ name: x.name, values: x.values.join(', ') })),
  );
  const readOnly = !canManage || !!a?.archivedAt;
  const set = (k: keyof typeof v, val: unknown) => setV({ ...v, [k]: val });
  const tax = md.taxRates.find((t) => t.id === v.taxRateId);

  const f = useSubmit(
    () => {
      const body: Record<string, unknown> = {
        ...v,
        number: v.number || null,
        manufacturerId: v.manufacturerId || null,
        categoryId: v.categoryId || null,
        weightKg: v.weightKg || null,
        customFields: custom,
        setComponents:
          v.kind === 'set'
            ? components.map((c) => ({ articleId: c.articleId, quantity: c.quantity }))
            : [],
        variantAttributes:
          v.kind === 'parent'
            ? attrs
                .filter((x) => x.name.trim())
                .map((x) => ({
                  name: x.name.trim(),
                  values: x.values
                    .split(',')
                    .map((s) => s.trim())
                    .filter(Boolean),
                }))
            : null,
      };
      if (canPrices)
        body.prices = priceRows
          .filter((p) => p.priceNet)
          .map((p) => ({
            customerGroupId: p.customerGroupId || null,
            minQuantity: p.minQuantity || '1',
            priceNet: p.priceNet,
          }));
      else {
        delete body.purchasePriceNet;
        delete body.salePriceNet;
      }
      return a
        ? http.put<ArticleRow>(`/articles/${a.id}`, { ...body, version: a.version })
        : http.post<ArticleRow>('/articles', body);
    },
    async (saved) => {
      await onSaved();
      await qc.invalidateQueries({ queryKey: ['article', saved.id] });
      if (!a) onOpen(saved.id);
      else onClose();
    },
  );
  const generate = useSubmit(
    () => http.post<{ created: number }>(`/articles/${a!.id}/variants/generate`),
    async () => {
      await qc.invalidateQueries({ queryKey: ['article', a!.id] });
      await onSaved();
    },
  );

  const tabs: { id: Tab; label: string; hidden?: boolean }[] = [
    { id: 'data', label: 'Stammdaten' },
    { id: 'prices', label: 'Preise' },
    {
      id: 'structure',
      label: v.kind === 'set' ? 'Set-Bestandteile' : 'Varianten',
      hidden: v.kind === 'standard',
    },
    { id: 'stock', label: 'Bestand', hidden: !a || !canStock || v.kind !== 'standard' },
    { id: 'suppliers', label: 'Bezugsquellen', hidden: !a },
    { id: 'barcodes', label: 'Barcodes', hidden: !a },
    { id: 'history', label: 'Verlauf', hidden: !a },
  ];
  const fieldErr = (k: string) => f.fieldErrors[k];

  return (
    <Dialog
      open
      wide
      onClose={onClose}
      title={a ? `${a.number} · ${a.name}` : 'Artikel anlegen'}
      description={a?.parent ? `Variante von ${a.parent.number} · ${a.parent.name}` : undefined}
      footer={
        !readOnly && ['data', 'prices', 'structure'].includes(tab) ? (
          <>
            <Button variant="secondary" onClick={onClose}>
              Abbrechen
            </Button>
            <Button onClick={() => f.submit(undefined)} loading={f.pending}>
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
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {f.error && (
        <div className="mb-4">
          <Alert tone="danger">{f.error}</Alert>
        </div>
      )}
      <fieldset disabled={readOnly} className="contents">
        {tab === 'data' && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Bezeichnung *" error={fieldErr('name')}>
              {(p) => <Input {...p} value={v.name} onChange={(e) => set('name', e.target.value)} />}
            </Field>
            <Field
              label="Artikelnummer"
              hint={a ? undefined : 'Leer lassen = automatisch vergeben'}
              error={fieldErr('number')}
            >
              {(p) => (
                <Input {...p} value={v.number} onChange={(e) => set('number', e.target.value)} />
              )}
            </Field>
            {!a && (
              <Field label="Artikelart">
                {(p) => (
                  <Select {...p} value={v.kind} onChange={(e) => set('kind', e.target.value)}>
                    <option value="standard">{ARTICLE_KINDS.standard}</option>
                    <option value="parent">{ARTICLE_KINDS.parent}</option>
                    <option value="set">{ARTICLE_KINDS.set}</option>
                  </Select>
                )}
              </Field>
            )}
            <Field label="EAN/GTIN" error={fieldErr('gtin')}>
              {(p) => (
                <Input
                  {...p}
                  inputMode="numeric"
                  value={v.gtin}
                  onChange={(e) => set('gtin', e.target.value)}
                />
              )}
            </Field>
            <Field label="Kategorie" error={fieldErr('categoryId')}>
              {(p) => (
                <Select
                  {...p}
                  value={v.categoryId}
                  onChange={(e) => set('categoryId', e.target.value)}
                >
                  <option value="">– keine –</option>
                  {[...categoryPaths(md.categories)]
                    .filter(([cid]) => !md.categories.find((c) => c.id === cid)?.archivedAt)
                    .sort((x, y) => x[1].localeCompare(y[1]))
                    .map(([cid, label]) => (
                      <option key={cid} value={cid}>
                        {label}
                      </option>
                    ))}
                </Select>
              )}
            </Field>
            <Field label="Hersteller">
              {(p) => (
                <Select
                  {...p}
                  value={v.manufacturerId}
                  onChange={(e) => set('manufacturerId', e.target.value)}
                >
                  <option value="">– keiner –</option>
                  {md.manufacturers.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Marke">
              {(p) => (
                <Input {...p} value={v.brand} onChange={(e) => set('brand', e.target.value)} />
              )}
            </Field>
            <Field label="Einheit">
              {(p) => (
                <Input
                  {...p}
                  list="units"
                  value={v.unit}
                  onChange={(e) => set('unit', e.target.value)}
                />
              )}
            </Field>
            <datalist id="units">
              {['Stück', 'Paar', 'Packung', 'Set', 'kg', 'g', 'm', 'l'].map((u) => (
                <option key={u} value={u} />
              ))}
            </datalist>
            <Field label="Gewicht (kg)" error={fieldErr('weightKg')}>
              {(p) => (
                <Input
                  {...p}
                  inputMode="decimal"
                  value={v.weightKg}
                  onChange={(e) => set('weightKg', e.target.value)}
                />
              )}
            </Field>
            {v.kind === 'standard' && (
              <Field label="Mindestbestand" error={fieldErr('minStock')}>
                {(p) => (
                  <Input
                    {...p}
                    inputMode="decimal"
                    value={v.minStock}
                    onChange={(e) => set('minStock', e.target.value)}
                  />
                )}
              </Field>
            )}
            <div className="sm:col-span-2">
              <Field label="Kurzbeschreibung">
                {(p) => (
                  <Input
                    {...p}
                    value={v.shortDescription}
                    onChange={(e) => set('shortDescription', e.target.value)}
                  />
                )}
              </Field>
            </div>
            <div className="sm:col-span-2">
              <Field label="Beschreibung">
                {(p) => (
                  <textarea
                    {...p}
                    rows={4}
                    className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm"
                    value={v.description}
                    onChange={(e) => set('description', e.target.value)}
                  />
                )}
              </Field>
            </div>
            <div className="flex flex-wrap gap-x-6 gap-y-2 sm:col-span-2">
              <Checkbox
                label="Aktiv"
                checked={v.active}
                onChange={(e) => set('active', e.target.checked)}
              />
              {v.kind === 'standard' && (
                <Checkbox
                  label="Bestand führen"
                  checked={v.stockTracked}
                  onChange={(e) => set('stockTracked', e.target.checked)}
                />
              )}
              <Checkbox
                label="Chargen"
                checked={v.trackBatches}
                onChange={(e) => set('trackBatches', e.target.checked)}
              />
              <Checkbox
                label="Seriennummern"
                checked={v.trackSerials}
                onChange={(e) => set('trackSerials', e.target.checked)}
              />
              <Checkbox
                label="Mindesthaltbarkeit (MHD)"
                checked={v.trackBestBefore}
                onChange={(e) => set('trackBestBefore', e.target.checked)}
              />
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

        {tab === 'prices' && (
          <div className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Steuersatz" error={fieldErr('taxRateId')}>
                {(p) => (
                  <Select
                    {...p}
                    value={v.taxRateId}
                    onChange={(e) => set('taxRateId', e.target.value)}
                  >
                    {md.taxRates
                      .filter((t) => !t.archivedAt || t.id === v.taxRateId)
                      .map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name} ({toInput(t.rate)} %)
                        </option>
                      ))}
                  </Select>
                )}
              </Field>
              {canPrices ? (
                <>
                  <Field label="Einkaufspreis netto (€)" error={fieldErr('purchasePriceNet')}>
                    {(p) => (
                      <Input
                        {...p}
                        inputMode="decimal"
                        value={v.purchasePriceNet}
                        onChange={(e) => set('purchasePriceNet', e.target.value)}
                      />
                    )}
                  </Field>
                  <Field
                    label="Verkaufspreis netto (€)"
                    hint={
                      tax
                        ? `brutto ${formatMoney(gross(v.salePriceNet.replace(',', '.') || '0', tax.rate))}`
                        : undefined
                    }
                    error={fieldErr('salePriceNet')}
                  >
                    {(p) => (
                      <Input
                        {...p}
                        inputMode="decimal"
                        value={v.salePriceNet}
                        onChange={(e) => set('salePriceNet', e.target.value)}
                      />
                    )}
                  </Field>
                </>
              ) : (
                <p className="self-end text-sm text-muted sm:col-span-2">
                  Verkaufspreis netto: <strong>{formatMoney(a?.salePriceNet ?? '0')}</strong>.
                  Preise ändern dürfen nur Personen mit dem Recht „Preise“.
                </p>
              )}
            </div>
            {canPrices && (
              <div>
                <p className="mb-2 text-sm font-semibold">
                  Staffel- und Kundengruppenpreise (netto)
                </p>
                <Table>
                  <THead>
                    <tr>
                      <TH>Kundengruppe</TH>
                      <TH>ab Menge</TH>
                      <TH>Preis netto (€)</TH>
                      <TH />
                    </tr>
                  </THead>
                  <TBody>
                    {priceRows.map((p, i) => (
                      <TR key={i}>
                        <TD>
                          <Select
                            aria-label="Kundengruppe"
                            value={p.customerGroupId}
                            onChange={(e) =>
                              setPriceRows(
                                priceRows.map((x, j) =>
                                  j === i ? { ...x, customerGroupId: e.target.value } : x,
                                ),
                              )
                            }
                          >
                            <option value="">Alle Kunden</option>
                            {md.customerGroups.map((g) => (
                              <option key={g.id} value={g.id}>
                                {g.name}
                              </option>
                            ))}
                          </Select>
                        </TD>
                        <TD>
                          <Input
                            aria-label="ab Menge"
                            inputMode="decimal"
                            value={p.minQuantity}
                            onChange={(e) =>
                              setPriceRows(
                                priceRows.map((x, j) =>
                                  j === i ? { ...x, minQuantity: e.target.value } : x,
                                ),
                              )
                            }
                          />
                        </TD>
                        <TD>
                          <Input
                            aria-label="Preis netto"
                            inputMode="decimal"
                            value={p.priceNet}
                            onChange={(e) =>
                              setPriceRows(
                                priceRows.map((x, j) =>
                                  j === i ? { ...x, priceNet: e.target.value } : x,
                                ),
                              )
                            }
                          />
                        </TD>
                        <TD>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label="Preis entfernen"
                            onClick={() => setPriceRows(priceRows.filter((_, j) => j !== i))}
                          >
                            <Trash2 />
                          </Button>
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
                <Button
                  variant="secondary"
                  size="sm"
                  className="mt-2"
                  onClick={() =>
                    setPriceRows([
                      ...priceRows,
                      { customerGroupId: '', minQuantity: '1', priceNet: '' },
                    ])
                  }
                >
                  <Plus /> Preis hinzufügen
                </Button>
                {fieldErr('prices') && (
                  <p className="mt-2 text-sm text-danger">{fieldErr('prices')}</p>
                )}
              </div>
            )}
          </div>
        )}

        {tab === 'structure' && v.kind === 'set' && (
          <SetEditor
            components={components}
            onChange={setComponents}
            error={fieldErr('setComponents')}
            selfId={a?.id}
          />
        )}
        {tab === 'structure' && v.kind === 'parent' && (
          <div className="space-y-4">
            <p className="text-sm text-muted">
              Legen Sie die Merkmale fest (z. B. Größe: S, M, L). „Varianten erzeugen“ legt für jede
              Kombination einen eigenen Artikel an. Bestehende Varianten bleiben erhalten.
            </p>
            {attrs.map((x, i) => (
              <div key={i} className="grid gap-2 sm:grid-cols-[1fr_2fr_auto]">
                <Input
                  aria-label="Merkmal"
                  placeholder="Merkmal, z. B. Farbe"
                  value={x.name}
                  onChange={(e) =>
                    setAttrs(attrs.map((y, j) => (j === i ? { ...y, name: e.target.value } : y)))
                  }
                />
                <Input
                  aria-label="Ausprägungen"
                  placeholder="Ausprägungen, durch Komma getrennt"
                  value={x.values}
                  onChange={(e) =>
                    setAttrs(attrs.map((y, j) => (j === i ? { ...y, values: e.target.value } : y)))
                  }
                />
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Merkmal entfernen"
                  disabled={attrs.length <= 1}
                  onClick={() => setAttrs(attrs.filter((_, j) => j !== i))}
                >
                  <Trash2 />
                </Button>
              </div>
            ))}
            {attrs.length < 5 && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setAttrs([...attrs, { name: '', values: '' }])}
              >
                <Plus /> Merkmal hinzufügen
              </Button>
            )}
            {fieldErr('variantAttributes') && (
              <p className="text-sm text-danger">{fieldErr('variantAttributes')}</p>
            )}
            {a && (
              <div className="border-t border-border pt-4">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-sm font-semibold">{a.variants.length} Varianten</p>
                  {canManage && (
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={generate.pending}
                      onClick={() => generate.submit(undefined)}
                    >
                      <Wand2 /> Varianten erzeugen
                    </Button>
                  )}
                </div>
                {generate.error && <Alert tone="danger">{generate.error}</Alert>}
                <ul className="divide-y divide-border rounded-lg border border-border">
                  {a.variants.map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        className="flex w-full justify-between px-3 py-2 text-left text-sm hover:bg-surface-2"
                        onClick={() => onOpen(c.id)}
                      >
                        <span>
                          {c.number} · {c.name}
                        </span>
                        <span className="text-muted">{formatMoney(c.salePriceNet)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </fieldset>

      {tab === 'stock' && a && <ArticleStock article={a} md={md} />}
      {tab === 'suppliers' &&
        a &&
        (a.supplierArticles.length ? (
          <Table>
            <THead>
              <tr>
                <TH>Lieferant</TH>
                <TH>Lief.-Art.-Nr.</TH>
                {canPrices && <TH>EK netto</TH>}
                <TH>Lieferzeit</TH>
                <TH />
              </tr>
            </THead>
            <TBody>
              {a.supplierArticles.map((s) => (
                <TR key={s.supplierId}>
                  <TD>{s.supplier ? `${s.supplier.number} · ${s.supplier.name}` : '–'}</TD>
                  <TD>{s.supplierSku ?? '–'}</TD>
                  {canPrices && <TD>{formatMoney(s.purchasePriceNet)}</TD>}
                  <TD>{s.deliveryDays !== null ? `${s.deliveryDays} Tage` : '–'}</TD>
                  <TD>{s.isPreferred && <Badge tone="primary">Bevorzugt</Badge>}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        ) : (
          <p className="text-sm text-muted">
            Noch keine Bezugsquellen. Ordnen Sie den Artikel beim Lieferanten zu.
          </p>
        ))}
      {tab === 'barcodes' && a && (
        <BarcodesTab articleId={a.id} gtin={a.gtin} canManage={canManage && !a.archivedAt} />
      )}
      {tab === 'history' && a && <ActivityList entityType="article" entityId={a.id} />}
    </Dialog>
  );
}

function SetEditor({
  components,
  onChange,
  error,
  selfId,
}: {
  components: { articleId: string; quantity: string; label: string }[];
  onChange: (c: { articleId: string; quantity: string; label: string }[]) => void;
  error?: string;
  selfId?: string;
}) {
  const [q, setQ] = useState('');
  const search = useQuery({
    queryKey: ['article-pick', q],
    queryFn: () =>
      http.get<{ items: ArticleRow[] }>(
        `/articles?pageSize=10&q=${encodeURIComponent(q)}&filters=${encodeURIComponent(JSON.stringify([{ field: 'kind', op: 'eq', value: 'standard' }]))}`,
      ),
    enabled: q.length >= 2,
  });
  return (
    <div className="space-y-4">
      <ul className="divide-y divide-border rounded-lg border border-border">
        {components.map((c, i) => (
          <li key={c.articleId} className="flex items-center gap-3 px-3 py-2">
            <span className="flex-1 text-sm">{c.label}</span>
            <Input
              aria-label="Menge"
              className="w-24"
              inputMode="decimal"
              value={c.quantity}
              onChange={(e) =>
                onChange(
                  components.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)),
                )
              }
            />
            <Button
              variant="ghost"
              size="icon"
              aria-label="Bestandteil entfernen"
              onClick={() => onChange(components.filter((_, j) => j !== i))}
            >
              <Trash2 />
            </Button>
          </li>
        ))}
        {!components.length && (
          <li className="px-3 py-4 text-sm text-muted">Noch keine Bestandteile.</li>
        )}
      </ul>
      <Field label="Bestandteil hinzufügen" hint="Artikelnummer oder Bezeichnung eingeben">
        {(p) => <Input {...p} value={q} onChange={(e) => setQ(e.target.value)} />}
      </Field>
      <ul className="space-y-1">
        {search.data?.items
          .filter((x) => x.id !== selfId && !components.some((c) => c.articleId === x.id))
          .map((x) => (
            <li key={x.id}>
              <button
                type="button"
                className="w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-surface-2"
                onClick={() => {
                  onChange([
                    ...components,
                    { articleId: x.id, quantity: '1', label: `${x.number} · ${x.name}` },
                  ]);
                  setQ('');
                }}
              >
                + {x.number} · {x.name}
              </button>
            </li>
          ))}
      </ul>
      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  );
}

function ArticleStock({ article, md }: { article: ArticleDetail; md: MasterData }) {
  const wh = (id: string) => md.warehouses.find((w) => w.id === id);
  const loc = (id: string | null) => (id ? md.locations.find((l) => l.id === id)?.code : null);
  const total = article.stock.reduce((s, l) => s + Number(l.quantity), 0);
  return (
    <div className="space-y-4">
      <p className="text-sm">
        Gesamtbestand:{' '}
        <strong>
          {formatQty(String(total))} {article.unit}
        </strong>
        {Number(article.minStock) > 0 && (
          <span className="text-muted"> · Mindestbestand {formatQty(article.minStock)}</span>
        )}
      </p>
      {article.stock.length ? (
        <Table>
          <THead>
            <tr>
              <TH>Lager</TH>
              <TH>Lagerplatz</TH>
              <TH>Bestand</TH>
              <TH>Reserviert</TH>
            </tr>
          </THead>
          <TBody>
            {article.stock.map((l, i) => (
              <TR key={i}>
                <TD>{wh(l.warehouseId)?.name ?? '–'}</TD>
                <TD>{loc(l.locationId) ?? '–'}</TD>
                <TD>{formatQty(l.quantity)}</TD>
                <TD>{formatQty(l.reserved)}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      ) : (
        <p className="text-sm text-muted">Noch kein Bestand gebucht.</p>
      )}
      <p className="text-xs text-muted">
        Buchungen (Zugang, Abgang, Umlagerung, Inventur) unter „Lager &amp; Bestand“.
      </p>
    </div>
  );
}

/** Zusätzliche Barcodes (z. B. Lieferanten-EAN), die beim Scannen zu diesem Artikel führen. */
function BarcodesTab({
  articleId,
  gtin,
  canManage,
}: {
  articleId: string;
  gtin: string | null;
  canManage: boolean;
}) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['barcodes', articleId],
    queryFn: () => http.get<{ id: string; code: string }[]>(`/articles/${articleId}/barcodes`),
  });
  const [code, setCode] = useState('');
  const add = useSubmit(
    () => http.post(`/articles/${articleId}/barcodes`, { code }),
    async () => {
      setCode('');
      await qc.invalidateQueries({ queryKey: ['barcodes', articleId] });
    },
  );
  const remove = async (id: string) => {
    await http.del(`/articles/${articleId}/barcodes/${id}`);
    await qc.invalidateQueries({ queryKey: ['barcodes', articleId] });
  };
  return (
    <div className="space-y-3 text-sm">
      <p className="text-muted">
        Beim Scannen werden GTIN/EAN{gtin ? ` (${gtin})` : ''}, Artikelnummer und diese zusätzlichen
        Codes erkannt.
      </p>
      {add.error && <Alert tone="danger">{add.error}</Alert>}
      <ul className="space-y-1">
        {q.data?.map((b) => (
          <li
            key={b.id}
            className="flex items-center justify-between rounded-md border border-border px-3 py-1.5"
          >
            <span className="font-mono">{b.code}</span>
            {canManage && (
              <Button size="sm" variant="ghost" onClick={() => remove(b.id)}>
                Entfernen
              </Button>
            )}
          </li>
        ))}
        {q.data?.length === 0 && <li className="text-muted">Keine zusätzlichen Barcodes</li>}
      </ul>
      {canManage && (
        <div className="flex items-end gap-2">
          <Field label="Neuer Barcode" error={add.fieldErrors.code}>
            {(p) => (
              <Input
                {...p}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && code && add.submit(undefined)}
              />
            )}
          </Field>
          <Button loading={add.pending} disabled={!code} onClick={() => add.submit(undefined)}>
            Hinzufügen
          </Button>
        </div>
      )}
    </div>
  );
}
