import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Building2,
  CheckCircle2,
  Delete,
  FileText,
  KeyRound,
  LogIn,
  LogOut,
  Maximize,
  Minus,
  PackageCheck,
  Plus,
  ScanLine,
  Settings2,
  ShieldCheck,
  Trash2,
  TriangleAlert,
  UserRound,
  Warehouse as WarehouseIcon,
  XCircle,
} from 'lucide-react';
import { type FormEvent, type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { CARRIERS, PACKING_PROBLEMS, type Carrier, type PackingProblem } from '@fangevo/shared';
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
import { printPdf } from '../../lib/print-pdf';
import {
  resolveActiveCompany,
  sessionQuery,
  storeActiveCompany,
  useCan,
  useSession,
} from '../../lib/session';

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
  settings: { autoInvoice?: boolean; autoDeliveryNote?: boolean; autoPrint?: boolean };
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

/**
 * Einstieg: ohne Anmeldung PIN-Bildschirm (nur an freigegebenen Geräten), mit PIN-Sitzung fester
 * Packplatz des Geräts, mit voller Anmeldung freie Wahl von Firma, Lager und Packplatz.
 */
export function PacktischPage() {
  const session = useQuery(sessionQuery);
  if (session.isPending)
    return (
      <Shell>
        <Center>
          <Spinner />
        </Center>
      </Shell>
    );
  if (!session.data) return <PinLoginScreen />;
  if (session.data.scope) return <ScopedPacktisch />;
  return <FullPacktisch />;
}

/** Abmelden und zurück zum PIN-Bildschirm (bzw. zur Anmeldung). */
function useLogout() {
  const qc = useQueryClient();
  return useCallback(async () => {
    try {
      await http.post('/auth/logout');
    } finally {
      // Erst die Sitzung auf „abgemeldet“ setzen (die Seite wechselt zur PIN-Anmeldung),
      // dann alle übrigen Daten der Person verwerfen.
      qc.setQueryData(sessionQuery.queryKey, null);
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== sessionQuery.queryKey[0] });
    }
  }, [qc]);
}

function FullPacktisch() {
  const s = useSession();
  const can = useCan();
  const qc = useQueryClient();
  const logout = useLogout();
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
      stationId={setup.stationId}
      actions={(busy, station) => (
        <>
          {can('shipping.manage') && <DeviceRelease station={station} />}
          <Button
            variant="secondary"
            className="h-12 [&_svg]:size-5"
            onClick={() => setChanging(true)}
            disabled={busy}
          >
            <Settings2 /> Platz wechseln
          </Button>
          <Button
            variant="ghost"
            className="h-12 [&_svg]:size-5"
            onClick={() => void logout()}
            disabled={busy}
          >
            <LogOut /> Abmelden
          </Button>
        </>
      )}
      onInvalid={() => {
        writeSetup(accountId, companyId, null);
        setSetup(null);
      }}
    />
  );
}

/** Nach so vielen Minuten ohne Eingabe wird eine PIN-Sitzung am Gerät abgemeldet. */
const IDLE_LOGOUT_MIN = 15;

/** Mit PIN angemeldet: Packplatz kommt vom Gerät, Abmelden statt Platz wechseln. */
function ScopedPacktisch() {
  const s = useSession();
  const logout = useLogout();
  useState(() => resolveActiveCompany(s));
  const current = useQuery({
    queryKey: ['packtisch', 'device'],
    queryFn: () =>
      http.get<{ station: { id: string; name: string } | null; device: { name: string } }>(
        '/packing/devices/current',
      ),
    retry: false,
  });

  // Automatisch abmelden, wenn niemand mehr am Gerät arbeitet
  useEffect(() => {
    let timer = window.setTimeout(() => void logout(), IDLE_LOGOUT_MIN * 60_000);
    const reset = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void logout(), IDLE_LOGOUT_MIN * 60_000);
    };
    const events = ['pointerdown', 'keydown'] as const;
    for (const e of events) window.addEventListener(e, reset);
    return () => {
      window.clearTimeout(timer);
      for (const e of events) window.removeEventListener(e, reset);
    };
  }, [logout]);

  if (current.isPending)
    return (
      <Shell>
        <Center>
          <Spinner />
        </Center>
      </Shell>
    );
  if (current.isError || !current.data.station)
    return (
      <Shell>
        <Center>
          <p className="text-2xl font-semibold">Packplatz nicht verfügbar</p>
          <p className="mt-2 text-lg text-muted">
            {current.isError
              ? errorMessage(current.error)
              : 'Der Packplatz dieses Geräts wurde entfernt. Bitte beim Lagerleiter melden.'}
          </p>
          <Button className={cn(big, 'mt-6')} onClick={() => void logout()}>
            <LogOut /> Abmelden
          </Button>
        </Center>
      </Shell>
    );
  return (
    <Workbench
      stationId={current.data.station.id}
      actions={(busy) => (
        <Button
          variant="secondary"
          className="h-12 [&_svg]:size-5"
          onClick={() => void logout()}
          disabled={busy}
        >
          <LogOut /> Abmelden
        </Button>
      )}
      onInvalid={() => void logout()}
    />
  );
}

