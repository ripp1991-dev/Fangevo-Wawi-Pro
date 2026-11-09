import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, Lock, Mail, Trash2, Undo2, Wallet } from 'lucide-react';
import { useMemo, useState } from 'react';
import { DOCUMENT_TYPES, type ListFilter } from '@fangevo/shared';
import {
  Alert,
  Badge,
  Button,
  Dialog,
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
import { DataTable } from '../../components/table/data-table';
import { type Column } from '../../components/table/types';
import { useSubmit } from '../../components/use-form';
import { errorMessage, http } from '../../lib/api';
import { formatDate, formatDateTime } from '../../lib/format';
import { formatMoney, formatQty } from '../../lib/master-data';
import {
  PAYMENT_STATUS,
  documentTypeLabel,
  openPdf,
  todayIso,
  type DocumentDetail,
  type DocumentRow,
} from '../../lib/sales';
import { useCan, useSession } from '../../lib/session';

export function useCanManageDocuments(): boolean {
  const can = useCan();
  const s = useSession();
  return can('documents.manage') && s.account?.accessMode === 'full';
}

export function DocumentsPage() {
  const [open, setOpen] = useState<string | null>(() =>
    new URLSearchParams(window.location.search).get('id'),
  );
  const columns = useMemo<Column<DocumentRow>[]>(
    () => [
      {
        id: 'type',
        header: 'Art',
        kind: 'enum',
        sortable: true,
        width: 150,
        options: Object.entries(DOCUMENT_TYPES)
          .filter(([k]) => k !== 'purchase_order')
          .map(([value, label]) => ({ value, label })),
        value: (r) => r.type,
        cell: (r) => documentTypeLabel(r.type),
      },
      {
        id: 'number',
        header: 'Nummer',
        kind: 'string',
        sortable: true,
        width: 130,
        value: (r) => r.number,
        cell: (r) => r.number ?? <Badge>Entwurf</Badge>,
      },
      {
        id: 'issueDate',
        header: 'Datum',
        kind: 'date',
        sortable: true,
        width: 120,
        value: (r) => r.issueDate,
        cell: (r) => formatDate(r.issueDate),
      },
      {
        id: 'recipient',
        header: 'Empfänger',
        kind: 'string',
        filterable: false,
        width: 220,
        value: (r) => r.recipientName,
      },
      {
        id: 'totalGross',
        header: 'Brutto',
        kind: 'number',
        sortable: true,
        width: 120,
        value: (r) => Number(r.totalGross),
        cell: (r) => <span className="tabular-nums">{formatMoney(r.totalGross)}</span>,
      },
      {
        id: 'paymentStatus',
        header: 'Zahlung',
        kind: 'enum',
        sortable: true,
        width: 150,
        options: Object.entries(PAYMENT_STATUS).map(([value, v]) => ({ value, label: v.label })),
        value: (r) => r.paymentStatus,
        cell: (r) =>
          r.paymentStatus ? (
            <Badge tone={PAYMENT_STATUS[r.paymentStatus]?.tone}>
              {PAYMENT_STATUS[r.paymentStatus]?.label ?? r.paymentStatus}
            </Badge>
          ) : null,
      },
      {
        id: 'dueDate',
        header: 'Fällig',
        kind: 'date',
        sortable: true,
        width: 120,
        defaultHidden: true,
        value: (r) => r.dueDate,
        cell: (r) => formatDate(r.dueDate),
      },
    ],
    [],
  );
  return (
    <>
      <PageHeader
        title="Belege"
        description="Angebote, Auftragsbestätigungen, Lieferscheine, Rechnungen, Gutschriften und Stornos. Belege entstehen aus Aufträgen."
      />
      <DataTable<DocumentRow>
        tableKey="documents"
        mode="server"
        queryKey={['documents']}
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
          return http.get(`/documents?${q}`);
        }}
        columns={columns}
        rowId={(r) => r.id}
        exportName="belege"
        onRowClick={(r) => setOpen(r.id)}
        initial={{ sort: 'createdAt:desc' }}
      />
      {open && <DocumentDialog id={open} onClose={() => setOpen(null)} onOpen={setOpen} />}
    </>
  );
}

