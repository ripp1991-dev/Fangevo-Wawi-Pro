import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, FileText, Minus, PackageCheck, Plus, ScanLine, Trash2 } from 'lucide-react';
import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  CARRIERS,
  NO_CHANNEL,
  PACKING_MISMATCH,
  type Carrier,
  type ListFilter,
  type PackingMismatch,
} from '@fangevo/shared';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  Checkbox,
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
import { DataTable } from '../../components/table/data-table';
import { type Column } from '../../components/table/types';
import { Tabs } from '../../components/tabs';
import { ApiError, errorMessage, http } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import { categoryPaths, formatQty, useMasterData } from '../../lib/master-data';
import {
  documentTypeLabel,
  openPdf,
  orderStatusLabel,
  type AddressSnapshot,
} from '../../lib/sales';
import { useCan, useSession } from '../../lib/session';

interface Rules {
  channelIds: string[];
  categoryIds: string[];
  excludeCategoryIds: string[];
  mismatch: PackingMismatch;
  locked: boolean;
}

const EMPTY_RULES: Rules = {
  channelIds: [],
  categoryIds: [],
  excludeCategoryIds: [],
  mismatch: 'warn',
  locked: false,
};

interface Station {
  id: string;
  name: string;
  defaultCarrier: Carrier;
  settings: { autoInvoice?: boolean; autoDeliveryNote?: boolean; rules?: Partial<Rules> };
  archivedAt: string | null;
}

const rulesOf = (s: Station | null): Rules => ({ ...EMPTY_RULES, ...(s?.settings.rules ?? {}) });

interface QueueItem {
  id: string;
  number: string;
  status: string;
  orderDate: string;
  externalNumber: string | null;
  shippingMethod: string | null;
  customerName: string;
  channelId: string | null;
  channelName: string | null;
  positions: number;
}

interface QueueData {
  rules: Rules;
  channels: { id: string; name: string; count: number }[];
  total: number;
  truncated: boolean;
  items: QueueItem[];
}

interface ChannelOption {
  id: string;
  name: string;
}

/** Verkaufskanäle für Auswahllisten (ohne Modul „Multichannel“ nur „Ohne Kanal“). */
function useChannelOptions() {
  const can = useCan();
  return useQuery({
    queryKey: ['channels', 'options'],
    enabled: can('channels.read'),
    retry: false,
    queryFn: async () =>
      (await http.get<{ items: ChannelOption[] }>('/channels?pageSize=100')).items,
  });
}

interface PackItem {
  orderLineId: string;
  articleId: string;
  articleNumber: string;
  name: string;
  unit: string;
  setName: string | null;
  quantity: string;
  trackBatches: boolean;
  trackSerials: boolean;
  barcodes: string[];
  suggestedBatch: string | null;
  suggestedLocationId: string | null;
}

interface Prepared {
  order: {
    id: string;
    number: string;
    status: string;
    shippable: boolean;
    customerName: string;
    shippingAddress: AddressSnapshot | null;
    shippingMethod: string | null;
    notes: string | null;
    channelId: string | null;
    channelName: string | null;
  };
  rule: { ok: boolean; message: string | null; mismatch: PackingMismatch };
  items: PackItem[];
}

interface Packed {
  key: string;
  orderLineId: string;
  articleId: string;
  quantity: number;
  batch: string;
  serialNumber: string | null;
  locationId: string | null;
}

const STATION_KEY = 'fe-packing-station';

