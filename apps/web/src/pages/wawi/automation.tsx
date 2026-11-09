import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, FlaskConical, Plus, Send, Trash2, Workflow } from 'lucide-react';
import { useState } from 'react';
import {
  CONDITION_FIELDS,
  CONDITION_OPS,
  ORDER_STATUSES,
  SCHEDULE_CHECKS,
  WORKFLOW_ACTIONS,
  WORKFLOW_TRIGGERS,
  triggerContext,
  type ConditionOp,
  type ScheduleCheck,
  type WorkflowAction,
  type WorkflowActionType,
  type WorkflowDefinition,
  type WorkflowTrigger,
} from '@fangevo/shared';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  Checkbox,
  Dialog,
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
import { Tabs } from '../../components/tabs';
import { useSubmit } from '../../components/use-form';
import { errorMessage, http } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import { useCan, useSession } from '../../lib/session';

interface Rule {
  id: string;
  name: string;
  active: boolean;
  triggerType: WorkflowTrigger;
  currentVersion: number;
  updatedAt: string;
}
interface Run {
  id: string;
  version: number;
  status: 'queued' | 'success' | 'skipped' | 'failed' | 'test';
  eventType: string;
  entityId: string | null;
  steps: { action: string; ok: boolean; message: string }[];
  error: string | null;
  createdAt: string;
}
interface RuleDetail extends Rule {
  definition: WorkflowDefinition;
  versions: { version: number; createdAt: string }[];
  runs: Run[];
}

const RUN_TONE: Record<Run['status'], 'neutral' | 'primary' | 'success' | 'warning' | 'danger'> = {
  queued: 'primary',
  success: 'success',
  skipped: 'neutral',
  failed: 'danger',
  test: 'warning',
};
const RUN_LABEL: Record<Run['status'], string> = {
  queued: 'Wartet',
  success: 'Ausgeführt',
  skipped: 'Übersprungen',
  failed: 'Fehler',
  test: 'Testlauf',
};

