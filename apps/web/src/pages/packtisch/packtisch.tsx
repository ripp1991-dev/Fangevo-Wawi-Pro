import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Building2,
  CheckCircle2,
  Delete,
  FileText,
  Maximize,
  Minus,
  PackageCheck,
  Plus,
  ScanLine,
  Settings2,
  Trash2,
  Warehouse as WarehouseIcon,
  XCircle,
} from 'lucide-react';
import { type FormEvent, type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { CARRIERS, type Carrier } from '@fangevo/shared';
import { Button, Select, Spinner, cn } from '@fangevo/ui';
import { Logo } from '../../components/logo';
import { ApiError, errorMessage, http } from '../../lib/api';
import { type Warehouse } from '../../lib/master-data';
import {
  type PackItem,
  type Packed,
  completeItems,
  isComplete,
  packedCount,
  progress,
  removeUnit,
  addUnit,
  scanArticle,
  scanSerial,
  typeWeight,
  weightForApi,
} from '../../lib/packing-session';
import {
  documentTypeLabel,
  openPdf,
  orderStatusLabel,
  type AddressSnapshot,
} from '../../lib/sales';
import { resolveActiveCompany, storeActiveCompany, useCan, useSession } from '../../lib/session';

/*
 * Touch-Packtisch: Vollbild-Arbeitsplatz für Packer an einem Lagerrechner mit Touchscreen
 * (ab 1280 × 720) und USB-Handscanner (Tastatureingabe). Ein Schritt pro Bildschirm, große
 * Schaltflächen, deutliche Rückmeldung in Farbe und Ton. Die Prüfung erfolgt in der API.
 */

interface Station {
  id: string;
  name: string;
  warehouseId: string | null;
  defaultCarrier: Carrier;
  settings: { autoInvoice?: boolean; autoDeliveryNote?: boolean };
  archivedAt: string | null;
}

interface QueueItem {
  id: string;
  number: string;
  orderDate: string;
  externalNumber: string | null;
  shippingMethod: string | null;
  customerName: string;
  channelName: string | null;
}

interface QueueData {
  rules: { locked: boolean; channelIds: string[] };
  channels: { id: string; name: string; count: number }[];
  total: number;
  truncated: boolean;
  items: QueueItem[];
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
    channelName: string | null;
  };
  rule: { ok: boolean; message: string | null; mismatch: 'warn' | 'block' };
  items: PackItem[];
}

interface Done {
  orderNumber: string;
  shipment: { id: string; number: string; hasLabel: boolean };
  documents: { type: string; id: string; number: string | null }[];
  warnings: string[];
}

type Tone = 'info' | 'success' | 'danger' | 'warning';
interface Msg {
  tone: Tone;
  text: string;
  /** Zähler, damit dieselbe Meldung erneut aufblinkt */
  n: number;
}

// ───── Gerät: Firma, Lager und Packplatz werden je Browser gemerkt ─────

interface DeviceSetup {
  warehouseId: string | null;
  stationId: string;
}
const setupKey = (accountId: string, companyId: string) => `fe-packtisch:${accountId}:${companyId}`;

function readSetup(accountId: string, companyId: string | null): DeviceSetup | null {
  if (!companyId) return null;
  try {
    const raw = localStorage.getItem(setupKey(accountId, companyId));
    return raw ? (JSON.parse(raw) as DeviceSetup) : null;
  } catch {
    return null;
  }
}
function writeSetup(accountId: string, companyId: string, s: DeviceSetup | null) {
  try {
    if (s) localStorage.setItem(setupKey(accountId, companyId), JSON.stringify(s));
    else localStorage.removeItem(setupKey(accountId, companyId));
  } catch {
    /* ohne Speicher weiter – dann wird bei jedem Start neu gewählt */
  }
}

// ───── Ton: kurzer heller Ton = richtig, tiefer langer Ton = falsch ─────