/** Belege eines Auftrags (für die Auftragsansicht). */
export function OrderDocuments({
  orderId,
  orderCancelled,
}: {
  orderId: string;
  orderCancelled: boolean;
}) {
  const manage = useCanManageDocuments();
  const can = useCan();
  const qc = useQueryClient();
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ['documents', 'order', orderId],
    queryFn: () =>
      http.get<{ items: DocumentRow[] }>(
        `/documents?pageSize=100&sort=createdAt:asc&filters=${encodeURIComponent(JSON.stringify([{ field: 'orderId', op: 'eq', value: orderId }]))}`,
      ),
    enabled: can('documents.read'),
  });
  const create = async (type: string) => {
    setBusy(type);
    setError(null);
    try {
      const d = await http.post<DocumentRow>(`/documents/from-order/${orderId}`, { type });
      await qc.invalidateQueries({ queryKey: ['documents'] });
      setOpen(d.id);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  if (!can('documents.read'))
    return <p className="text-sm text-muted">Keine Berechtigung für Belege.</p>;
  return (
    <div className="space-y-3">
      {manage && !orderCancelled && (
        <div className="flex flex-wrap gap-2">
          {(['offer', 'order_confirmation', 'delivery_note', 'invoice'] as const).map((t) => (
            <Button
              key={t}
              size="sm"
              variant="secondary"
              loading={busy === t}
              onClick={() => create(t)}
            >
              <FileText /> {DOCUMENT_TYPES[t]}
            </Button>
          ))}
        </div>
      )}
      {error && <Alert tone="danger">{error}</Alert>}
      {!q.data ? (
        <Spinner />
      ) : q.data.items.length === 0 ? (
        <p className="text-sm text-muted">Noch keine Belege.</p>
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Art</TH>
              <TH>Nummer</TH>
              <TH>Datum</TH>
              <TH className="text-right">Brutto</TH>
              <TH>Zahlung</TH>
            </TR>
          </THead>
          <TBody>
            {q.data.items.map((d) => (
              <TR
                key={d.id}
                className="cursor-pointer hover:bg-surface-2"
                onClick={() => setOpen(d.id)}
              >
                <TD>{documentTypeLabel(d.type)}</TD>
                <TD>{d.number ?? <Badge>Entwurf</Badge>}</TD>
                <TD>{formatDate(d.issueDate)}</TD>
                <TD className="text-right tabular-nums">
                  {d.type === 'delivery_note' ? '–' : formatMoney(d.totalGross)}
                </TD>
                <TD>
                  {d.paymentStatus && (
                    <Badge tone={PAYMENT_STATUS[d.paymentStatus]?.tone}>
                      {PAYMENT_STATUS[d.paymentStatus]?.label}
                    </Badge>
                  )}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
      {open && <DocumentDialog id={open} onClose={() => setOpen(null)} onOpen={setOpen} />}
    </div>
  );
}

export function DocumentDialog({
  id,
  onClose,
  onOpen,
}: {
  id: string;
  onClose: () => void;
  onOpen: (id: string) => void;
}) {
  const manage = useCanManageDocuments();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['document', id],
    queryFn: () => http.get<DocumentDetail>(`/documents/${id}`),
  });
  const [action, setAction] = useState<'send' | 'payment' | 'credit' | 'cancel' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ['documents'] });
    await qc.invalidateQueries({ queryKey: ['document', id] });
    await qc.invalidateQueries({ queryKey: ['order'] });
  };
  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  const d = q.data;
  const title = d ? `${documentTypeLabel(d.type)} ${d.number ?? '(Entwurf)'}` : 'Beleg';
  return (
    <Dialog open wide onClose={onClose} title={title} description={d?.recipient.displayName}>
      {!d ? (
        q.isError ? (
          <Alert tone="danger">{errorMessage(q.error)}</Alert>
        ) : (
          <Spinner />
        )
      ) : (
        <div className="space-y-4">
          {error && <Alert tone="danger">{error}</Alert>}
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              loading={busy === 'pdf'}
              onClick={() => run('pdf', () => openPdf(`/documents/${d.id}/pdf`))}
            >
              <FileText /> {d.status === 'draft' ? 'Vorschau (PDF)' : 'PDF öffnen'}
            </Button>
            {manage && d.status === 'draft' && (
              <>
                <Button
                  size="sm"
                  loading={busy === 'finalize'}
                  onClick={() => run('finalize', () => http.post(`/documents/${d.id}/finalize`))}
                >
                  <Lock /> Festschreiben
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  loading={busy === 'delete'}
                  onClick={() =>
                    run('delete', async () => {
                      await http.del(`/documents/${d.id}`);
                      onClose();
                    })
                  }
                >
                  <Trash2 /> Entwurf löschen
                </Button>
              </>
            )}
            {manage && d.status === 'finalized' && (
              <Button size="sm" variant="secondary" onClick={() => setAction('send')}>
                <Mail /> Per E-Mail senden
              </Button>
            )}
            {manage &&
              d.type === 'invoice' &&
              d.status === 'finalized' &&
              d.paymentStatus !== 'cancelled' && (
                <>
                  <Button size="sm" variant="secondary" onClick={() => setAction('payment')}>
                    <Wallet /> Zahlung erfassen
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => setAction('credit')}>
                    <Undo2 /> Gutschrift
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setAction('cancel')}>
                    Stornieren
                  </Button>
                </>
              )}
          </div>
          {d.status === 'draft' && (
            <Alert tone="warning">
              Entwurf: Die Nummer wird erst beim Festschreiben vergeben. Danach ist der Beleg
              unveränderlich (GoBD).
            </Alert>
          )}
          <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-muted">Datum</dt>
              <dd>{formatDate(d.issueDate)}</dd>
            </div>
            {d.dueDate && (
              <div>
                <dt className="text-muted">Fällig am</dt>
                <dd>{formatDate(d.dueDate)}</dd>
              </div>
            )}
            {d.recipient.orderNumber && (
              <div>
                <dt className="text-muted">Auftrag</dt>
                <dd>{d.recipient.orderNumber}</dd>
              </div>
            )}
            {d.paymentStatus && (
              <div>
                <dt className="text-muted">Zahlung</dt>
                <dd>
                  <Badge tone={PAYMENT_STATUS[d.paymentStatus]?.tone}>
                    {PAYMENT_STATUS[d.paymentStatus]?.label}
                  </Badge>{' '}
                  {d.paymentStatus !== 'cancelled' && (
                    <span className="text-muted">offen {formatMoney(d.openAmount)}</span>
                  )}
                </dd>
              </div>
            )}
            {d.sentAt && (
              <div>
                <dt className="text-muted">Versendet</dt>
                <dd>{formatDateTime(d.sentAt)}</dd>
              </div>
            )}
          </dl>
          <Table>
            <THead>
              <TR>
                <TH>Bezeichnung</TH>
                <TH className="text-right">Menge</TH>
                {d.type !== 'delivery_note' && (
                  <>
                    <TH className="text-right">Einzelpreis netto</TH>
                    <TH className="text-right">USt</TH>
                    <TH className="text-right">Netto</TH>
                  </>
                )}
              </TR>
            </THead>
            <TBody>
              {d.lines.map((l, i) => (
                <TR key={i}>
                  <TD>
                    {l.articleNumber && <span className="text-muted">{l.articleNumber} · </span>}
                    {l.name}
                  </TD>
                  <TD className="text-right tabular-nums">
                    {formatQty(l.quantity)} {l.unit}
                  </TD>
                  {d.type !== 'delivery_note' && (
                    <>
                      <TD className="text-right tabular-nums">{formatMoney(l.unitPriceNet)}</TD>
                      <TD className="whitespace-nowrap text-right tabular-nums">
                        {formatQty(l.taxRate)} %
                      </TD>
                      <TD className="text-right tabular-nums">{formatMoney(l.lineNet)}</TD>
                    </>
                  )}
                </TR>
              ))}
            </TBody>
          </Table>
          {d.type !== 'delivery_note' && (
            <div className="ml-auto max-w-xs space-y-1 text-sm">
              <Row label="Summe netto" value={formatMoney(d.totalNet)} />
              {d.taxSummary.map((t) => (
                <Row
                  key={t.rate}
                  label={`USt ${formatQty(t.rate)} % auf ${formatMoney(t.net)}`}
                  value={formatMoney(t.tax)}
                />
              ))}
              <Row label="Gesamt" value={formatMoney(d.totalGross)} strong />
            </div>
          )}
          {d.notes && <p className="whitespace-pre-line text-sm text-muted">{d.notes}</p>}
          {d.payments.length > 0 && (
            <div>
              <p className="mb-1 text-sm font-semibold">Zahlungen</p>
              <ul className="text-sm">
                {d.payments.map((p) => (
                  <li key={p.id} className="flex justify-between gap-2 py-0.5">
                    <span>
                      {formatDate(p.paidOn)} {p.method && `· ${p.method}`}{' '}
                      {p.reference && <span className="text-muted">({p.reference})</span>}
                    </span>
                    <span className="tabular-nums">{formatMoney(p.amount)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {d.related.length > 0 && (
            <div>
              <p className="mb-1 text-sm font-semibold">Zugehörige Belege</p>
              <ul className="text-sm">
                {d.related.map((r) => (
                  <li key={r.id}>
                    <Button variant="link" size="sm" onClick={() => onOpen(r.id)}>
                      {documentTypeLabel(r.type)} {r.number ?? '(Entwurf)'} ·{' '}
                      {formatMoney(r.totalGross)}
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {d.pdfSha256 && (
            <p className="break-all text-xs text-muted">Prüfsumme (SHA-256): {d.pdfSha256}</p>
          )}
        </div>
      )}
      {d && action === 'send' && (
        <SendDialog
          path={`/documents/${d.id}/send`}
          defaultTo={d.recipient.email ?? ''}
          onClose={() => setAction(null)}
          onDone={refresh}
        />
      )}
      {d && action === 'payment' && (
        <PaymentDialog doc={d} onClose={() => setAction(null)} onDone={refresh} />
      )}
      {d && (action === 'credit' || action === 'cancel') && (
        <ReasonDialog
          title={action === 'credit' ? 'Gutschrift erstellen' : 'Rechnung stornieren'}
          description={
            action === 'credit'
              ? 'Erstellt einen Gutschrift-Entwurf über die gesamte Rechnung. Einzelne Positionen können Sie über die API gutschreiben.'
              : 'Erstellt eine Stornorechnung mit negativen Beträgen und schreibt sie sofort fest.'
          }
          confirm={action === 'credit' ? 'Gutschrift anlegen' : 'Stornorechnung erstellen'}
          onClose={() => setAction(null)}
          onSubmit={async (reason) => {
            const r = await http.post<{ id: string }>(
              `/documents/${d.id}/${action === 'credit' ? 'credit-note' : 'cancel'}`,
              { reason },
            );
            await refresh();
            onOpen(r.id);
          }}
        />
      )}
    </Dialog>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-4 ${strong ? 'font-semibold' : ''}`}>
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

export function SendDialog({
  path,
  defaultTo,
  onClose,
  onDone,
}: {
  path: string;
  defaultTo: string;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const [to, setTo] = useState(defaultTo);
  const [message, setMessage] = useState('');
  const f = useSubmit(
    () => http.post(path, { to, ...(message.trim() ? { message } : {}) }),
    async () => {
      await onDone();
      onClose();
    },
  );
  return (
    <Dialog
      open
      onClose={onClose}
      title="Per E-Mail senden"
      description="Das PDF wird als Anhang verschickt."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Abbrechen
          </Button>
          <Button loading={f.pending} onClick={() => f.submit(undefined)}>
            Senden
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {f.error && <Alert tone="danger">{f.error}</Alert>}
        <Field label="Empfänger" error={f.fieldErrors.to}>
          {(p) => <Input {...p} type="email" value={to} onChange={(e) => setTo(e.target.value)} />}
        </Field>
        <Field label="Nachricht (optional)" hint="Leer lassen = Standardtext">
          {(p) => (
            <textarea
              {...p}
              rows={4}
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
          )}
        </Field>
      </div>
    </Dialog>
  );
}

function PaymentDialog({
  doc,
  onClose,
  onDone,
}: {
  doc: DocumentDetail;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const [v, setV] = useState({
    amount: doc.openAmount.replace('.', ','),
    paidOn: todayIso(),
    method: 'Überweisung',
    reference: '',
  });
  const f = useSubmit(
    () => http.post(`/documents/${doc.id}/payments`, v),
    async () => {
      await onDone();
      onClose();
    },
  );
  return (
    <Dialog
      open
      onClose={onClose}
      title="Zahlung erfassen"
      description="Zahlungen sind unveränderlich. Korrekturen als Gegenbuchung mit negativem Betrag."
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
      <div className="grid gap-3 sm:grid-cols-2">
        {f.error && (
          <div className="sm:col-span-2">
            <Alert tone="danger">{f.error}</Alert>
          </div>
        )}
        <Field label="Betrag (brutto)" error={f.fieldErrors.amount}>
          {(p) => (
            <Input
              {...p}
              value={v.amount}
              onChange={(e) => setV({ ...v, amount: e.target.value })}
            />
          )}
        </Field>
        <Field label="Datum" error={f.fieldErrors.paidOn}>
          {(p) => (
            <Input
              {...p}
              type="date"
              value={v.paidOn}
              onChange={(e) => setV({ ...v, paidOn: e.target.value })}
            />
          )}
        </Field>
        <Field label="Zahlungsart">
          {(p) => (
            <Input
              {...p}
              value={v.method}
              onChange={(e) => setV({ ...v, method: e.target.value })}
            />
          )}
        </Field>
        <Field label="Referenz">
          {(p) => (
            <Input
              {...p}
              value={v.reference}
              onChange={(e) => setV({ ...v, reference: e.target.value })}
            />
          )}
        </Field>
      </div>
    </Dialog>
  );
}

export function ReasonDialog({
  title,
  description,
  confirm,
  onClose,
  onSubmit,
}: {
  title: string;
  description: string;
  confirm: string;
  onClose: () => void;
  onSubmit: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState('');
  const f = useSubmit(
    () => onSubmit(reason),
    () => onClose(),
  );
  return (
    <Dialog
      open
      onClose={onClose}
      title={title}
      description={description}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Abbrechen
          </Button>
          <Button variant="danger" loading={f.pending} onClick={() => f.submit(undefined)}>
            {confirm}
          </Button>
        </>
      }
    >
      {f.error && (
        <div className="mb-3">
          <Alert tone="danger">{f.error}</Alert>
        </div>
      )}
      <Field label="Grund *" error={f.fieldErrors.reason}>
        {(p) => (
          <Input {...p} autoFocus value={reason} onChange={(e) => setReason(e.target.value)} />
        )}
      </Field>
    </Dialog>
  );
}
