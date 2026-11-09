import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Camera, ScanLine, X } from 'lucide-react';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { Alert, Badge, Button, Card, CardBody, Field, Input, Select, Spinner } from '@fangevo/ui';
import { Tabs } from '../../components/tabs';
import { errorMessage, http } from '../../lib/api';
import { formatDate } from '../../lib/format';
import { formatQty, useMasterData } from '../../lib/master-data';
import { useCan, useSession } from '../../lib/session';

interface ArticleHit {
  type: 'article';
  article: {
    id: string;
    number: string;
    name: string;
    unit: string;
    gtin: string | null;
    trackBatches: boolean;
    trackSerials: boolean;
    trackBestBefore: boolean;
  };
  reserved: string;
  levels: {
    warehouse: { id: string; code: string; name: string } | null;
    locationId: string | null;
    locationCode: string | null;
    batch: string | null;
    serialNumber: string | null;
    bestBefore: string | null;
    quantity: string;
  }[];
}
interface LocationHit {
  type: 'location';
  location: {
    id: string;
    code: string;
    warehouse: { id: string; code: string; name: string } | null;
  };
  levels: {
    article: { id: string; number: string; name: string; unit: string } | null;
    batch: string | null;
    serialNumber: string | null;
    quantity: string;
  }[];
}
type Hit = ArticleHit | LocationHit;

interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
}
declare global {
  interface Window {
    BarcodeDetector?: new (opts?: { formats?: string[] }) => BarcodeDetectorLike;
  }
}

