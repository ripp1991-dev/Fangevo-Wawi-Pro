import { useQuery, useQueryClient } from '@tanstack/react-query';
import { LifeBuoy, Plus } from 'lucide-react';
import { useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
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
import { SUPPORT_CATEGORIES, SUPPORT_PRIORITIES, SUPPORT_STATUS } from '@fangevo/shared';
import { formData, useSubmit } from '../../components/use-form';
import { errorMessage, http } from '../../lib/api';
import { formatDateTime } from '../../lib/format';

export interface Ticket {
  id: string;
  number: string;
  subject: string;
  category: keyof typeof SUPPORT_CATEGORIES;
  priority: keyof typeof SUPPORT_PRIORITIES;
  status: keyof typeof SUPPORT_STATUS;
  createdAt: string;
  updatedAt: string;
}
export interface TicketDetail extends Ticket {
  messages: {
    id: string;
    authorName: string;
    fromSupport: boolean;
    body: string;
    createdAt: string;
  }[];
}

export const statusTone = (s: string) =>
  s === 'waiting_customer' ? 'warning' : s === 'closed' ? 'neutral' : 'primary';

export function SupportPage() {
  const qc = useQueryClient();
  const initial =
    typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('ticket')
      : null;
  const [open, setOpen] = useState<string | null>(initial);
  const [create, setCreate] = useState(false);
  const q = useQuery({
    queryKey: ['support'],
    queryFn: () => http.get<Ticket[]>('/support/tickets'),
  });
  return (
    <>
      <PageHeader
        title="Support"
        description="Fragen, Fehler oder Wünsche? Schreiben Sie uns – Sie erhalten die Antwort hier und per E-Mail."
        actions={
          <Button onClick={() => setCreate(true)}>
            <Plus /> Neue Anfrage
          </Button>
        }
      />
      {q.isError && <Alert tone="danger">{errorMessage(q.error)}</Alert>}
      {!q.data ? (
        <Spinner />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[2fr_3fr]">
          <Card>
            <CardBody className="p-0">
              <Table>
                <THead>
                  <TR>
                    <TH>Nr.</TH>
                    <TH>Betreff</TH>
                    <TH>Status</TH>
                  </TR>
                </THead>
                <TBody>
                  {q.data.map((t) => (
                    <TR
                      key={t.id}
                      className={`cursor-pointer ${open === t.id ? 'bg-surface-2' : ''}`}
                      onClick={() => setOpen(t.id)}
                    >
                      <TD className="font-mono text-xs">{t.number}</TD>
                      <TD>
                        <button type="button" className="text-left hover:underline">
                          {t.subject}
                        </button>
                        <p className="text-xs text-muted">{formatDateTime(t.updatedAt)}</p>
                      </TD>
                      <TD>
                        <Badge tone={statusTone(t.status)}>
                          {SUPPORT_STATUS[t.status] ?? t.status}
                        </Badge>
                      </TD>
                    </TR>
                  ))}
                  {!q.data.length && (
                    <TR>
                      <TD colSpan={3} className="text-center text-muted">
                        <LifeBuoy className="mx-auto mb-2 size-6" />
                        Noch keine Anfragen
                      </TD>
                    </TR>
                  )}
                </TBody>
              </Table>
            </CardBody>
          </Card>
          {open && (
            <TicketView
              key={open}
              path={`/support/tickets/${open}`}
              replyPath={`/support/tickets/${open}/messages`}
              onChange={() => qc.invalidateQueries({ queryKey: ['support'] })}
              customer
            />
          )}
        </div>
      )}
      {create && (
        <NewTicketDialog
          onClose={() => setCreate(false)}
          onCreated={async (id) => {
            setCreate(false);
            setOpen(id);
            await qc.invalidateQueries({ queryKey: ['support'] });
          }}
        />
      )}
    </>
  );
}

/** Verlauf einer Anfrage mit Antwortfeld (Kunde und Plattform-Support). */
export function TicketView({
  path,
  replyPath,
  onChange,
  customer,
  extraReplyFields,
}: {
  path: string;
  replyPath: string;
  onChange: () => unknown;
  customer?: boolean;
  extraReplyFields?: React.ReactNode;
}) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['ticket', path], queryFn: () => http.get<TicketDetail>(path) });
  const f = useSubmit(
    (d: Record<string, string>) => http.post(replyPath, d),
    async () => {
      await qc.invalidateQueries({ queryKey: ['ticket', path] });
      await onChange();
    },
  );
  const [err, setErr] = useState<string | null>(null);
  if (q.isPending) return <Spinner />;
  if (q.isError) return <Alert tone="danger">{errorMessage(q.error)}</Alert>;
  const t = q.data;
  return (
    <Card>
      <CardHeader
        title={`${t.number} · ${t.subject}`}
        description={`${SUPPORT_CATEGORIES[t.category] ?? t.category} · Priorität ${SUPPORT_PRIORITIES[t.priority] ?? t.priority}`}
        actions={<Badge tone={statusTone(t.status)}>{SUPPORT_STATUS[t.status] ?? t.status}</Badge>}
      />
      <CardBody className="space-y-3">
        {err && <Alert tone="danger">{err}</Alert>}
        <ol className="space-y-3">
          {t.messages.map((m) => (
            <li
              key={m.id}
              className={`rounded-lg border p-3 text-sm ${
                m.fromSupport ? 'border-primary/30 bg-primary/5' : 'border-border'
              }`}
            >
              <p className="mb-1 text-xs text-muted">
                <strong className="text-fg">{m.authorName}</strong> · {formatDateTime(m.createdAt)}
              </p>
              <p className="whitespace-pre-wrap">{m.body}</p>
            </li>
          ))}
        </ol>
        <form
          className="space-y-2"
          onSubmit={(e) => {
            const d = formData(e);
            const form = e.currentTarget;
            f.submit(d, { onSuccess: () => form.reset() });
          }}
        >
          {f.error && <Alert tone="danger">{f.error}</Alert>}
          <Field label="Antwort" error={f.fieldErrors.message}>
            {(p) => (
              <textarea
                {...p}
                name="message"
                required
                rows={4}
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm"
              />
            )}
          </Field>
          {extraReplyFields}
          <div className="flex justify-end gap-2">
            {customer && t.status !== 'closed' && (
              <Button
                type="button"
                variant="ghost"
                onClick={async () => {
                  try {
                    await http.post(`${path}/close`);
                    await qc.invalidateQueries({ queryKey: ['ticket', path] });
                    await onChange();
                  } catch (e) {
                    setErr(errorMessage(e));
                  }
                }}
              >
                Als erledigt markieren
              </Button>
            )}
            <Button type="submit" disabled={f.pending}>
              Senden
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

function NewTicketDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string) => Promise<void>;
}) {
  const f = useSubmit(
    (d: Record<string, string>) => http.post<{ id: string }>('/support/tickets', d),
    (r) => onCreated(r.id),
  );
  return (
    <Dialog open onClose={onClose} title="Neue Support-Anfrage">
      <form className="space-y-3" onSubmit={(e) => f.submit(formData(e))}>
        {f.error && <Alert tone="danger">{f.error}</Alert>}
        <Field label="Betreff" error={f.fieldErrors.subject}>
          {(p) => <Input {...p} name="subject" required minLength={3} />}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Kategorie">
            {(p) => (
              <Select {...p} name="category" defaultValue="question">
                {Object.entries(SUPPORT_CATEGORIES).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Priorität">
            {(p) => (
              <Select {...p} name="priority" defaultValue="normal">
                {Object.entries(SUPPORT_PRIORITIES).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <Field
          label="Nachricht"
          hint="Bitte keine Passwörter oder Zahlungsdaten senden."
          error={f.fieldErrors.message}
        >
          {(p) => (
            <textarea
              {...p}
              name="message"
              required
              rows={6}
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm"
            />
          )}
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Abbrechen
          </Button>
          <Button type="submit" disabled={f.pending}>
            Absenden
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
