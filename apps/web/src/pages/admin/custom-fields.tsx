import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, Pencil, Plus, RotateCcw, SlidersHorizontal, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { CUSTOM_FIELD_ENTITIES, REFERENCE_TARGETS, type CustomFieldEntity } from '@fangevo/shared';
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
  Select,
  Spinner,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
} from '@fangevo/ui';
import { useSubmit } from '../../components/use-form';
import { errorMessage, http } from '../../lib/api';
import { type CustomFieldDef } from '../../lib/custom-fields';

const TYPES: Record<CustomFieldDef['type'], string> = {
  text: 'Text',
  number: 'Zahl',
  date: 'Datum',
  boolean: 'Ja/Nein',
  select: 'Auswahl',
  multiselect: 'Mehrfachauswahl',
  reference: 'Verweis auf Datensatz',
};

function slug(label: string): string {
  const s = label
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  return /^[a-z]/.test(s) ? s : `f_${s}`.slice(0, 40);
}

export function CustomFieldsPage() {
  const qc = useQueryClient();
  const [entity, setEntity] = useState<CustomFieldEntity>('company');
  const [edit, setEdit] = useState<CustomFieldDef | 'new' | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ['custom-fields', entity, 'all'],
    queryFn: () => http.get<CustomFieldDef[]>(`/custom-fields?entityType=${entity}&archived=true`),
  });
  const act = async (fn: () => Promise<unknown>) => {
    setErr(null);
    try {
      await fn();
      await qc.invalidateQueries({ queryKey: ['custom-fields'] });
    } catch (e) {
      setErr(errorMessage(e));
    }
  };
  return (
    <>
      <PageHeader
        title="Eigene Felder"
        description="Ergänzen Sie Datensätze um Felder, die Ihr Unternehmen braucht. Sie erscheinen in Formularen, Tabellen und Filtern."
        actions={
          <Button onClick={() => setEdit('new')}>
            <Plus /> Feld anlegen
          </Button>
        }
      />
      <div className="mb-4 flex items-center gap-3">
        <label htmlFor="cf-entity" className="text-sm text-muted">
          Datensatztyp
        </label>
        <Select
          id="cf-entity"
          className="w-48"
          value={entity}
          onChange={(e) => setEntity(e.target.value as CustomFieldEntity)}
        >
          {Object.entries(CUSTOM_FIELD_ENTITIES).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </Select>
        <span className="text-xs text-muted">
          Weitere Typen (Artikel, Kunden …) folgen mit den Fachmodulen.
        </span>
      </div>
      {err && (
        <div className="mb-4">
          <Alert tone="danger">{err}</Alert>
        </div>
      )}
      <Card>
        {q.isPending ? (
          <Spinner />
        ) : q.isError ? (
          <div className="p-4">
            <Alert tone="danger">{errorMessage(q.error)}</Alert>
          </div>
        ) : !q.data.length ? (
          <EmptyState
            icon={<SlidersHorizontal />}
            title="Noch keine eigenen Felder"
            description="Zum Beispiel „Region“, „Kundennummer beim Lieferanten“ oder „Stammkunde ja/nein“."
            action={
              <Button onClick={() => setEdit('new')}>
                <Plus /> Erstes Feld anlegen
              </Button>
            }
          />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Bezeichnung</TH>
                <TH>Schlüssel</TH>
                <TH>Typ</TH>
                <TH>Pflicht</TH>
                <TH>Status</TH>
                <TH className="text-right">Aktionen</TH>
              </tr>
            </THead>
            <TBody>
              {q.data.map((d) => (
                <TR key={d.id}>
                  <TD className="font-medium">{d.label}</TD>
                  <TD>
                    <code className="text-xs">{d.key}</code>
                  </TD>
                  <TD>
                    {TYPES[d.type]}
                    {d.type === 'reference' && d.referenceEntity
                      ? ` (${REFERENCE_TARGETS[d.referenceEntity]})`
                      : ''}
                    {d.options?.length ? (
                      <span className="text-muted"> · {d.options.length} Optionen</span>
                    ) : (
                      ''
                    )}
                  </TD>
                  <TD>{d.required ? 'Ja' : 'Nein'}</TD>
                  <TD>
                    {d.archivedAt ? <Badge>Archiviert</Badge> : <Badge tone="success">Aktiv</Badge>}
                  </TD>
                  <TD className="text-right">
                    <div className="flex justify-end gap-1">
                      {!d.archivedAt && (
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`${d.label} bearbeiten`}
                          onClick={() => setEdit(d)}
                        >
                          <Pencil />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={d.archivedAt ? 'Wiederherstellen' : 'Archivieren'}
                        onClick={() =>
                          act(() =>
                            http.post(
                              `/custom-fields/${d.id}/${d.archivedAt ? 'restore' : 'archive'}`,
                            ),
                          )
                        }
                      >
                        {d.archivedAt ? <RotateCcw /> : <Archive />}
                      </Button>
                    </div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
      <p className="mt-3 text-xs text-muted">
        Archivierte Felder werden ausgeblendet, gespeicherte Werte bleiben erhalten. Schlüssel und
        Typ sind nach dem Anlegen fest.
      </p>
      {edit && (
        <FieldDialog
          entity={entity}
          field={edit === 'new' ? null : edit}
          onClose={() => setEdit(null)}
        />
      )}
    </>
  );
}

function FieldDialog({
  entity,
  field,
  onClose,
}: {
  entity: CustomFieldEntity;
  field: CustomFieldDef | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [label, setLabel] = useState(field?.label ?? '');
  const [key, setKey] = useState(field?.key ?? '');
  const [keyTouched, setKeyTouched] = useState(false);
  const [type, setType] = useState<CustomFieldDef['type']>(field?.type ?? 'text');
  const [required, setRequired] = useState(field?.required ?? false);
  const [position, setPosition] = useState(field?.position ?? 0);
  const [options, setOptions] = useState<{ value: string; label: string }[]>(
    field?.options ?? [{ value: '', label: '' }],
  );
  const [referenceEntity, setReferenceEntity] = useState<'company' | 'member'>(
    field?.referenceEntity ?? 'company',
  );
  const hasOptions = type === 'select' || type === 'multiselect';
  const f = useSubmit(
    () => {
      const opts = hasOptions
        ? options
            .filter((o) => o.label.trim())
            .map((o) => ({ value: o.value || slug(o.label), label: o.label }))
        : undefined;
      return field
        ? http.put(`/custom-fields/${field.id}`, { label, required, position, options: opts })
        : http.post('/custom-fields', {
            entityType: entity,
            key,
            label,
            type,
            required,
            position,
            options: opts,
            referenceEntity: type === 'reference' ? referenceEntity : undefined,
          });
    },
    async () => {
      await qc.invalidateQueries({ queryKey: ['custom-fields'] });
      onClose();
    },
  );
  return (
    <Dialog
      open
      onClose={onClose}
      title={field ? `Feld „${field.label}“ bearbeiten` : 'Eigenes Feld anlegen'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Abbrechen
          </Button>
          <Button loading={f.pending} onClick={() => f.submit(undefined)}>
            Speichern
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {f.error && <Alert tone="danger">{f.error}</Alert>}
        <Field label="Bezeichnung" error={f.fieldErrors.label}>
          {(p) => (
            <Input
              {...p}
              value={label}
              autoFocus
              onChange={(e) => {
                setLabel(e.target.value);
                if (!field && !keyTouched) setKey(slug(e.target.value));
              }}
            />
          )}
        </Field>
        <Field
          label="Schlüssel"
          hint="Technischer Name für Importe und Schnittstellen. Nach dem Anlegen nicht änderbar."
          error={f.fieldErrors.key}
        >
          {(p) => (
            <Input
              {...p}
              value={key}
              disabled={!!field}
              onChange={(e) => {
                setKey(e.target.value);
                setKeyTouched(true);
              }}
              className="font-mono"
            />
          )}
        </Field>
        <Field label="Typ">
          {(p) => (
            <Select
              {...p}
              value={type}
              disabled={!!field}
              onChange={(e) => setType(e.target.value as CustomFieldDef['type'])}
            >
              {Object.entries(TYPES).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {type === 'reference' && (
          <Field label="Verweis auf" error={f.fieldErrors.referenceEntity}>
            {(p) => (
              <Select
                {...p}
                value={referenceEntity}
                disabled={!!field}
                onChange={(e) => setReferenceEntity(e.target.value as 'company' | 'member')}
              >
                {Object.entries(REFERENCE_TARGETS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
        {hasOptions && (
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Auswahlmöglichkeiten</legend>
            {options.map((o, i) => (
              <div key={i} className="flex gap-2">
                <Input
                  aria-label={`Option ${i + 1}`}
                  value={o.label}
                  placeholder={`Option ${i + 1}`}
                  onChange={(e) =>
                    setOptions(
                      options.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)),
                    )
                  }
                />
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Option entfernen"
                  disabled={options.length <= 1}
                  onClick={() => setOptions(options.filter((_, j) => j !== i))}
                >
                  <Trash2 />
                </Button>
              </div>
            ))}
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setOptions([...options, { value: '', label: '' }])}
            >
              <Plus /> Option hinzufügen
            </Button>
            {f.fieldErrors.options && (
              <p className="text-sm text-danger">{f.fieldErrors.options}</p>
            )}
          </fieldset>
        )}
        <Field label="Reihenfolge" hint="Kleinere Zahlen erscheinen weiter oben.">
          {(p) => (
            <Input
              {...p}
              type="number"
              min={0}
              max={1000}
              value={position}
              onChange={(e) => setPosition(Number(e.target.value))}
            />
          )}
        </Field>
        <Checkbox
          label="Pflichtfeld"
          description="Datensätze können nur mit ausgefülltem Feld gespeichert werden."
          checked={required}
          onChange={(e) => setRequired(e.target.checked)}
        />
      </div>
    </Dialog>
  );
}
