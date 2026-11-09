import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, Plus, RotateCcw } from 'lucide-react';
import { useMemo, useState } from 'react';
import { type ListFilter } from '@fangevo/shared';
import { Alert, Badge, Button, Checkbox, Dialog, Field, Input, PageHeader, cn } from '@fangevo/ui';
import { ActivityList } from '../../components/activity-list';
import { DataTable } from '../../components/table/data-table';
import { type Column } from '../../components/table/types';
import { useSubmit } from '../../components/use-form';
import { http } from '../../lib/api';
import {
  CustomFieldInputs,
  customFieldColumns,
  useCustomFields,
  type CustomFieldDef,
} from '../../lib/custom-fields';
import { formatDateTime } from '../../lib/format';
import { type Company, type Member } from '../../lib/types';
import { useCan, useSession } from '../../lib/session';

interface CompanyRow extends Company {
  customFields: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

function listUrl(
  p: { q: string; sort: string | null; filters: ListFilter[]; page: number; pageSize: number },
  archived: boolean,
): string {
  const s = new URLSearchParams({
    page: String(p.page),
    pageSize: String(p.pageSize),
    archived: String(archived),
  });
  if (p.q) s.set('q', p.q);
  if (p.sort) s.set('sort', p.sort);
  if (p.filters.length) s.set('filters', JSON.stringify(p.filters));
  return `/admin/companies?${s}`;
}

export function CompaniesPage() {
  const can = useCan();
  const s = useSession();
  const qc = useQueryClient();
  const [showArchived, setShowArchived] = useState(false);
  const [edit, setEdit] = useState<CompanyRow | 'new' | null>(null);
  const manage = can('companies.manage') && s.account?.accessMode === 'full';
  const fields = useCustomFields('company');
  const members = useQuery({
    queryKey: ['members'],
    queryFn: () => http.get<Member[]>('/admin/members'),
    enabled: can('users.read'),
  });
  const companyNames = useMemo(
    () => new Map((s.account?.companies ?? []).map((c) => [c.id, c.name])),
    [s.account?.companies],
  );

  const columns = useMemo<Column<CompanyRow>[]>(() => {
    const ref = (entity: string, id: string) =>
      entity === 'company'
        ? companyNames.get(id)
        : members.data?.find((m) => m.id === id)?.user.name;
    return [
      {
        id: 'name',
        header: 'Name',
        kind: 'string',
        sortable: true,
        width: 220,
        value: (r) => r.name,
        cell: (r) => (
          <div className="truncate">
            <p className="truncate font-medium">{r.name}</p>
            {r.legalName && <p className="truncate text-xs text-muted">{r.legalName}</p>}
          </div>
        ),
      },
      {
        id: 'city',
        header: 'Ort',
        kind: 'string',
        sortable: true,
        value: (r) => r.city,
        text: (r) => [r.postalCode, r.city].filter(Boolean).join(' '),
      },
      {
        id: 'country',
        header: 'Land',
        kind: 'string',
        sortable: true,
        groupable: true,
        width: 90,
        value: (r) => r.country,
      },
      { id: 'vatId', header: 'USt-IdNr.', kind: 'string', sortable: true, value: (r) => r.vatId },
      {
        id: 'email',
        header: 'E-Mail',
        kind: 'string',
        sortable: true,
        defaultHidden: true,
        value: (r) => r.email,
      },
      {
        id: 'createdAt',
        header: 'Angelegt',
        kind: 'date',
        sortable: true,
        defaultHidden: true,
        value: (r) => r.createdAt,
      },
      {
        id: 'status',
        header: 'Status',
        kind: 'string',
        filterable: false,
        width: 120,
        value: (r) => (r.archivedAt ? 'Archiviert' : 'Aktiv'),
        cell: (r) =>
          r.archivedAt ? <Badge>Archiviert</Badge> : <Badge tone="success">Aktiv</Badge>,
      },
      ...customFieldColumns<CompanyRow>(fields.data ?? [], ref),
    ];
  }, [fields.data, companyNames, members.data]);

  const refresh = () => qc.invalidateQueries();
  const setArchived = async (rows: CompanyRow[], archived: boolean) => {
    for (const r of rows)
      await http.post(`/admin/companies/${r.id}/${archived ? 'archive' : 'restore'}`);
    await refresh();
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
      <DataTable<CompanyRow>
        key={String(fields.data?.length ?? 0)}
        tableKey="companies"
        mode="server"
        queryKey={['companies', showArchived]}
        fetch={(p) => http.get(listUrl(p, showArchived))}
        columns={columns}
        rowId={(r) => r.id}
        exportName="firmen"
        onRowClick={(r) => setEdit(r)}
        initial={{ sort: 'name:asc' }}
        toolbar={
          manage && (
            <Checkbox
              label="Archivierte anzeigen"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
            />
          )
        }
        bulkActions={
          manage
            ? [
                {
                  label: 'Archivieren',
                  icon: <Archive />,
                  run: (rows) =>
                    setArchived(
                      rows.filter((r) => !r.archivedAt),
                      true,
                    ),
                },
                {
                  label: 'Wiederherstellen',
                  icon: <RotateCcw />,
                  run: (rows) =>
                    setArchived(
                      rows.filter((r) => r.archivedAt),
                      false,
                    ),
                },
              ]
            : undefined
        }
      />
      {edit && (
        <CompanyDialog
          company={edit === 'new' ? null : edit}
          defs={fields.data ?? []}
          canEdit={manage}
          members={members.data ?? []}
          onClose={() => setEdit(null)}
        />
      )}
    </>
  );
}

function CompanyDialog({
  company,
  defs,
  canEdit,
  members,
  onClose,
}: {
  company: CompanyRow | null;
  defs: CustomFieldDef[];
  canEdit: boolean;
  members: Member[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const s = useSession();
  const [tab, setTab] = useState<'data' | 'history'>('data');
  const [values, setValues] = useState<Record<string, string>>(() => {
    const keys = [
      'name',
      'legalName',
      'street',
      'postalCode',
      'city',
      'country',
      'vatId',
      'email',
      'phone',
    ] as const;
    return Object.fromEntries(
      keys.map((k) => [k, (company?.[k] as string | null) ?? (k === 'country' ? 'DE' : '')]),
    );
  });
  const [custom, setCustom] = useState<Record<string, unknown>>(company?.customFields ?? {});
  const f = useSubmit(
    () => {
      const body = { ...values, customFields: custom };
      return company
        ? http.put(`/admin/companies/${company.id}`, { ...body, version: company.version })
        : http.post('/admin/companies', body);
    },
    async () => {
      await qc.invalidateQueries();
      onClose();
    },
  );
  const fieldsDef: [string, string, string?][] = [
    ['name', 'Anzeigename *'],
    ['legalName', 'Rechtlicher Name', 'z. B. Muster GmbH'],
    ['street', 'Straße und Hausnummer'],
    ['postalCode', 'PLZ'],
    ['city', 'Ort'],
    ['country', 'Land (ISO-Code)', 'DE, AT, CH …'],
    ['vatId', 'USt-IdNr.'],
    ['email', 'E-Mail'],
    ['phone', 'Telefon'],
  ];
  const references = {
    company: (s.account?.companies ?? []).filter((c) => c.id !== company?.id),
    member: members.map((m) => ({ id: m.id, name: m.user.name })),
  };
  const readOnly = !canEdit || !!company?.archivedAt;
  return (
    <Dialog
      open
      onClose={onClose}
      title={company ? company.name : 'Firma anlegen'}
      description={company ? `Zuletzt geändert ${formatDateTime(company.updatedAt)}` : undefined}
      wide
      footer={
        tab === 'data' && !readOnly ? (
          <>
            <Button variant="secondary" onClick={onClose}>
              Abbrechen
            </Button>
            <Button onClick={() => f.submit(undefined)} loading={f.pending}>
              Speichern
            </Button>
          </>
        ) : (
          <Button variant="secondary" onClick={onClose}>
            Schließen
          </Button>
        )
      }
    >
      {company && (
        <div className="-mt-1 mb-4 flex gap-1 border-b border-border" role="tablist">
          {(['data', 'history'] as const).map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              className={cn(
                '-mb-px border-b-2 px-3 py-2 text-sm font-medium',
                tab === t
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted hover:text-fg',
              )}
              onClick={() => setTab(t)}
            >
              {t === 'data' ? 'Stammdaten' : 'Verlauf'}
            </button>
          ))}
        </div>
      )}
      {tab === 'history' && company ? (
        <ActivityList
          entityType="company"
          entityId={company.id}
          fieldLabel={(k) =>
            k.startsWith('cf.') ? defs.find((d) => `cf.${d.key}` === k)?.label : undefined
          }
        />
      ) : (
        <form
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            f.submit(undefined);
          }}
          noValidate
        >
          {f.error && (
            <div className="sm:col-span-2">
              <Alert tone="danger">{f.error}</Alert>
            </div>
          )}
          <fieldset disabled={readOnly} className="contents">
            {fieldsDef.map(([k, label, hint]) => (
              <div
                key={k}
                className={
                  k === 'name' || k === 'legalName' || k === 'street' ? 'sm:col-span-2' : ''
                }
              >
                <Field label={label} hint={hint} error={f.fieldErrors[k]}>
                  {(p) => (
                    <Input
                      {...p}
                      value={values[k] ?? ''}
                      onChange={(e) => setValues({ ...values, [k]: e.target.value })}
                    />
                  )}
                </Field>
              </div>
            ))}
            {defs.length > 0 && (
              <p className="pt-2 text-sm font-semibold sm:col-span-2">Eigene Felder</p>
            )}
            <CustomFieldInputs
              defs={defs}
              values={custom}
              onChange={setCustom}
              errors={f.fieldErrors}
              references={references}
            />
          </fieldset>
        </form>
      )}
    </Dialog>
  );
}
