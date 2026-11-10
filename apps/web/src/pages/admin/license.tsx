import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Hammer, MinusCircle } from 'lucide-react';
import { Alert, Badge, Card, CardBody, CardHeader, PageHeader, Spinner } from '@fangevo/ui';
import { errorMessage, http } from '../../lib/api';
import { formatDate } from '../../lib/format';

interface License {
  plan: string;
  planName: string;
  priceIsPreliminary: boolean;
  monthlyPriceEur: number | null;
  status: string;
  accessMode: string;
  trialEndsAt: string | null;
  validUntil: string | null;
  limits: { companies: number; users: number | null; connectors: number | null };
  usage: { companies: number; users: number; openInvitations: number };
  modules: { key: string; name: string; phase: number; available: boolean; licensed: boolean }[];
}

const STATUS: Record<string, string> = {
  TRIAL: 'Testphase',
  ACTIVE: 'Aktiv',
  PAST_DUE: 'Zahlung offen',
  SUSPENDED: 'Gesperrt',
  CANCELED: 'Gekündigt',
};

function Usage({ label, used, limit }: { label: string; used: number; limit: number | null }) {
  const pct = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  return (
    <div>
      <div className="flex justify-between text-sm">
        <span>{label}</span>
        <span className="font-medium">
          {used} / {limit ?? '∞'}
        </span>
      </div>
      <div
        className="mt-1.5 h-2 rounded-full bg-surface-2"
        role="progressbar"
        aria-valuenow={used}
        aria-valuemax={limit ?? undefined}
        aria-label={label}
      >
        {limit !== null && (
          <div
            className={`h-2 rounded-full ${pct >= 100 ? 'bg-warning' : 'bg-primary'}`}
            style={{ width: `${pct}%` }}
          />
        )}
      </div>
    </div>
  );
}

export function LicensePage() {
  const q = useQuery({ queryKey: ['license'], queryFn: () => http.get<License>('/admin/license') });
  if (q.isPending) return <Spinner />;
  if (q.isError) return <Alert tone="danger">{errorMessage(q.error)}</Alert>;
  const l = q.data;
  return (
    <>
      <PageHeader
        title="Lizenz"
        description="Ihr gebuchtes Paket, Limits und Module. Paket wechseln unter „Abo & Rechnungen“, Module zubuchen im Marketplace."
      />
      <div className="grid gap-4 lg:grid-cols-[1fr_2fr]">
        <Card>
          <CardHeader
            title={`Paket ${l.planName}`}
            description={
              l.monthlyPriceEur
                ? `${l.monthlyPriceEur} € / Monat${l.priceIsPreliminary ? ' (vorläufig)' : ''}`
                : 'Individuell'
            }
          />
          <CardBody className="space-y-5">
            <p className="text-sm">
              Status:{' '}
              <Badge tone={l.accessMode === 'full' ? 'success' : 'warning'}>
                {STATUS[l.status] ?? l.status}
              </Badge>
            </p>
            {l.trialEndsAt && (
              <p className="text-sm text-muted">Test endet am {formatDate(l.trialEndsAt)}</p>
            )}
            {l.validUntil && (
              <p className="text-sm text-muted">Gültig bis {formatDate(l.validUntil)}</p>
            )}
            <Usage label="Firmen" used={l.usage.companies} limit={l.limits.companies} />
            <Usage
              label="Benutzer (inkl. offener Einladungen)"
              used={l.usage.users + l.usage.openInvitations}
              limit={l.limits.users}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Module" />
          <CardBody>
            <ul className="divide-y divide-border">
              {l.modules.map((m) => (
                <li key={m.key} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <span className="flex items-center gap-2">
                    {m.licensed ? (
                      <CheckCircle2 className="size-4 text-success" />
                    ) : (
                      <MinusCircle className="size-4 text-muted" />
                    )}
                    {m.name}
                  </span>
                  <span className="flex gap-2">
                    {!m.available && (
                      <Badge>
                        <Hammer className="size-3" /> ab Phase {m.phase}
                      </Badge>
                    )}
                    <Badge tone={m.licensed ? 'success' : 'neutral'}>
                      {m.licensed ? 'Gebucht' : 'Nicht gebucht'}
                    </Badge>
                  </span>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
