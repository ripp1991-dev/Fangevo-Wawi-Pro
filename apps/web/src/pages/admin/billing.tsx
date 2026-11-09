import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Download } from 'lucide-react';
import { useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
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
import { ADDON_STATUS, PLATFORM_INVOICE_STATUS, SUBSCRIPTION_STATUS } from '@fangevo/shared';
import { formData, useSubmit } from '../../components/use-form';
import { errorMessage, http } from '../../lib/api';
import { formatDate } from '../../lib/format';
import { openPdf } from '../../lib/sales';
import { useRefreshSession } from '../../lib/session';

interface Subscription {
  plan: string;
  interval: 'month' | 'year';
  status: keyof typeof SUBSCRIPTION_STATUS;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  scheduledPlan: string | null;
  scheduledInterval: string | null;
  suspendedAt: string | null;
  billingName: string | null;
  billingStreet: string | null;
  billingPostalCode: string | null;
  billingCity: string | null;
  billingCountry: string;
  billingVatId: string | null;
  billingEmail: string | null;
}

interface Overview {
  subscription: Subscription;
  trialEndsAt: string | null;
  entitlementStatus: string;
  billingComplete: boolean;
  missingDetails: string[];
  pricesArePreliminary: boolean;
  paymentInfo: {
    iban: string | null;
    bic: string | null;
    bankName: string | null;
    issuerConfigured: boolean;
  };
  plans: {
    key: string;
    name: string;
    monthlyEur: number | null;
    yearlyEur: number | null;
    modules: string[];
    selfService: boolean;
  }[];
  addons: {
    module: string;
    name: string;
    status: keyof typeof ADDON_STATUS;
    trialEndsAt: string | null;
    endsAt: string | null;
    usable: boolean;
  }[];
  invoices: {
    id: string;
    number: string;
    periodStart: string;
    periodEnd: string;
    totalNet: string;
    totalGross: string;
    status: keyof typeof PLATFORM_INVOICE_STATUS;
    issuedAt: string;
    dueDate: string;
    paidAt: string | null;
  }[];
}

const eur = (v: string | number) =>
  new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(Number(v));

export function BillingPage() {
  const qc = useQueryClient();
  const refresh = useRefreshSession();
  const q = useQuery({ queryKey: ['billing'], queryFn: () => http.get<Overview>('/billing') });
  const [choose, setChoose] = useState<'activate' | 'change' | null>(null);
  const [editDetails, setEditDetails] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const reload = async () => {
    await qc.invalidateQueries({ queryKey: ['billing'] });
    await qc.invalidateQueries({ queryKey: ['license'] });
    await qc.invalidateQueries({ queryKey: ['marketplace'] });
    await refresh();
  };
  const act = async (path: string, msg: string) => {
    setError(null);
    setInfo(null);
    try {
      await http.post(path);
      setInfo(msg);
      await reload();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  if (q.isPending) return <Spinner />;
  if (q.isError) return <Alert tone="danger">{errorMessage(q.error)}</Alert>;
  const o = q.data;
  const s = o.subscription;
  const plan = o.plans.find((p) => p.key === s.plan);
  const paying = s.status === 'active' || s.status === 'past_due';
  const price = plan ? (s.interval === 'year' ? plan.yearlyEur : plan.monthlyEur) : null;

  return (
    <>
      <PageHeader
        title="Abo & Rechnungen"
        description="Paket, Laufzeit, Zusatzmodule und Ihre Rechnungen von FangEvo."
      />
      {error && <Alert tone="danger">{error}</Alert>}
      {info && <Alert tone="success">{info}</Alert>}
      {o.pricesArePreliminary && (
        <Alert tone="info" title="Vorläufige Preise">
          Die Preise sind noch nicht endgültig kalkuliert. Alle Preise zzgl. gesetzlicher
          Umsatzsteuer.
        </Alert>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader
            title={`Paket ${plan?.name ?? s.plan}`}
            description={
              price !== null
                ? `${eur(price)} netto / ${s.interval === 'year' ? 'Jahr' : 'Monat'}`
                : 'Individuell vereinbart'
            }
          />
          <CardBody className="space-y-3 text-sm">
            <p>
              Status:{' '}
              <Badge
                tone={
                  s.status === 'active'
                    ? 'success'
                    : s.status === 'trialing'
                      ? 'primary'
                      : 'warning'
                }
              >
                {SUBSCRIPTION_STATUS[s.status] ?? s.status}
              </Badge>
              {s.suspendedAt && (
                <Badge tone="danger" className="ml-2">
                  Von FangEvo gesperrt
                </Badge>
              )}
            </p>
            {s.status === 'trialing' && o.trialEndsAt && (
              <p className="text-muted">
                Ihre kostenlose Testphase endet am {formatDate(o.trialEndsAt)}. Danach können Sie
                Ihre Daten weiter ansehen, aber erst nach Aktivierung wieder ändern.
              </p>
            )}
            {paying && s.currentPeriodEnd && (
              <p className="text-muted">
                Laufzeit bis {formatDate(s.currentPeriodEnd)} –{' '}
                {s.cancelAtPeriodEnd ? (
                  <strong className="text-warning">gekündigt, endet dann</strong>
                ) : (
                  'verlängert sich automatisch'
                )}
              </p>
            )}
            {(s.scheduledPlan || s.scheduledInterval) && (
              <Alert tone="info">
                Zum {formatDate(s.currentPeriodEnd)} wechseln Sie zu{' '}
                <strong>
                  {o.plans.find((p) => p.key === (s.scheduledPlan ?? s.plan))?.name}
                  {s.scheduledInterval &&
                    ` (${s.scheduledInterval === 'year' ? 'jährlich' : 'monatlich'})`}
                </strong>
                .
              </Alert>
            )}
            {s.status === 'past_due' && (
              <Alert tone="warning" title="Zahlung offen">
                Mindestens eine Rechnung ist überfällig. Bitte überweisen Sie den offenen Betrag.
                Nach 30 Tagen Verzug kann der Account nur noch gelesen werden.
              </Alert>
            )}
            <div className="flex flex-wrap gap-2 pt-2">
              {(s.status === 'trialing' || s.status === 'canceled') && (
                <Button onClick={() => setChoose('activate')}>Abo kostenpflichtig starten</Button>
              )}
              {s.status !== 'canceled' && (
                <Button variant="secondary" onClick={() => setChoose('change')}>
                  Paket wechseln
                </Button>
              )}
              {s.status !== 'canceled' && !s.cancelAtPeriodEnd && (
                <Button
                  variant="ghost"
                  onClick={() => {
                    if (
                      window.confirm(
                        paying
                          ? `Abo zum ${formatDate(s.currentPeriodEnd)} kündigen? Ihre Daten bleiben erhalten.`
                          : 'Testphase beenden? Nach dem Testende ist der Account nur noch lesbar.',
                      )
                    )
                      void act('/billing/cancel', 'Das Abo wurde gekündigt.');
                  }}
                >
                  Kündigen
                </Button>
              )}
              {s.cancelAtPeriodEnd && s.status !== 'canceled' && (
                <Button
                  variant="secondary"
                  onClick={() =>
                    void act('/billing/reactivate', 'Die Kündigung wurde zurückgenommen.')
                  }
                >
                  Kündigung zurücknehmen
                </Button>
              )}
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Rechnungsdaten"
            description="Diese Angaben stehen auf Ihren FangEvo-Rechnungen."
            actions={
              <Button size="sm" variant="secondary" onClick={() => setEditDetails(true)}>
                Bearbeiten
              </Button>
            }
          />
          <CardBody className="space-y-1 text-sm">
            {!o.billingComplete && (
              <Alert tone="warning">Es fehlen noch: {o.missingDetails.join(', ')}</Alert>
            )}
            <p className="font-medium">{s.billingName ?? '–'}</p>
            <p>{s.billingStreet}</p>
            <p>
              {s.billingPostalCode} {s.billingCity} {s.billingCountry !== 'DE' && s.billingCountry}
            </p>
            {s.billingVatId && <p>USt-IdNr.: {s.billingVatId}</p>}
            <p className="text-muted">Rechnungen per E-Mail an: {s.billingEmail ?? '–'}</p>
            <p className="pt-2 text-muted">
              Zahlungsart: Rechnung / Überweisung (14 Tage)
              {o.paymentInfo.iban && ` · IBAN ${o.paymentInfo.iban}`}
            </p>
          </CardBody>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader
          title="Zusatzmodule"
          description="Einzeln gebuchte Module. Buchen und kündigen Sie Module im Marketplace."
        />
        <CardBody>
          {o.addons.filter((a) => a.usable).length === 0 ? (
            <p className="text-sm text-muted">Keine Zusatzmodule gebucht.</p>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {o.addons
                .filter((a) => a.usable)
                .map((a) => (
                  <li key={a.module} className="flex items-center justify-between py-2">
                    <span className="flex items-center gap-2">
                      {a.usable && <CheckCircle2 className="size-4 text-success" />}
                      {a.name}
                    </span>
                    <span className="text-muted">
                      <Badge>{ADDON_STATUS[a.status] ?? a.status}</Badge>{' '}
                      {a.status === 'trial' && a.trialEndsAt && `bis ${formatDate(a.trialEndsAt)}`}
                      {a.status === 'canceled' && a.endsAt && `endet ${formatDate(a.endsAt)}`}
                    </span>
                  </li>
                ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card className="mt-4">
        <CardHeader title="Rechnungen" />
        <CardBody>
          <Table>
            <THead>
              <TR>
                <TH>Nummer</TH>
                <TH>Datum</TH>
                <TH>Zeitraum</TH>
                <TH className="text-right">Netto</TH>
                <TH className="text-right">Brutto</TH>
                <TH>Fällig</TH>
                <TH>Status</TH>
                <TH />
              </TR>
            </THead>
            <TBody>
              {o.invoices.map((i) => (
                <TR key={i.id}>
                  <TD className="font-medium">{i.number}</TD>
                  <TD>{formatDate(i.issuedAt)}</TD>
                  <TD>
                    {formatDate(i.periodStart)} – {formatDate(i.periodEnd)}
                  </TD>
                  <TD className="text-right">{eur(i.totalNet)}</TD>
                  <TD className="text-right">{eur(i.totalGross)}</TD>
                  <TD>{formatDate(i.dueDate)}</TD>
                  <TD>
                    <Badge
                      tone={
                        i.status === 'paid'
                          ? 'success'
                          : i.status === 'open'
                            ? 'warning'
                            : 'neutral'
                      }
                    >
                      {PLATFORM_INVOICE_STATUS[i.status] ?? i.status}
                    </Badge>
                  </TD>
                  <TD>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Rechnung ${i.number} als PDF öffnen`}
                      onClick={() =>
                        void openPdf(`/billing/invoices/${i.id}/pdf`).catch((e) =>
                          setError(errorMessage(e)),
                        )
                      }
                    >
                      <Download /> PDF
                    </Button>
                  </TD>
                </TR>
              ))}
              {!o.invoices.length && (
                <TR>
                  <TD colSpan={8} className="text-center text-muted">
                    Noch keine Rechnungen
                  </TD>
                </TR>
              )}
            </TBody>
          </Table>
        </CardBody>
      </Card>

      {choose && (
        <PlanDialog
          mode={choose}
          overview={o}
          onClose={() => setChoose(null)}
          onDone={async (msg) => {
            setChoose(null);
            setInfo(msg);
            await reload();
          }}
        />
      )}
      {editDetails && (
        <DetailsDialog
          s={s}
          onClose={() => setEditDetails(false)}
          onDone={async () => {
            setEditDetails(false);
            await reload();
          }}
        />
      )}
    </>
  );
}

function PlanDialog({
  mode,
  overview,
  onClose,
  onDone,
}: {
  mode: 'activate' | 'change';
  overview: Overview;
  onClose: () => void;
  onDone: (msg: string) => Promise<void>;
}) {
  const s = overview.subscription;
  const [plan, setPlan] = useState(mode === 'activate' ? s.plan : '');
  const [interval, setInterval] = useState<'month' | 'year'>(s.interval);
  const f = useSubmit(
    () =>
      http.post<{ effective?: 'now' | 'period_end' }>(
        mode === 'activate' ? '/billing/activate' : '/billing/plan',
        { plan, interval },
      ),
    async (r) =>
      onDone(
        mode === 'activate'
          ? 'Ihr Abo ist aktiv. Die Rechnung wurde per E-Mail versendet.'
          : r.effective === 'period_end'
            ? 'Der Wechsel erfolgt zum Laufzeitende.'
            : 'Das Paket wurde gewechselt.',
      ),
  );
  const paying = s.status === 'active' || s.status === 'past_due';
  return (
    <Dialog
      open
      wide
      onClose={onClose}
      title={mode === 'activate' ? 'Abo starten' : 'Paket wechseln'}
      description={
        paying
          ? 'Hochstufen gilt sofort (anteilige Rechnung bis Laufzeitende). Herabstufen und Wechsel zwischen monatlich/jährlich gelten ab dem nächsten Zeitraum.'
          : mode === 'activate'
            ? 'Die erste Rechnung wird sofort erstellt und per E-Mail versendet. Zahlung per Überweisung innerhalb von 14 Tagen.'
            : 'Während der Testphase können Sie das Paket kostenlos wechseln.'
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Abbrechen
          </Button>
          <Button disabled={!plan || f.pending} onClick={() => f.submit(undefined)}>
            {mode === 'activate' ? 'Kostenpflichtig bestellen' : 'Wechseln'}
          </Button>
        </>
      }
    >
      {f.error && <Alert tone="danger">{f.error}</Alert>}
      {mode === 'activate' && !overview.billingComplete && (
        <Alert tone="warning">
          Bitte zuerst die Rechnungsdaten vervollständigen: {overview.missingDetails.join(', ')}
        </Alert>
      )}
      <div className="mb-4 flex gap-2" role="radiogroup" aria-label="Abrechnung">
        {(['month', 'year'] as const).map((i) => (
          <Button
            key={i}
            size="sm"
            variant={interval === i ? 'primary' : 'secondary'}
            aria-pressed={interval === i}
            onClick={() => setInterval(i)}
          >
            {i === 'month' ? 'Monatlich' : 'Jährlich (2 Monate gratis)'}
          </Button>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {overview.plans.map((p) => {
          const current = p.key === s.plan && interval === s.interval && mode === 'change';
          const price = interval === 'year' ? p.yearlyEur : p.monthlyEur;
          return (
            <button
              key={p.key}
              type="button"
              disabled={!p.selfService || current}
              aria-pressed={plan === p.key}
              onClick={() => setPlan(p.key)}
              className={`rounded-xl border p-4 text-left transition ${
                plan === p.key ? 'border-primary ring-2 ring-primary/30' : 'border-border'
              } ${!p.selfService || current ? 'opacity-60' : 'hover:border-primary/60'}`}
            >
              <p className="font-semibold">
                {p.name} {current && <Badge>aktuell</Badge>}
              </p>
              <p className="text-sm">
                {price !== null
                  ? `${eur(price)} netto / ${interval === 'year' ? 'Jahr' : 'Monat'}`
                  : 'Preis auf Anfrage'}
              </p>
              <p className="mt-1 text-xs text-muted">{p.modules.length} Module inklusive</p>
            </button>
          );
        })}
      </div>
    </Dialog>
  );
}

function DetailsDialog({
  s,
  onClose,
  onDone,
}: {
  s: Subscription;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const f = useSubmit((d: Record<string, string>) => http.put('/billing/details', d), onDone);
  return (
    <Dialog open onClose={onClose} title="Rechnungsdaten">
      <form className="space-y-3" onSubmit={(e) => f.submit(formData(e))}>
        {f.error && <Alert tone="danger">{f.error}</Alert>}
        <Field label="Firma / Name" error={f.fieldErrors.billingName}>
          {(p) => <Input {...p} name="billingName" defaultValue={s.billingName ?? ''} required />}
        </Field>
        <Field label="Straße und Hausnummer" error={f.fieldErrors.billingStreet}>
          {(p) => (
            <Input {...p} name="billingStreet" defaultValue={s.billingStreet ?? ''} required />
          )}
        </Field>
        <div className="grid grid-cols-[1fr_2fr] gap-3">
          <Field label="PLZ" error={f.fieldErrors.billingPostalCode}>
            {(p) => (
              <Input
                {...p}
                name="billingPostalCode"
                defaultValue={s.billingPostalCode ?? ''}
                required
              />
            )}
          </Field>
          <Field label="Ort" error={f.fieldErrors.billingCity}>
            {(p) => <Input {...p} name="billingCity" defaultValue={s.billingCity ?? ''} required />}
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Land" error={f.fieldErrors.billingCountry}>
            {(p) => (
              <Select {...p} name="billingCountry" defaultValue={s.billingCountry}>
                <option value="DE">Deutschland</option>
                <option value="AT">Österreich</option>
                <option value="CH">Schweiz</option>
                <option value="NL">Niederlande</option>
                <option value="DK">Dänemark</option>
              </Select>
            )}
          </Field>
          <Field
            label="USt-IdNr. (optional)"
            hint="Für Kunden in der EU außerhalb Deutschlands"
            error={f.fieldErrors.billingVatId}
          >
            {(p) => <Input {...p} name="billingVatId" defaultValue={s.billingVatId ?? ''} />}
          </Field>
        </div>
        <Field label="E-Mail für Rechnungen" error={f.fieldErrors.billingEmail}>
          {(p) => (
            <Input
              {...p}
              name="billingEmail"
              type="email"
              defaultValue={s.billingEmail ?? ''}
              required
            />
          )}
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Abbrechen
          </Button>
          <Button type="submit" disabled={f.pending}>
            Speichern
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
