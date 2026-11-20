import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link2, PlugZap, RefreshCw, ShoppingBag } from 'lucide-react';
import { useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  Checkbox,
  Dialog,
  Field,
  Input,
  Select,
  Spinner,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
} from '@fangevo/ui';
import { useSubmit } from '../../components/use-form';
import { errorMessage, http } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import { useMasterData } from '../../lib/master-data';

export interface ShopifySettings {
  shopDomain: string;
  locationId: string | null;
  importOrders: boolean;
  importUnpaid: boolean;
  importSince: string | null;
  syncStock: boolean;
  pushFulfillment: boolean;
  notifyCustomer: boolean;
}

export interface ShopifyChannelConfig {
  listedOnly?: boolean;
  shopify?: ShopifySettings;
  shopifyState?: {
    shopName?: string;
    locationName?: string | null;
    links?: {
      refreshedAt: string;
      linked: number;
      variants: number;
      unmatched: number;
      unmatchedSample: string[];
      duplicates: string[];
    };
    stock?: { at: string; updated: number; unchanged: number; notStocked: number; stale: number };
    failedOrders?: string[];
  };
}

interface ShopifyChannel {
  id: string;
  name: string;
  active: boolean;
  warehouseId: string;
  config: ShopifyChannelConfig;
}

interface Location {
  id: string;
  name: string;
  isActive: boolean;
  fulfillsOnlineOrders: boolean;
}

const LAUNCH_KEY = 'fangevo.shopify-launch';

/** Aufruf aus Shopify vor der Anmeldung merken (nur in diesem Tab, die Signatur ist ohnehin befristet). */
export function keepShopifyLaunch(search: string): void {
  const sp = new URLSearchParams(search);
  if (!sp.get('shop') || !sp.get('hmac')) return;
  try {
    sessionStorage.setItem(LAUNCH_KEY, search);
  } catch {
    // ohne Speicher: Shop nach der Anmeldung erneut aus Shopify öffnen
  }
}

export function hasShopifyLaunch(): boolean {
  try {
    return !!sessionStorage.getItem(LAUNCH_KEY);
  } catch {
    return false;
  }
}

/** Parameter, mit denen Shopify die App-Seite aufruft (nach Installation oder beim Öffnen der App). */
export function shopifyLaunchParams(): Record<string, string> | null {
  let search = window.location.search;
  try {
    search = sessionStorage.getItem(LAUNCH_KEY) ?? search;
  } catch {
    // ignorieren
  }
  const sp = new URLSearchParams(search);
  if (!sp.get('shop') || !sp.get('hmac')) return null;
  return Object.fromEntries(sp.entries());
}

export function clearLaunchParams() {
  try {
    sessionStorage.removeItem(LAUNCH_KEY);
  } catch {
    // ignorieren
  }
  window.history.replaceState(null, '', window.location.pathname);
}

/** Hinweis-Karte: So wird ein Shopify-Shop verbunden. */
export function ShopifyHowTo() {
  const info = useQuery({
    queryKey: ['shopify-info'],
    queryFn: () => http.get<{ configured: boolean }>('/channels/shopify/info'),
  });
  return (
    <Card>
      <CardBody>
        <p className="flex items-center gap-2 font-semibold">
          <ShoppingBag className="size-4" /> Shopify verbinden
        </p>
        {info.data && !info.data.configured ? (
          <p className="mt-1 text-sm text-muted">
            Die Shopify-App ist auf diesem Server noch nicht eingerichtet. Ihr Administrator findet
            die Anleitung in docs/SHOPIFY.md.
          </p>
        ) : (
          <ol className="mt-1 list-decimal space-y-1 pl-5 text-sm text-muted">
            <li>Im Shopify-Admin die App „FangEvo Wawi“ installieren (Link von FangEvo).</li>
            <li>
              Danach öffnet sich diese Seite automatisch – oder im Shopify-Admin unter Apps auf
              „FangEvo Wawi“ klicken.
            </li>
            <li>
              Hier „Shop verbinden“ bestätigen. Fertig: Bestellungen kommen alle paar Minuten.
            </li>
          </ol>
        )}
      </CardBody>
    </Card>
  );
}

