import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Play, Search } from 'lucide-react';
import { useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
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
import { PLATFORM_INVOICE_STATUS, SUBSCRIPTION_STATUS, SUPPORT_STATUS } from '@fangevo/shared';
import { Tabs } from '../../components/tabs';
import { useSubmit } from '../../components/use-form';
import { errorMessage, http } from '../../lib/api';
import { formatDate, formatDateTime } from '../../lib/format';
import { openPdf } from '../../lib/sales';
import { useSession } from '../../lib/session';
import { TicketView, statusTone } from './support';

interface DirAccount {
  accountId: string;
  name: string;
  ownerEmail: string | null;
  plan: string;
  status: string;
  createdAt: string;
}

interface AccountDetail extends DirAccount {
  entitlement: {
    plan: string;
    status: string;
    modules: string[];
    maxCompanies: number;
    trialEndsAt: string | null;
    validUntil: string | null;
  } | null;
  subscription: {
    plan: string;
    interval: string;
    status: keyof typeof SUBSCRIPTION_STATUS;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
    suspendedAt: string | null;
    extraCompanies: number;
    billingEmail: string | null;
  } | null;
  addons: { module: string; status: string; trialEndsAt: string | null; endsAt: string | null }[];
  invoices: {
    id: string;
    number: string;
    totalGross: string;
    status: keyof typeof PLATFORM_INVOICE_STATUS;
    issuedAt: string;
    dueDate: string;
  }[];
  events: { id: string; actor: string; createdAt: string; change: unknown }[];
  usage: { companies: number; users: number };
}

interface InboxRow {
  ticketId: string;
  accountId: string;
  accountName: string;
  number?: string;
  subject?: string;
  status: string;
  priority: string;
  updatedAt: string;
}

const eur = (v: string) =>
  new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(Number(v));

export function PlatformPage() {
  const s = useSession();
  const [tab, setTab] = useState<'accounts' | 'support'>('accounts');
  const me = useQuery({
    queryKey: ['platform', 'me'],
    queryFn: () => http.get('/platform/me'),
    retry: false,
  });
  if (!s.platformAdmin) return <Alert tone="danger">Nur für FangEvo-Mitarbeiter.</Alert>;
  if (me.isPending) return <Spinner />;
  if (me.isError)
    return (
      <Alert tone="warning" title="Zugang nicht möglich">
        {errorMessage(me.error)} Die Zwei-Faktor-Anmeldung richten Sie unter „Profil & Sicherheit“
        ein.
      </Alert>
    );
  return (
    <>
      <PageHeader
        title="Plattform-Verwaltung"
        description="Nur für FangEvo-Mitarbeiter. Alle Änderungen werden im Audit-Log des Kunden protokolliert."
      />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'accounts' as const, label: 'Accounts & Lizenzen' },
          { id: 'support' as const, label: 'Support-Postfach' },
        ]}
      />
      <div className="mt-4">{tab === 'accounts' ? <Accounts /> : <Inbox />}</div>
    </>
  );
}