let audio: AudioContext | null = null;
function beep(ok: boolean) {
  try {
    audio ??= new AudioContext();
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = ok ? 'sine' : 'square';
    osc.frequency.value = ok ? 1200 : 220;
    gain.gain.value = 0.15;
    osc.connect(gain).connect(audio.destination);
    osc.start();
    osc.stop(audio.currentTime + (ok ? 0.12 : 0.45));
  } catch {
    /* kein Ton verfügbar */
  }
}

// ───── Bausteine ─────

const toneBg: Record<Tone, string> = {
  info: 'bg-primary/10 text-fg border-primary/40',
  success: 'bg-success text-white border-success',
  danger: 'bg-danger text-white border-danger',
  warning: 'bg-warning text-white border-warning',
};

function Banner({ msg }: { msg: Msg | null }) {
  if (!msg) return null;
  const Icon = msg.tone === 'danger' ? XCircle : msg.tone === 'success' ? CheckCircle2 : ScanLine;
  return (
    <div
      key={msg.n}
      role={msg.tone === 'danger' ? 'alert' : 'status'}
      className={cn(
        'flex min-h-14 items-center gap-3 rounded-xl border-2 px-5 py-3 text-xl font-semibold',
        'animate-[pt-flash_0.4s_ease-out]',
        toneBg[msg.tone],
      )}
    >
      <Icon className="size-7 shrink-0" aria-hidden />
      <span>{msg.text}</span>
    </div>
  );
}

/** Große Kachel-Schaltfläche für Touch. */
function Tile({
  children,
  onClick,
  active,
  className,
  ...rest
}: {
  children: ReactNode;
  onClick: () => void;
  active?: boolean;
  className?: string;
  'aria-label'?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'min-h-20 rounded-xl border-2 bg-surface p-4 text-left text-lg shadow-xs transition-colors',
        'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring active:bg-surface-3',
        active ? 'border-primary bg-primary/10' : 'border-border hover:bg-surface-2',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

const big = 'h-14 px-6 text-lg [&_svg]:size-6';

// ───── Seite ─────

export function PacktischPage() {
  const s = useSession();
  const can = useCan();
  const qc = useQueryClient();
  const [companyId, setCompanyId] = useState(() => resolveActiveCompany(s));
  const accountId = s.account?.id ?? '';
  const [setup, setSetup] = useState<DeviceSetup | null>(() => readSetup(accountId, companyId));
  const [changing, setChanging] = useState(false);

  if (!s.account || !can('packing.execute'))
    return (
      <Shell>
        <Center>
          <p className="text-2xl font-semibold">Kein Zugriff auf den Packtisch</p>
          <p className="mt-2 text-lg text-muted">
            Für den Packtisch fehlt das Recht „Packen“. Bitte beim Lagerleiter melden.
          </p>
          <a href="/" className="mt-6 inline-block">
            <Button size="lg" variant="secondary">
              Zur Übersicht
            </Button>
          </a>
        </Center>
      </Shell>
    );

  const pickCompany = async (id: string) => {
    storeActiveCompany(accountId, id);
    setCompanyId(id);
    setSetup(readSetup(accountId, id));
    await qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== 'session' });
  };

  if (!setup || changing || !companyId)
    return (
      <SetupScreen
        companyId={companyId}
        initial={setup}
        onCompany={pickCompany}
        onCancel={setup && companyId ? () => setChanging(false) : null}
        onDone={(next) => {
          writeSetup(accountId, companyId!, next);
          setSetup(next);
          setChanging(false);
        }}
      />
    );

  return (
    <Workbench
      key={`${companyId}:${setup.stationId}`}
      setup={setup}
      onChange={() => setChanging(true)}
      onInvalid={() => {
        writeSetup(accountId, companyId, null);
        setSetup(null);
      }}
    />
  );
}

