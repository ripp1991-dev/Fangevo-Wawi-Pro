import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Monitor, ShieldCheck } from 'lucide-react';
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
  Spinner,
} from '@fangevo/ui';
import { formData, useSubmit } from '../../components/use-form';
import { http } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import { useCan, useRefreshSession, useSession } from '../../lib/session';

export function SecurityPage() {
  const s = useSession();
  const can = useCan();
  return (
    <>
      <PageHeader title="Profil & Sicherheit" description={s.user.email} />
      <div className="grid gap-6 lg:grid-cols-2">
        <ProfileCard />
        <PasswordCard />
        {can('packing.execute') && <PackingPinCard />}
        <MfaCard />
        <SessionsCard />
        <NotificationSettingsCard />
      </div>
    </>
  );
}

function ProfileCard() {
  const s = useSession();
  const refresh = useRefreshSession();
  const [saved, setSaved] = useState(false);
  const f = useSubmit(
    (v: Record<string, string>) => http.patch('/auth/profile', v),
    async () => {
      setSaved(true);
      await refresh();
    },
  );
  return (
    <Card>
      <CardHeader title="Profil" />
      <CardBody>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            setSaved(false);
            f.submit(formData(e));
          }}
        >
          {saved && <Alert tone="success">Gespeichert.</Alert>}
          <Field label="Name" error={f.fieldErrors.name}>
            {(p) => <Input {...p} name="name" defaultValue={s.user.name} required />}
          </Field>
          <Button type="submit" loading={f.pending}>
            Speichern
          </Button>
        </form>
      </CardBody>
    </Card>
  );
}

function PasswordCard() {
  const [done, setDone] = useState(false);
  const f = useSubmit(
    (v: Record<string, string>) => http.post('/auth/password/change', v),
    () => setDone(true),
  );
  return (
    <Card>
      <CardHeader title="Passwort ändern" description="Andere Sitzungen werden dabei abgemeldet." />
      <CardBody>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            setDone(false);
            f.submit(formData(e));
            e.currentTarget.reset();
          }}
        >
          {f.error && <Alert tone="danger">{f.error}</Alert>}
          {done && <Alert tone="success">Passwort geändert.</Alert>}
          <Field label="Aktuelles Passwort">
            {(p) => (
              <Input
                {...p}
                name="currentPassword"
                type="password"
                autoComplete="current-password"
                required
              />
            )}
          </Field>
          <Field
            label="Neues Passwort"
            hint="Mindestens 12 Zeichen."
            error={f.fieldErrors.newPassword}
          >
            {(p) => (
              <Input
                {...p}
                name="newPassword"
                type="password"
                autoComplete="new-password"
                minLength={12}
                required
              />
            )}
          </Field>
          <Button type="submit" loading={f.pending}>
            Passwort ändern
          </Button>
        </form>
      </CardBody>
    </Card>
  );
}

/** PIN für die schnelle Anmeldung am Touch-Packtisch (nur an freigegebenen Lagerrechnern). */
function PackingPinCard() {
  const qc = useQueryClient();
  const [done, setDone] = useState(false);
  const status = useQuery({
    queryKey: ['packing-pin', 'me'],
    queryFn: () => http.get<{ hasPin: boolean }>('/packing/pins/me'),
  });
  const f = useSubmit(
    (v: Record<string, string>) => http.put('/packing/pins/me', v),
    async () => {
      setDone(true);
      await qc.invalidateQueries({ queryKey: ['packing-pin', 'me'] });
    },
  );
  return (
    <Card>
      <CardHeader
        title="PIN für den Packtisch"
        description="Damit melden Sie sich am Lagerrechner mit Namen und PIN an – nur für den Packtisch."
      />
      <CardBody>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            setDone(false);
            f.submit(formData(e));
            e.currentTarget.reset();
          }}
        >
          {status.data && (
            <p className="text-sm">
              {status.data.hasPin ? (
                <Badge tone="success">PIN ist festgelegt</Badge>
              ) : (
                <Badge>Noch keine PIN</Badge>
              )}
            </p>
          )}
          {f.error && <Alert tone="danger">{f.error}</Alert>}
          {done && <Alert tone="success">PIN gespeichert.</Alert>}
          <Field
            label={status.data?.hasPin ? 'Neue PIN' : 'PIN'}
            hint="4 bis 6 Ziffern, nicht 1111 oder 1234."
            error={f.fieldErrors.pin}
          >
            {(p) => (
              <Input
                {...p}
                name="pin"
                type="password"
                inputMode="numeric"
                autoComplete="off"
                pattern="d{4,6}"
                maxLength={6}
                required
              />
            )}
          </Field>
          <Field label="Ihr Passwort zur Bestätigung" error={f.fieldErrors.password}>
            {(p) => (
              <Input
                {...p}
                name="password"
                type="password"
                autoComplete="current-password"
                required
              />
            )}
          </Field>
          <Button type="submit" loading={f.pending}>
            PIN speichern
          </Button>
        </form>
      </CardBody>
    </Card>
  );
}

