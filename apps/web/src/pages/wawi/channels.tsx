import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, KeyRound, Plus, Store } from 'lucide-react';
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
import {
  SearchPicker,
  articleItem,
  searchArticles,
  type ArticlePick,
} from '../../components/pickers';
import { useSubmit } from '../../components/use-form';
import { errorMessage, http } from '../../lib/api';
import { formatDate, formatDateTime } from '../../lib/format';
import { formatMoney, toInput, useMasterData } from '../../lib/master-data';
import { useCan, useSession } from '../../lib/session';

interface Channel {
  id: string;
  name: string;
  type: 'api';
  active: boolean;
  status: string;
  lastSyncAt: string | null;
  lastError: string | null;
  warehouseId: string;
  config: { listedOnly?: boolean };
  orderCount?: number;
}

interface ChannelDetail extends Channel {
  logs: { id: string; level: 'info' | 'warning' | 'error'; message: string; createdAt: string }[];
}

export function ChannelsPage() {
  const can = useCan();
  const s = useSession();
  const manage = can('channels.manage') && s.account?.accessMode === 'full';
  const [open, setOpen] = useState<string | 'new' | null>(null);
  const list = useQuery({
    queryKey: ['channels'],
    queryFn: () => http.get<{ items: Channel[] }>('/channels?pageSize=100'),
  });
  const types = useQuery({
    queryKey: ['channel-types'],
    queryFn: () => http.get<{ planned: string[]; note: string }>('/channels/types'),
  });
  return (
    <>
      <PageHeader
        title="Verkaufskanäle"
        description="Shops und Marktplätze anbinden. Bestellungen kommen als Aufträge an, Bestände und Preise stehen dem Kanal zur Verfügung."
        actions={
          manage && (
            <Button onClick={() => setOpen('new')}>
              <Plus /> Kanal anlegen
            </Button>
          )
        }
      />
      {!list.data ? (
        <Spinner />
      ) : list.data.items.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted">Noch kein Verkaufskanal angelegt.</p>
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Kanal</TH>
              <TH>Art</TH>
              <TH>Status</TH>
              <TH className="text-right">Aufträge</TH>
              <TH>Letzte Übernahme</TH>
            </TR>
          </THead>
          <TBody>
            {list.data.items.map((c) => (
              <TR
                key={c.id}
                className="cursor-pointer hover:bg-surface-2"
                onClick={() => setOpen(c.id)}
              >
                <TD>
                  <Store className="mr-1 inline size-4" /> {c.name}
                </TD>
                <TD>Eigener Shop über API</TD>
                <TD>
                  {!c.active ? (
                    <Badge>Deaktiviert</Badge>
                  ) : c.status === 'error' ? (
                    <Badge tone="danger">Fehler</Badge>
                  ) : (
                    <Badge tone="success">OK</Badge>
                  )}
                </TD>
                <TD className="text-right tabular-nums">{c.orderCount ?? 0}</TD>
                <TD>{formatDateTime(c.lastSyncAt)}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
      {types.data && (
        <Card>
          <CardBody>
            <p className="text-sm font-semibold">Geplante Anbindungen</p>
            <p className="mt-1 text-sm text-muted">{types.data.planned.join(' · ')}</p>
            <p className="mt-1 text-xs text-muted">{types.data.note}</p>
          </CardBody>
        </Card>
      )}
      {open === 'new' && <ChannelForm channel={null} onClose={() => setOpen(null)} />}
      {open && open !== 'new' && (
        <ChannelDialog id={open} manage={manage} onClose={() => setOpen(null)} />
      )}
    </>
  );
}

function ChannelForm({ channel, onClose }: { channel: Channel | null; onClose: () => void }) {
  const qc = useQueryClient();
  const md = useMasterData().data;
  const [v, setV] = useState({
    name: channel?.name ?? '',
    warehouseId: channel?.warehouseId ?? '',
    active: channel?.active ?? true,
    listedOnly: channel?.config.listedOnly ?? false,
  });
  const f = useSubmit(
    () => {
      const body = { type: 'api', ...v, warehouseId: v.warehouseId || null };
      return channel ? http.put(`/channels/${channel.id}`, body) : http.post('/channels', body);
    },
    async () => {
      await qc.invalidateQueries({ queryKey: ['channels'] });
      await qc.invalidateQueries({ queryKey: ['channel'] });
      onClose();
    },
  );
  return (
    <Dialog
      open
      onClose={onClose}
      title={channel ? 'Kanal bearbeiten' : 'Kanal anlegen'}
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
        <Field label="Name" error={f.fieldErrors.name}>
          {(p) => (
            <Input {...p} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
          )}
        </Field>
        <Field label="Lager für diesen Kanal">
          {(p) => (
            <Select
              {...p}
              value={v.warehouseId}
              onChange={(e) => setV({ ...v, warehouseId: e.target.value })}
            >
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
        <Checkbox
          label="Aktiv (Bestellungen annehmen)"
          checked={v.active}
          onChange={(e) => setV({ ...v, active: e.target.checked })}
        />
        <Checkbox
          label="Nur ausdrücklich gelistete Artikel an den Kanal geben"
          description="Sonst alle aktiven Artikel"
          checked={v.listedOnly}
          onChange={(e) => setV({ ...v, listedOnly: e.target.checked })}
        />
      </div>
    </Dialog>
  );
}

function ChannelDialog({
  id,
  manage,
  onClose,
}: {
  id: string;
  manage: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [edit, setEdit] = useState(false);
  const q = useQuery({
    queryKey: ['channel', id],
    queryFn: () => http.get<ChannelDetail>(`/channels/${id}`),
  });
  const listings = useQuery({
    queryKey: ['channel-listings', id],
    queryFn: () =>
      http.get<
        {
          articleId: string;
          active: boolean;
          priceNet: string | null;
          article: { number: string; name: string; salePriceNet: string } | null;
        }[]
      >(`/channels/${id}/listings`),
  });
  const [price, setPrice] = useState('');
  const [error, setError] = useState<string | null>(null);
  if (edit && q.data) return <ChannelForm channel={q.data} onClose={() => setEdit(false)} />;
  const c = q.data;
  const base = `${window.location.origin}/api/v1/channels/${id}`;
  const setListing = async (
    articleId: string,
    body: { active: boolean; priceNet: string | null },
  ) => {
    setError(null);
    try {
      await http.put(`/channels/${id}/listings/${articleId}`, body);
      await qc.invalidateQueries({ queryKey: ['channel-listings', id] });
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  return (
    <Dialog
      open
      wide
      onClose={onClose}
      title={c?.name ?? 'Kanal'}
      description="Eigener Shop über API"
    >
      {!c ? (
        <Spinner />
      ) : (
        <div className="space-y-4">
          {manage && (
            <Button size="sm" variant="secondary" onClick={() => setEdit(true)}>
              Bearbeiten
            </Button>
          )}
          {c.lastError && <Alert tone="danger">Letzter Fehler: {c.lastError}</Alert>}
          {error && <Alert tone="danger">{error}</Alert>}
          <Card>
            <CardBody>
              <p className="mb-2 font-semibold">So bindet Ihr Shop den Kanal an</p>
              <p className="text-sm text-muted">
                Legen Sie unter „API-Schlüssel“ einen Schlüssel mit den Rechten Verkaufskanäle
                ansehen, Aufträge ansehen/anlegen und Lager ansehen an. Der Shop sendet ihn als
                <code className="mx-1">Authorization: Bearer fe_live_…</code>.
              </p>
              <ul className="mt-2 space-y-1 font-mono text-xs">
                <li>
                  POST {base}/orders – Bestellung übergeben (doppelte Übergabe liefert den
                  vorhandenen Auftrag)
                </li>
                <li>GET {base}/stock – verfügbare Bestände und Preise</li>
                <li>
                  GET {base}/orders/&#123;Bestellnummer&#125; – Status, Versand, Trackingnummern
                </li>
              </ul>
              <Button
                size="sm"
                variant="ghost"
                className="mt-2"
                onClick={() => void navigator.clipboard?.writeText(base)}
              >
                <Copy /> Adresse kopieren
              </Button>
              <p className="mt-2 text-xs text-muted">
                Die vollständige Beschreibung steht in der API-Dokumentation unter /api/docs.
              </p>
            </CardBody>
          </Card>
          <div>
            <p className="mb-2 font-semibold">
              Artikel im Kanal
              {c.config.listedOnly
                ? ' (nur diese werden angeboten)'
                : ' (abweichende Preise oder deaktiviert)'}
            </p>
            <Table>
              <THead>
                <TR>
                  <TH>Artikel</TH>
                  <TH className="text-right">Standardpreis</TH>
                  <TH className="text-right">Preis im Kanal</TH>
                  <TH>Aktiv</TH>
                </TR>
              </THead>
              <TBody>
                {listings.data?.map((l) => (
                  <TR key={l.articleId}>
                    <TD>
                      {l.article?.number} · {l.article?.name}
                    </TD>
                    <TD className="text-right tabular-nums">
                      {formatMoney(l.article?.salePriceNet)}
                    </TD>
                    <TD className="text-right tabular-nums">
                      {l.priceNet ? formatMoney(l.priceNet) : '–'}
                    </TD>
                    <TD>
                      <Checkbox
                        label={<span className="sr-only">aktiv</span>}
                        disabled={!manage}
                        checked={l.active}
                        onChange={(e) =>
                          void setListing(l.articleId, {
                            active: e.target.checked,
                            priceNet: l.priceNet,
                          })
                        }
                      />
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            {manage && (
              <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_160px] sm:items-end">
                <SearchPicker<ArticlePick>
                  label="Artikel hinzufügen"
                  queryKey="channel-articles"
                  value={null}
                  onChange={(a) =>
                    a && void setListing(a.id, { active: true, priceNet: price || null })
                  }
                  search={searchArticles}
                  toItem={articleItem}
                />
                <Field label="Preis netto (optional)">
                  {(p) => (
                    <Input
                      {...p}
                      value={price}
                      onChange={(e) => setPrice(e.target.value)}
                      placeholder={toInput('0.00')}
                    />
                  )}
                </Field>
              </div>
            )}
          </div>
          <div>
            <p className="mb-2 font-semibold">Protokoll</p>
            <ul className="max-h-64 space-y-1 overflow-y-auto text-sm">
              {c.logs.map((l) => (
                <li key={l.id}>
                  <span className="text-muted">{formatDateTime(l.createdAt)}</span>{' '}
                  <Badge
                    tone={
                      l.level === 'error' ? 'danger' : l.level === 'warning' ? 'warning' : 'neutral'
                    }
                  >
                    {l.level === 'error' ? 'Fehler' : l.level === 'warning' ? 'Warnung' : 'Info'}
                  </Badge>{' '}
                  {l.message}
                </li>
              ))}
              {!c.logs.length && <li className="text-muted">Noch keine Einträge</li>}
            </ul>
          </div>
        </div>
      )}
    </Dialog>
  );
}

interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  permissions: string[];
  expiresAt: string | null;
  revokedAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
}

export function ApiKeysPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['api-keys'], queryFn: () => http.get<ApiKey[]>('/api-keys') });
  const [create, setCreate] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const revoke = async (id: string) => {
    setError(null);
    try {
      await http.post(`/api-keys/${id}/revoke`);
      await qc.invalidateQueries({ queryKey: ['api-keys'] });
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  return (
    <>
      <PageHeader
        title="API-Schlüssel"
        description="Zugänge für externe Systeme (Shop, Buchhaltung, eigene Programme). Jeder Schlüssel gilt nur für die aktive Firma und nur mit den gewählten Rechten."
        actions={
          <Button onClick={() => setCreate(true)}>
            <KeyRound /> Schlüssel anlegen
          </Button>
        }
      />
      {error && <Alert tone="danger">{error}</Alert>}
      {token && (
        <Alert
          tone="warning"
          title="Schlüssel jetzt kopieren – er wird nur dieses eine Mal angezeigt"
        >
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <code className="break-all rounded bg-surface-2 px-2 py-1 text-sm">{token}</code>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void navigator.clipboard?.writeText(token)}
            >
              <Copy /> Kopieren
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setToken(null)}>
              Erledigt
            </Button>
          </div>
        </Alert>
      )}
      {!q.data ? (
        <Spinner />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Name</TH>
              <TH>Schlüssel</TH>
              <TH>Rechte</TH>
              <TH>Zuletzt genutzt</TH>
              <TH>Gültig bis</TH>
              <TH />
            </TR>
          </THead>
          <TBody>
            {q.data.map((k) => (
              <TR key={k.id} className={k.revokedAt ? 'opacity-60' : ''}>
                <TD>{k.name}</TD>
                <TD className="font-mono text-xs">{k.prefix}…</TD>
                <TD className="text-xs">{k.permissions.join(', ')}</TD>
                <TD>{formatDateTime(k.lastUsedAt)}</TD>
                <TD>{k.expiresAt ? formatDate(k.expiresAt) : 'unbegrenzt'}</TD>
                <TD>
                  {k.revokedAt ? (
                    <Badge>Gesperrt</Badge>
                  ) : (
                    <Button size="sm" variant="ghost" onClick={() => void revoke(k.id)}>
                      Sperren
                    </Button>
                  )}
                </TD>
              </TR>
            ))}
            {!q.data.length && (
              <TR>
                <TD colSpan={6} className="text-center text-muted">
                  Noch keine API-Schlüssel
                </TD>
              </TR>
            )}
          </TBody>
        </Table>
      )}
      {create && (
        <ApiKeyDialog
          onClose={() => setCreate(false)}
          onCreated={async (t) => {
            setToken(t);
            setCreate(false);
            await qc.invalidateQueries({ queryKey: ['api-keys'] });
          }}
        />
      )}
    </>
  );
}

function ApiKeyDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (token: string) => Promise<void>;
}) {
  const perms = useQuery({
    queryKey: ['api-key-perms'],
    queryFn: () =>
      http.get<{ key: string; label: string; module: string }[]>('/api-keys/permissions'),
  });
  const [name, setName] = useState('');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [expiresAt, setExpiresAt] = useState('');
  const f = useSubmit(
    () =>
      http.post<{ token: string }>('/api-keys', {
        name,
        permissions: [...sel],
        expiresAt: expiresAt || null,
      }),
    (r) => onCreated(r.token),
  );
  return (
    <Dialog
      open
      wide
      onClose={onClose}
      title="API-Schlüssel anlegen"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Abbrechen
          </Button>
          <Button loading={f.pending} onClick={() => f.submit(undefined)}>
            Anlegen
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {f.error && <Alert tone="danger">{f.error}</Alert>}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name" hint="z. B. „Webshop“" error={f.fieldErrors.name}>
            {(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} />}
          </Field>
          <Field label="Gültig bis (optional)">
            {(p) => (
              <Input
                {...p}
                type="date"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
              />
            )}
          </Field>
        </div>
        <p className="text-sm font-medium">Rechte</p>
        {!perms.data ? (
          <Spinner />
        ) : (
          <div className="grid gap-1 sm:grid-cols-2">
            {perms.data.map((p) => (
              <Checkbox
                key={p.key}
                label={p.label}
                description={p.key}
                checked={sel.has(p.key)}
                onChange={(e) => {
                  const n = new Set(sel);
                  if (e.target.checked) n.add(p.key);
                  else n.delete(p.key);
                  setSel(n);
                }}
              />
            ))}
          </div>
        )}
        <p className="text-xs text-muted">
          Der Schlüssel handelt in Ihrem Namen: Verlieren Sie selbst ein Recht, verliert es auch der
          Schlüssel.
        </p>
      </div>
    </Dialog>
  );
}
