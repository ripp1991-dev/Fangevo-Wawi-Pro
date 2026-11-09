import { useNavigate } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert, Button, Field, Input } from '@fangevo/ui';
import { AuthLayout } from '../../components/auth-layout';
import { formData, useSubmit } from '../../components/use-form';
import { http } from '../../lib/api';

export function MfaPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [recovery, setRecovery] = useState(false);
  const f = useSubmit(
    (v: Record<string, string>) => http.post('/auth/mfa/verify', v),
    async () => {
      await qc.invalidateQueries();
      await navigate({ to: '/' });
    },
  );
  return (
    <AuthLayout
      title="Zwei-Faktor-Bestätigung"
      subtitle={
        recovery
          ? 'Geben Sie einen Ihrer Wiederherstellungscodes ein.'
          : 'Geben Sie den 6-stelligen Code aus Ihrer Authenticator-App ein.'
      }
    >
      <form className="space-y-4" onSubmit={(e) => f.submit(formData(e))}>
        {f.error && <Alert tone="danger">{f.error}</Alert>}
        <Field label={recovery ? 'Wiederherstellungscode' : 'Bestätigungscode'}>
          {(p) => (
            <Input
              {...p}
              key={String(recovery)}
              name="code"
              autoComplete="one-time-code"
              inputMode={recovery ? 'text' : 'numeric'}
              pattern={recovery ? undefined : '[0-9]{6}'}
              maxLength={recovery ? 32 : 6}
              required
              autoFocus
              className="text-center font-mono text-lg tracking-[0.3em]"
            />
          )}
        </Field>
        <Button type="submit" className="w-full" loading={f.pending}>
          Bestätigen
        </Button>
        <Button
          type="button"
          variant="link"
          className="w-full"
          onClick={() => setRecovery(!recovery)}
        >
          {recovery
            ? 'Code aus der App verwenden'
            : 'Kein Zugriff auf die App? Wiederherstellungscode nutzen'}
        </Button>
      </form>
    </AuthLayout>
  );
}