function Shell({ children, header }: { children: ReactNode; header?: ReactNode }) {
  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-bg text-fg">
      <header className="flex h-16 shrink-0 items-center gap-4 border-b border-border bg-surface px-5">
        <Logo />
        <span className="text-xl font-semibold">Packtisch</span>
        <div className="ml-auto flex items-center gap-3">
          {header}
          <Button
            variant="ghost"
            className="h-12 w-12 p-0 [&_svg]:size-6"
            aria-label="Vollbild"
            onClick={() => {
              if (document.fullscreenElement) void document.exitFullscreen();
              else void document.documentElement.requestFullscreen?.().catch(() => undefined);
            }}
          >
            <Maximize />
          </Button>
        </div>
      </header>
      <main className="min-h-0 flex-1">{children}</main>
    </div>
  );
}

function Center({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="max-w-2xl text-center">{children}</div>
    </div>
  );
}

// ───── Einrichtung: Firma → Lager → Packplatz ─────

function SetupScreen({
  companyId,
  initial,
  onCompany,
  onDone,
  onCancel,
}: {
  companyId: string | null;
  initial: DeviceSetup | null;
  onCompany: (id: string) => void;
  onDone: (s: DeviceSetup) => void;
  onCancel: (() => void) | null;
}) {
  const s = useSession();
  const can = useCan();
  const companies = s.account?.companies ?? [];
  const warehouses = useQuery({
    queryKey: ['packtisch', 'warehouses', companyId],
    enabled: !!companyId,
    queryFn: async () =>
      (await http.get<{ warehouses: Warehouse[] }>('/company/master-data')).warehouses.filter(
        (w) => !w.archivedAt,
      ),
  });
  const stations = useQuery({
    queryKey: ['packtisch', 'stations', companyId],
    enabled: !!companyId,
    queryFn: async () =>
      (await http.get<Station[]>('/packing/stations')).filter((x) => !x.archivedAt),
  });
  const [warehouseId, setWarehouseId] = useState<string | null>(initial?.warehouseId ?? null);

  const whs = warehouses.data ?? [];
  // Nur ein Lager: Auswahl überspringen
  const effectiveWh = whs.length === 1 ? whs[0]!.id : warehouseId;
  const visibleStations = (stations.data ?? []).filter(
    (st) => !st.warehouseId || !effectiveWh || st.warehouseId === effectiveWh,
  );

  return (
    <Shell
      header={
        onCancel && (
          <Button variant="secondary" className={big} onClick={onCancel}>
            Abbrechen
          </Button>
        )
      }
    >
      <div className="mx-auto flex h-full max-w-5xl flex-col gap-6 overflow-y-auto p-6">
        <h1 className="text-3xl font-semibold">Arbeitsplatz einrichten</h1>
        <p className="-mt-4 text-lg text-muted">
          Einmal festlegen, wo dieser Rechner steht. Das Gerät merkt sich die Auswahl.
        </p>

        {companies.length > 1 && (
          <Step icon={<Building2 />} title="Firma">
            {companies.map((c) => (
              <Tile key={c.id} active={c.id === companyId} onClick={() => onCompany(c.id)}>
                {c.name}
              </Tile>
            ))}
          </Step>
        )}

        {companyId && (warehouses.isPending || stations.isPending) && <Spinner />}
        {(warehouses.isError || stations.isError) && (
          <p className="text-lg text-danger">{errorMessage(warehouses.error ?? stations.error)}</p>
        )}

        {whs.length > 1 && (
          <Step icon={<WarehouseIcon />} title="Lager">
            {whs.map((w) => (
              <Tile key={w.id} active={w.id === warehouseId} onClick={() => setWarehouseId(w.id)}>
                <span className="block font-semibold">{w.name}</span>
                {w.city && <span className="text-base text-muted">{w.city}</span>}
              </Tile>
            ))}
          </Step>
        )}

        {stations.data && effectiveWh !== null && (
          <Step icon={<PackageCheck />} title="Packplatz">
            {visibleStations.length ? (
              visibleStations.map((st) => (
                <Tile
                  key={st.id}
                  active={st.id === initial?.stationId}
                  onClick={() => onDone({ warehouseId: effectiveWh, stationId: st.id })}
                >
                  <span className="block font-semibold">{st.name}</span>
                  <span className="text-base text-muted">{CARRIERS[st.defaultCarrier]}</span>
                </Tile>
              ))
            ) : (
              <p className="col-span-full text-lg text-muted">
                In diesem Lager gibt es noch keinen Packplatz.{' '}
                {can('shipping.manage')
                  ? 'Unter Packtisch › Packplätze anlegen.'
                  : 'Bitte den Lagerleiter, einen anzulegen.'}
              </p>
            )}
          </Step>
        )}
        {stations.data && whs.length > 1 && effectiveWh === null && (
          <p className="text-lg text-muted">Bitte zuerst das Lager wählen.</p>
        )}
      </div>
    </Shell>
  );
}

