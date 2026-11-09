import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Hammer } from 'lucide-react';
import { useState } from 'react';
import { Alert, Badge, Button, Card, CardBody, PageHeader, Spinner } from '@fangevo/ui';
import { ADDON_STATUS } from '@fangevo/shared';
import { errorMessage, http } from '../../lib/api';
import { formatDate } from '../../lib/format';
import { useCan, useRefreshSession } from '../../lib/session';

interface MarketModule {
  key: string;
  name: string;
  description: string;
  version: string;
  available: boolean;
  includedInPlan: boolean;
  licensed: boolean;
  bookable: boolean;
  monthlyEur: number | null;
  trialAvailable: boolean;
  addon: {
    status: keyof typeof ADDON_STATUS;
    trialEndsAt: string | null;
    endsAt: string | null;
    usable: boolean;
  } | null;
}

interface Market {
  plan: string;
  planName: string;
  pricesArePreliminary: boolean;
  trialDays: number;
  modules: MarketModule[];
}

export function MarketplacePage() {
  const qc = useQueryClient();
  const refresh = useRefreshSession();
  const can = useCan();
  const q = useQuery({
    queryKey: ['marketplace'],
    queryFn: () => http.get<Market>('/marketplace'),
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const act = async (m: MarketModule, action: 'book' | 'cancel') => {
    if (
      action === 'cancel' &&
      !window.confirm(
        m.addon?.status === 'trial'
          ? `Testversion von „${m.name}“ jetzt beenden?`
          : `„${m.name}“ zum Laufzeitende kündigen? Ihre Daten bleiben erhalten.`,
      )
    )
      return;
    setError(null);
    setBusy(m.key);
    try {
      await http.post(`/marketplace/${m.key}/${action}`);
      await qc.invalidateQueries({ queryKey: ['marketplace'] });
      await qc.invalidateQueries({ queryKey: ['billing'] });
      await refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  if (q.isPending) return <Spinner />;
  if (q.isError) return <Alert tone="danger">{errorMessage(q.error)}</Alert>;
  const d = q.data;
  const manage = can('billing.manage');
  return (
    <>
      <PageHeader
        title="Marketplace"
        description={`Alle Module von FangEvo Wawi Pro. Ihr Paket: ${d.planName}. Zusatzmodule können Sie ${d.trialDays} Tage kostenlos testen und danach monatlich kündigen.`}
      />
      {error && <Alert tone="danger">{error}</Alert>}
      {d.pricesArePreliminary && <Alert tone="info">Preise vorläufig, zzgl. Umsatzsteuer.</Alert>}
      <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {d.modules
          .filter((m) => m.key !== 'core' && m.key !== 'marketplace')
          .map((m) => (
            <Card
              key={m.key}
              role="region"
              aria-label={m.name}
              className={m.available ? '' : 'opacity-70'}
            >
              <CardBody className="flex h-full flex-col gap-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h2 className="flex items-center gap-2 font-semibold">
                      {m.licensed && <CheckCircle2 className="size-4 text-success" />}
                      {m.name}
                    </h2>
                    <p className="text-xs text-muted">Version {m.version}</p>
                  </div>
                  {m.includedInPlan ? (
                    <Badge tone="success">Im Paket</Badge>
                  ) : m.addon ? (
                    <Badge tone={m.addon.usable ? 'primary' : 'neutral'}>
                      {ADDON_STATUS[m.addon.status]}
                    </Badge>
                  ) : !m.available ? (
                    <Badge>
                      <Hammer className="size-3" /> In Entwicklung
                    </Badge>
                  ) : null}
                </div>
                <p className="flex-1 text-sm text-muted">{m.description}</p>
                {m.addon?.status === 'trial' && m.addon.trialEndsAt && (
                  <p className="text-xs">
                    Test bis {formatDate(m.addon.trialEndsAt)}, danach kostenpflichtig.
                  </p>
                )}
                {m.addon?.status === 'canceled' && m.addon.endsAt && m.addon.usable && (
                  <p className="text-xs">Gekündigt, nutzbar bis {formatDate(m.addon.endsAt)}.</p>
                )}
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">
                    {m.includedInPlan
                      ? ''
                      : m.monthlyEur !== null
                        ? `${m.monthlyEur} € / Monat`
                        : m.available
                          ? 'Nur in größeren Paketen'
                          : ''}
                  </span>
                  {manage && m.bookable && (
                    <>
                      {m.addon && (m.addon.status === 'active' || m.addon.status === 'trial') ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy === m.key}
                          onClick={() => void act(m, 'cancel')}
                        >
                          Kündigen
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          disabled={busy === m.key}
                          onClick={() => void act(m, 'book')}
                        >
                          {m.addon?.status === 'canceled' && m.addon.usable
                            ? 'Kündigung zurücknehmen'
                            : m.trialAvailable
                              ? `${d.trialDays} Tage testen`
                              : 'Buchen'}
                        </Button>
                      )}
                    </>
                  )}
                </div>
              </CardBody>
            </Card>
          ))}
      </div>
    </>
  );
}