// ───── Gerät für die PIN-Anmeldung freigeben (Lagerleiter) ─────

function DeviceRelease({ station }: { station: Station }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const device = useQuery({
    queryKey: ['packtisch', 'pin-device'],
    queryFn: () => http.get<PinDeviceInfo>('/packing/pin/device'),
    retry: false,
  });
  if (device.isPending) return null;
  if (device.data?.station.id === station.id)
    return (
      <span className="flex items-center gap-1 text-base text-success">
        <ShieldCheck className="size-5" aria-hidden /> PIN-Anmeldung aktiv
      </span>
    );
  return (
    <>
      {error && <span className="max-w-64 truncate text-sm text-danger">{error}</span>}
      <Button
        variant="secondary"
        className="h-12 [&_svg]:size-5"
        loading={busy}
        title="Danach können sich Packer an diesem Rechner mit Namen und PIN anmelden"
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await http.post('/packing/devices', {
              stationId: station.id,
              name: `${station.name} · ${new Date().toLocaleDateString('de-DE')}`,
            });
            await qc.invalidateQueries({ queryKey: ['packtisch', 'pin-device'] });
          } catch (e) {
            setError(errorMessage(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        <ShieldCheck /> Gerät für PIN freigeben
      </Button>
    </>
  );
}

// ───── PIN-Anmeldung am freigegebenen Gerät ─────

interface PinDeviceInfo {
  device: { id: string; name: string };
  station: { id: string; name: string };
  companyName: string;
  packers: { userId: string; name: string }[];
}

function PinLoginScreen() {
  const qc = useQueryClient();
  const info = useQuery({
    queryKey: ['packtisch', 'pin-device'],
    queryFn: () => http.get<PinDeviceInfo>('/packing/pin/device'),
    retry: false,
    refetchInterval: 60_000,
  });
  const [who, setWho] = useState<{ userId: string; name: string } | null>(null);
  const [pin, setPin] = useState('');
  const [msg, setMsg] = useState<Msg | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (value: string) => {
    if (!who || value.length < 4) return;
    setBusy(true);
    try {
      await http.post('/packing/pin/login', { userId: who.userId, pin: value });
      await qc.invalidateQueries({ queryKey: sessionQuery.queryKey });
    } catch (e) {
      setPin('');
      setMsg((m) => ({ tone: 'danger', text: errorMessage(e), n: (m?.n ?? 0) + 1 }));
      beep(false);
    } finally {
      setBusy(false);
    }
  };

  // PIN auch über die Tastatur (Ziffern, Rücktaste, Enter)
  useEffect(() => {
    if (!who) return;
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) setPin((p) => (p.length < 6 ? p + e.key : p));
      else if (e.key === 'Backspace') setPin((p) => p.slice(0, -1));
      else if (e.key === 'Enter') void submit(pin);
      else if (e.key === 'Escape') setWho(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (info.isPending)
    return (
      <Shell>
        <Center>
          <Spinner />
        </Center>
      </Shell>
    );
  if (info.isError)
    return (
      <Shell>
        <Center>
          <KeyRound className="mx-auto size-16 text-muted" aria-hidden />
          <p className="mt-3 text-2xl font-semibold">Dieses Gerät ist nicht freigegeben</p>
          <p className="mt-2 text-lg text-muted">
            Der Lagerleiter meldet sich einmal mit E-Mail und Passwort an, öffnet den Packtisch und
            tippt auf „Gerät für PIN freigeben“. Danach können sich Packer hier mit Namen und PIN
            anmelden.
          </p>
          <a href="/login" className="mt-6 inline-block">
            <Button className={big}>Mit E-Mail anmelden</Button>
          </a>
        </Center>
      </Shell>
    );
  const d = info.data;
  return (
    <Shell
      header={
        <span className="text-lg text-muted">
          {d.station.name} · {d.companyName}
        </span>
      }
    >
      <div className="mx-auto flex h-full max-w-5xl flex-col gap-4 p-6">
        {!who ? (
          <>
            <h1 className="text-3xl font-semibold">Wer packt?</h1>
            {d.packers.length ? (
              <div className="grid min-h-0 grid-cols-3 gap-3 overflow-y-auto">
                {d.packers.map((p) => (
                  <Tile
                    key={p.userId}
                    onClick={() => {
                      setWho(p);
                      setPin('');
                      setMsg(null);
                    }}
                  >
                    <span className="flex items-center gap-3 text-xl font-semibold">
                      <UserRound className="size-7 text-muted" aria-hidden />
                      {p.name}
                    </span>
                  </Tile>
                ))}
              </div>
            ) : (
              <p className="text-lg text-muted">
                Noch niemand hat eine PIN. Die PIN legt man unter Einstellungen › Sicherheit fest,
                oder der Administrator vergibt sie unter Benutzer.
              </p>
            )}
            <a href="/login" className="mt-auto self-start text-base text-muted underline">
              Mit E-Mail anmelden (Lagerleiter)
            </a>
          </>
        ) : (
          <div className="mx-auto flex w-full max-w-md flex-col gap-4">
            <div className="flex items-center gap-3">
              <Button
                variant="secondary"
                className="h-12 w-12 p-0 [&_svg]:size-6"
                aria-label="Zurück zur Auswahl"
                onClick={() => setWho(null)}
              >
                <ArrowLeft />
              </Button>
              <h1 className="text-2xl font-semibold">PIN für {who.name}</h1>
            </div>
            <Banner msg={msg} />
            <div
              className="flex h-16 items-center justify-center gap-4 rounded-xl border-2 border-border bg-surface"
              aria-label={`${pin.length} Ziffern eingegeben`}
            >
              {Array.from({ length: Math.max(4, pin.length) }, (_, i) => (
                <span
                  key={i}
                  className={cn(
                    'size-5 rounded-full border-2 border-fg',
                    i < pin.length ? 'bg-fg' : 'bg-transparent',
                  )}
                />
              ))}
            </div>
            <div className="grid grid-cols-3 gap-3" role="group" aria-label="PIN eingeben">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'back', '0', 'ok'].map((k) => (
                <Button
                  key={k}
                  variant={k === 'ok' ? 'primary' : 'secondary'}
                  className="h-16 text-2xl [&_svg]:size-7"
                  aria-label={k === 'back' ? 'Löschen' : k === 'ok' ? 'Anmelden' : k}
                  disabled={busy || (k === 'ok' && pin.length < 4)}
                  loading={busy && k === 'ok'}
                  onClick={() => {
                    if (k === 'back') setPin((p) => p.slice(0, -1));
                    else if (k === 'ok') void submit(pin);
                    else setPin((p) => (p.length < 6 ? p + k : p));
                  }}
                >
                  {k === 'back' ? <Delete /> : k === 'ok' ? <LogIn /> : k}
                </Button>
              ))}
            </div>
          </div>
        )}
      </div>
    </Shell>
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
  stationId,
  actions,
  onInvalid,
}: {
  stationId: string;
  /** Schaltflächen oben rechts; busy = gerade wird ein Auftrag gepackt */
  actions: (busy: boolean, station: Station) => ReactNode;
  onInvalid: () => void;
}) {
  const qc = useQueryClient();
  const s = useSession();
  const stations = useQuery({
    queryKey: ['packing-stations'],
    queryFn: () => http.get<Station[]>('/packing/stations'),
  });
  const station = stations.data?.find((x) => x.id === stationId && !x.archivedAt) ?? null;

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
  const [problemOpen, setProblemOpen] = useState(false);
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

  /** Etikett und festgeschriebene Belege nacheinander drucken (Einstellung des Packplatzes). */
  const autoPrint = async (r: Omit<Done, 'orderNumber'>) => {
    const jobs = [
      ...(r.shipment.hasLabel ? [`/packing/shipments/${r.shipment.id}/label`] : []),
      ...r.documents.filter((d) => d.number).map((d) => `/documents/${d.id}/pdf`),
    ];
    try {
      for (const j of jobs) await printPdf(j);
    } catch (e) {
      say('warning', `Drucken nicht möglich: ${errorMessage(e)}`, false);
    }
  };

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
      if (station.settings.autoPrint) void autoPrint(r);
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
          {actions(!!prep, station)}
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
        {problemOpen && prep && station && (
          <ProblemDialog
            orderId={prep.order.id}
            orderNumber={prep.order.number}
            stationId={station.id}
            onClose={() => setProblemOpen(false)}
            onDone={async (text) => {
              setProblemOpen(false);
              reset();
              say('warning', `Auftrag ${prep.order.number} zurückgestellt – ${text}`, false);
              beep(false);
              await qc.invalidateQueries({ queryKey: ['packing-queue'] });
              await qc.invalidateQueries({ queryKey: ['orders'] });
            }}
          />
        )}

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
              onProblem={() => setProblemOpen(true)}
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
  onProblem: () => void;
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
            variant="secondary"
            className={cn(big, 'px-4 text-warning')}
            disabled={props.readOnly}
            onClick={props.onProblem}
          >
            <TriangleAlert /> Problem
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

// ───── Problem melden ─────

function ProblemDialog({
  orderId,
  orderNumber,
  stationId,
  onClose,
  onDone,
}: {
  orderId: string;
  orderNumber: string;
  stationId: string;
  onClose: () => void;
  onDone: (text: string) => void | Promise<void>;
}) {
  const [reason, setReason] = useState<PackingProblem | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pt-problem-title"
    >
      <div className="w-full max-w-3xl rounded-2xl bg-surface p-6 shadow-xl">
        <h2 id="pt-problem-title" className="text-2xl font-semibold">
          Problem mit Auftrag {orderNumber}
        </h2>
        <p className="mt-1 text-lg text-muted">
          Der Auftrag wird zurückgestellt und erscheint im Büro unter „In Bearbeitung“.
        </p>
        <div className="mt-4 grid grid-cols-2 gap-3">
          {(Object.entries(PACKING_PROBLEMS) as [PackingProblem, string][]).map(([k, label]) => (
            <Tile key={k} active={reason === k} onClick={() => setReason(k)}>
              <span className="text-xl font-semibold">{label}</span>
            </Tile>
          ))}
        </div>
        <label htmlFor="pt-problem-note" className="mt-4 block text-base font-medium">
          Notiz (optional)
        </label>
        <input
          id="pt-problem-note"
          value={note}
          maxLength={500}
          onChange={(e) => setNote(e.target.value)}
          placeholder="z. B. Fach leer, Verpackung eingerissen"
          className="mt-1 h-14 w-full rounded-xl border-2 border-border bg-surface px-4 text-lg focus:border-primary focus:outline-none"
        />
        {error && <p className="mt-3 text-lg text-danger">{error}</p>}
        <div className="mt-5 flex justify-end gap-3">
          <Button variant="secondary" className={big} onClick={onClose} disabled={busy}>
            Abbrechen
          </Button>
          <Button
            className={cn(big, 'bg-warning text-white hover:bg-warning/90')}
            disabled={!reason}
            loading={busy}
            onClick={async () => {
              if (!reason) return;
              setBusy(true);
              setError(null);
              try {
                await http.post(`/packing/orders/${orderId}/problem`, {
                  reason,
                  note: note.trim() || null,
                  stationId,
                });
                await onDone(PACKING_PROBLEMS[reason]);
              } catch (e) {
                setError(errorMessage(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            <TriangleAlert /> Zurückstellen
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
