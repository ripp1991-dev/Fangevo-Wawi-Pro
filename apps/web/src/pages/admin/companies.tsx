import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, Building2, Pencil, Plus, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  Dialog,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Spinner,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
} from '@fangevo/ui';
import { formData, useSubmit } from '../../components/use-form';
import { errorMessage, http } from '../../lib/api';
import { type Company } from '../../lib/types';
import { useCan, useSession } from '../../lib/session';

export function CompaniesPage() {
  const can = useCan();
  const s = useSession();
  const qc = useQueryClient();
  const [showArchived, setShowArchived] = useState(false);
  const [edit, setEdit] = useState<Company | 'new' | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ['companies', showArchived],
    queryFn: () => http.get<Company[]>(`/admin/companies?archived=${showArchived}`),
  });
  const manage = can('companies.manage') && s.account?.accessMode === 'full';

  const toggleArchive = async (c: Company) => {
    setActionError(null);
    try {
      await http.post(`/admin/companies/${c.id}/${c.archivedAt ? 'restore' : 'archive'}`);
      await qc.invalidateQueries();
    } catch (e) {
      setActionError(errorMessage(e));
    }
  };

  return (
    <>
      <PageHeader
        title="Firmen"
        description="Jede Firma hat eigene Stammdaten. In Ihrer Lizenz sind 3 Firmen enthalten."
        actions={
          manage && (
            <Button onClick={() => setEdit('new')}>
              <Plus /> Firma anlegen
            </Button>
          )
        }
      />
      {actionError && (
        <div className="mb-4">
          <Alert tone="danger">{actionError}</Alert>
        </div>
      )}
      <Card>
        {manage && (
          <div className="border-b border-border px-4 py-3">
            <Checkbox
              label="Archivierte Firmen anzeigen"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
            />
          </div>
        )}
        {q.isPending ? (
          <Spinner />
        ) : q.isError ? (
          <div className="p-4">
            <Alert tone="danger">{errorMessage(q.error)}</Alert>
          </div>
        ) : !q.data.length ? (
          <EmptyState icon={<Building2 />} title="Keine Firmen" />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Name</TH>
                <TH>Ort</TH>
                <TH>USt-IdNr.</TH>
                <TH>Status</TH>
                {manage && <TH className="text-right">Aktionen</TH>}
              </tr>
            </THead>
            <TBody>
              {q.data.map((c) => (
                <TR key={c.id}>
                  <TD>
                    <p className="font-medium">{c.name}</p>
                    {c.legalName && <p className="text-xs text-muted">{c.legalName}</p>}
                  </TD>
                  <TD>
                    {[c.postalCode, c.city].filter(Boolean).join(' ')}
                    <span className={c.city || c.postalCode ? 'ml-1 text-muted' : 'text-muted'}>
                      {c.country}
                    </span>
                  </TD>
                  <TD>{c.vatId ?? '–'}</TD>
                  <TD>
                    {c.archivedAt ? <Badge>Archiviert</Badge> : <Badge tone="success">Aktiv</Badge>}
                  </TD>
                  {manage && (
                    <TD className="text-right">
                      <div className="flex justify-end gap-1">
                        {!c.archivedAt && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setEdit(c)}
                            aria-label={`${c.name} bearbeiten`}
                          >
                            <Pencil />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => toggleArchive(c)}
                          aria-label={c.archivedAt ? 'Wiederherstellen' : 'Archivieren'}
                        >
                          {c.archivedAt ? <RotateCcw /> : <Archive />}
                        </Button>
                      </div>
                    </TD>
                  )}
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
      {edit && (
        <CompanyDialog company={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />
      )}
    </>
  );
}

function CompanyDialog({ company, onClose }: { company: Company | null; onClose: () => void }) {
  const qc = useQueryClient();
  const f = useSubmit(
    (v: Record<string, string>) =>
      company
        ? http.put(`/admin/companies/${company.id}`, { ...v, version: company.version })
        : http.post('/admin/companies', v),
    async () => {
      await qc.invalidateQueries();
      onClose();
    },
  );
  const fields: [keyof Company, string, string?][] = [
    ['name', 'Anzeigename'],
    ['legalName', 'Rechtlicher Name', 'z. B. Muster GmbH'],
    ['street', 'Straße und Hausnummer'],
    ['postalCode', 'PLZ'],
    ['city', 'Ort'],
    ['country', 'Land (ISO-Code)', 'DE, AT, CH …'],
    ['vatId', 'USt-IdNr.'],
    ['email', 'E-Mail'],
    ['phone', 'Telefon'],
  ];
  return (
    <Dialog
      open
      onClose={onClose}
      title={company ? 'Firma bearbeiten' : 'Firma anlegen'}
      wide
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Abbrechen
          </Button>
          <Button type="submit" form="company-form" loading={f.pending}>
            Speichern
          </Button>
        </>
      }
    >
      <form
        id="company-form"
        className="grid gap-4 sm:grid-cols-2"
        onSubmit={(e) => f.submit(formData(e))}
        noValidate
      >
        {f.error && (
          <div className="sm:col-span-2">
            <Alert tone="danger">{f.error}</Alert>
          </div>
        )}
        {fields.map(([k, label, hint]) => (
          <div
            key={k}
            className={k === 'name' || k === 'legalName' || k === 'street' ? 'sm:col-span-2' : ''}
          >
            <Field label={label} hint={hint} error={f.fieldErrors[k]}>
              {(p) => (
                <Input
                  {...p}
                  name={k}
                  defaultValue={(company?.[k] as string | null) ?? (k === 'country' ? 'DE' : '')}
                  required={k === 'name'}
                />
              )}
            </Field>
          </div>
        ))}
      </form>
    </Dialog>
  );
}