function Step({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="mb-3 flex items-center gap-2 text-xl font-semibold [&_svg]:size-6">
        {icon}
        {title}
      </h2>
      <div className="grid grid-cols-3 gap-3">{children}</div>
    </section>
  );
}

// ───── Arbeitsplatz ─────

function Workbench({
  setup,
  onChange,
  onInvalid,
}: {
  setup: DeviceSetup;
  onChange: () => void;
  onInvalid: () => void;
}) {
  const qc = useQueryClient();
  const s = useSession();
  const stations = useQuery({
    queryKey: ['packing-stations'],
    queryFn: () => http.get<Station[]>('/packing/stations'),
  });
  const station = stations.data?.find((x) => x.id === setup.stationId && !x.archivedAt) ?? null;

  const [prep, setPrep] = useState<Prepared | null>(null);
  const [packed, setPacked] = useState<Packed[]>([]);
  const [serialFor, setSerialFor] = useState<PackItem | null>(null);
  const [msg, setMsgState] = useState<Msg | null>(null);
  const [carrier, setCarrier] = useState<Carrier>('manual');
  const [parcels, setParcels] = useState<string[]>(['']);
  const [activeParcel, setActiveParcel] = useState(0);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Done | null>(null);
  const [code, setCode] = useState('');
  const scanRef = useRef<HTMLInputElement>(null);
  const readOnly = s.account?.accessMode !== 'full';

  const say = useCallback((tone: Tone, text: string, sound = true) => {
    setMsgState((m) => ({ tone, text, n: (m?.n ?? 0) + 1 }));
    if (sound && (tone === 'success' || tone === 'danger')) beep(tone === 'success');
  }, []);

  // Packplatz gelöscht/archiviert → neu einrichten
  useEffect(() => {
    if (stations.data && !station) onInvalid();
  }, [stations.data, station, onInvalid]);
  useEffect(() => {
    if (station) setCarrier(station.defaultCarrier);
  }, [station]);

  // Scanner schreibt wie eine Tastatur: Eingabefeld immer im Fokus halten
  const refocus = useCallback(() => {
    const el = document.activeElement;
    if (el instanceof HTMLSelectElement) return;
    scanRef.current?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    refocus();
  }, [prep, serialFor, done, refocus]);

  const reset = () => {
    setPrep(null);
    setPacked([]);
    setSerialFor(null);
    setParcels(['']);
    setActiveParcel(0);
  };

  const loadOrder = async (ref: string) => {
    if (!station) return;
    try {
      const q = new URLSearchParams({ code: ref, stationId: station.id });
      const p = await http.get<Prepared>(`/packing/orders?${q}`);
      if (!p.order.shippable) {
        say(
          'danger',
          `Auftrag ${p.order.number} ist „${orderStatusLabel(p.order.status)}“ – nicht packbar`,
        );
        return;
      }
      if (!p.rule.ok && p.rule.mismatch === 'block') {
        say('danger', `Auftrag ${p.order.number}: ${p.rule.message}`);
        return;
      }
      reset();
      setDone(null);
      setPrep(p);
      if (p.rule.ok) say('info', `Auftrag ${p.order.number} – jetzt Artikel scannen`, false);
      else {
        say('warning', `Achtung: ${p.rule.message}`, false);
        beep(false);
      }
    } catch (err) {
      say(
        'danger',
        err instanceof ApiError && err.status === 404
          ? `Auftrag „${ref}“ nicht gefunden`
          : errorMessage(err),
      );
    }
  };

  const onScan = async (e: FormEvent) => {
    e.preventDefault();
    const c = code.trim();
    setCode('');
    if (!c) return;
    if (!prep) {
      await loadOrder(c);
      return;
    }
    const r = serialFor ? scanSerial(packed, serialFor, c) : scanArticle(prep.items, packed, c);
    switch (r.kind) {
      case 'packed':
        setPacked(r.packed);
        setSerialFor(null);
        say('success', `${r.item.name} ✓`);
        break;
      case 'need_serial':
        setSerialFor(r.item);
        say('info', `Seriennummer für ${r.item.name} scannen`, false);
        break;
      case 'not_in_order':
        say('danger', `Falscher Artikel – „${r.code}“ gehört nicht zu diesem Auftrag`);
        break;
      case 'already_complete':
        say('danger', `${r.item.name} ist schon vollständig – doppelt gescannt?`);
        break;
      case 'duplicate_serial':
        say('danger', `Seriennummer ${r.code} wurde schon gescannt`);
        break;
    }
  };

  const complete = !!prep && isComplete(prep.items, packed);

  const finish = async () => {
    if (!prep || !station) return;
    setBusy(true);
    try {
      const r = await http.post<Omit<Done, 'orderNumber'>>(
        `/packing/orders/${prep.order.id}/complete`,
        {
          stationId: station.id,
          carrier,
          trackingNumber: null,
          parcels: parcels.map((w) => ({ weightKg: weightForApi(w) })),
          items: completeItems(packed),
        },
      );
      setDone({ ...r, orderNumber: prep.order.number });
      reset();
      say('success', `Auftrag ${prep.order.number} versendet`);
      await qc.invalidateQueries({ queryKey: ['packing-queue'] });
      await qc.invalidateQueries({ queryKey: ['orders'] });
      await qc.invalidateQueries({ queryKey: ['shipments'] });
    } catch (err) {
      const detail =
        err instanceof ApiError && Object.keys(err.fieldErrors).length
          ? ` – ${Object.values(err.fieldErrors).join('; ')}`
          : '';
      say('danger', errorMessage(err) + detail);
    } finally {
      setBusy(false);
    }
  };

  if (stations.isPending || !station)
    return (
      <Shell>
        <Center>
          <Spinner />
        </Center>
      </Shell>
    );

  return (
    <Shell
      header={
        <>
          <span className="text-lg text-muted">
            {station.name} · {s.user.name}
          </span>
          <Button
            variant="secondary"
            className="h-12 [&_svg]:size-5"
            onClick={onChange}
            disabled={!!prep}
          >
            <Settings2 /> Platz wechseln
          </Button>
        </>
      }
    >
      <div
        className="flex h-full flex-col gap-4 p-4"
        onClick={(e) => {
          if (!(e.target instanceof HTMLInputElement)) refocus();
        }}
      >
        <form onSubmit={onScan} className="flex shrink-0 items-center gap-3">
          <label htmlFor="pt-scan" className="w-64 shrink-0 text-xl font-semibold">
            {serialFor ? 'Seriennummer scannen' : prep ? 'Artikel scannen' : 'Auftrag scannen'}
          </label>
          <input
            id="pt-scan"
            ref={scanRef}
            autoComplete="off"
            inputMode="none"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder={prep ? 'EAN oder Artikelnummer' : 'Auftragsnummer'}
            className="h-14 min-w-0 flex-1 rounded-xl border-2 border-border bg-surface px-4 text-xl focus:border-primary focus:outline-none"
          />
          <Button type="submit" className={big}>
            <ScanLine /> OK
          </Button>
        </form>
        <Banner msg={msg} />

        <div className="min-h-0 flex-1">
          {readOnly && (
            <p className="mb-3 text-lg text-warning">
              Der Account ist im Lesemodus – Packen ist nicht möglich.
            </p>
          )}
          {prep ? (
            <PackingView
              prep={prep}
              packed={packed}
              serialFor={serialFor}
              carrier={carrier}
              setCarrier={setCarrier}
              parcels={parcels}
              setParcels={setParcels}
              activeParcel={activeParcel}
              setActiveParcel={setActiveParcel}
              complete={complete}
              busy={busy}
              readOnly={readOnly}
              onAdd={(it) => {
                if (packedCount(packed, it) >= Number(it.quantity)) return;
                setPacked(addUnit(packed, it));
                say('success', `${it.name} ✓ (ohne Scan)`, false);
              }}
              onRemove={(it) => setPacked(removeUnit(packed, it))}
              onCancel={() => {
                reset();
                setMsgState(null);
              }}
              onFinish={finish}
            />
          ) : done ? (
            <DoneView
              done={done}
              onError={(t) => say('danger', t)}
              onNext={() => {
                setDone(null);
                setMsgState(null);
              }}
            />
          ) : (
            <QueueView stationId={station.id} onPick={(id) => void loadOrder(id)} />
          )}
        </div>
      </div>
    </Shell>
  );
}

