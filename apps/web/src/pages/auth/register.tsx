import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { MailCheck } from 'lucide-react';
import { Alert, Button, Field, Input } from '@fangevo/ui';
import { AuthLayout } from '../../components/auth-layout';
import { formData, useSubmit } from '../../components/use-form';
import { http } from '../../lib/api';

export function RegisterPage() {
  const [done, setDone] = useState<string | null>(null);
  const f = useSubmit(
    (v: Record<string, string>) => http.post('/auth/register', v).then(() => v.email ?? ''),
    setDone,
  );
  if (done) {
    return (
      <AuthLayout title="Fast geschafft" subtitle="Bitte bestätigen Sie Ihre E-Mail-Adresse.">
        <div className="space-y-4">
          <Alert tone="success" title="E-Mail versendet">
            Wir haben eine Nachricht an <strong>{done}</strong> geschickt. Klicken Sie auf den Link
            darin, um Ihren Zugang zu aktivieren.
          </Alert>
          <div className="flex items-center gap-3 text-sm text-muted">
            <MailCheck className="size-5" /> Keine E-Mail erhalten? Prüfen Sie Ihren Spam-Ordner.
          </div>
          <Link to="/login" className="block text-sm font-medium text-primary hover:underline">
            Zur Anmeldung
          </Link>
        </div>
      </AuthLayout>
    );
  }
  return (
    <AuthLayout
      title="Kostenlos testen"
      subtitle="14 Tage unverbindlich. Keine Zahlungsdaten nötig."
      footer={
        <>
          Bereits registriert?{' '}
          <Link to="/login" className="font-medium text-primary hover:underline">
            Anmelden
          </Link>
        </>
      }
    >
      <form className="space-y-4" onSubmit={(e) => f.submit(formData(e))} noValidate>
        {f.error && !Object.keys(f.fieldErrors).length && <Alert tone="danger">{f.error}</Alert>}
        <Field label="Ihr Name" error={f.fieldErrors.name}>
          {(p) => <Input {...p} name="name" autoComplete="name" required autoFocus />}
        </Field>
        <Field
          label="Firmenname"
          hint="Unter diesem Namen wird Ihr Account angelegt."
          error={f.fieldErrors.accountName}
        >
          {(p) => <Input {...p} name="accountName" autoComplete="organization" required />}
        </Field>
        <Field label="E-Mail-Adresse" error={f.fieldErrors.email}>
          {(p) => <Input {...p} name="email" type="email" autoComplete="email" required />}
        </Field>
        <Field
          label="Passwort"
          hint="Mindestens 12 Zeichen. Ein Satz ist leichter zu merken."
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
          Account erstellen
        </Button>
      </form>
    </AuthLayout>
  );
}
