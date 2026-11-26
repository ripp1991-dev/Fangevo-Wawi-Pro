import { useQuery, useQueryClient } from '@tanstack/react-query';
import { PlugZap, Truck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Alert, Badge, Button, Card, CardBody, Checkbox, Field, Input, Select } from '@fangevo/ui';
import { DHL_PRINT_FORMATS } from '@fangevo/shared';
import { useSubmit } from '../../components/use-form';
import { errorMessage, http } from '../../lib/api';
import { formatDateTime } from '../../lib/format';

interface DhlAccountView {
  configured: boolean;
  env: 'sandbox' | 'production';
  account: {
    active: boolean;
    gkpUser: string;
    billingNumber: string;
    billingNumberInternational: string | null;
    printFormat: string;
    hasPassword: boolean;
    lastCheckedAt: string | null;
    lastError: string | null;
  } | null;
}

/** DHL-Zugang der Firma: Zugangsdaten des Geschäftskundenportals, Abrechnungsnummern, Etikettenformat. */
export function DhlCard() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['dhl-account'],
    queryFn: () => http.get<DhlAccountView>('/packing/carriers/dhl'),
  });
  const [v, setV] = useState({
    active: true,
    gkpUser: '',
    gkpPassword: '',
    billingNumber: '',
    billingNumberInternational: '',
    printFormat: '910-300-410',
  });
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger' | 'warning'; text: string } | null>(
    null,
  );
  const [testing, setTesting] = useState(false);
  const acc = q.data?.account;
  useEffect(() => {
    if (acc)
      setV({
        active: acc.active,
        gkpUser: acc.gkpUser,
        gkpPassword: '',
        billingNumber: acc.billingNumber,
        billingNumberInternational: acc.billingNumberInternational ?? '',
        printFormat: acc.printFormat,
      });
  }, [acc]);
  const f = useSubmit(
    () =>
      http.put('/packing/carriers/dhl', {
        ...v,
        gkpPassword: v.gkpPassword || null,
        billingNumberInternational: v.billingNumberInternational || null,
      }),
    async () => {
      setMsg({ tone: 'success', text: 'DHL-Zugang gespeichert.' });
      await qc.invalidateQueries({ queryKey: ['dhl-account'] });
    },
  );
  const test = async () => {
    setTesting(true);
    setMsg(null);
    try {
      const r = await http.post<{ ok: boolean; error: string | null; warnings: string[] }>(
        '/packing/carriers/dhl/test',
      );
      setMsg(
        r.ok
          ? {
              tone: r.warnings.length ? 'warning' : 'success',
              text:
                'Verbindung zu DHL ist in Ordnung.' +
                (r.warnings.length ? ` Hinweise von DHL: ${r.warnings.join('; ')}` : ''),
            }
          : { tone: 'danger', text: r.error ?? 'Verbindung fehlgeschlagen' },
      );
    } catch (e) {
      setMsg({ tone: 'danger', text: errorMessage(e) });
    } finally {
      setTesting(false);
      await qc.invalidateQueries({ queryKey: ['dhl-account'] });
    }
  };
  if (!q.data) return null;
  return (
    <Card>
      <CardBody>
        <div className="flex flex-wrap items-center gap-2">
          <Truck className="size-4" />
          <p className="font-semibold">Versanddienstleister: DHL Paket</p>
          {q.data.env === 'sandbox' ? (
            <Badge tone="warning">Testumgebung von DHL – keine echten Sendungen</Badge>
          ) : (
            <Badge tone="success">Echtbetrieb</Badge>
          )}
          {acc && !acc.lastError && acc.lastCheckedAt && (
            <span className="text-xs text-muted">geprüft {formatDateTime(acc.lastCheckedAt)}</span>
          )}
        </div>
        {!q.data.configured ? (
          <p className="mt-2 text-sm text-muted">
            DHL ist auf diesem Server noch nicht eingerichtet. Ihr Administrator findet die
            Anleitung in docs/DHL.md.
          </p>
        ) : (
          <div className="mt-3 space-y-3">
            <p className="text-sm text-muted">
              Mit der Versandart „DHL Paket“ holt der Packtisch nach „Fertig“ das Etikett direkt bei
              DHL und trägt die Sendungsnummer ein. Die Zugangsdaten sind die des Post &amp; DHL
              Geschäftskundenportals (am besten ein Systembenutzer).
            </p>
            {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
            {f.error && <Alert tone="danger">{f.error}</Alert>}
            {acc?.lastError && !msg && <Alert tone="danger">Letzte Prüfung: {acc.lastError}</Alert>}
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Benutzer (Geschäftskundenportal)" error={f.fieldErrors.gkpUser}>
                {(p) => (
                  <Input
                    {...p}
                    autoComplete="off"
                    value={v.gkpUser}
                    onChange={(e) => setV({ ...v, gkpUser: e.target.value })}
                  />
                )}
              </Field>
              <Field
                label="Passwort"
                hint={acc?.hasPassword ? 'Gespeichert. Leer lassen = unverändert' : undefined}
                error={f.fieldErrors.gkpPassword}
              >
                {(p) => (
                  <Input
                    {...p}
                    type="password"
                    autoComplete="new-password"
                    value={v.gkpPassword}
                    onChange={(e) => setV({ ...v, gkpPassword: e.target.value })}
                  />
                )}
              </Field>
              <Field
                label="Abrechnungsnummer DHL Paket (national)"
                hint="14 Zeichen: Kundennummer (EKP) + 01 + Teilnahme"
                error={f.fieldErrors.billingNumber}
              >
                {(p) => (
                  <Input
                    {...p}
                    value={v.billingNumber}
                    onChange={(e) => setV({ ...v, billingNumber: e.target.value })}
                  />
                )}
              </Field>
              <Field
                label="Abrechnungsnummer DHL Paket International (optional)"
                hint="Für EU-Versand: EKP + 53 + Teilnahme"
                error={f.fieldErrors.billingNumberInternational}
              >
                {(p) => (
                  <Input
                    {...p}
                    value={v.billingNumberInternational}
                    onChange={(e) => setV({ ...v, billingNumberInternational: e.target.value })}
                  />
                )}
              </Field>
              <Field label="Etikettenformat">
                {(p) => (
                  <Select
                    {...p}
                    value={v.printFormat}
                    onChange={(e) => setV({ ...v, printFormat: e.target.value })}
                  >
                    {Object.entries(DHL_PRINT_FORMATS).map(([k, l]) => (
                      <option key={k} value={k}>
                        {l}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </div>
            <Checkbox
              label="DHL verwenden"
              checked={v.active}
              onChange={(e) => setV({ ...v, active: e.target.checked })}
            />
            <div className="flex flex-wrap gap-2">
              <Button size="sm" loading={f.pending} onClick={() => f.submit(undefined)}>
                Speichern
              </Button>
              <Button
                size="sm"
                variant="secondary"
                loading={testing}
                disabled={!acc?.hasPassword}
                onClick={() => void test()}
              >
                <PlugZap /> Verbindung prüfen
              </Button>
            </div>
            <p className="text-xs text-muted">
              Derzeit: Deutschland und EU, ein Paket je Auftrag. Andere Länder (mit Zollangaben) und
              mehrere Pakete bitte weiter über „Manuell“.
            </p>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