function Accounts() {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const list = useQuery({
    queryKey: ['platform', 'accounts', q],
    queryFn: () =>
      http.get<{ items: DirAccount[]; total: number }>(
        `/platform/accounts${q ? `?q=${encodeURIComponent(q)}` : ''}`,
      ),
  });
  const runBilling = async () => {
    setMsg(null);
    try {
      const r = await http.post<{ changed: number }>('/platform/billing-run');
      setMsg(`Abrechnungslauf abgeschlossen: ${r.changed} Account(s) geändert.`);
      await qc.invalidateQueries({ queryKey: ['platform'] });
    } catch (e) {
      setMsg(errorMessage(e));
    }
  };
  return (
    <div className="grid gap-4 xl:grid-cols-[2fr_3fr]">
      <Card>
        <CardHeader
          title={`Accounts (${list.data?.total ?? '…'})`}
          actions={
            <Button size="sm" variant="secondary" onClick={() => void runBilling()}>
              <Play /> Abrechnungslauf
            </Button>
          }
        />
        <CardBody className="space-y-3">
          {msg && <Alert tone="info">{msg}</Alert>}
          <div className="relative">
            <Search className="absolute left-3 top-2.5 size-4 text-muted" />
            <Input
              className="pl-9"
              placeholder="Name oder E-Mail suchen"
              aria-label="Accounts suchen"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          {!list.data ? (
            <Spinner />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Account</TH>
                  <TH>Paket</TH>
                  <TH>Status</TH>
                </TR>
              </THead>
              <TBody>
                {list.data.items.map((a) => (
                  <TR
                    key={a.accountId}
                    className={`cursor-pointer ${sel === a.accountId ? 'bg-surface-2' : ''}`}
                    onClick={() => setSel(a.accountId)}
                  >
                    <TD>
                      <button type="button" className="text-left font-medium hover:underline">
                        {a.name}
                      </button>
                      <p className="text-xs text-muted">{a.ownerEmail}</p>
                    </TD>
                    <TD>{a.plan}</TD>
                    <TD>
                      <Badge
                        tone={
                          a.status === 'ACTIVE'
                            ? 'success'
                            : a.status === 'TRIAL'
                              ? 'primary'
                              : 'warning'
                        }
                      >
                        {a.status}
                      </Badge>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>
      {sel && <AccountPanel key={sel} id={sel} />}
    </div>
  );
}

function AccountPanel({ id }: { id: string }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['platform', 'account', id],
    queryFn: () => http.get<AccountDetail>(`/platform/accounts/${id}`),
  });
  const [err, setErr] = useState<string | null>(null);
  const reload = () => qc.invalidateQueries({ queryKey: ['platform'] });
  const f = useSubmit(
    (body: Record<string, unknown>) => http.post(`/platform/accounts/${id}/license`, body),
    reload,
  );
  if (q.isPending) return <Spinner />;
  if (q.isError) return <Alert tone="danger">{errorMessage(q.error)}</Alert>;
  const a = q.data;
  const s = a.subscription;
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title={a.name}
          description={`${a.ownerEmail ?? ''} · seit ${formatDate(a.createdAt)}`}
        />
        <CardBody className="grid gap-2 text-sm sm:grid-cols-2">
          <p>
            Lizenz: <strong>{a.entitlement?.plan}</strong> · {a.entitlement?.status}
          </p>
          <p>
            Abo:{' '}
            {s ? (
              <>
                {SUBSCRIPTION_STATUS[s.status] ?? s.status} (
                {s.interval === 'year' ? 'jährlich' : 'monatlich'})
                {s.cancelAtPeriodEnd && ' · gekündigt'}
                {s.suspendedAt && ' · gesperrt'}
              </>
            ) : (
              'noch nicht angelegt'
            )}
          </p>
          <p>Laufzeit bis: {formatDate(s?.currentPeriodEnd)}</p>
          <p>Test bis: {formatDate(a.entitlement?.trialEndsAt)}</p>
          <p>
            Firmen: {a.usage.companies} / {a.entitlement?.maxCompanies} · Benutzer: {a.usage.users}
          </p>
          <p>Zusatzmodule: {a.addons.map((x) => `${x.module} (${x.status})`).join(', ') || '–'}</p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Lizenz ändern"
          description="Ohne Rechnung. Für Pilotkunden, Kulanz oder individuelle Vereinbarungen."
        />
        <CardBody>
          <form
            className="grid gap-3 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              const d = new FormData(e.currentTarget);
              const body: Record<string, unknown> = {};
              if (d.get('plan')) body.plan = d.get('plan');
              if (d.get('interval')) body.interval = d.get('interval');
              if (d.get('extraCompanies') !== '')
                body.extraCompanies = Number(d.get('extraCompanies'));
              if (d.get('extendTrialDays')) body.extendTrialDays = Number(d.get('extendTrialDays'));
              if (d.get('activateWithoutInvoice')) body.activateWithoutInvoice = true;
              const susp = d.get('suspended');
              if (susp) body.suspended = susp === 'yes';
              f.submit(body);
            }}
          >
            {f.error && (
              <div className="sm:col-span-2">
                <Alert tone="danger">{f.error}</Alert>
              </div>
            )}
            <Field label="Paket">
              {(p) => (
                <Select {...p} name="plan" defaultValue="">
                  <option value="">unverändert</option>
                  <option value="starter">Starter</option>
                  <option value="business">Business</option>
                  <option value="professional">Professional</option>
                  <option value="enterprise">Enterprise</option>
                </Select>
              )}
            </Field>
            <Field label="Abrechnung">
              {(p) => (
                <Select {...p} name="interval" defaultValue="">
                  <option value="">unverändert</option>
                  <option value="month">monatlich</option>
                  <option value="year">jährlich</option>
                </Select>
              )}
            </Field>
            <Field label="Zusätzliche Firmen">
              {(p) => (
                <Input
                  {...p}
                  name="extraCompanies"
                  type="number"
                  min={0}
                  defaultValue={s?.extraCompanies ?? 0}
                />
              )}
            </Field>
            <Field label="Testphase verlängern (Tage ab heute)">
              {(p) => <Input {...p} name="extendTrialDays" type="number" min={1} max={365} />}
            </Field>
            <Field label="Sperre">
              {(p) => (
                <Select {...p} name="suspended" defaultValue="">
                  <option value="">unverändert</option>
                  <option value="yes">sperren (nur lesen)</option>
                  <option value="no">entsperren</option>
                </Select>
              )}
            </Field>
            <div className="flex items-end">
              <Checkbox name="activateWithoutInvoice" label="Abo ohne Rechnung aktivieren" />
            </div>
            <div className="sm:col-span-2 flex justify-end">
              <Button type="submit" disabled={f.pending}>
                Übernehmen
              </Button>
            </div>
          </form>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Rechnungen" />
        <CardBody>
          {err && <Alert tone="danger">{err}</Alert>}
          <Table>
            <THead>
              <TR>
                <TH>Nummer</TH>
                <TH>Datum</TH>
                <TH className="text-right">Brutto</TH>
                <TH>Fällig</TH>
                <TH>Status</TH>
                <TH />
              </TR>
            </THead>
            <TBody>
              {a.invoices.map((i) => (
                <TR key={i.id}>
                  <TD className="whitespace-nowrap">{i.number}</TD>
                  <TD>{formatDate(i.issuedAt)}</TD>
                  <TD className="text-right">{eur(i.totalGross)}</TD>
                  <TD>{formatDate(i.dueDate)}</TD>
                  <TD>
                    <Badge tone={i.status === 'paid' ? 'success' : 'warning'}>
                      {PLATFORM_INVOICE_STATUS[i.status] ?? i.status}
                    </Badge>
                  </TD>
                  <TD className="flex gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Rechnung ${i.number} öffnen`}
                      onClick={() =>
                        void openPdf(`/platform/accounts/${id}/invoices/${i.id}/pdf`).catch((e) =>
                          setErr(errorMessage(e)),
                        )
                      }
                    >
                      <Download />
                    </Button>
                    {i.status === 'open' && (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={async () => {
                          setErr(null);
                          try {
                            await http.post(`/platform/accounts/${id}/invoices/${i.id}/paid`);
                            await reload();
                          } catch (e) {
                            setErr(errorMessage(e));
                          }
                        }}
                      >
                        Bezahlt
                      </Button>
                    )}
                  </TD>
                </TR>
              ))}
              {!a.invoices.length && (
                <TR>
                  <TD colSpan={6} className="text-center text-muted">
                    Keine Rechnungen
                  </TD>
                </TR>
              )}
            </TBody>
          </Table>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Lizenz-Verlauf" />
        <CardBody>
          <ul className="space-y-1 text-xs">
            {a.events.map((e) => (
              <li key={e.id}>
                {formatDateTime(e.createdAt)} · <span className="font-mono">{e.actor}</span>
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>
    </div>
  );
}

function Inbox() {
  const qc = useQueryClient();
  const [status, setStatus] = useState('');
  const [sel, setSel] = useState<string | null>(null);
  const [replyStatus, setReplyStatus] = useState('waiting_customer');
  const q = useQuery({
    queryKey: ['platform', 'support', status],
    queryFn: () => http.get<InboxRow[]>(`/platform/support${status ? `?status=${status}` : ''}`),
  });
  return (
    <div className="grid gap-4 xl:grid-cols-[2fr_3fr]">
      <Card>
        <CardHeader
          title="Anfragen"
          actions={
            <Select
              aria-label="Status filtern"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="">offen</option>
              {Object.entries(SUPPORT_STATUS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          }
        />
        <CardBody>
          {!q.data ? (
            <Spinner />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Anfrage</TH>
                  <TH>Account</TH>
                  <TH>Status</TH>
                </TR>
              </THead>
              <TBody>
                {q.data.map((r) => (
                  <TR
                    key={r.ticketId}
                    className={`cursor-pointer ${sel === r.ticketId ? 'bg-surface-2' : ''}`}
                    onClick={() => setSel(r.ticketId)}
                  >
                    <TD>
                      <button type="button" className="text-left hover:underline">
                        {r.number} {r.subject}
                      </button>
                      <p className="text-xs text-muted">
                        {formatDateTime(r.updatedAt)} · {r.priority}
                      </p>
                    </TD>
                    <TD>{r.accountName}</TD>
                    <TD>
                      <Badge tone={statusTone(r.status)}>
                        {SUPPORT_STATUS[r.status as keyof typeof SUPPORT_STATUS] ?? r.status}
                      </Badge>
                    </TD>
                  </TR>
                ))}
                {!q.data.length && (
                  <TR>
                    <TD colSpan={3} className="text-center text-muted">
                      Keine Anfragen
                    </TD>
                  </TR>
                )}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>
      {sel && (
        <TicketView
          key={sel}
          path={`/platform/support/${sel}`}
          replyPath={`/platform/support/${sel}/reply`}
          onChange={() => qc.invalidateQueries({ queryKey: ['platform', 'support'] })}
          extraReplyFields={
            <Field label="Status nach Antwort">
              {(p) => (
                <Select
                  {...p}
                  name="status"
                  value={replyStatus}
                  onChange={(e) => setReplyStatus(e.target.value)}
                >
                  <option value="waiting_customer">Wartet auf Kunden</option>
                  <option value="waiting_support">Bleibt beim Support</option>
                  <option value="closed">Erledigt</option>
                </Select>
              )}
            </Field>
          }
        />
      )}
    </div>
  );
}
