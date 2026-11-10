import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Play, RotateCcw, Save } from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  EXPORT_ENTITIES,
  IMPORT_ENTITIES,
  IMPORT_FIELDS,
  IMPORT_MODES,
  STOCK_MODES,
  type ExportEntity,
  type ImportEntity,
  type ListFilter,
} from '@fangevo/shared';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  Checkbox,
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
import { DataTable } from '../../components/table/data-table';
import { type Column } from '../../components/table/types';
import { Tabs } from '../../components/tabs';
import { errorMessage, getActiveCompany, http } from '../../lib/api';
import { formatDateTime } from '../../lib/format';

interface Job {
  id: string;
  entity: ImportEntity;
  status: 'uploaded' | 'validated' | 'queued' | 'running' | 'done' | 'failed' | 'rolled_back';
  fileName: string;
  headers: string[];
  preview: string[][];
  suggestion: Record<string, number>;
  totalRows: number;
  processedRows: number;
  okRows: number;
  errorRows: number;
  errors: { row: number; message: string }[];
  createdAt: string;
}

interface DryRun {
  create: number;
  update: number;
  book: number;
  skip: number;
  error: number;
  errors: { row: number; message: string }[];
}

const STATUS: Record<
  Job['status'],
  { label: string; tone: 'neutral' | 'primary' | 'success' | 'warning' | 'danger' }
> = {
  uploaded: { label: 'Hochgeladen', tone: 'neutral' },
  validated: { label: 'Geprüft', tone: 'primary' },
  queued: { label: 'Wartet', tone: 'warning' },
  running: { label: 'Läuft', tone: 'warning' },
  done: { label: 'Fertig', tone: 'success' },
  failed: { label: 'Abgebrochen', tone: 'danger' },
  rolled_back: { label: 'Rückgängig gemacht', tone: 'neutral' },
};

export function ImportPage() {
  const [tab, setTab] = useState<'new' | 'history' | 'export'>('new');
  const [jobId, setJobId] = useState<string | null>(null);
  return (
    <>
      <PageHeader
        title="Import & Export"
        description="Artikel, Kunden, Lieferanten, Bestände, Preise und Kategorien aus CSV- oder Excel-Dateien übernehmen – zum Beispiel aus einem JTL-Export. Jeder Import wird zuerst geprüft."
      />
      <Tabs
        tabs={[
          { id: 'new', label: 'Importieren' },
          { id: 'history', label: 'Verlauf' },
          { id: 'export', label: 'Exportieren' },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'new' && <Wizard jobId={jobId} onJob={setJobId} />}
      {tab === 'history' && (
        <History
          onOpen={(id) => {
            setJobId(id);
            setTab('new');
          }}
        />
      )}
      {tab === 'export' && <Export />}
    </>
  );
}

function readFile(f: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.onerror = () => reject(new Error('Datei konnte nicht gelesen werden'));
    r.readAsDataURL(f);
  });
}