export function AutomationPage() {
  const can = useCan();
  const [tab, setTab] = useState<'rules' | 'webhooks'>(() =>
    new URLSearchParams(window.location.search).get('tab') === 'webhooks' ? 'webhooks' : 'rules',
  );
  return (
    <>
      <PageHeader
        title="Automatisierung"
        description="Regeln nach dem Muster „Wenn – und – dann“ sowie Webhooks, die andere Systeme über Ereignisse informieren."
      />
      <Tabs
        tabs={[
          { id: 'rules', label: 'Regeln', hidden: !can('workflows.read') },
          { id: 'webhooks', label: 'Webhooks', hidden: !can('webhooks.manage') },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'rules' && can('workflows.read') && <Rules />}
      {tab === 'webhooks' && can('webhooks.manage') && <Webhooks />}
    </>
  );
}

function Rules() {
  const can = useCan();
  const s = useSession();
  const manage = can('workflows.manage') && s.account?.accessMode === 'full';
  const [open, setOpen] = useState<string | 'new' | null>(null);
  const q = useQuery({
    queryKey: ['workflows'],
    queryFn: () => http.get<{ items: Rule[] }>('/workflows?pageSize=200'),
  });
  return (
    <div className="space-y-3">
      {manage && (
        <Button onClick={() => setOpen('new')}>
          <Plus /> Regel anlegen
        </Button>
      )}
      {!q.data ? (
        <Spinner />
      ) : q.data.items.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted">
          Noch keine Regeln. Beispiel: „Wenn eine Bestellung über 500 € eingeht, dann Status
          ‚Ungeprüft‘ setzen und den Vertrieb benachrichtigen.“
        </p>
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Regel</TH>
              <TH>Auslöser</TH>
              <TH>Status</TH>
              <TH>Version</TH>
              <TH>Geändert</TH>
            </TR>
          </THead>
          <TBody>
            {q.data.items.map((r) => (
              <TR
                key={r.id}
                className="cursor-pointer hover:bg-surface-2"
                onClick={() => setOpen(r.id)}
              >
                <TD>
                  <Workflow className="mr-1 inline size-4" /> {r.name}
                </TD>
                <TD>{WORKFLOW_TRIGGERS[r.triggerType]}</TD>
                <TD>{r.active ? <Badge tone="success">Aktiv</Badge> : <Badge>Inaktiv</Badge>}</TD>
                <TD>{r.currentVersion}</TD>
                <TD>{formatDateTime(r.updatedAt)}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
      {open && (
        <RuleDialog
          id={open === 'new' ? null : open}
          manage={manage}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  );
}

const EMPTY: WorkflowDefinition = {
  trigger: { type: 'order.created', toStatus: null, schedule: null },
  match: 'all',
  conditions: [],
  actions: [
    {
      type: 'notify',
      permission: 'orders.read',
      title: 'Neuer Auftrag {{order.number}}',
      message: '',
    },
  ],
};

function defaultAction(type: WorkflowActionType): WorkflowAction {
  switch (type) {
    case 'set_order_status':
      return { type, status: 'unchecked' };
    case 'set_shipping_method':
      return { type, value: '' };
    case 'notify':
      return { type, permission: 'orders.read', title: '', message: '' };
    case 'send_email':
      return { type, to: '', subject: '', message: '' };
    case 'webhook':
      return { type, webhookId: '' };
  }
}

function RuleDialog({
  id,
  manage,
  onClose,
}: {
  id: string | null;
  manage: boolean;
  onClose: () => void;
}) {
  const q = useQuery({
    queryKey: ['workflow', id],
    queryFn: () => http.get<RuleDetail>(`/workflows/${id}`),
    enabled: !!id,
  });
  if (id && !q.data)
    return (
      <Dialog open onClose={onClose} title="Regel">
        {q.isError ? <Alert tone="danger">{errorMessage(q.error)}</Alert> : <Spinner />}
      </Dialog>
    );
  return (
    <RuleEditor
      key={q.data?.currentVersion ?? 'new'}
      rule={q.data ?? null}
      manage={manage}
      onClose={onClose}
    />
  );
}

function RuleEditor({
  rule,
  manage,
  onClose,
}: {
  rule: RuleDetail | null;
  manage: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [tab, setTab] = useState<'edit' | 'runs'>('edit');
  const [name, setName] = useState(rule?.name ?? '');
  const [active, setActive] = useState(rule?.active ?? false);
  const [d, setD] = useState<WorkflowDefinition>(rule?.definition ?? EMPTY);
  const [testId, setTestId] = useState('');
  const [test, setTest] = useState<{
    matched: boolean;
    conditions: { field: string; op: string; value: string; actual: unknown; ok: boolean }[];
  } | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const hooks = useQuery({
    queryKey: ['webhooks'],
    queryFn: () => http.get<{ id: string; name: string }[]>('/webhooks').catch(() => []),
  });
  const kind = triggerContext(d.trigger);
  const fields = CONDITION_FIELDS[kind] as Record<string, { label: string }>;
  const f = useSubmit(
    () =>
      rule
        ? http.put(`/workflows/${rule.id}`, { name, active, definition: d })
        : http.post('/workflows', { name, active, definition: d }),
    async () => {
      await qc.invalidateQueries({ queryKey: ['workflows'] });
      await qc.invalidateQueries({ queryKey: ['workflow'] });
      onClose();
    },
  );
  const setTrigger = (type: WorkflowTrigger) =>
    setD({
      ...d,
      trigger: {
        type,
        toStatus: null,
        schedule:
          type === 'schedule'
            ? { every: 'day', hour: 7, check: 'orders_waiting', status: null, hours: 24 }
            : null,
      },
      conditions: [],
    });
  const setAction = (i: number, a: WorkflowAction) =>
    setD({ ...d, actions: d.actions.map((x, j) => (j === i ? a : x)) });
  return (
    <Dialog
      open
      wide
      onClose={onClose}
      title={rule ? `Regel: ${rule.name}` : 'Regel anlegen'}
      description={
        rule ? `Version ${rule.currentVersion} · Speichern legt eine neue Version an` : undefined
      }
      footer={
        manage && tab === 'edit' ? (
          <>
            {rule && (
              <Button
                variant="ghost"
                onClick={async () => {
                  await http.post(`/workflows/${rule.id}/archive`);
                  await qc.invalidateQueries({ queryKey: ['workflows'] });
                  onClose();
                }}
              >
                <Trash2 /> Archivieren
              </Button>
            )}
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
      {rule && (
        <Tabs
          tabs={[
            { id: 'edit', label: 'Regel' },
            { id: 'runs', label: `Protokoll (${rule.runs.length})` },
          ]}
          value={tab}
          onChange={setTab}
        />
      )}
      {tab === 'runs' && rule && (
        <ul className="space-y-2 text-sm">
          {rule.runs.map((r) => (
            <li key={r.id} className="rounded-lg border border-border p-2">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={RUN_TONE[r.status]}>{RUN_LABEL[r.status]}</Badge>
                <span className="text-muted">
                  {formatDateTime(r.createdAt)} · v{r.version} · {r.eventType}
                </span>
              </div>
              {r.error && <p className="mt-1 text-muted">{r.error}</p>}
              {r.steps.map((s, i) => (
                <p key={i} className={s.ok ? '' : 'text-danger'}>
                  {s.ok ? '✓' : '✗'} {WORKFLOW_ACTIONS[s.action as WorkflowActionType] ?? s.action}:{' '}
                  {s.message}
                </p>
              ))}
            </li>
          ))}
          {!rule.runs.length && <li className="text-muted">Noch keine Ausführungen</li>}
        </ul>
      )}
      {tab === 'edit' && (
        <fieldset disabled={!manage} className="space-y-4">
          {f.error && <Alert tone="danger">{f.error}</Alert>}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name" error={f.fieldErrors.name}>
              {(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} />}
            </Field>
            <Checkbox
              label="Aktiv"
              description="Inaktive Regeln werden nicht ausgeführt, können aber getestet werden"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
            />
          </div>
          <Card>
            <CardBody>
              <p className="mb-2 font-semibold">Wenn …</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Auslöser">
                  {(p) => (
                    <Select
                      {...p}
                      value={d.trigger.type}
                      onChange={(e) => setTrigger(e.target.value as WorkflowTrigger)}
                    >
                      {Object.entries(WORKFLOW_TRIGGERS).map(([k, l]) => (
                        <option key={k} value={k}>
                          {l}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                {d.trigger.type === 'order.status_changed' && (
                  <Field label="Neuer Status">
                    {(p) => (
                      <Select
                        {...p}
                        value={d.trigger.toStatus ?? ''}
                        onChange={(e) =>
                          setD({
                            ...d,
                            trigger: { ...d.trigger, toStatus: e.target.value || null },
                          })
                        }
                      >
                        <option value="">jeder</option>
                        {Object.entries(ORDER_STATUSES).map(([k, l]) => (
                          <option key={k} value={k}>
                            {l}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>
                )}
                {d.trigger.type === 'schedule' && d.trigger.schedule && (
                  <>
                    <Field label="Prüfung">
                      {(p) => (
                        <Select
                          {...p}
                          value={d.trigger.schedule!.check}
                          onChange={(e) =>
                            setD({
                              ...d,
                              conditions: [],
                              trigger: {
                                ...d.trigger,
                                schedule: {
                                  ...d.trigger.schedule!,
                                  check: e.target.value as ScheduleCheck,
                                },
                              },
                            })
                          }
                        >
                          {Object.entries(SCHEDULE_CHECKS).map(([k, l]) => (
                            <option key={k} value={k}>
                              {l}
                            </option>
                          ))}
                        </Select>
                      )}
                    </Field>
                    <Field label="Häufigkeit">
                      {(p) => (
                        <Select
                          {...p}
                          value={`${d.trigger.schedule!.every}:${d.trigger.schedule!.hour}`}
                          onChange={(e) => {
                            const [every, hour] = e.target.value.split(':');
                            setD({
                              ...d,
                              trigger: {
                                ...d.trigger,
                                schedule: {
                                  ...d.trigger.schedule!,
                                  every: every as 'hour' | 'day',
                                  hour: Number(hour),
                                },
                              },
                            });
                          }}
                        >
                          <option value={`hour:${d.trigger.schedule!.hour}`}>stündlich</option>
                          {[6, 7, 8, 12, 16, 18].map((h) => (
                            <option key={h} value={`day:${h}`}>
                              täglich um {h}:00 Uhr
                            </option>
                          ))}
                        </Select>
                      )}
                    </Field>
                    {d.trigger.schedule.check === 'orders_waiting' && (
                      <>
                        <Field label="Status">
                          {(p) => (
                            <Select
                              {...p}
                              value={d.trigger.schedule!.status ?? ''}
                              onChange={(e) =>
                                setD({
                                  ...d,
                                  trigger: {
                                    ...d.trigger,
                                    schedule: {
                                      ...d.trigger.schedule!,
                                      status: e.target.value || null,
                                    },
                                  },
                                })
                              }
                            >
                              <option value="">jeder offene</option>
                              {Object.entries(ORDER_STATUSES)
                                .filter(([k]) => !['shipped', 'completed', 'cancelled'].includes(k))
                                .map(([k, l]) => (
                                  <option key={k} value={k}>
                                    {l}
                                  </option>
                                ))}
                            </Select>
                          )}
                        </Field>
                        <Field label="Länger als (Stunden)">
                          {(p) => (
                            <Input
                              {...p}
                              type="number"
                              min={1}
                              value={d.trigger.schedule!.hours ?? 24}
                              onChange={(e) =>
                                setD({
                                  ...d,
                                  trigger: {
                                    ...d.trigger,
                                    schedule: {
                                      ...d.trigger.schedule!,
                                      hours: Number(e.target.value),
                                    },
                                  },
                                })
                              }
                            />
                          )}
                        </Field>
                      </>
                    )}
                  </>
                )}
              </div>
            </CardBody>
          </Card>
          <Card>
            <CardBody>
              <div className="mb-2 flex items-center gap-2">
                <p className="font-semibold">… und</p>
                <Select
                  aria-label="Verknüpfung"
                  value={d.match}
                  onChange={(e) => setD({ ...d, match: e.target.value as 'all' | 'any' })}
                  className="w-56"
                >
                  <option value="all">alle Bedingungen erfüllt sind</option>
                  <option value="any">mindestens eine erfüllt ist</option>
                </Select>
              </div>
              {d.conditions.map((c, i) => (
                <div key={i} className="mb-2 grid gap-2 sm:grid-cols-[2fr_170px_1fr_auto]">
                  <Select
                    aria-label="Feld"
                    value={c.field}
                    onChange={(e) =>
                      setD({
                        ...d,
                        conditions: d.conditions.map((x, j) =>
                          j === i ? { ...x, field: e.target.value } : x,
                        ),
                      })
                    }
                  >
                    {Object.entries(fields).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v.label}
                      </option>
                    ))}
                  </Select>
                  <Select
                    aria-label="Vergleich"
                    value={c.op}
                    onChange={(e) =>
                      setD({
                        ...d,
                        conditions: d.conditions.map((x, j) =>
                          j === i ? { ...x, op: e.target.value as ConditionOp } : x,
                        ),
                      })
                    }
                  >
                    {Object.entries(CONDITION_OPS).map(([k, l]) => (
                      <option key={k} value={k}>
                        {l}
                      </option>
                    ))}
                  </Select>
                  <Input
                    aria-label="Wert"
                    value={c.value}
                    onChange={(e) =>
                      setD({
                        ...d,
                        conditions: d.conditions.map((x, j) =>
                          j === i ? { ...x, value: e.target.value } : x,
                        ),
                      })
                    }
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Bedingung entfernen"
                    onClick={() =>
                      setD({ ...d, conditions: d.conditions.filter((_, j) => j !== i) })
                    }
                  >
                    <Trash2 />
                  </Button>
                </div>
              ))}
              <Button
                size="sm"
                variant="secondary"
                onClick={() =>
                  setD({
                    ...d,
                    conditions: [
                      ...d.conditions,
                      { field: Object.keys(fields)[0]!, op: 'gte', value: '' },
                    ],
                  })
                }
              >
                <Plus /> Bedingung
              </Button>
              {!d.conditions.length && (
                <p className="mt-1 text-xs text-muted">Ohne Bedingung gilt die Regel immer.</p>
              )}
            </CardBody>
          </Card>
          <Card>
            <CardBody>
              <p className="mb-2 font-semibold">… dann</p>
              {d.actions.map((a, i) => (
                <div key={i} className="mb-3 rounded-lg border border-border p-2">
                  <div className="flex items-end gap-2">
                    <Field label={`Aktion ${i + 1}`}>
                      {(p) => (
                        <Select
                          {...p}
                          value={a.type}
                          onChange={(e) =>
                            setAction(i, defaultAction(e.target.value as WorkflowActionType))
                          }
                        >
                          {Object.entries(WORKFLOW_ACTIONS)
                            .filter(
                              ([k]) =>
                                kind === 'order' ||
                                (!k.startsWith('set_order') && k !== 'set_shipping_method'),
                            )
                            .map(([k, l]) => (
                              <option key={k} value={k}>
                                {l}
                              </option>
                            ))}
                        </Select>
                      )}
                    </Field>
                    {d.actions.length > 1 && (
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Aktion entfernen"
                        onClick={() => setD({ ...d, actions: d.actions.filter((_, j) => j !== i) })}
                      >
                        <Trash2 />
                      </Button>
                    )}
                  </div>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    {a.type === 'set_order_status' && (
                      <Select
                        aria-label="Neuer Status"
                        value={a.status}
                        onChange={(e) => setAction(i, { ...a, status: e.target.value })}
                      >
                        {Object.entries(ORDER_STATUSES)
                          .filter(([k]) => !['shipped', 'cancelled'].includes(k))
                          .map(([k, l]) => (
                            <option key={k} value={k}>
                              {l}
                            </option>
                          ))}
                      </Select>
                    )}
                    {a.type === 'set_shipping_method' && (
                      <Input
                        aria-label="Versandart"
                        placeholder="z. B. Spedition"
                        value={a.value}
                        onChange={(e) => setAction(i, { ...a, value: e.target.value })}
                      />
                    )}
                    {a.type === 'notify' && (
                      <>
                        <Select
                          aria-label="Wer"
                          value={a.permission}
                          onChange={(e) => setAction(i, { ...a, permission: e.target.value })}
                        >
                          <option value="orders.read">Alle mit Zugriff auf Aufträge</option>
                          <option value="orders.manage">Alle, die Aufträge bearbeiten</option>
                          <option value="inventory.read">Alle mit Zugriff auf das Lager</option>
                          <option value="purchasing.manage">Einkauf</option>
                        </Select>
                        <Input
                          aria-label="Titel"
                          placeholder="Titel, z. B. Großauftrag {{order.number}}"
                          value={a.title}
                          onChange={(e) => setAction(i, { ...a, title: e.target.value })}
                        />
                        <Input
                          aria-label="Text"
                          className="sm:col-span-2"
                          placeholder="Text (optional)"
                          value={a.message}
                          onChange={(e) => setAction(i, { ...a, message: e.target.value })}
                        />
                      </>
                    )}
                    {a.type === 'send_email' && (
                      <>
                        <Input
                          aria-label="Empfänger"
                          placeholder="E-Mail-Adresse"
                          value={a.to}
                          onChange={(e) => setAction(i, { ...a, to: e.target.value })}
                        />
                        <Input
                          aria-label="Betreff"
                          placeholder="Betreff"
                          value={a.subject}
                          onChange={(e) => setAction(i, { ...a, subject: e.target.value })}
                        />
                        <textarea
                          aria-label="Nachricht"
                          rows={3}
                          className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm sm:col-span-2"
                          value={a.message}
                          onChange={(e) => setAction(i, { ...a, message: e.target.value })}
                        />
                      </>
                    )}
                    {a.type === 'webhook' && (
                      <Select
                        aria-label="Webhook"
                        value={a.webhookId}
                        onChange={(e) => setAction(i, { ...a, webhookId: e.target.value })}
                      >
                        <option value="">– Webhook wählen –</option>
                        {hooks.data?.map((h) => (
                          <option key={h.id} value={h.id}>
                            {h.name}
                          </option>
                        ))}
                      </Select>
                    )}
                  </div>
                </div>
              ))}
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setD({ ...d, actions: [...d.actions, defaultAction('notify')] })}
              >
                <Plus /> Aktion
              </Button>
              <p className="mt-2 text-xs text-muted">
                Platzhalter:{' '}
                {Object.keys(fields)
                  .concat(
                    kind === 'order'
                      ? ['order.number', 'order.customerName']
                      : kind === 'article'
                        ? ['article.name']
                        : ['purchase.number'],
                  )
                  .map((k) => `{{${k}}}`)
                  .join(' ')}
              </p>
            </CardBody>
          </Card>
          {rule && (
            <Card>
              <CardBody>
                <p className="mb-2 font-semibold">Testlauf (führt nichts aus)</p>
                <div className="flex items-end gap-2">
                  <Field
                    label={`ID eines ${kind === 'order' ? 'Auftrags' : kind === 'article' ? 'Artikels' : 'Einkaufs'} (aus der Adresszeile, ?id=…)`}
                  >
                    {(p) => (
                      <Input {...p} value={testId} onChange={(e) => setTestId(e.target.value)} />
                    )}
                  </Field>
                  <Button
                    variant="secondary"
                    onClick={async () => {
                      setTestError(null);
                      try {
                        setTest(
                          await http.post(`/workflows/${rule.id}/test`, {
                            entityId: testId.trim(),
                          }),
                        );
                      } catch (e) {
                        setTestError(errorMessage(e));
                      }
                    }}
                  >
                    <FlaskConical /> Testen
                  </Button>
                </div>
                {testError && <Alert tone="danger">{testError}</Alert>}
                {test && (
                  <div className="mt-2 text-sm">
                    <p className="font-semibold">
                      {test.matched ? 'Regel würde greifen' : 'Regel würde nicht greifen'}
                    </p>
                    {test.conditions.map((c, i) => (
                      <p key={i} className={c.ok ? '' : 'text-danger'}>
                        {c.ok ? '✓' : '✗'} {fields[c.field]?.label ?? c.field}{' '}
                        {CONDITION_OPS[c.op as ConditionOp]} {c.value} (Ist: {String(c.actual)})
                      </p>
                    ))}
                  </div>
                )}
              </CardBody>
            </Card>
          )}
        </fieldset>
      )}
    </Dialog>
  );
}

interface Hook {
  id: string;
  name: string;
  url: string;
  events: string[];
  active: boolean;
  failureCount: number;
  disabledReason: string | null;
  lastStatus: number | null;
  lastDeliveryAt: string | null;
}

function Webhooks() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['webhooks'], queryFn: () => http.get<Hook[]>('/webhooks') });
  const events = useQuery({
    queryKey: ['webhook-events'],
    queryFn: () => http.get<{ key: string; label: string }[]>('/webhooks/events'),
  });
  const [create, setCreate] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const [open, setOpen] = useState<Hook | null>(null);
  return (
    <div className="space-y-3">
      <Button onClick={() => setCreate(true)}>
        <Plus /> Webhook anlegen
      </Button>
      {secret && (
        <Alert
          tone="warning"
          title="Signaturschlüssel jetzt kopieren – er wird nur einmal angezeigt"
        >
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <code className="break-all rounded bg-surface-2 px-2 py-1 text-sm">{secret}</code>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void navigator.clipboard?.writeText(secret)}
            >
              <Copy /> Kopieren
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSecret(null)}>
              Erledigt
            </Button>
          </div>
          <p className="mt-2 text-xs">
            Prüfen Sie jede Zustellung: HMAC-SHA256 über „Zeitstempel.Body“ muss dem Header
            X-FangEvo-Signature entsprechen.
          </p>
        </Alert>
      )}
      {!q.data ? (
        <Spinner />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Name</TH>
              <TH>Adresse</TH>
              <TH>Ereignisse</TH>
              <TH>Status</TH>
              <TH>Letzte Zustellung</TH>
            </TR>
          </THead>
          <TBody>
            {q.data.map((h) => (
              <TR
                key={h.id}
                className="cursor-pointer hover:bg-surface-2"
                onClick={() => setOpen(h)}
              >
                <TD>{h.name}</TD>
                <TD className="max-w-60 truncate font-mono text-xs">{h.url}</TD>
                <TD>{h.events.length}</TD>
                <TD>
                  {h.active ? (
                    <Badge tone="success">Aktiv</Badge>
                  ) : (
                    <Badge tone="danger">{h.disabledReason ? 'Abgeschaltet' : 'Inaktiv'}</Badge>
                  )}
                </TD>
                <TD>
                  {h.lastDeliveryAt
                    ? `${formatDateTime(h.lastDeliveryAt)} (${h.lastStatus ?? '–'})`
                    : '–'}
                </TD>
              </TR>
            ))}
            {!q.data.length && (
              <TR>
                <TD colSpan={5} className="text-center text-muted">
                  Noch keine Webhooks
                </TD>
              </TR>
            )}
          </TBody>
        </Table>
      )}
      {(create || open) && events.data && (
        <HookDialog
          hook={open}
          events={events.data}
          onClose={() => {
            setCreate(false);
            setOpen(null);
          }}
          onSaved={async (s) => {
            if (s) setSecret(s);
            setCreate(false);
            setOpen(null);
            await qc.invalidateQueries({ queryKey: ['webhooks'] });
          }}
        />
      )}
    </div>
  );
}

function HookDialog({
  hook,
  events,
  onClose,
  onSaved,
}: {
  hook: Hook | null;
  events: { key: string; label: string }[];
  onClose: () => void;
  onSaved: (secret: string | null) => Promise<void>;
}) {
  const [v, setV] = useState({
    name: hook?.name ?? '',
    url: hook?.url ?? 'https://',
    events: new Set(hook?.events ?? ['order.created']),
    active: hook?.active ?? true,
  });
  const deliveries = useQuery({
    queryKey: ['webhook-deliveries', hook?.id],
    queryFn: () =>
      http.get<
        {
          id: string;
          eventType: string;
          status: string;
          attempts: number;
          responseStatus: number | null;
          error: string | null;
          createdAt: string;
        }[]
      >(`/webhooks/${hook!.id}/deliveries`),
    enabled: !!hook,
    refetchInterval: 3000,
  });
  const [info, setInfo] = useState<string | null>(null);
  const f = useSubmit(
    () => {
      const body = { name: v.name, url: v.url, events: [...v.events], active: v.active };
      return hook
        ? http.put<{ secret?: string }>(`/webhooks/${hook.id}`, body)
        : http.post<{ secret: string }>('/webhooks', body);
    },
    (r) => onSaved(r.secret ?? null),
  );
  return (
    <Dialog
      open
      wide
      onClose={onClose}
      title={hook ? `Webhook: ${hook.name}` : 'Webhook anlegen'}
      footer={
        <>
          {hook && (
            <Button
              variant="ghost"
              onClick={async () => {
                await http.post(`/webhooks/${hook.id}/ping`);
                setInfo('Test-Ping wurde eingereiht.');
              }}
            >
              <Send /> Test-Ping
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>
            Abbrechen
          </Button>
          <Button loading={f.pending} onClick={() => f.submit(undefined)}>
            Speichern
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {f.error && <Alert tone="danger">{f.error}</Alert>}
        {info && <Alert tone="success">{info}</Alert>}
        {hook?.disabledReason && (
          <Alert tone="danger">
            {hook.disabledReason}. Mit „Aktiv“ und Speichern wieder einschalten.
          </Alert>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name" error={f.fieldErrors.name}>
            {(p) => (
              <Input {...p} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
            )}
          </Field>
          <Field label="Adresse (URL)" error={f.fieldErrors.url}>
            {(p) => (
              <Input {...p} value={v.url} onChange={(e) => setV({ ...v, url: e.target.value })} />
            )}
          </Field>
        </div>
        <Checkbox
          label="Aktiv"
          checked={v.active}
          onChange={(e) => setV({ ...v, active: e.target.checked })}
        />
        <p className="text-sm font-medium">Ereignisse</p>
        <div className="grid gap-1 sm:grid-cols-2">
          {events.map((e) => (
            <Checkbox
              key={e.key}
              label={e.label}
              description={e.key}
              checked={v.events.has(e.key)}
              onChange={(ev) => {
                const n = new Set(v.events);
                if (ev.target.checked) n.add(e.key);
                else n.delete(e.key);
                setV({ ...v, events: n });
              }}
            />
          ))}
        </div>
        {hook && (
          <div>
            <p className="mb-1 text-sm font-medium">Letzte Zustellungen</p>
            <ul className="max-h-60 space-y-1 overflow-y-auto text-sm">
              {deliveries.data?.map((d) => (
                <li key={d.id}>
                  <Badge
                    tone={
                      d.status === 'delivered'
                        ? 'success'
                        : d.status === 'failed'
                          ? 'danger'
                          : 'warning'
                    }
                  >
                    {d.status === 'delivered'
                      ? 'Zugestellt'
                      : d.status === 'failed'
                        ? 'Fehlgeschlagen'
                        : 'Ausstehend'}
                  </Badge>{' '}
                  {formatDateTime(d.createdAt)} · {d.eventType} · Versuche {d.attempts}
                  {d.responseStatus ? ` · HTTP ${d.responseStatus}` : ''}
                  {d.error && <span className="text-muted"> · {d.error}</span>}
                </li>
              ))}
              {!deliveries.data?.length && <li className="text-muted">Noch keine Zustellungen</li>}
            </ul>
          </div>
        )}
      </div>
    </Dialog>
  );
}