export function PackingPage() {
  const can = useCan();
  const [tab, setTab] = useState<'pack' | 'shipments' | 'stations'>('pack');
  return (
    <>
      <PageHeader
        title="Packtisch"
        description="Auftrag scannen, Artikel scannen, Pakete wiegen, abschließen. FangEvo prüft dabei Artikel, Varianten, Mengen und Seriennummern."
      />
      <Tabs
        tabs={[
          { id: 'pack', label: 'Packen' },
          { id: 'shipments', label: 'Sendungen' },
          { id: 'stations', label: 'Packplätze', hidden: !can('shipping.manage') },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'pack' && <PackStation />}
      {tab === 'shipments' && <Shipments />}
      {tab === 'stations' && <Stations />}
    </>
  );
}

function readStation(): string {
  try {
    return localStorage.getItem(STATION_KEY) ?? '';
  } catch {
    return '';
  }
}

function PackStation() {
  const qc = useQueryClient();
  const s = useSession();
  const stations = useQuery({
    queryKey: ['packing-stations'],
    queryFn: () => http.get<Station[]>('/packing/stations'),
  });
  const [stationId, setStationId] = useState(readStation);
  const station = stations.data?.find((x) => x.id === stationId) ?? null;
  const [prep, setPrep] = useState<Prepared | null>(null);
  const [packed, setPacked] = useState<Packed[]>([]);
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState<{
    tone: 'danger' | 'success' | 'info' | 'warning';
    text: string;
  } | null>(null);
  const [serialFor, setSerialFor] = useState<PackItem | null>(null);
  const [carrier, setCarrier] = useState<Carrier>('manual');
  const [tracking, setTracking] = useState('');
  const [parcels, setParcels] = useState<string[]>(['']);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{
    shipment: { id: string; number: string; hasLabel: boolean };
    documents: { type: string; id: string; number: string | null }[];
    warnings: string[];
  } | null>(null);
  const scanRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (station) setCarrier(station.defaultCarrier);
  }, [station]);
  useEffect(() => {
    scanRef.current?.focus();
  }, [prep, serialFor]);

  const count = (it: PackItem) =>
    packed
      .filter((p) => p.orderLineId === it.orderLineId && p.articleId === it.articleId)
      .reduce((a, p) => a + p.quantity, 0);
  const complete = !!prep && prep.items.every((it) => count(it) === Number(it.quantity));

  const add = (it: PackItem, serial: string | null = null) => {
    if (count(it) >= Number(it.quantity)) {
      setMsg({
        tone: 'danger',
        text: `${it.articleNumber} ist bereits vollständig gepackt (doppelt gescannt?)`,
      });
      return;
    }
    setPacked((ps) => [
      ...ps,
      {
        key: crypto.randomUUID(),
        orderLineId: it.orderLineId,
        articleId: it.articleId,
        quantity: 1,
        batch: it.suggestedBatch ?? '',
        serialNumber: serial,
        locationId: it.suggestedLocationId,
      },
    ]);
    setMsg({ tone: 'success', text: `${it.articleNumber} · ${it.name} gepackt` });
  };

  /** Auftrag laden (gescannte Nummer oder Klick in der Warteschlange) und gegen die Packregeln prüfen. */
  const loadOrder = async (ref: string) => {
    try {
      const q = new URLSearchParams({ code: ref });
      if (station) q.set('stationId', station.id);
      const p = await http.get<Prepared>(`/packing/orders?${q}`);
      if (!p.order.shippable) {
        setMsg({
          tone: 'danger',
          text: `Auftrag ${p.order.number} ist „${orderStatusLabel(p.order.status)}“ und kann nicht gepackt werden`,
        });
        return;
      }
      if (!p.rule.ok && p.rule.mismatch === 'block') {
        setMsg({ tone: 'danger', text: `Auftrag ${p.order.number}: ${p.rule.message}` });
        return;
      }
      setPrep(p);
      setPacked([]);
      setDone(null);
      setMsg(
        p.rule.ok
          ? { tone: 'info', text: `Auftrag ${p.order.number} geladen – jetzt Artikel scannen` }
          : { tone: 'warning', text: `Achtung: ${p.rule.message}` },
      );
    } catch (err) {
      setMsg({ tone: 'danger', text: errorMessage(err) });
    }
  };

  const onScan = async (e: FormEvent) => {
    e.preventDefault();
    const c = code.trim();
    setCode('');
    if (!c) return;
    if (serialFor) {
      if (packed.some((p) => p.articleId === serialFor.articleId && p.serialNumber === c)) {
        setMsg({ tone: 'danger', text: `Seriennummer ${c} wurde bereits gescannt` });
        return;
      }
      add(serialFor, c);
      setSerialFor(null);
      return;
    }
    if (!prep) {
      await loadOrder(c);
      return;
    }
    const matches = prep.items.filter((it) =>
      it.barcodes.some((b) => b.toLowerCase() === c.toLowerCase()),
    );
    if (!matches.length) {
      setMsg({
        tone: 'danger',
        text: `„${c}“ gehört nicht zu diesem Auftrag (falscher Artikel oder falsche Variante)`,
      });
      return;
    }
    const it = matches.find((m) => count(m) < Number(m.quantity)) ?? matches[0]!;
    if (it.trackSerials && count(it) < Number(it.quantity)) {
      setSerialFor(it);
      setMsg({ tone: 'info', text: `Seriennummer für ${it.articleNumber} scannen` });
      return;
    }
    add(it);
  };

  const finish = async () => {
    if (!prep) return;
    setBusy(true);
    setMsg(null);
    try {
      // Gleiche Zeilen zusammenfassen (Seriennummern bleiben einzeln)
      const items = new Map<
        string,
        {
          orderLineId: string;
          articleId: string;
          quantity: number;
          batch: string | null;
          serialNumber: string | null;
          locationId: string | null;
        }
      >();
      for (const p of packed) {
        const key = p.serialNumber
          ? p.key
          : `${p.orderLineId}|${p.articleId}|${p.batch}|${p.locationId ?? ''}`;
        const prev = items.get(key);
        if (prev) prev.quantity += p.quantity;
        else
          items.set(key, {
            orderLineId: p.orderLineId,
            articleId: p.articleId,
            quantity: p.quantity,
            batch: p.batch || null,
            serialNumber: p.serialNumber,
            locationId: p.locationId,
          });
      }
      const r = await http.post<NonNullable<typeof done>>(
        `/packing/orders/${prep.order.id}/complete`,
        {
          stationId: station?.id ?? null,
          carrier,
          trackingNumber: tracking || null,
          parcels: parcels.map((w) => ({ weightKg: w || '0' })),
          items: [...items.values()].map((i) => ({ ...i, quantity: String(i.quantity) })),
        },
      );
      setDone(r);
      setPrep(null);
      setPacked([]);
      setTracking('');
      setParcels(['']);
      await qc.invalidateQueries({ queryKey: ['orders'] });
      await qc.invalidateQueries({ queryKey: ['shipments'] });
      await qc.invalidateQueries({ queryKey: ['packing-queue'] });
    } catch (err) {
      const detail =
        err instanceof ApiError && Object.keys(err.fieldErrors).length
          ? ` – ${Object.values(err.fieldErrors).join('; ')}`
          : '';
      setMsg({ tone: 'danger', text: errorMessage(err) + detail });
    } finally {
      setBusy(false);
    }
  };

  const toneClass = useMemo(
    () => ({ danger: 'danger', success: 'success', info: 'info', warning: 'warning' }) as const,
    [],
  );

  if (stations.isPending) return <Spinner />;
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <div className="space-y-4">
        <Card>
          <CardBody>
            <form onSubmit={onScan} className="flex items-end gap-2">
              <div className="flex-1">
                <Field
                  label={
                    serialFor
                      ? `Seriennummer für ${serialFor.articleNumber}`
                      : prep
                        ? 'Artikel scannen'
                        : 'Auftrag scannen (Auftragsnummer)'
                  }
                >
                  {(p) => (
                    <Input
                      {...p}
                      ref={scanRef}
                      autoComplete="off"
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                      placeholder={prep ? 'EAN, Artikelnummer …' : 'z. B. AU-000123'}
                    />
                  )}
                </Field>
              </div>
              <Button type="submit">
                <ScanLine /> OK
              </Button>
            </form>
            {msg && (
              <div className="mt-3" role="status">
                <Alert tone={toneClass[msg.tone]}>{msg.text}</Alert>
              </div>
            )}
          </CardBody>
        </Card>
        {done && (
          <Alert tone="success" title={`Versendet – Sendung ${done.shipment.number}`}>
            <div className="mt-2 flex flex-wrap gap-2">
              {done.shipment.hasLabel && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    openPdf(`/packing/shipments/${done.shipment.id}/label`).catch((e) =>
                      setMsg({ tone: 'danger', text: errorMessage(e) }),
                    )
                  }
                >
                  <FileText /> Etikett drucken
                </Button>
              )}
              {done.documents.map((d) => (
                <Button
                  key={d.id}
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    openPdf(`/documents/${d.id}/pdf`).catch((e) =>
                      setMsg({ tone: 'danger', text: errorMessage(e) }),
                    )
                  }
                >
                  <FileText /> {documentTypeLabel(d.type)} {d.number ?? '(Entwurf)'}
                </Button>
              ))}
            </div>
            {done.warnings.map((w) => (
              <p key={w} className="mt-2 text-sm">
                Hinweis: {w}
              </p>
            ))}
          </Alert>
        )}
        {!prep && (
          <PackQueue
            key={station?.id ?? ''}
            stationId={station?.id ?? null}
            onPick={(id) => void loadOrder(id)}
          />
        )}
        {prep && (
          <Card>
            <CardBody>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-semibold">
                    Auftrag {prep.order.number} · {prep.order.customerName}{' '}
                    <Badge tone={prep.rule.ok ? 'neutral' : 'warning'}>
                      {prep.order.channelName ?? 'Ohne Kanal'}
                    </Badge>
                  </p>
                  <p className="text-sm text-muted">
                    {[
                      prep.order.shippingAddress?.street,
                      [prep.order.shippingAddress?.postalCode, prep.order.shippingAddress?.city]
                        .filter(Boolean)
                        .join(' '),
                    ]
                      .filter(Boolean)
                      .join(', ')}
                    {prep.order.shippingMethod && ` · ${prep.order.shippingMethod}`}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setPrep(null);
                    setPacked([]);
                    setSerialFor(null);
                    setMsg(null);
                  }}
                >
                  Abbrechen
                </Button>
              </div>
              {prep.order.notes && <Alert tone="warning">{prep.order.notes}</Alert>}
              <Table>
                <THead>
                  <TR>
                    <TH>Artikel</TH>
                    <TH className="text-right">Soll</TH>
                    <TH className="text-right">Gepackt</TH>
                    <TH>Charge / SN</TH>
                    <TH />
                  </TR>
                </THead>
                <TBody>
                  {prep.items.map((it) => {
                    const n = count(it);
                    const ok = n === Number(it.quantity);
                    const mine = packed.filter(
                      (p) => p.orderLineId === it.orderLineId && p.articleId === it.articleId,
                    );
                    return (
                      <TR
                        key={`${it.orderLineId}${it.articleId}`}
                        className={ok ? 'bg-success/5' : ''}
                      >
                        <TD>
                          {ok && <CheckCircle2 className="mr-1 inline size-4 text-success" />}
                          {it.articleNumber} · {it.name}
                          {it.setName && (
                            <span className="block text-xs text-muted">aus Set „{it.setName}“</span>
                          )}
                        </TD>
                        <TD className="text-right tabular-nums">
                          {formatQty(it.quantity)} {it.unit}
                        </TD>
                        <TD className="text-right tabular-nums">{n}</TD>
                        <TD>
                          {it.trackSerials &&
                            mine.map((p) => (
                              <Badge key={p.key} className="mr-1">
                                {p.serialNumber}
                              </Badge>
                            ))}
                          {it.trackBatches && (
                            <Input
                              aria-label={`Charge ${it.articleNumber}`}
                              className="w-28"
                              value={mine[0]?.batch ?? it.suggestedBatch ?? ''}
                              placeholder="automatisch"
                              onChange={(e) => {
                                const b = e.target.value;
                                setPacked((ps) =>
                                  ps.map((p) =>
                                    p.orderLineId === it.orderLineId && p.articleId === it.articleId
                                      ? { ...p, batch: b }
                                      : p,
                                  ),
                                );
                              }}
                            />
                          )}
                        </TD>
                        <TD>
                          <div className="flex justify-end gap-1">
                            {!it.trackSerials && (
                              <Button
                                size="icon"
                                variant="ghost"
                                aria-label={`${it.articleNumber} ohne Scan hinzufügen`}
                                disabled={ok}
                                onClick={() => add(it)}
                              >
                                <Plus />
                              </Button>
                            )}
                            <Button
                              size="icon"
                              variant="ghost"
                              aria-label={`${it.articleNumber} eins zurück`}
                              disabled={!n}
                              onClick={() =>
                                setPacked((ps) => ps.filter((p) => p.key !== mine.at(-1)?.key))
                              }
                            >
                              <Minus />
                            </Button>
                          </div>
                        </TD>
                      </TR>
                    );
                  })}
                </TBody>
              </Table>
            </CardBody>
          </Card>
        )}
      </div>
      <Card>
        <CardBody>
          <div className="space-y-3">
            <Field label="Packplatz">
              {(p) => (
                <Select
                  {...p}
                  value={stationId}
                  onChange={(e) => {
                    setStationId(e.target.value);
                    try {
                      localStorage.setItem(STATION_KEY, e.target.value);
                    } catch {
                      /* ohne Speicher weiter */
                    }
                  }}
                >
                  <option value="">– ohne Packplatz –</option>
                  {stations.data
                    ?.filter((x) => !x.archivedAt)
                    .map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name}
                      </option>
                    ))}
                </Select>
              )}
            </Field>
            {station && (
              <p className="text-xs text-muted">
                Automatisch:{' '}
                {[
                  station.settings.autoDeliveryNote && 'Lieferschein',
                  station.settings.autoInvoice && 'Rechnung',
                ]
                  .filter(Boolean)
                  .join(', ') || 'keine Belege'}
              </p>
            )}
            <Field label="Versandart">
              {(p) => (
                <Select
                  {...p}
                  value={carrier}
                  onChange={(e) => setCarrier(e.target.value as Carrier)}
                >
                  {Object.entries(CARRIERS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <p className="text-xs text-muted">
              Etiketten von DHL, DPD, GLS usw. folgen, sobald Zugangsdaten vorliegen und die
              Anbindung im Testsystem geprüft ist.
            </p>
            {carrier === 'manual' && (
              <Field label="Trackingnummer (optional)">
                {(p) => (
                  <Input {...p} value={tracking} onChange={(e) => setTracking(e.target.value)} />
                )}
              </Field>
            )}
            <div className="space-y-2">
              <p className="text-sm font-medium">Pakete</p>
              {parcels.map((w, i) => (
                <div key={i} className="flex items-end gap-2">
                  <Field label={`Paket ${i + 1}: Gewicht (kg)`}>
                    {(p) => (
                      <Input
                        {...p}
                        value={w}
                        onChange={(e) =>
                          setParcels(parcels.map((x, j) => (j === i ? e.target.value : x)))
                        }
                      />
                    )}
                  </Field>
                  {parcels.length > 1 && (
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={`Paket ${i + 1} entfernen`}
                      onClick={() => setParcels(parcels.filter((_, j) => j !== i))}
                    >
                      <Trash2 />
                    </Button>
                  )}
                </div>
              ))}
              <Button size="sm" variant="secondary" onClick={() => setParcels([...parcels, ''])}>
                <Plus /> Paket
              </Button>
            </div>
            <Button
              className="w-full"
              size="lg"
              disabled={!complete || s.account?.accessMode !== 'full'}
              loading={busy}
              onClick={finish}
            >
              <PackageCheck /> Packen abschließen
            </Button>
            {prep && !complete && (
              <p className="text-xs text-muted">
                Erst wenn alle Positionen vollständig gepackt sind.
              </p>
            )}
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

/** Warteschlange am Packplatz: packbereite Aufträge nach den Packregeln, mit Kanal-Reitern. */
function PackQueue({
  stationId,
  onPick,
}: {
  stationId: string | null;
  onPick: (id: string) => void;
}) {
  const [channel, setChannel] = useState('');
  const [allChannels, setAllChannels] = useState(false);
  const q = useQuery({
    queryKey: ['packing-queue', stationId, channel, allChannels],
    queryFn: () => {
      const p = new URLSearchParams({ stage: 'packing' });
      if (stationId) p.set('stationId', stationId);
      if (channel) p.set('channelId', channel);
      if (allChannels) p.set('allChannels', 'true');
      return http.get<QueueData>(`/packing/queue?${p}`);
    },
    refetchInterval: 30_000,
  });
  if (q.isPending) return <Spinner />;
  if (q.isError) return <Alert tone="danger">{errorMessage(q.error)}</Alert>;
  const d = q.data;
  const all = d.channels.reduce((a, c) => a + c.count, 0);
  const restricted = d.rules.channelIds.length > 0;
  return (
    <Card>
      <CardBody>
        {restricted && !d.rules.locked && (
          <div className="mb-2">
            <Checkbox
              label="Auch andere Kanäle anzeigen"
              checked={allChannels}
              onChange={(e) => {
                setAllChannels(e.target.checked);
                setChannel('');
              }}
            />
          </div>
        )}
        <div className="mb-3 flex flex-wrap items-center gap-2" role="tablist" aria-label="Kanal">
          <Button
            size="sm"
            role="tab"
            aria-selected={!channel}
            variant={!channel ? 'primary' : 'secondary'}
            onClick={() => setChannel('')}
          >
            Alle ({all})
          </Button>
          {d.channels.map((c) => (
            <Button
              key={c.id}
              size="sm"
              role="tab"
              aria-selected={channel === c.id}
              variant={channel === c.id ? 'primary' : 'secondary'}
              onClick={() => setChannel(c.id)}
            >
              {c.name} ({c.count})
            </Button>
          ))}
        </div>
        {d.truncated && (
          <p className="mb-2 text-xs text-muted">
            Es warten sehr viele Aufträge; angezeigt werden die ältesten.
          </p>
        )}
        {d.items.length ? (
          <Table>
            <THead>
              <TR>
                <TH>Auftrag</TH>
                <TH>Datum</TH>
                <TH>Kanal</TH>
                <TH>Kunde</TH>
                <TH>Versand</TH>
                <TH className="text-right">Pos.</TH>
                <TH />
              </TR>
            </THead>
            <TBody>
              {d.items.map((o) => (
                <TR key={o.id}>
                  <TD>
                    {o.number}
                    {o.externalNumber && (
                      <span className="block text-xs text-muted">{o.externalNumber}</span>
                    )}
                  </TD>
                  <TD>{formatDateTime(o.orderDate)}</TD>
                  <TD>{o.channelName ?? 'Ohne Kanal'}</TD>
                  <TD>{o.customerName}</TD>
                  <TD>{o.shippingMethod ?? '–'}</TD>
                  <TD className="text-right tabular-nums">{o.positions}</TD>
                  <TD>
                    <Button size="sm" variant="secondary" onClick={() => onPick(o.id)}>
                      Packen
                    </Button>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        ) : (
          <p className="py-6 text-center text-sm text-muted">
            Keine Aufträge zum Packen{channel ? ' in diesem Kanal' : ''}.
          </p>
        )}
      </CardBody>
    </Card>
  );
}

interface ShipmentRow {
  id: string;
  number: string;
  orderNumber: string | null;
  customerName: string | null;
  carrier: Carrier;
  trackingNumber: string | null;
  parcels: { weightKg: string }[];
  hasLabel: boolean;
  createdAt: string;
}

function Shipments() {
  const columns = useMemo<Column<ShipmentRow>[]>(
    () => [
      {
        id: 'number',
        header: 'Sendung',
        kind: 'string',
        sortable: true,
        width: 130,
        value: (r) => r.number,
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
        width: 200,
        value: (r) => r.customerName,
      },
      {
        id: 'carrier',
        header: 'Versandart',
        kind: 'enum',
        sortable: true,
        width: 200,
        options: Object.entries(CARRIERS).map(([value, label]) => ({ value, label })),
        value: (r) => r.carrier,
        cell: (r) => CARRIERS[r.carrier],
      },
      {
        id: 'trackingNumber',
        header: 'Tracking',
        kind: 'string',
        sortable: true,
        value: (r) => r.trackingNumber,
      },
      {
        id: 'parcels',
        header: 'Pakete',
        kind: 'number',
        filterable: false,
        width: 90,
        value: (r) => r.parcels.length,
      },
      {
        id: 'createdAt',
        header: 'Datum',
        kind: 'date',
        sortable: true,
        width: 160,
        value: (r) => r.createdAt,
        cell: (r) => formatDateTime(r.createdAt),
      },
      {
        id: 'label',
        header: '',
        kind: 'string',
        filterable: false,
        width: 110,
        value: () => '',
        cell: (r) =>
          r.hasLabel ? (
            <Button
              size="sm"
              variant="link"
              onClick={(e) => {
                e.stopPropagation();
                void openPdf(`/packing/shipments/${r.id}/label`);
              }}
            >
              Etikett
            </Button>
          ) : null,
      },
    ],
    [],
  );
  return (
    <DataTable<ShipmentRow>
      tableKey="shipments"
      mode="server"
      queryKey={['shipments']}
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
        return http.get(`/packing/shipments?${q}`);
      }}
      columns={columns}
      rowId={(r) => r.id}
      exportName="sendungen"
      initial={{ sort: 'createdAt:desc' }}
    />
  );
}

/** Packregeln bearbeiten: Kanäle, Kategorien (nur / ohne), Verhalten bei fremden Aufträgen. */
function RulesEditor({
  title,
  initial,
  channels,
  categories,
  onSave,
  onCancel,
}: {
  title: string;
  initial: Rules;
  channels: ChannelOption[];
  /** Aktive Kategorien als [id, Pfad] */
  categories: [string, string][];
  onSave: (r: Rules) => void | Promise<void>;
  onCancel: () => void;
}) {
  const [r, setR] = useState<Rules>(initial);
  const [busy, setBusy] = useState(false);
  const toggle = (key: 'channelIds' | 'categoryIds' | 'excludeCategoryIds', id: string) =>
    setR((x) => ({
      ...x,
      [key]: x[key].includes(id) ? x[key].filter((y) => y !== id) : [...x[key], id],
    }));
  const cats = [...categories].sort((a, b) => a[1].localeCompare(b[1], 'de'));
  const channelOpts = [...channels, { id: NO_CHANNEL, name: 'Ohne Kanal (manuelle Aufträge)' }];
  return (
    <Card>
      <CardBody>
        <p className="mb-3 font-semibold">{title}</p>
        <div className="grid gap-4 md:grid-cols-3">
          <fieldset className="space-y-2">
            <legend className="mb-1 text-sm font-medium">Kanäle (leer = alle)</legend>
            {channelOpts.map((c) => (
              <Checkbox
                key={c.id}
                label={c.name}
                checked={r.channelIds.includes(c.id)}
                onChange={() => toggle('channelIds', c.id)}
              />
            ))}
          </fieldset>
          <fieldset className="space-y-2">
            <legend className="mb-1 text-sm font-medium">Nur Kategorien</legend>
            <p className="text-xs text-muted">
              Aufträge, deren Artikel alle aus diesen Kategorien stammen (inkl. Unterkategorien).
            </p>
            {cats.map(([id, name]) => (
              <Checkbox
                key={id}
                label={name}
                checked={r.categoryIds.includes(id)}
                disabled={r.excludeCategoryIds.includes(id)}
                onChange={() => toggle('categoryIds', id)}
              />
            ))}
          </fieldset>
          <fieldset className="space-y-2">
            <legend className="mb-1 text-sm font-medium">Ohne Kategorien</legend>
            <p className="text-xs text-muted">
              Blendet Aufträge aus, die nur aus diesen Kategorien bestehen. Gemischte Aufträge
              bleiben hier.
            </p>
            {cats.map(([id, name]) => (
              <Checkbox
                key={id}
                label={name}
                checked={r.excludeCategoryIds.includes(id)}
                disabled={r.categoryIds.includes(id)}
                onChange={() => toggle('excludeCategoryIds', id)}
              />
            ))}
          </fieldset>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Field label="Auftrag passt nicht zum Packplatz">
            {(p) => (
              <Select
                {...p}
                value={r.mismatch}
                onChange={(e) => setR({ ...r, mismatch: e.target.value as PackingMismatch })}
              >
                {Object.entries(PACKING_MISMATCH).map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Checkbox
            label="Kanäle fest einstellen"
            description="Packer können am Platz nicht auf andere Kanäle umschalten."
            checked={r.locked}
            onChange={(e) => setR({ ...r, locked: e.target.checked })}
          />
        </div>
        <div className="mt-4 flex gap-2">
          <Button
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onSave(r);
              } finally {
                setBusy(false);
              }
            }}
          >
            Speichern
          </Button>
          <Button variant="ghost" onClick={onCancel}>
            Abbrechen
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

function Stations() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['packing-stations'],
    queryFn: () => http.get<Station[]>('/packing/stations'),
  });
  const channels = useChannelOptions();
  const md = useMasterData();
  const [v, setV] = useState({
    name: '',
    defaultCarrier: 'manual' as Carrier,
    autoInvoice: false,
    autoDeliveryNote: true,
    rules: EMPTY_RULES,
  });
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const save = async (id: string | null, body: typeof v) => {
    setError(null);
    try {
      await (id ? http.put(`/packing/stations/${id}`, body) : http.post('/packing/stations', body));
      await qc.invalidateQueries({ queryKey: ['packing-stations'] });
      await qc.invalidateQueries({ queryKey: ['packing-queue'] });
      if (!id) setV({ ...v, name: '' });
      return true;
    } catch (e) {
      setError(errorMessage(e));
      return false;
    }
  };
  const channelName = (id: string) =>
    id === NO_CHANNEL ? 'Ohne Kanal' : (channels.data?.find((c) => c.id === id)?.name ?? '?');
  const paths = categoryPaths(md.data?.categories ?? []);
  const summary = (r: Rules) =>
    [
      r.channelIds.length ? r.channelIds.map(channelName).join(', ') : 'alle Kanäle',
      r.categoryIds.length && `nur ${r.categoryIds.map((c) => paths.get(c) ?? '?').join(', ')}`,
      r.excludeCategoryIds.length &&
        `ohne ${r.excludeCategoryIds.map((c) => paths.get(c) ?? '?').join(', ')}`,
      r.mismatch === 'block' && 'gesperrt',
      r.locked && 'fest',
    ]
      .filter(Boolean)
      .join(' · ');
  if (!q.data) return <Spinner />;
  return (
    <div className="max-w-3xl space-y-4">
      {error && <Alert tone="danger">{error}</Alert>}
      <Table>
        <THead>
          <TR>
            <TH>Packplatz</TH>
            <TH>Versandart</TH>
            <TH>Lieferschein</TH>
            <TH>Rechnung</TH>
            <TH>Packregeln</TH>
          </TR>
        </THead>
        <TBody>
          {q.data
            .filter((s) => !s.archivedAt)
            .map((s) => {
              const body = {
                name: s.name,
                defaultCarrier: s.defaultCarrier,
                autoInvoice: !!s.settings.autoInvoice,
                autoDeliveryNote: !!s.settings.autoDeliveryNote,
                rules: rulesOf(s),
              };
              return (
                <TR key={s.id}>
                  <TD>{s.name}</TD>
                  <TD>{CARRIERS[s.defaultCarrier]}</TD>
                  <TD>
                    <Checkbox
                      label={<span className="sr-only">Lieferschein automatisch</span>}
                      checked={body.autoDeliveryNote}
                      onChange={(e) => save(s.id, { ...body, autoDeliveryNote: e.target.checked })}
                    />
                  </TD>
                  <TD>
                    <Checkbox
                      label={<span className="sr-only">Rechnung automatisch</span>}
                      checked={body.autoInvoice}
                      onChange={(e) => save(s.id, { ...body, autoInvoice: e.target.checked })}
                    />
                  </TD>
                  <TD>
                    <span className="text-sm">{summary(body.rules)}</span>{' '}
                    <Button size="sm" variant="link" onClick={() => setEditing(s.id)}>
                      Bearbeiten
                    </Button>
                  </TD>
                </TR>
              );
            })}
        </TBody>
      </Table>
      {editing &&
        (() => {
          const s = q.data.find((x) => x.id === editing);
          if (!s) return null;
          return (
            <RulesEditor
              key={s.id}
              title={`Packregeln für „${s.name}“`}
              initial={rulesOf(s)}
              channels={channels.data ?? []}
              categories={(md.data?.categories ?? [])
                .filter((c) => !c.archivedAt)
                .map((c): [string, string] => [c.id, paths.get(c.id) ?? c.name])}
              onCancel={() => setEditing(null)}
              onSave={async (rules) => {
                const ok = await save(s.id, {
                  name: s.name,
                  defaultCarrier: s.defaultCarrier,
                  autoInvoice: !!s.settings.autoInvoice,
                  autoDeliveryNote: !!s.settings.autoDeliveryNote,
                  rules,
                });
                if (ok) setEditing(null);
              }}
            />
          );
        })()}
      <Card>
        <CardBody>
          <p className="mb-3 font-semibold">Neuer Packplatz</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name">
              {(p) => (
                <Input
                  {...p}
                  value={v.name}
                  onChange={(e) => setV({ ...v, name: e.target.value })}
                />
              )}
            </Field>
            <Field label="Standard-Versandart">
              {(p) => (
                <Select
                  {...p}
                  value={v.defaultCarrier}
                  onChange={(e) => setV({ ...v, defaultCarrier: e.target.value as Carrier })}
                >
                  {Object.entries(CARRIERS).map(([k, l]) => (
                    <option key={k} value={k}>
                      {l}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Checkbox
              label="Lieferschein beim Abschluss erstellen"
              checked={v.autoDeliveryNote}
              onChange={(e) => setV({ ...v, autoDeliveryNote: e.target.checked })}
            />
            <Checkbox
              label="Rechnung beim Abschluss erstellen und festschreiben"
              checked={v.autoInvoice}
              onChange={(e) => setV({ ...v, autoInvoice: e.target.checked })}
            />
          </div>
          <Button className="mt-3" disabled={!v.name} onClick={() => save(null, v)}>
            <Plus /> Anlegen
          </Button>
        </CardBody>
      </Card>
    </div>
  );
}