/** Kamera-Scan über die BarcodeDetector-Schnittstelle des Browsers (z. B. Chrome auf Android). */
function CameraScanner({ onCode, onClose }: { onCode: (c: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let stream: MediaStream | null = null;
    let stop = false;
    const Detector = window.BarcodeDetector;
    if (!Detector) {
      setError(
        'Dieser Browser kann keine Barcodes per Kamera lesen. Bitte Handscanner oder Eingabe nutzen.',
      );
      return;
    }
    const detector = new Detector({
      formats: ['ean_13', 'ean_8', 'code_128', 'code_39', 'qr_code', 'upc_a'],
    });
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' } })
      .then(async (s) => {
        stream = s;
        if (!video.current) return;
        video.current.srcObject = s;
        await video.current.play();
        const tick = async () => {
          if (stop || !video.current) return;
          try {
            const codes = await detector.detect(video.current);
            if (codes[0]?.rawValue) {
              onCode(codes[0].rawValue);
              return;
            }
          } catch {
            /* nächster Versuch */
          }
          setTimeout(tick, 250);
        };
        void tick();
      })
      .catch(() => setError('Kein Zugriff auf die Kamera.'));
    return () => {
      stop = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [onCode]);
  return (
    <div className="space-y-2">
      {error ? (
        <Alert tone="warning">{error}</Alert>
      ) : (
        <video ref={video} className="w-full rounded-lg bg-black" muted playsInline />
      )}
      <Button variant="secondary" className="w-full" onClick={onClose}>
        <X /> Kamera schließen
      </Button>
    </div>
  );
}

/**
 * Mobile Lageroberfläche: scannen (Handscanner, Kamera oder Eingabe), Bestand und Lagerplätze sehen,
 * Wareneingang, Umlagerung und Inventur direkt am Regal.
 */
export function ScanPage() {
  const can = useCan();
  const s = useSession();
  const qc = useQueryClient();
  const md = useMasterData().data;
  const [code, setCode] = useState('');
  const [camera, setCamera] = useState(false);
  const [hit, setHit] = useState<Hit | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [action, setAction] = useState<'receipt' | 'transfer' | 'correction'>('receipt');
  const [v, setV] = useState({
    quantity: '1',
    locationId: '',
    toLocationId: '',
    batch: '',
    serialNumber: '',
    bestBefore: '',
  });
  const input = useRef<HTMLInputElement>(null);
  const manage = can('inventory.manage') && s.account?.accessMode === 'full';
  const warehouse = md?.warehouses.find((w) => w.isDefault);
  const locations = md?.locations.filter((l) => l.warehouseId === warehouse?.id) ?? [];

  const lookup = async (c: string) => {
    setError(null);
    setOk(null);
    setCamera(false);
    if (!c.trim()) return;
    try {
      setHit(await http.get<Hit>(`/scan?code=${encodeURIComponent(c.trim())}`));
    } catch (e) {
      setHit(null);
      setError(errorMessage(e));
    }
    setCode('');
    input.current?.focus();
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void lookup(code);
  };

  const book = async () => {
    if (hit?.type !== 'article' || !warehouse) return;
    setError(null);
    setOk(null);
    const lot = { batch: v.batch || null, serialNumber: v.serialNumber || null };
    try {
      if (action === 'receipt')
        await http.post('/inventory/bookings', {
          type: 'receipt',
          articleId: hit.article.id,
          warehouseId: warehouse.id,
          locationId: v.locationId || null,
          quantity: v.quantity,
          bestBefore: v.bestBefore || null,
          ...lot,
        });
      else if (action === 'transfer')
        await http.post('/inventory/transfers', {
          articleId: hit.article.id,
          fromWarehouseId: warehouse.id,
          fromLocationId: v.locationId || null,
          toWarehouseId: warehouse.id,
          toLocationId: v.toLocationId || null,
          quantity: v.quantity,
          ...lot,
        });
      else
        await http.post('/inventory/corrections', {
          articleId: hit.article.id,
          warehouseId: warehouse.id,
          locationId: v.locationId || null,
          countedQuantity: v.quantity,
          bestBefore: v.bestBefore || null,
          ...lot,
        });
      setOk('Gebucht');
      await qc.invalidateQueries({ queryKey: ['inventory'] });
      setHit(await http.get<Hit>(`/scan?code=${encodeURIComponent(hit.article.number)}`));
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <h1 className="text-xl font-semibold">Scannen</h1>
      <form onSubmit={submit} className="flex items-end gap-2">
        <div className="flex-1">
          <Field label="Barcode, Artikelnummer oder Lagerplatz">
            {(p) => (
              <Input
                {...p}
                ref={input}
                autoFocus
                inputMode="text"
                autoComplete="off"
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            )}
          </Field>
        </div>
        <Button type="submit" aria-label="Suchen">
          <ScanLine />
        </Button>
        <Button
          type="button"
          variant="secondary"
          aria-label="Kamera"
          onClick={() => setCamera(true)}
        >
          <Camera />
        </Button>
      </form>
      {camera && <CameraScanner onCode={(c) => void lookup(c)} onClose={() => setCamera(false)} />}
      {error && <Alert tone="danger">{error}</Alert>}
      {ok && <Alert tone="success">{ok}</Alert>}
      {!md && <Spinner />}

      {hit?.type === 'location' && (
        <Card>
          <CardBody>
            <p className="text-lg font-semibold">Lagerplatz {hit.location.code}</p>
            <p className="mb-2 text-sm text-muted">{hit.location.warehouse?.name}</p>
            {hit.levels.length === 0 && <p className="text-sm text-muted">Leer</p>}
            <ul className="divide-y divide-border text-sm">
              {hit.levels.map((l, i) => (
                <li key={i} className="flex justify-between gap-2 py-2">
                  <button
                    type="button"
                    className="text-left hover:underline"
                    onClick={() => l.article && void lookup(l.article.number)}
                  >
                    {l.article?.number} · {l.article?.name}
                    {(l.batch || l.serialNumber) && (
                      <span className="block text-xs text-muted">
                        {[l.batch, l.serialNumber].filter(Boolean).join(' · ')}
                      </span>
                    )}
                  </button>
                  <span className="tabular-nums">
                    {formatQty(l.quantity)} {l.article?.unit}
                  </span>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}

      {hit?.type === 'article' && (
        <Card>
          <CardBody>
            <p className="text-lg font-semibold">{hit.article.name}</p>
            <p className="text-sm text-muted">
              {hit.article.number}
              {hit.article.gtin && ` · ${hit.article.gtin}`}
            </p>
            <p className="mt-2 text-sm">
              Bestand gesamt{' '}
              <strong>
                {formatQty(String(hit.levels.reduce((a, l) => a + Number(l.quantity), 0)))}{' '}
                {hit.article.unit}
              </strong>
              {Number(hit.reserved) > 0 && (
                <span className="text-muted"> · reserviert {formatQty(hit.reserved)}</span>
              )}
            </p>
            <ul className="mt-2 divide-y divide-border text-sm">
              {hit.levels.map((l, i) => (
                <li key={i} className="flex justify-between gap-2 py-2">
                  <span>
                    <Badge>{l.locationCode ?? 'ohne Platz'}</Badge> {l.warehouse?.code}
                    {(l.batch || l.serialNumber || l.bestBefore) && (
                      <span className="block text-xs text-muted">
                        {[
                          l.batch && `Charge ${l.batch}`,
                          l.serialNumber && `SN ${l.serialNumber}`,
                          l.bestBefore && `MHD ${formatDate(l.bestBefore)}`,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    )}
                  </span>
                  <span className="tabular-nums">{formatQty(l.quantity)}</span>
                </li>
              ))}
            </ul>
            {manage && warehouse && (
              <div className="mt-4 space-y-3 border-t border-border pt-3">
                <Tabs
                  tabs={[
                    { id: 'receipt', label: 'Zugang' },
                    { id: 'transfer', label: 'Umlagern' },
                    { id: 'correction', label: 'Inventur' },
                  ]}
                  value={action}
                  onChange={setAction}
                />
                <Field label={action === 'correction' ? 'Gezählt' : 'Menge'}>
                  {(p) => (
                    <Input
                      {...p}
                      inputMode="decimal"
                      value={v.quantity}
                      onChange={(e) => setV({ ...v, quantity: e.target.value })}
                    />
                  )}
                </Field>
                <Field label={action === 'transfer' ? 'Von Lagerplatz' : 'Lagerplatz'}>
                  {(p) => (
                    <Select
                      {...p}
                      value={v.locationId}
                      onChange={(e) => setV({ ...v, locationId: e.target.value })}
                    >
                      <option value="">– ohne Lagerplatz –</option>
                      {locations.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.code}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                {action === 'transfer' && (
                  <Field label="Nach Lagerplatz">
                    {(p) => (
                      <Select
                        {...p}
                        value={v.toLocationId}
                        onChange={(e) => setV({ ...v, toLocationId: e.target.value })}
                      >
                        <option value="">– ohne Lagerplatz –</option>
                        {locations.map((l) => (
                          <option key={l.id} value={l.id}>
                            {l.code}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>
                )}
                {hit.article.trackBatches && (
                  <Field label="Charge">
                    {(p) => (
                      <Input
                        {...p}
                        value={v.batch}
                        onChange={(e) => setV({ ...v, batch: e.target.value })}
                      />
                    )}
                  </Field>
                )}
                {hit.article.trackSerials && (
                  <Field label="Seriennummer">
                    {(p) => (
                      <Input
                        {...p}
                        value={v.serialNumber}
                        onChange={(e) => setV({ ...v, serialNumber: e.target.value })}
                      />
                    )}
                  </Field>
                )}
                {hit.article.trackBestBefore && action !== 'transfer' && (
                  <Field label="MHD">
                    {(p) => (
                      <Input
                        {...p}
                        type="date"
                        value={v.bestBefore}
                        onChange={(e) => setV({ ...v, bestBefore: e.target.value })}
                      />
                    )}
                  </Field>
                )}
                <Button className="w-full" size="lg" onClick={book}>
                  Buchen
                </Button>
              </div>
            )}
          </CardBody>
        </Card>
      )}
      <OpenPickLists />
    </div>
  );
}

/** Offene Picklisten für das Kommissionieren am Handy. */
function OpenPickLists() {
  const can = useCan();
  const filters = encodeURIComponent(
    JSON.stringify([{ field: 'status', op: 'in', value: ['open', 'in_progress'] }]),
  );
  const q = useQuery({
    queryKey: ['pick-lists', 'open'],
    queryFn: () =>
      http.get<{ items: { id: string; number: string; picked: string; quantity: string }[] }>(
        `/pick-lists?pageSize=20&filters=${filters}`,
      ),
    enabled: can('picking.execute'),
  });
  if (!can('picking.execute') || !q.data?.items.length) return null;
  return (
    <Card>
      <CardBody>
        <p className="mb-2 font-semibold">Offene Picklisten</p>
        <ul className="divide-y divide-border text-sm">
          {q.data.items.map((p) => (
            <li key={p.id} className="flex justify-between py-2">
              <a href={`/picking?id=${p.id}`} className="hover:underline">
                {p.number}
              </a>
              <span className="text-muted">
                {formatQty(p.picked)} / {formatQty(p.quantity)}
              </span>
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}
