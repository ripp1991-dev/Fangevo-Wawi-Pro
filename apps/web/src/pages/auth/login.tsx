import { Link, useNavigate } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert, Button, Field, Input } from '@fangevo/ui';
import { AuthLayout } from '../../components/auth-layout';
import { formData, useSubmit } from '../../components/use-form';
import { http } from '../../lib/api';

export function LoginPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const [resent, setResent] = useState(false);
  const f = useSubmit(
    (v: Record<string, string>) => http.post<{ mfaRequired: boolean }>('/auth/login', v),
    async (r) => {
      await qc.invalidateQueries();
      await navigate({ to: r.mfaRequired ? '/mfa' : '/' });
    },
  );
  const notVerified = f.error?.includes('bestätigen');
  return (
    <AuthLayout
      title="Anmelden"
      subtitle="Willkommen zurück bei FangEvo Wawi Pro."
      footer={
        <>
          Noch kein Zugang?{' '}
          <Link to="/register" className="font-medium text-primary hover:underline">
            Kostenlos testen
          </Link>
        </>
      }
    >
      <form className="space-y-4" onSubmit={(e) => f.submit(formData(e))} noValidate>
        {f.error && <Alert tone="danger">{f.error}</Alert>}
        {notVerified && !resent && (
          <Button
            type="button"
            variant="link"
            onClick={async () => {
              await http.post('/auth/resend-verification', { email });
              setResent(true);
            }}
          >
            Bestätigungs-E-Mail erneut senden
          </Button>
        )}
        {resent && (
          <Alert tone="success">
            Falls ein Zugang existiert, wurde eine neue E-Mail versendet.
          </Alert>
        )}
        <Field label="E-Mail-Adresse" error={f.fieldErrors.email}>
          {(p) => (
            <Input
              {...p}
              name="email"
              type="email"
              autoComplete="email"
              required
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          )}
        </Field>
        <Field label="Passwort" error={f.fieldErrors.password}>
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
        <div className="flex justify-end">
          <Link to="/forgot-password" className="text-sm font-medium text-primary hover:underline">
            Passwort vergessen?
          </Link>
        </div>
        <Button type="submit" className="w-full" loading={f.pending}>
          Anmelden
        </Button>
      </form>
    </AuthLayout>
  );
}
