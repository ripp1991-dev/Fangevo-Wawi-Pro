import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, Ban, Plus, RotateCcw } from 'lucide-react';
import { useMemo, useState } from 'react';
import { type ListFilter } from '@fangevo/shared';
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Dialog,
  Field,
  Input,
  PageHeader,
  Select,
  Spinner,
} from '@fangevo/ui';
import { ActivityList } from '../../components/activity-list';
import { DataTable } from '../../components/table/data-table';
import { type Column } from '../../components/table/types';
import { Tabs } from '../../components/tabs';
import { useSubmit } from '../../components/use-form';
import { errorMessage, http } from '../../lib/api';
import { CustomFieldInputs, customFieldColumns, useCustomFields } from '../../lib/custom-fields';
import { useMasterData, type MasterData } from '../../lib/master-data';
import { useCan, useSession } from '../../lib/session';
import { AddressesEditor, ContactsEditor, toAddressValue, toContactValue } from './party-editor';

interface CustomerRow {
  id: string;
  number: string;
  type: 'private' | 'business';
  displayName: string;
  companyName: string | null;
  salutation: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  vatId: string | null;
  customerGroupId: string | null;
  paymentTermsDays: number;
  blocked: boolean;
  blockedReason: string | null;
  notes: string | null;
  city: string | null;
  customFields: Record<string, unknown>;
  archivedAt: string | null;
  version: number;
  createdAt: string;
}
interface CustomerDetail extends CustomerRow {
  addresses: Record<string, unknown>[];
  contacts: Record<string, unknown>[];
}

const url = (
  base: string,
  p: { q: string; sort: string | null; filters: ListFilter[]; page: number; pageSize: number },
  archived: boolean,
) => {
  const s = new URLSearchParams({
    page: String(p.page),
    pageSize: String(p.pageSize),
    archived: String(archived),
  });
  if (p.q) s.set('q', p.q);
  if (p.sort) s.set('sort', p.sort);
  if (p.filters.length) s.set('filters', JSON.stringify(p.filters));
  return `${base}?${s}`;
};

export function CustomersPage() {
  const can = useCan();
  const s = useSession();
  const qc = useQueryClient();
  const md = useMasterData();
  const fields = useCustomFields('customer');
  const [archived, setArchived] = useState(false);
  const [open, setOpen] = useState<string | 'new' | null>(() =>
    new URLSearchParams(window.location.search).get('id'),
  );
  const manage = can('customers.manage') && s.account?.accessMode === 'full';
  const groups = useMemo(() => md.data?.customerGroups ?? [], [md.data?.customerGroups]);

  const columns = useMemo<Column<CustomerRow>[]>(
    () => [
      {
        id: 'number',
        header: 'Kd.-Nr.',
        kind: 'string',
        sortable: true,
        width: 120,
        value: (r) => r.number,
      },
      {
        id: 'lastName',
        header: 'Name',
        kind: 'string',
        sortable: true,
        width: 260,
        value: (r) => r.displayName,
        cell: (r) => (
          <div className="flex items-center gap-2 truncate">
            <span className="truncate font-medium">{r.displayName}</span>
            {r.blocked && (
              <Badge tone="danger">
                <Ban className="size-3" /> Gesperrt
              </Badge>
            )}
          </div>
        ),
      },
      {
        id: 'type',
        header: 'Art',
        kind: 'enum',
        groupable: true,
        width: 120,
        options: [
          { value: 'private', label: 'Privat' },
          { value: 'business', label: 'Geschäft' },
        ],
        value: (r) => r.type,
      },
      { id: 'email', header: 'E-Mail', kind: 'string', sortable: true, value: (r) => r.email },
      {
        id: 'city',
        header: 'Ort',
        kind: 'string',
        filterable: false,
        width: 140,
        value: (r) => r.city,
      },
      {
        id: 'customerGroupId',
        header: 'Kundengruppe',
        kind: 'enum',
        groupable: true,
        options: groups.map((g) => ({ value: g.id, label: g.name })),
        value: (r) => r.customerGroupId,
      },
      {
        id: 'vatId',
        header: 'USt-IdNr.',
        kind: 'string',
        sortable: true,
        defaultHidden: true,
        value: (r) => r.vatId,
      },
      {
        id: 'phone',
        header: 'Telefon',
        kind: 'string',
        defaultHidden: true,
        value: (r) => r.phone,
      },
      {
        id: 'blocked',
        header: 'Gesperrt',
        kind: 'boolean',
        sortable: true,
        defaultHidden: true,
        value: (r) => r.blocked,
      },
      {
        id: 'createdAt',
        header: 'Angelegt',
        kind: 'date',
        sortable: true,
        defaultHidden: true,
        value: (r) => r.createdAt,
      },
      ...customFieldColumns<CustomerRow>(fields.data ?? []),
    ],
    [groups, fields.data],
  );

  const archive = async (rows: CustomerRow[], a: boolean) => {
    for (const r of rows) await http.post(`/customers/${r.id}/${a ? 'archive' : 'restore'}`);
    await qc.invalidateQueries({ queryKey: ['customers'] });
  };

  return (
    <>
      <PageHeader
        title="Kunden"
        description="Privat- und Geschäftskunden mit Adressen, Ansprechpartnern und Konditionen."
        actions={
          manage && (
            <Button onClick={() => setOpen('new')}>
              <Plus /> Kunde anlegen
            </Button>
          )
        }
      />
      <DataTable<CustomerRow>
        key={`${fields.data?.length ?? 0}-${groups.length}`}
        tableKey="customers"
        mode="server"
        queryKey={['customers', archived]}
        fetch={(p) => http.get(url('/customers', p, archived))}
        columns={columns}
        rowId={(r) => r.id}
        exportName="kunden"
        onRowClick={(r) => setOpen(r.id)}
        initial={{ sort: 'number:asc' }}
        toolbar={
          <Checkbox
            label="Archivierte anzeigen"
            checked={archived}
            onChange={(e) => setArchived(e.target.checked)}
          />
        }
        bulkActions={
          manage
            ? [
                {
                  label: 'Archivieren',
                  icon: <Archive />,
                  run: (rows) =>
                    archive(
                      rows.filter((r) => !r.archivedAt),
                      true,
                    ),
                },
                {
                  label: 'Wiederherstellen',
                  icon: <RotateCcw />,
                  run: (rows) =>
                    archive(
                      rows.filter((r) => r.archivedAt),
                      false,
                    ),
                },
              ]
            : undefined
        }
      />
      {open && md.data && (
        <CustomerDialog
          id={open === 'new' ? null : open}
          md={md.data}
          canManage={manage}
          onClose={() => setOpen(null)}
        />
      )}
    </>
  );
}