/** Bestätigung nach dem Aufruf aus Shopify: Shop mit der aktiven Firma verbinden. */
export function ShopifyConnectDialog({
  params,
  onDone,
}: {
  params: Record<string, string>;
  onDone: (channelId: string | null) => void;
}) {
  const qc = useQueryClient();
  const md = useMasterData().data;
  const [name, setName] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const f = useSubmit(
    () =>
      http.post<{ created: boolean; channel: { id: string } }>('/channels/shopify/connect', {
        params,
        name: name || null,
        warehouseId: warehouseId || null,
      }),
    async (r) => {
      clearLaunchParams();
      await qc.invalidateQueries({ queryKey: ['channels'] });
      onDone(r.channel.id);
    },
  );
  const close = () => {
    clearLaunchParams();
    onDone(null);
  };
  return (
    <Dialog
      open
      onClose={close}
      title="Shopify-Shop verbinden"
      description={params.shop}
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            Abbrechen
          </Button>
          <Button loading={f.pending} onClick={() => f.submit(undefined)}>
            <PlugZap /> Shop verbinden
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {f.error && <Alert tone="danger">{f.error}</Alert>}
        <p className="text-sm text-muted">
          Der Shop wird mit der aktuell gewählten Firma verbunden. Bestellungen der letzten 7 Tage
          und alle neuen werden übernommen (einstellbar), der Bestand wird an Shopify übertragen und
          der Versand mit Sendungsnummer zurückgemeldet.
        </p>
        <Field label="Name (optional)" hint="Standard: „Shopify“ und der Shopname">
          {(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} />}
        </Field>
        <Field label="Lager für diesen Shop">
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
    </Dialog>
  );
}

