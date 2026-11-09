import { Alert, Button, Card, CardBody, CardHeader, Field, Input, PageHeader } from '@fangevo/ui';
import { useState } from 'react';
import { formData, useSubmit } from '../../components/use-form';
import { http } from '../../lib/api';
import { useRefreshSession, useSession } from '../../lib/session';

export function AccountPage() {
  const s = useSession();
  const refresh = useRefreshSession();
  const [saved, setSaved] = useState(false);
  const f = useSubmit(
    (v: Record<string, string>) => http.patch('/admin/account', v),
    async () => {
      setSaved(true);
      await refresh();
    },
  );
  return (
    <>
      <PageHeader
        title="Account"
        description="Einstellungen, die für alle Firmen dieses Accounts gelten."
      />
      <Card className="max-w-xl">
        <CardHeader title="Allgemein" />
        <CardBody>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              setSaved(false);
              f.submit(formData(e));
            }}
          >
            {f.error && <Alert tone="danger">{f.error}</Alert>}
            {saved && <Alert tone="success">Gespeichert.</Alert>}
            <Field label="Account-Name" error={f.fieldErrors.name}>
              {(p) => <Input {...p} name="name" defaultValue={s.account?.name} required />}
            </Field>
            <Button type="submit" loading={f.pending}>
              Speichern
            </Button>
          </form>
        </CardBody>
      </Card>
    </>
  );
}