function CustomerDialog({
  id,
  md,
  canManage,
  onClose,
}: {
  id: string | null;
  md: MasterData;
  canManage: boolean;
  onClose: () => void;
}) {
  const q = useQuery({
    queryKey: ['customer', id],
    queryFn: () => http.get<CustomerDetail>(`/customers/${id}`),
    enabled: !!id,
  });
  if (id && q.isPending)
    return (
      <Dialog open onClose={onClose} title="Kunde">
        <Spinner />
      </Dialog>
    );
  if (id && q.isError)
    return (
      <Dialog open onClose={onClose} title="Kunde">
        <Alert tone="danger">{errorMessage(q.error)}</Alert>
      </Dialog>
    );
  return (
    <CustomerForm
      key={id ?? 'new'}
      c={q.data ?? null}
      md={md}
      canManage={canManage}
      onClose={onClose}
    />
  );
}

function CustomerForm({
  c,
  md,
  canManage,
  onClose,
}: {
  c: CustomerDetail | null;
  md: MasterData;
  canManage: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const defs = useCustomFields('customer').data ?? [];
  const [tab, setTab] = useState<'data' | 'addresses' | 'contacts' | 'history'>('data');
  const [v, setV] = useState({
    number: c?.number ?? '',
    type: c?.type ?? ('private' as 'private' | 'business'),
    companyName: c?.companyName ?? '',
    salutation: c?.salutation ?? '',
    firstName: c?.firstName ?? '',
    lastName: c?.lastName ?? '',
    email: c?.email ?? '',
    phone: c?.phone ?? '',
    vatId: c?.vatId ?? '',
    customerGroupId: c?.customerGroupId ?? md.customerGroups.find((g) => g.isDefault)?.id ?? '',
    paymentTermsDays: c?.paymentTermsDays ?? 14,
    blocked: c?.blocked ?? false,
    blockedReason: c?.blockedReason ?? '',
    notes: c?.notes ?? '',
  });
  const [addresses, setAddresses] = useState(() =>
    (c?.addresses ?? [{ kind: 'billing', isDefault: true }]).map(toAddressValue),
  );
  const [contacts, setContacts] = useState(() => (c?.contacts ?? []).map(toContactValue));
  const [custom, setCustom] = useState<Record<string, unknown>>(c?.customFields ?? {});
  const set = (k: keyof typeof v, val: unknown) => setV({ ...v, [k]: val });
  const f = useSubmit(
    () => {
      const body = {
        ...v,
        number: v.number || null,
        customerGroupId: v.customerGroupId || null,
        paymentTermsDays: Number(v.paymentTermsDays),
        addresses: addresses.filter((a) => a.street || a.city || a.name),
        contacts: contacts.filter((x) => x.name),
        customFields: custom,
      };
      return c
        ? http.put(`/customers/${c.id}`, { ...body, version: c.version })
        : http.post('/customers', body);
    },
    async () => {
      await qc.invalidateQueries({ queryKey: ['customers'] });
      await qc.invalidateQueries({ queryKey: ['customer'] });
      onClose();
    },
  );
  const readOnly = !canManage || !!c?.archivedAt;
  return (
    <Dialog
      open
      wide
      onClose={onClose}
      title={c ? `${c.number} · ${c.displayName}` : 'Kunde anlegen'}
      footer={
        !readOnly && tab !== 'history' ? (
          <>
            <Button variant="secondary" onClick={onClose}>
              Abbrechen
            </Button>
            <Button loading={f.pending} onClick={() => f.submit(undefined)}>
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
      <Tabs
        tabs={[
          { id: 'data', label: 'Stammdaten' },
          { id: 'addresses', label: `Adressen (${addresses.length})` },
          { id: 'contacts', label: `Ansprechpartner (${contacts.length})` },
          { id: 'history', label: 'Verlauf', hidden: !c },
        ]}
        value={tab}
        onChange={setTab}
      />
      {f.error && (
        <div className="mb-4">
          <Alert tone="danger">{f.error}</Alert>
        </div>
      )}
      <fieldset disabled={readOnly} className="contents">
        {tab === 'data' && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Kundenart">
              {(p) => (
                <Select {...p} value={v.type} onChange={(e) => set('type', e.target.value)}>
                  <option value="private">Privatkunde</option>
                  <option value="business">Geschäftskunde</option>
                </Select>
              )}
            </Field>
            <Field
              label="Kundennummer"
              hint={c ? undefined : 'Leer lassen = automatisch vergeben'}
              error={f.fieldErrors.number}
            >
              {(p) => (
                <Input {...p} value={v.number} onChange={(e) => set('number', e.target.value)} />
              )}
            </Field>
            {v.type === 'business' && (
              <div className="sm:col-span-2">
                <Field label="Firmenname *" error={f.fieldErrors.companyName}>
                  {(p) => (
                    <Input
                      {...p}
                      value={v.companyName}
                      onChange={(e) => set('companyName', e.target.value)}
                    />
                  )}
                </Field>
              </div>
            )}
            <Field label="Anrede">
              {(p) => (
                <Select
                  {...p}
                  value={v.salutation}
                  onChange={(e) => set('salutation', e.target.value)}
                >
                  <option value="">–</option>
                  <option>Frau</option>
                  <option>Herr</option>
                  <option>Divers</option>
                </Select>
              )}
            </Field>
            <Field label="Vorname">
              {(p) => (
                <Input
                  {...p}
                  value={v.firstName}
                  onChange={(e) => set('firstName', e.target.value)}
                />
              )}
            </Field>
            <Field
              label={v.type === 'private' ? 'Nachname *' : 'Nachname'}
              error={f.fieldErrors.lastName}
            >
              {(p) => (
                <Input
                  {...p}
                  value={v.lastName}
                  onChange={(e) => set('lastName', e.target.value)}
                />
              )}
            </Field>
            <Field label="E-Mail" error={f.fieldErrors.email}>
              {(p) => (
                <Input
                  {...p}
                  type="email"
                  value={v.email}
                  onChange={(e) => set('email', e.target.value)}
                />
              )}
            </Field>
            <Field label="Telefon">
              {(p) => (
                <Input {...p} value={v.phone} onChange={(e) => set('phone', e.target.value)} />
              )}
            </Field>
            <Field label="USt-IdNr.">
              {(p) => (
                <Input {...p} value={v.vatId} onChange={(e) => set('vatId', e.target.value)} />
              )}
            </Field>
            <Field label="Kundengruppe">
              {(p) => (
                <Select
                  {...p}
                  value={v.customerGroupId}
                  onChange={(e) => set('customerGroupId', e.target.value)}
                >
                  {md.customerGroups
                    .filter((g) => !g.archivedAt)
                    .map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name} ({g.priceDisplay === 'gross' ? 'brutto' : 'netto'})
                      </option>
                    ))}
                </Select>
              )}
            </Field>
            <Field label="Zahlungsziel (Tage)">
              {(p) => (
                <Input
                  {...p}
                  type="number"
                  min={0}
                  max={365}
                  value={v.paymentTermsDays}
                  onChange={(e) => set('paymentTermsDays', e.target.value)}
                />
              )}
            </Field>
            <div className="space-y-2 sm:col-span-2">
              <Checkbox
                label="Kunde gesperrt"
                description="Gesperrte Kunden können später keine neuen Aufträge erhalten."
                checked={v.blocked}
                onChange={(e) => set('blocked', e.target.checked)}
              />
              {v.blocked && (
                <Input
                  aria-label="Grund der Sperre"
                  placeholder="Grund, z. B. Zahlungsrückstand"
                  value={v.blockedReason}
                  onChange={(e) => set('blockedReason', e.target.value)}
                />
              )}
            </div>
            <div className="sm:col-span-2">
              <Field label="Notizen">
                {(p) => (
                  <textarea
                    {...p}
                    rows={3}
                    className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm"
                    value={v.notes}
                    onChange={(e) => set('notes', e.target.value)}
                  />
                )}
              </Field>
            </div>
            {defs.length > 0 && (
              <p className="pt-2 text-sm font-semibold sm:col-span-2">Eigene Felder</p>
            )}
            <CustomFieldInputs
              defs={defs}
              values={custom}
              onChange={setCustom}
              errors={f.fieldErrors}
              references={{}}
            />
          </div>
        )}
        {tab === 'addresses' && <AddressesEditor value={addresses} onChange={setAddresses} />}
        {tab === 'contacts' && <ContactsEditor value={contacts} onChange={setContacts} />}
      </fieldset>
      {tab === 'history' && c && <ActivityList entityType="customer" entityId={c.id} />}
    </Dialog>
  );
}