// ───── Warteschlange als große Kacheln ─────

function QueueView({ stationId, onPick }: { stationId: string; onPick: (id: string) => void }) {
  const [channel, setChannel] = useState('');
  const q = useQuery({
    queryKey: ['packing-queue', stationId, channel, false],
    queryFn: () => {
      const p = new URLSearchParams({ stage: 'packing', stationId });
      if (channel) p.set('channelId', channel);
      return http.get<QueueData>(`/packing/queue?${p}`);
    },
    refetchInterval: 30_000,
  });
  if (q.isPending) return <Spinner />;
  if (q.isError) return <p className="text-lg text-danger">{errorMessage(q.error)}</p>;
  const d = q.data;
  const all = d.channels.reduce((a, c) => a + c.count, 0);
  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex shrink-0 flex-wrap gap-2" role="tablist" aria-label="Kanal">
        {[{ id: '', name: 'Alle', count: all }, ...d.channels].map((c) => (
          <Button
            key={c.id}
            role="tab"
            aria-selected={channel === c.id}
            variant={channel === c.id ? 'primary' : 'secondary'}
            className="h-12 px-5 text-base"
            onClick={() => setChannel(c.id)}
          >
            {c.name} ({c.count})
          </Button>
        ))}
      </div>
      {d.items.length ? (
        <div className="grid min-h-0 flex-1 auto-rows-min grid-cols-3 gap-3 overflow-y-auto pb-2">
          {d.items.map((o) => (
            <Tile key={o.id} onClick={() => onPick(o.id)} aria-label={`Auftrag ${o.number} packen`}>
              <span className="flex items-baseline justify-between gap-2">
                <span className="text-xl font-semibold">{o.number}</span>
                <span className="text-sm text-muted">
                  {new Date(o.orderDate).toLocaleDateString('de-DE')}
                </span>
              </span>
              <span className="block truncate">{o.customerName}</span>
              <span className="block truncate text-base text-muted">
                {[o.channelName ?? 'Ohne Kanal', o.shippingMethod].filter(Boolean).join(' · ')}
              </span>
            </Tile>
          ))}
        </div>
      ) : (
        <Center>
          <PackageCheck className="mx-auto size-16 text-success" aria-hidden />
          <p className="mt-3 text-2xl font-semibold">Alles gepackt</p>
          <p className="mt-1 text-lg text-muted">
            Keine Aufträge zum Packen{channel ? ' in diesem Kanal' : ''}. Die Liste aktualisiert
            sich von selbst.
          </p>
        </Center>
      )}
      {d.truncated && (
        <p className="shrink-0 text-sm text-muted">
          Es warten sehr viele Aufträge; angezeigt werden die ältesten.
        </p>
      )}
    </div>
  );
}