function Wizard({ jobId, onJob }: { jobId: string | null; onJob: (id: string | null) => void }) {
  const qc = useQueryClient();
  const [entity, setEntity] = useState<ImportEntity>('articles');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const job = useQuery({
    queryKey: ['import', jobId],
    queryFn: () => http.get<Job>(`/imports/${jobId}`),
    enabled: !!jobId,
    refetchInterval: (q) =>
      q.state.data && ['queued', 'running'].includes(q.state.data.status) ? 1000 : false,
  });

  const upload = async (f: File | undefined) => {
    if (!f) return;
    setError(null);
    setBusy(true);
    try {
      if (f.size > 10 * 1024 * 1024) throw new Error('Die Datei ist zu groß (höchstens 10 MB)');
      const j = await http.post<Job>('/imports', {
        entity,
        fileName: f.name,
        contentBase64: await readFile(f),
      });
      onJob(j.id);
    } catch (e) {
      setError(e instanceof Error && !('code' in e) ? e.message : errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (!jobId)
    return (
      <Card>
        <CardBody>
          <div className="grid max-w-xl gap-4">
            {error && <Alert tone="danger">{error}</Alert>}
            <Field label="Was soll importiert werden?">
              {(p) => (
                <Select
                  {...p}
                  value={entity}
                  onChange={(e) => setEntity(e.target.value as ImportEntity)}
                >
                  {Object.entries(IMPORT_ENTITIES).map(([k, l]) => (
                    <option key={k} value={k}>
                      {l}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field
              label="Datei (CSV oder Excel .xlsx, höchstens 10 MB)"
              hint="Erste Zeile = Spaltenüberschriften. Trennzeichen und Zeichensatz werden erkannt."
            >
              {(p) => (
                <input
                  {...p}
                  type="file"
                  accept=".csv,.txt,.xlsx"
                  disabled={busy}
                  onChange={(e) => upload(e.target.files?.[0])}
                  className="text-sm"
                />
              )}
            </Field>
            {busy && <Spinner />}
          </div>
        </CardBody>
      </Card>
    );
  if (!job.data)
    return job.isError ? <Alert tone="danger">{errorMessage(job.error)}</Alert> : <Spinner />;
  return (
    <JobView
      job={job.data}
      onReset={() => {
        onJob(null);
        void qc.invalidateQueries({ queryKey: ['imports'] });
      }}
    />
  );
}

function JobView({ job, onReset }: { job: Job; onReset: () => void }) {
  const qc = useQueryClient();
  const fields = IMPORT_FIELDS[job.entity];
  const [mapping, setMapping] = useState<Record<string, number>>(job.suggestion);
  const [defaults, setDefaults] = useState<Record<string, string>>({});
  const [mode, setMode] = useState<keyof typeof IMPORT_MODES>('upsert');
  const [stockMode, setStockMode] = useState<keyof typeof STOCK_MODES>('set');
  const [createMissing, setCreateMissing] = useState(true);
  const [dry, setDry] = useState<DryRun | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [tplName, setTplName] = useState('');
  const templates = useQuery({
    queryKey: ['import-templates', job.entity],
    queryFn: () =>
      http.get<
        { id: string; name: string; columns: Record<string, string>; config: { mode?: string } }[]
      >(`/imports/templates?entity=${job.entity}`),
  });
  const editable = ['uploaded', 'validated'].includes(job.status);
  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  const config = { mapping, defaults, mode, stockMode, createMissing };
  const progress = job.totalRows ? Math.round((job.processedRows / job.totalRows) * 100) : 0;
  const hasModes = ['articles', 'customers', 'suppliers'].includes(job.entity);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={STATUS[job.status].tone}>{STATUS[job.status].label}</Badge>
        <span className="text-sm">
          {IMPORT_ENTITIES[job.entity]} aus <strong>{job.fileName}</strong> ·{' '}
          {job.totalRows.toLocaleString('de-DE')} Zeilen
        </span>
        <Button size="sm" variant="ghost" onClick={onReset}>
          Neuer Import
        </Button>
      </div>
      {error && <Alert tone="danger">{error}</Alert>}
      {info && <Alert tone="success">{info}</Alert>}

      {editable && (
        <Card>
          <CardBody>
            <div className="mb-3 flex flex-wrap items-end gap-2">
              <p className="mr-auto font-semibold">Spalten zuordnen</p>
              {!!templates.data?.length && (
                <Select
                  aria-label="Vorlage anwenden"
                  value=""
                  onChange={(e) => {
                    const tpl = templates.data!.find((x) => x.id === e.target.value);
                    if (!tpl) return;
                    const m: Record<string, number> = {};
                    for (const [k, col] of Object.entries(tpl.columns)) {
                      const idx = job.headers.indexOf(col);
                      if (idx >= 0) m[k] = idx;
                    }
                    setMapping(m);
                    if (tpl.config.mode) setMode(tpl.config.mode as keyof typeof IMPORT_MODES);
                  }}
                >
                  <option value="">Vorlage anwenden …</option>
                  {templates.data.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
                </Select>
              )}
            </div>
            <Table>
              <THead>
                <TR>
                  <TH>Feld in FangEvo</TH>
                  <TH>Spalte in der Datei</TH>
                  <TH>Standardwert (wenn leer)</TH>
                  <TH>Beispiel</TH>
                </TR>
              </THead>
              <TBody>
                {fields.map((f) => {
                  const idx = mapping[f.key];
                  return (
                    <TR key={f.key}>
                      <TD>
                        {f.label}
                        {f.required && ' *'}
                        {f.hint && <span className="block text-xs text-muted">{f.hint}</span>}
                      </TD>
                      <TD>
                        <Select
                          aria-label={`Spalte für ${f.label}`}
                          value={idx === undefined ? '' : String(idx)}
                          onChange={(e) => {
                            const m = { ...mapping };
                            if (e.target.value === '') delete m[f.key];
                            else m[f.key] = Number(e.target.value);
                            setMapping(m);
                            setDry(null);
                          }}
                        >
                          <option value="">– nicht importieren –</option>
                          {job.headers.map((h, i) => (
                            <option key={i} value={i}>
                              {h}
                            </option>
                          ))}
                        </Select>
                      </TD>
                      <TD>
                        <Input
                          aria-label={`Standardwert für ${f.label}`}
                          value={defaults[f.key] ?? ''}
                          onChange={(e) => {
                            setDefaults({ ...defaults, [f.key]: e.target.value });
                            setDry(null);
                          }}
                        />
                      </TD>
                      <TD className="max-w-48 truncate text-muted">
                        {idx !== undefined ? job.preview[0]?.[idx] : ''}
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              {hasModes && (
                <Field label="Vorgehen">
                  {(p) => (
                    <Select
                      {...p}
                      value={mode}
                      onChange={(e) => {
                        setMode(e.target.value as keyof typeof IMPORT_MODES);
                        setDry(null);
                      }}
                    >
                      {Object.entries(IMPORT_MODES).map(([k, l]) => (
                        <option key={k} value={k}>
                          {l}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              )}
              {job.entity === 'stock' && (
                <Field label="Bestand">
                  {(p) => (
                    <Select
                      {...p}
                      value={stockMode}
                      onChange={(e) => {
                        setStockMode(e.target.value as keyof typeof STOCK_MODES);
                        setDry(null);
                      }}
                    >
                      {Object.entries(STOCK_MODES).map(([k, l]) => (
                        <option key={k} value={k}>
                          {l}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              )}
              <Checkbox
                label="Fehlende Kategorien, Hersteller und Lagerplätze anlegen"
                checked={createMissing}
                onChange={(e) => {
                  setCreateMissing(e.target.checked);
                  setDry(null);
                }}
              />
            </div>
            <div className="mt-4 flex flex-wrap items-end gap-2">
              <Button
                loading={busy === 'validate'}
                onClick={() =>
                  run('validate', async () =>
                    setDry(await http.post<DryRun>(`/imports/${job.id}/validate`, config)),
                  )
                }
              >
                Prüflauf starten
              </Button>
              <div className="ml-auto flex items-end gap-2">
                <Field label="Als Vorlage speichern">
                  {(p) => (
                    <Input
                      {...p}
                      placeholder="Name der Vorlage"
                      value={tplName}
                      onChange={(e) => setTplName(e.target.value)}
                    />
                  )}
                </Field>
                <Button
                  variant="secondary"
                  disabled={!tplName}
                  loading={busy === 'tpl'}
                  onClick={() =>
                    run('tpl', async () => {
                      await http.post('/imports/templates', {
                        entity: job.entity,
                        name: tplName,
                        columns: Object.fromEntries(
                          Object.entries(mapping).map(([k, i]) => [k, job.headers[i]!]),
                        ),
                        config: { defaults, mode, stockMode, createMissing },
                      });
                      setTplName('');
                      await qc.invalidateQueries({ queryKey: ['import-templates'] });
                    })
                  }
                >
                  <Save /> Speichern
                </Button>
              </div>
            </div>
          </CardBody>
        </Card>
      )}

      {dry && editable && (
        <Card>
          <CardBody>
            <p className="mb-2 font-semibold">Ergebnis des Prüflaufs (noch nichts gespeichert)</p>
            <p className="text-sm">
              {dry.create} neu · {dry.update} ändern · {dry.book} Buchungen · {dry.skip}{' '}
              übersprungen ·{' '}
              <span className={dry.error ? 'font-semibold text-danger' : ''}>
                {dry.error} fehlerhaft
              </span>
            </p>
            <ErrorList errors={dry.errors} />
            <Button
              className="mt-3"
              loading={busy === 'start'}
              onClick={() =>
                run('start', async () => {
                  await http.post(`/imports/${job.id}/start`);
                  await qc.invalidateQueries({ queryKey: ['import', job.id] });
                })
              }
            >
              <Play /> Import ausführen
              {dry.error ? ` (fehlerhafte Zeilen werden übersprungen)` : ''}
            </Button>
          </CardBody>
        </Card>
      )}

      {!editable && (
        <Card>
          <CardBody>
            <div
              className="mb-2 h-3 overflow-hidden rounded-full bg-surface-2"
              role="progressbar"
              aria-valuenow={progress}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} />
            </div>
            <p className="text-sm">
              {job.processedRows.toLocaleString('de-DE')} von{' '}
              {job.totalRows.toLocaleString('de-DE')} Zeilen · {job.okRows} erfolgreich ·{' '}
              <span className={job.errorRows ? 'font-semibold text-danger' : ''}>
                {job.errorRows} Fehler
              </span>
            </p>
            <ErrorList errors={job.errors} />
            {job.status === 'done' &&
              ['articles', 'customers', 'suppliers'].includes(job.entity) && (
                <Button
                  className="mt-3"
                  variant="secondary"
                  loading={busy === 'rollback'}
                  onClick={() =>
                    run('rollback', async () => {
                      const r = await http.post<{ archived: number; updatedNotReverted: number }>(
                        `/imports/${job.id}/rollback`,
                      );
                      setInfo(
                        `${r.archived} neu angelegte Datensätze archiviert.${r.updatedNotReverted ? ` ${r.updatedNotReverted} Änderungen an bestehenden Datensätzen bleiben bestehen.` : ''}`,
                      );
                      await qc.invalidateQueries({ queryKey: ['import', job.id] });
                    })
                  }
                >
                  <RotateCcw /> Rückgängig (neu angelegte archivieren)
                </Button>
              )}
          </CardBody>
        </Card>
      )}

      <Card>
        <CardBody>
          <p className="mb-2 font-semibold">Vorschau (erste Zeilen)</p>
          <div className="overflow-x-auto">
            <Table>
              <THead>
                <TR>
                  {job.headers.map((h, i) => (
                    <TH key={i}>{h}</TH>
                  ))}
                </TR>
              </THead>
              <TBody>
                {job.preview.slice(0, 8).map((r, i) => (
                  <TR key={i}>
                    {r.map((c, j) => (
                      <TD key={j} className="max-w-40 truncate">
                        {c}
                      </TD>
                    ))}
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

function ErrorList({ errors }: { errors: { row: number; message: string }[] }) {
  if (!errors.length) return null;
  return (
    <ul className="mt-2 max-h-60 overflow-y-auto rounded-lg border border-border p-2 text-sm">
      {errors.map((e, i) => (
        <li key={i}>
          <span className="text-muted">{e.row ? `Zeile ${e.row}: ` : ''}</span>
          {e.message}
        </li>
      ))}
    </ul>
  );
}

function History({ onOpen }: { onOpen: (id: string) => void }) {
  const columns = useMemo<Column<Job>[]>(
    () => [
      {
        id: 'createdAt',
        header: 'Datum',
        kind: 'date',
        sortable: true,
        width: 160,
        value: (r) => r.createdAt,
        cell: (r) => formatDateTime(r.createdAt),
      },
      {
        id: 'entity',
        header: 'Datenart',
        kind: 'enum',
        sortable: true,
        width: 150,
        options: Object.entries(IMPORT_ENTITIES).map(([value, label]) => ({ value, label })),
        value: (r) => r.entity,
        cell: (r) => IMPORT_ENTITIES[r.entity],
      },
      { id: 'fileName', header: 'Datei', kind: 'string', sortable: true, value: (r) => r.fileName },
      {
        id: 'status',
        header: 'Status',
        kind: 'enum',
        sortable: true,
        width: 160,
        options: Object.entries(STATUS).map(([value, v]) => ({ value, label: v.label })),
        value: (r) => r.status,
        cell: (r) => <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge>,
      },
      {
        id: 'rows',
        header: 'Ergebnis',
        kind: 'string',
        filterable: false,
        width: 200,
        value: (r) => `${r.okRows} ok · ${r.errorRows} Fehler`,
      },
    ],
    [],
  );
  return (
    <DataTable<Job>
      tableKey="imports"
      mode="server"
      queryKey={['imports']}
      fetch={(p: {
        q: string;
        sort: string | null;
        filters: ListFilter[];
        page: number;
        pageSize: number;
      }) => {
        const q = new URLSearchParams({ page: String(p.page), pageSize: String(p.pageSize) });
        if (p.q) q.set('q', p.q);
        if (p.sort) q.set('sort', p.sort);
        if (p.filters.length) q.set('filters', JSON.stringify(p.filters));
        return http.get(`/imports?${q}`);
      }}
      columns={columns}
      rowId={(r) => r.id}
      exportName="importe"
      onRowClick={(r) => onOpen(r.id)}
      initial={{ sort: 'createdAt:desc' }}
    />
  );
}

function Export() {
  const [error, setError] = useState<string | null>(null);
  const download = async (entity: ExportEntity) => {
    setError(null);
    try {
      const companyId = getActiveCompany();
      const res = await fetch(`/api/v1/imports/export/${entity}`, {
        credentials: 'include',
        headers: companyId ? { 'x-company-id': companyId } : {},
      });
      if (!res.ok)
        throw new Error(
          ((await res.json().catch(() => ({}))) as { detail?: string }).detail ??
            'Export fehlgeschlagen',
        );
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = `${entity}-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export fehlgeschlagen');
    }
  };
  return (
    <Card>
      <CardBody>
        {error && <Alert tone="danger">{error}</Alert>}
        <p className="mb-3 text-sm text-muted">
          CSV mit Semikolon, Excel-tauglich. Die Spalten passen wieder zum Import.
        </p>
        <div className="flex flex-wrap gap-2">
          {Object.entries(EXPORT_ENTITIES).map(([k, l]) => (
            <Button key={k} variant="secondary" onClick={() => download(k as ExportEntity)}>
              <Download /> {l}
            </Button>
          ))}
        </div>
      </CardBody>
    </Card>
  );
}