/** Einstellungen eines Shopify-Kanals. */
export function ShopifyForm({
  channel,
  onClose,
}: {
  channel: ShopifyChannel;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const md = useMasterData().data;
  const s = channel.config.shopify!;
  const [v, setV] = useState({
    name: channel.name,
    warehouseId: channel.warehouseId,
    active: channel.active,
    ...s,
  });
  const locations = useQuery({
    queryKey: ['shopify-check', channel.id],
    queryFn: () => http.post<{ locations: Location[] }>(`/channels/${channel.id}/shopify/check`),
    staleTime: 60_000,
    retry: false,
  });
  const f = useSubmit(
    () =>
      http.put(`/channels/${channel.id}`, {
        type: 'shopify',
        name: v.name,
        warehouseId: v.warehouseId,
        active: v.active,
        listedOnly: channel.config.listedOnly ?? false,
        shopify: {
          shopDomain: s.shopDomain,
          locationId: v.locationId || null,
          importOrders: v.importOrders,
          importUnpaid: v.importUnpaid,
          importSince: v.importSince || null,
          syncStock: v.syncStock,
          pushFulfillment: v.pushFulfillment,
          notifyCustomer: v.notifyCustomer,
        },
      }),
    async () => {
      await qc.invalidateQueries({ queryKey: ['channels'] });
      await qc.invalidateQueries({ queryKey: ['channel'] });
      onClose();
    },
  );
  return (
    <Dialog
      open
      wide
      onClose={onClose}
      title="Shopify-Kanal bearbeiten"
      description={s.shopDomain}
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
      <div className="space-y-3">
        {f.error && <Alert tone="danger">{f.error}</Alert>}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name" error={f.fieldErrors.name}>
            {(p) => (
              <Input {...p} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
            )}
          </Field>
          <Field label="Lager (Bestand und Aufträge)">
            {(p) => (
              <Select
                {...p}
                value={v.warehouseId}
                onChange={(e) => setV({ ...v, warehouseId: e.target.value })}
              >
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
          <Field
            label="Shopify-Standort für den Bestand"
            error={f.fieldErrors['shopify.locationId']}
            hint={locations.isError ? errorMessage(locations.error) : undefined}
          >
            {(p) => (
              <Select
                {...p}
                value={v.locationId ?? ''}
                onChange={(e) => setV({ ...v, locationId: e.target.value || null })}
              >
                <option value="">– kein Bestandsabgleich –</option>
                {(locations.data?.locations ?? [])
                  .filter((l) => l.isActive || l.id === v.locationId)
                  .map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                {!locations.data && v.locationId && (
                  <option value={v.locationId}>
                    {channel.config.shopifyState?.locationName ?? v.locationId}
                  </option>
                )}
              </Select>
            )}
          </Field>
          <Field
            label="Bestellungen ab"
            hint="Ältere Bestellungen werden nicht übernommen"
            error={f.fieldErrors['shopify.importSince']}
          >
            {(p) => (
              <Input
                {...p}
                type="date"
                value={v.importSince ?? ''}
                onChange={(e) => setV({ ...v, importSince: e.target.value || null })}
              />
            )}
          </Field>
        </div>
        <Checkbox
          label="Aktiv"
          description="Deaktiviert: kein Abgleich mehr"
          checked={v.active}
          onChange={(e) => setV({ ...v, active: e.target.checked })}
        />
        <Checkbox
          label="Bestellungen übernehmen"
          description="Bezahlte, noch nicht versendete Bestellungen werden alle paar Minuten zu Aufträgen"
          checked={v.importOrders}
          onChange={(e) => setV({ ...v, importOrders: e.target.checked })}
        />
        <Checkbox
          label="Auch unbezahlte Bestellungen übernehmen"
          description="z. B. Vorkasse oder Rechnung"
          checked={v.importUnpaid}
          onChange={(e) => setV({ ...v, importUnpaid: e.target.checked })}
        />
        <Checkbox
          label="Bestand an Shopify übertragen"
          description="Die Wawi ist führend: verfügbar = Bestand − reserviert"
          checked={v.syncStock}
          onChange={(e) => setV({ ...v, syncStock: e.target.checked })}
        />
        <Checkbox
          label="Versand an Shopify melden"
          description="Mit Sendungsnummer, sobald der Auftrag versendet ist"
          checked={v.pushFulfillment}
          onChange={(e) => setV({ ...v, pushFulfillment: e.target.checked })}
        />
        <Checkbox
          label="Versandbestätigung von Shopify an den Kunden"
          checked={v.notifyCustomer}
          disabled={!v.pushFulfillment}
          onChange={(e) => setV({ ...v, notifyCustomer: e.target.checked })}
        />
      </div>
    </Dialog>
  );
}

/** Übersicht im Kanal-Dialog: Status, Aktionen, Verknüpfungen. */
export function ShopifyPanel({ channel, manage }: { channel: ShopifyChannel; manage: boolean }) {
  const qc = useQueryClient();
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger' | 'warning'; text: string } | null>(
    null,
  );
  const [busy, setBusy] = useState<string | null>(null);
  const links = useQuery({
    queryKey: ['shopify-links', channel.id],
    queryFn: () =>
      http.get<{
        items: {
          articleId: string;
          article: { number: string; name: string } | null;
          sku: string | null;
          title: string | null;
          matchedBy: string;
          stockTracked: boolean;
          lastStockSent: string | null;
          lastStockSentAt: string | null;
        }[];
      }>(`/channels/${channel.id}/shopify/links`),
  });
  const st = channel.config.shopifyState;
  const run = async (key: string, fn: () => Promise<string>) => {
    setBusy(key);
    setMsg(null);
    try {
      setMsg({ tone: 'success', text: await fn() });
    } catch (e) {
      setMsg({ tone: 'danger', text: errorMessage(e) });
    } finally {
      setBusy(null);
      await qc.invalidateQueries({ queryKey: ['channel', channel.id] });
      await qc.invalidateQueries({ queryKey: ['shopify-links', channel.id] });
    }
  };
  const [showLinks, setShowLinks] = useState(false);
  return (
    <div className="space-y-3">
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <CardBody>
            <p className="text-xs text-muted">Shop</p>
            <p className="font-semibold">{st?.shopName ?? channel.config.shopify?.shopDomain}</p>
            <p className="text-xs text-muted">{channel.config.shopify?.shopDomain}</p>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <p className="text-xs text-muted">Artikel verknüpft</p>
            <p className="font-semibold">
              {st?.links ? `${st.links.linked} von ${st.links.variants} Varianten` : '–'}
            </p>
            {st?.links && st.links.unmatched > 0 && (
              <p className="text-xs text-warning">{st.links.unmatched} ohne passenden Artikel</p>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <p className="text-xs text-muted">Bestand an Shopify</p>
            <p className="font-semibold">
              {!channel.config.shopify?.locationId
                ? 'aus (kein Standort)'
                : st?.stock
                  ? `${st.stock.updated} geändert, ${st.stock.unchanged} gleich`
                  : '–'}
            </p>
            {st?.stock && (
              <p className="text-xs text-muted">
                {formatDateTime(st.stock.at)}
                {st.stock.notStocked ? ` · ${st.stock.notStocked} am Standort nicht geführt` : ''}
              </p>
            )}
          </CardBody>
        </Card>
      </div>
      {!!st?.failedOrders?.length && (
        <Alert tone="warning">
          {st.failedOrders.length} Bestellung(en) konnten noch nicht übernommen werden (Grund im
          Protokoll). Sie werden bei jedem Abgleich erneut versucht.
        </Alert>
      )}
      {manage && (
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            loading={busy === 'sync'}
            onClick={() =>
              void run('sync', async () => {
                await http.post(`/channels/${channel.id}/shopify/sync`, {});
                return 'Abgleich gestartet. Ergebnis erscheint gleich im Protokoll.';
              })
            }
          >
            <RefreshCw /> Jetzt abgleichen
          </Button>
          <Button
            size="sm"
            variant="secondary"
            loading={busy === 'relink'}
            onClick={() =>
              void run('relink', async () => {
                await http.post(`/channels/${channel.id}/shopify/sync`, { relink: true });
                return 'Artikel werden neu verknüpft (über SKU = Artikelnummer bzw. Barcode = EAN).';
              })
            }
          >
            <Link2 /> Artikel neu verknüpfen
          </Button>
          <Button
            size="sm"
            variant="secondary"
            loading={busy === 'check'}
            onClick={() =>
              void run('check', async () => {
                const r = await http.post<{
                  ok: boolean;
                  shop: { name: string };
                  missingScopes: string[];
                }>(`/channels/${channel.id}/shopify/check`);
                return r.ok
                  ? `Verbindung zu „${r.shop.name}“ ist in Ordnung.`
                  : `Verbunden, aber Berechtigungen fehlen: ${r.missingScopes.join(', ')}`;
              })
            }
          >
            <PlugZap /> Verbindung prüfen
          </Button>
        </div>
      )}
      {st?.links && st.links.unmatchedSample.length > 0 && (
        <p className="text-xs text-muted">
          Nicht verknüpft (SKU in Shopify ohne gleiche Artikelnummer/EAN in der Wawi):{' '}
          {st.links.unmatchedSample.join(', ')}
          {st.links.unmatched > st.links.unmatchedSample.length ? ' …' : ''}
        </p>
      )}
      <div>
        <Button size="sm" variant="ghost" onClick={() => setShowLinks(!showLinks)}>
          {showLinks ? 'Verknüpfungen ausblenden' : 'Verknüpfte Artikel anzeigen'}
        </Button>
        {showLinks &&
          (!links.data ? (
            <Spinner />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Artikel</TH>
                  <TH>Shopify</TH>
                  <TH>über</TH>
                  <TH className="text-right">Bestand gesendet</TH>
                </TR>
              </THead>
              <TBody>
                {links.data.items.map((l) => (
                  <TR key={l.articleId}>
                    <TD>
                      {l.article?.number} · {l.article?.name}
                    </TD>
                    <TD className="text-xs">
                      {l.title}
                      {l.sku ? ` (${l.sku})` : ''}
                    </TD>
                    <TD>
                      <Badge>{l.matchedBy === 'sku' ? 'SKU' : 'Barcode'}</Badge>
                    </TD>
                    <TD className="text-right tabular-nums">
                      {!l.stockTracked ? (
                        <span className="text-xs text-muted">ohne Bestandsführung</span>
                      ) : (
                        (l.lastStockSent ?? '–')
                      )}
                    </TD>
                  </TR>
                ))}
                {!links.data.items.length && (
                  <TR>
                    <TD colSpan={4} className="text-center text-muted">
                      Noch keine Artikel verknüpft
                    </TD>
                  </TR>
                )}
              </TBody>
            </Table>
          ))}
      </div>
    </div>
  );
}
