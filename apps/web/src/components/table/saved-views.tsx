import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bookmark, Trash2, Users } from 'lucide-react';
import { useState } from 'react';
import { type TableState } from '@fangevo/shared';
import { Alert, Button, Checkbox, Input, Popover, cn } from '@fangevo/ui';
import { errorMessage, http } from '../../lib/api';

interface SavedView {
  id: string;
  name: string;
  state: TableState;
  shared: boolean;
  mine: boolean;
}

/** Gespeicherte Ansichten: laden, speichern (persönlich/für alle), aktualisieren, löschen. */
export function SavedViews({
  tableKey,
  state,
  onApply,
}: {
  tableKey: string;
  state: TableState;
  onApply: (s: TableState) => void;
}) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['views', tableKey],
    queryFn: () => http.get<SavedView[]>(`/views?table=${tableKey}`),
  });
  const [active, setActive] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [shared, setShared] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const current = q.data?.find((v) => v.id === active);
  const refresh = () => qc.invalidateQueries({ queryKey: ['views', tableKey] });
  const run = async (fn: () => Promise<unknown>) => {
    setErr(null);
    try {
      await fn();
      await refresh();
    } catch (e) {
      setErr(errorMessage(e));
    }
  };
  return (
    <Popover
      trigger={(p) => (
        <Button variant="secondary" size="sm" {...p}>
          <Bookmark /> {current ? current.name : 'Ansichten'}
        </Button>
      )}
      className="w-80"
    >
      {(close) => (
        <div className="space-y-3 text-sm">
          {err && <Alert tone="danger">{err}</Alert>}
          <ul className="max-h-56 space-y-0.5 overflow-y-auto">
            {!q.data?.length && <li className="text-muted">Noch keine gespeicherten Ansichten.</li>}
            {q.data?.map((v) => (
              <li key={v.id} className="flex items-center justify-between gap-2">
                <button
                  className={cn(
                    'flex-1 truncate rounded-md px-2 py-1.5 text-left hover:bg-surface-2',
                    v.id === active && 'font-semibold text-primary',
                  )}
                  onClick={() => {
                    setActive(v.id);
                    onApply(v.state);
                    close();
                  }}
                >
                  {v.name}{' '}
                  {v.shared && (
                    <Users
                      className="ml-1 inline size-3 text-muted"
                      aria-label="für alle freigegeben"
                    />
                  )}
                </button>
                {v.mine && (
                  <button
                    className="rounded p-1 text-muted hover:text-danger"
                    aria-label={`Ansicht ${v.name} löschen`}
                    onClick={() =>
                      run(() => http.del(`/views/${v.id}`)).then(
                        () => v.id === active && setActive(null),
                      )
                    }
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                )}
              </li>
            ))}
          </ul>
          {current?.mine && (
            <Button
              size="sm"
              variant="secondary"
              className="w-full"
              onClick={() =>
                run(() =>
                  http.put(`/views/${current.id}`, {
                    tableKey,
                    name: current.name,
                    state,
                    shared: current.shared,
                  }),
                )
              }
            >
              „{current.name}“ mit aktueller Einstellung überschreiben
            </Button>
          )}
          <form
            className="space-y-2 border-t border-border pt-3"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                const v = await http.post<SavedView>('/views', { tableKey, name, state, shared });
                setActive(v.id);
                setName('');
              });
            }}
          >
            <p className="font-semibold">Aktuelle Ansicht speichern</p>
            <Input
              aria-label="Name der Ansicht"
              placeholder="z. B. Firmen in Österreich"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={60}
            />
            <Checkbox
              label="Für alle im Account freigeben"
              checked={shared}
              onChange={(e) => setShared(e.target.checked)}
            />
            <Button size="sm" type="submit" className="w-full">
              Speichern
            </Button>
          </form>
        </div>
      )}
    </Popover>
  );
}