function MfaCard() {
  const s = useSession();
  const refresh = useRefreshSession();
  const [setup, setSetup] = useState<{ secret: string; qrDataUrl: string } | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const start = useSubmit(
    () => http.post<{ secret: string; qrDataUrl: string }>('/auth/mfa/setup'),
    setSetup,
  );
  const enable = useSubmit(
    (v: Record<string, string>) => http.post<{ recoveryCodes: string[] }>('/auth/mfa/enable', v),
    async (r) => {
      setSetup(null);
      setCodes(r.recoveryCodes);
      await refresh();
    },
  );
  const disable = useSubmit(
    (v: Record<string, string>) => http.post('/auth/mfa/disable', v),
    refresh,
  );

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <ShieldCheck className="size-4" /> Zwei-Faktor-Anmeldung
          </span>
        }
        actions={
          s.user.mfaEnabled ? (
            <Badge tone="success">Aktiv</Badge>
          ) : (
            <Badge tone="warning">Nicht aktiv</Badge>
          )
        }
      />
      <CardBody className="space-y-4">
        {codes && (
          <Alert tone="warning" title="Wiederherstellungscodes – jetzt sicher aufbewahren">
            <p className="mb-2">
              Jeder Code funktioniert einmal, falls Sie keinen Zugriff auf Ihre App haben. Sie
              werden nur jetzt angezeigt.
            </p>
            <ul className="grid grid-cols-2 gap-1 font-mono text-sm">
              {codes.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
            <Button variant="link" onClick={() => setCodes(null)}>
              Ich habe die Codes gespeichert
            </Button>
          </Alert>
        )}
        {s.user.mfaEnabled ? (
          <form className="space-y-3" onSubmit={(e) => disable.submit(formData(e))}>
            <p className="text-sm text-muted">Zum Deaktivieren bitte das Passwort bestätigen.</p>
            {disable.error && <Alert tone="danger">{disable.error}</Alert>}
            <Field label="Passwort">
              {(p) => (
                <Input
                  {...p}
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                />
              )}
            </Field>
            <Button variant="danger" type="submit" loading={disable.pending}>
              Deaktivieren
            </Button>
          </form>
        ) : setup ? (
          <form className="space-y-4" onSubmit={(e) => enable.submit(formData(e))}>
            <p className="text-sm">
              1. Scannen Sie den QR-Code mit einer Authenticator-App (z. B. Microsoft Authenticator,
              Google Authenticator, 1Password).
            </p>
            <img
              src={setup.qrDataUrl}
              alt="QR-Code für die Authenticator-App"
              className="mx-auto size-44 rounded-lg bg-white p-2"
            />
            <p className="text-center text-xs text-muted">
              Manuell: <code className="font-mono">{setup.secret}</code>
            </p>
            <p className="text-sm">2. Geben Sie den angezeigten Code ein.</p>
            {enable.error && <Alert tone="danger">{enable.error}</Alert>}
            <Field label="6-stelliger Code">
              {(p) => (
                <Input
                  {...p}
                  name="code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  required
                  className="font-mono tracking-[0.3em]"
                />
              )}
            </Field>
            <Button type="submit" loading={enable.pending}>
              Aktivieren
            </Button>
          </form>
        ) : (
          <>
            <p className="text-sm text-muted">
              Schützt Ihren Zugang zusätzlich mit einem Code aus einer App auf Ihrem Smartphone.
              Dringend empfohlen.
            </p>
            {start.error && <Alert tone="danger">{start.error}</Alert>}
            <Button onClick={() => start.submit(undefined)} loading={start.pending}>
              Einrichten
            </Button>
          </>
        )}
      </CardBody>
    </Card>
  );
}

function SessionsCard() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['sessions'],
    queryFn: () =>
      http.get<
        {
          id: string;
          ip: string | null;
          userAgent: string | null;
          lastSeenAt: string;
          current: boolean;
        }[]
      >('/auth/sessions'),
  });
  return (
    <Card>
      <CardHeader title="Angemeldete Geräte" />
      <CardBody>
        {q.isPending ? (
          <Spinner />
        ) : (
          <ul className="divide-y divide-border">
            {q.data?.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                <div className="flex min-w-0 items-center gap-3">
                  <Monitor className="size-4 shrink-0 text-muted" />
                  <div className="min-w-0">
                    <p className="truncate">{s.userAgent ?? 'Unbekanntes Gerät'}</p>
                    <p className="text-xs text-muted">
                      {s.ip ?? '–'} · zuletzt aktiv {formatDateTime(s.lastSeenAt)}
                    </p>
                  </div>
                </div>
                {s.current ? (
                  <Badge tone="primary">Dieses Gerät</Badge>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={async () => {
                      await http.del(`/auth/sessions/${s.id}`);
                      await qc.invalidateQueries({ queryKey: ['sessions'] });
                    }}
                  >
                    Abmelden
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

function NotificationSettingsCard() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['notification-preferences'],
    queryFn: () =>
      http.get<{ type: string; label: string; description: string; inApp: boolean }[]>(
        '/notifications/preferences',
      ),
  });
  return (
    <Card id="benachrichtigungen" className="lg:col-span-2">
      <CardHeader
        title="Benachrichtigungen"
        description="Welche Hinweise möchten Sie in der Software erhalten? Sicherheitshinweise kommen zusätzlich immer per E-Mail."
      />
      <CardBody>
        {q.isPending ? (
          <Spinner />
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {q.data?.map((p) => (
              <li key={p.type}>
                <Checkbox
                  label={p.label}
                  description={p.description}
                  checked={p.inApp}
                  onChange={async (e) => {
                    await http.put('/notifications/preferences', { [p.type]: e.target.checked });
                    await qc.invalidateQueries({ queryKey: ['notification-preferences'] });
                  }}
                />
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