// ───── Packen ─────

function PackingView(props: {
  prep: Prepared;
  packed: Packed[];
  serialFor: PackItem | null;
  carrier: Carrier;
  setCarrier: (c: Carrier) => void;
  parcels: string[];
  setParcels: (p: string[]) => void;
  activeParcel: number;
  setActiveParcel: (i: number) => void;
  complete: boolean;
  busy: boolean;
  readOnly: boolean;
  onAdd: (it: PackItem) => void;
  onRemove: (it: PackItem) => void;
  onCancel: () => void;
  onFinish: () => void;
}) {
  const { prep, packed, parcels, activeParcel } = props;
  const pr = progress(prep.items, packed);
  const addr = prep.order.shippingAddress;
  return (
    <div className="grid h-full grid-cols-[1fr_400px] gap-4">
      <div className="flex min-h-0 flex-col gap-3">
        <div className="flex shrink-0 items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-2xl font-semibold">
              {prep.order.number} · {prep.order.customerName}
            </p>
            <p className="truncate text-base text-muted">
              {[
                prep.order.channelName ?? 'Ohne Kanal',
                addr && [addr.postalCode, addr.city].filter(Boolean).join(' '),
                addr && addr.country !== 'DE' ? addr.country : null,
                prep.order.shippingMethod,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </div>
          <span className="shrink-0 rounded-full bg-surface-3 px-4 py-2 text-xl font-semibold tabular-nums">
            {pr.done} / {pr.total}
          </span>
        </div>
        {prep.order.notes && (
          <p className="shrink-0 rounded-xl border-2 border-warning bg-warning/10 px-4 py-2 text-lg">
            Hinweis: {prep.order.notes}
          </p>
        )}
        <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
          {prep.items.map((it) => {
            const n = packedCount(packed, it);
            const soll = Number(it.quantity);
            const ok = n === soll;
            const waiting = props.serialFor === it;
            const serials = packed.filter(
              (p) =>
                p.orderLineId === it.orderLineId && p.articleId === it.articleId && p.serialNumber,
            );
            return (
              <li
                key={`${it.orderLineId}${it.articleId}`}
                className={cn(
                  'flex items-center gap-4 rounded-xl border-2 bg-surface px-4 py-3',
                  ok
                    ? 'border-success bg-success/10'
                    : waiting
                      ? 'border-primary'
                      : 'border-border',
                )}
              >
                {ok ? (
                  <CheckCircle2 className="size-9 shrink-0 text-success" aria-hidden />
                ) : (
                  <span
                    className="size-9 shrink-0 rounded-full border-2 border-border"
                    aria-hidden
                  />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xl font-semibold">{it.name}</p>
                  <p className="truncate text-base text-muted">
                    {it.articleNumber}
                    {it.setName && ` · aus Set „${it.setName}“`}
                    {it.trackSerials && ' · mit Seriennummer'}
                  </p>
                  {serials.length > 0 && (
                    <p className="truncate text-sm text-muted">
                      SN: {serials.map((p) => p.serialNumber).join(', ')}
                    </p>
                  )}
                </div>
                <span
                  className={cn(
                    'w-24 shrink-0 text-center text-3xl font-bold tabular-nums',
                    ok ? 'text-success' : '',
                  )}
                  aria-label={`${n} von ${soll} gepackt`}
                >
                  {n}/{soll}
                </span>
                <Button
                  variant="secondary"
                  className="h-14 w-14 p-0 [&_svg]:size-7"
                  aria-label={`${it.name} eins zurück`}
                  disabled={!n}
                  onClick={() => props.onRemove(it)}
                >
                  <Minus />
                </Button>
                <Button
                  variant="secondary"
                  className="h-14 w-14 p-0 [&_svg]:size-7"
                  aria-label={`${it.name} ohne Scan hinzufügen`}
                  disabled={ok || it.trackSerials}
                  onClick={() => props.onAdd(it)}
                >
                  <Plus />
                </Button>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="flex min-h-0 flex-col gap-3 rounded-xl border border-border bg-surface p-4">
        <div className="flex shrink-0 items-center gap-2">
          <label htmlFor="pt-carrier" className="text-base font-medium">
            Versand
          </label>
          <Select
            id="pt-carrier"
            className="h-12 flex-1 text-base"
            value={props.carrier}
            onChange={(e) => props.setCarrier(e.target.value as Carrier)}
          >
            {Object.entries(CARRIERS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {parcels.map((w, i) => (
            <Button
              key={i}
              variant={i === activeParcel ? 'primary' : 'secondary'}
              className="h-12 px-3 text-base"
              onClick={() => props.setActiveParcel(i)}
            >
              Paket {i + 1}: {w || '–'} kg
            </Button>
          ))}
          <Button
            variant="secondary"
            className="h-12 px-3 text-base"
            aria-label="Paket hinzufügen"
            onClick={() => {
              props.setParcels([...parcels, '']);
              props.setActiveParcel(parcels.length);
            }}
          >
            <Plus />
          </Button>
          {parcels.length > 1 && (
            <Button
              variant="ghost"
              className="h-12 px-3"
              aria-label={`Paket ${activeParcel + 1} entfernen`}
              onClick={() => {
                props.setParcels(parcels.filter((_, j) => j !== activeParcel));
                props.setActiveParcel(0);
              }}
            >
              <Trash2 />
            </Button>
          )}
        </div>
        <Numpad
          label={`Gewicht Paket ${activeParcel + 1} (kg)`}
          onKey={(k) =>
            props.setParcels(parcels.map((x, j) => (j === activeParcel ? typeWeight(x, k) : x)))
          }
        />
        <div className="mt-auto flex shrink-0 gap-2">
          <Button variant="secondary" className={cn(big, 'px-4')} onClick={props.onCancel}>
            <ArrowLeft /> Zurück
          </Button>
          <Button
            className={cn(big, 'flex-1 bg-success text-white hover:bg-success/90')}
            disabled={!props.complete || props.readOnly}
            loading={props.busy}
            onClick={props.onFinish}
          >
            <PackageCheck /> Fertig
          </Button>
        </div>
      </div>
    </div>
  );
}

function Numpad({ label, onKey }: { label: string; onKey: (k: string) => void }) {
  const keys = ['7', '8', '9', '4', '5', '6', '1', '2', '3', ',', '0', 'back'];
  return (
    <div className="shrink-0" role="group" aria-label={label}>
      <p className="mb-2 text-sm text-muted">{label}</p>
      <div className="grid grid-cols-3 gap-2">
        {keys.map((k) => (
          <Button
            key={k}
            variant="secondary"
            className="h-12 text-xl [&_svg]:size-6"
            aria-label={k === 'back' ? 'Löschen' : k}
            onClick={() => onKey(k)}
          >
            {k === 'back' ? <Delete /> : k}
          </Button>
        ))}
      </div>
    </div>
  );
}

// ───── Abgeschlossen ─────

function DoneView({
  done,
  onNext,
  onError,
}: {
  done: Done;
  onNext: () => void;
  onError: (t: string) => void;
}) {
  return (
    <Center>
      <CheckCircle2 className="mx-auto size-20 text-success" aria-hidden />
      <p className="mt-3 text-3xl font-semibold">Auftrag {done.orderNumber} versendet</p>
      <p className="mt-1 text-lg text-muted">Sendung {done.shipment.number}</p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        {done.shipment.hasLabel && (
          <Button
            variant="secondary"
            className={big}
            onClick={() =>
              openPdf(`/packing/shipments/${done.shipment.id}/label`).catch((e) =>
                onError(errorMessage(e)),
              )
            }
          >
            <FileText /> Etikett drucken
          </Button>
        )}
        {done.documents.map((d) => (
          <Button
            key={d.id}
            variant="secondary"
            className={big}
            onClick={() => openPdf(`/documents/${d.id}/pdf`).catch((e) => onError(errorMessage(e)))}
          >
            <FileText /> {documentTypeLabel(d.type)} {d.number ?? '(Entwurf)'}
          </Button>
        ))}
        <Button className={big} onClick={onNext}>
          Nächster Auftrag
        </Button>
      </div>
      {done.warnings.map((w) => (
        <p key={w} className="mt-3 text-lg text-warning">
          Hinweis: {w}
        </p>
      ))}
      <p className="mt-6 text-base text-muted">Oder einfach den nächsten Auftrag scannen.</p>
    </Center>
  );
}
