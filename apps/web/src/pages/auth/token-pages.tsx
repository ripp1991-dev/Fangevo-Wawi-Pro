import { Link, useNavigate } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Field, Input, Spinner } from '@fangevo/ui';
import { AuthLayout } from '../../components/auth-layout';
import { formData, useSubmit } from '../../components/use-form';
import { errorMessage, http } from '../../lib/api';
import { sessionQuery } from '../../lib/session';

function useToken(): string {
  return new URLSearchParams(window.location.search).get('token') ?? '';
}

export function VerifyEmailPage() {
  const token = useToken();
  const m = useMutation({ mutationFn: () => http.post('/auth/verify-email', { token }) });
  const { mutate } = m;
  // Das Token ist nur einmal gültig: auch bei doppelt ausgeführten Effekten nur einmal senden.
  const sent = useRef(false);
  useEffect(() => {
    if (token && !sent.current) {
      sent.current = true;
      mutate();
    }
  }, [token, mutate]);
  return (
    <AuthLayout title="E-Mail bestätigen">
      {m.isPending || m.isIdle ? (
        <Spinner label="Wird bestätigt …" />
      ) : m.isSuccess ? (
        <div className="space-y-4">
          <Alert tone="success" title="Vielen Dank!">
            Ihre E-Mail-Adresse ist bestätigt. Sie können sich jetzt anmelden.
          </Alert>
          <Link to="/login">
            <Button className="w-full">Zur Anmeldung</Button>
          </Link>
        </div>
      ) : (
        <Alert tone="danger" title="Bestätigung fehlgeschlagen">
          {errorMessage(m.error)}
        </Alert>
      )}
    </AuthLayout>
  );
}

export function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const f = useSubmit(
    (v: Record<string, string>) => http.post('/auth/password/forgot', v),
    () => setSent(true),
  );
  return (
    <AuthLayout
      title="Passwort vergessen"
      subtitle="Wir senden Ihnen einen Link zum Zurücksetzen."
      footer={
        <Link to="/login" className="font-medium text-primary hover:underline">
          Zurück zur Anmeldung
        </Link>
      }
    >
      {sent ? (
        <Alert tone="success">
          Falls ein Zugang mit dieser Adresse existiert, haben wir eine E-Mail versendet. Der Link
          ist 1 Stunde gültig.
        </Alert>
      ) : (
        <form className="space-y-4" onSubmit={(e) => f.submit(formData(e))} noValidate>
          {f.error && <Alert tone="danger">{f.error}</Alert>}
          <Field label="E-Mail-Adresse" error={f.fieldErrors.email}>
            {(p) => (
              <Input {...p} name="email" type="email" autoComplete="email" required autoFocus />
            )}
          </Field>
          <Button type="submit" className="w-full" loading={f.pending}>
            Link senden
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}

export function ResetPasswordPage() {
  const token = useToken();
  const [done, setDone] = useState(false);
  const f = useSubmit(
    (v: Record<string, string>) =>
      http.post('/auth/password/reset', { token, password: v.password }),
    () => setDone(true),
  );
  return (
    <AuthLayout title="Neues Passwort festlegen">
      {done ? (
        <div className="space-y-4">
          <Alert tone="success">
            Ihr Passwort wurde geändert. Aus Sicherheitsgründen wurden alle Sitzungen beendet.
          </Alert>
          <Link to="/login">
            <Button className="w-full">Zur Anmeldung</Button>
          </Link>
        </div>
      ) : (
        <form className="space-y-4" onSubmit={(e) => f.submit(formData(e))} noValidate>
          {f.error && <Alert tone="danger">{f.error}</Alert>}
          <Field
            label="Neues Passwort"
            hint="Mindestens 12 Zeichen."
            error={f.fieldErrors.password}
          >
            {(p) => (
              <Input
                {...p}
                name="password"
                type="password"
                autoComplete="new-password"
                minLength={12}
                required
                autoFocus
              />
            )}
          </Field>
          <Button type="submit" className="w-full" loading={f.pending}>
            Passwort speichern
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}

export function AcceptInvitationPage() {
  const token = useToken();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const preview = useQuery({
    queryKey: ['invitation', token],
    queryFn: () =>
      http.get<{ email: string; accountName: string; userExists: boolean }>(
        `/auth/invitations/${encodeURIComponent(token)}`,
      ),
    retry: false,
  });
  const session = useQuery(sessionQuery);
  const f = useSubmit(
    (v: Record<string, string>) => http.post('/auth/invitations/accept', { token, ...v }),
    async () => {
      await qc.invalidateQueries();
      await navigate({ to: '/' });
    },
  );
  if (preview.isPending)
    return (
      <AuthLayout title="Einladung">
        <Spinner />
      </AuthLayout>
    );
  if (preview.isError) {
    return (
      <AuthLayout title="Einladung">
        <Alert tone="danger" title="Einladung ungültig">
          Der Link ist ungültig, abgelaufen oder wurde bereits verwendet. Bitten Sie um eine neue
          Einladung.
        </Alert>
      </AuthLayout>
    );
  }
  const inv = preview.data;
  const loggedInAs = session.data?.user.email;
  return (
    <AuthLayout
      title={`Einladung zu ${inv.accountName}`}
      subtitle={
        <>
          für <strong>{inv.email}</strong>
        </>
      }
    >
      {f.error && (
        <div className="mb-4">
          <Alert tone="danger">{f.error}</Alert>
        </div>
      )}
      {inv.userExists ? (
        loggedInAs === inv.email ? (
          <Button className="w-full" loading={f.pending} onClick={() => f.submit({})}>
            Einladung annehmen
          </Button>
        ) : (
          <div className="space-y-4">
            <Alert tone="info">
              Für diese Adresse gibt es bereits einen Zugang. Bitte melden Sie sich an und öffnen
              Sie den Link danach erneut.
            </Alert>
            <Link to="/login">
              <Button className="w-full">Anmelden</Button>
            </Link>
          </div>
        )
      ) : (
        <form className="space-y-4" onSubmit={(e) => f.submit(formData(e))} noValidate>
          <Field label="Ihr Name" error={f.fieldErrors.name}>
            {(p) => <Input {...p} name="name" autoComplete="name" required autoFocus />}
          </Field>
          <Field
            label="Passwort festlegen"
            hint="Mindestens 12 Zeichen."
            error={f.fieldErrors.password}
          >
            {(p) => (
              <Input
                {...p}
                name="password"
                type="password"
                autoComplete="new-password"
                minLength={12}
                required
              />
            )}
          </Field>
          <Button type="submit" className="w-full" loading={f.pending}>
            Zugang erstellen und beitreten
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
