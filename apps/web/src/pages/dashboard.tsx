import { Link } from '@tanstack/react-router';
import { ArrowRight, Building2, Hammer, ShieldCheck, Users } from 'lucide-react';
import { Badge, Card, CardBody, CardHeader, PageHeader } from '@fangevo/ui';
import { daysUntil } from '../lib/format';
import { useCan, useSession } from '../lib/session';

/**
 * Startseite. Das individuell konfigurierbare Dashboard mit Kennzahlen-Widgets folgt in Phase 2,
 * die Kennzahlen selbst erst mit den Fachmodulen (Phase 3). Bis dahin zeigen wir hier nur echte Daten.
 */
export function DashboardPage() {
  const s = useSession();
  const can = useCan();
  const acc = s.account!;
  const days = acc.license.status === 'TRIAL' ? daysUntil(acc.license.trialEndsAt) : null;
  const first = s.user.name.split(' ')[0];
  const quick = [
    {
      to: '/admin/companies',
      label: 'Firmen verwalten',
      text: 'Stammdaten Ihrer Firmen pflegen',
      icon: Building2,
      ok: can('companies.read'),
    },
    {
      to: '/admin/members',
      label: 'Team einladen',
      text: 'Mitarbeiter einladen und Rechte vergeben',
      icon: Users,
      ok: can('users.read'),
    },
    {
      to: '/settings/security',
      label: 'Konto absichern',
      text: s.user.mfaEnabled ? 'Zwei-Faktor ist aktiv' : 'Zwei-Faktor-Anmeldung einrichten',
      icon: ShieldCheck,
      ok: true,
    },
  ].filter((q) => q.ok);
  const upcoming = acc.license.modules.filter((m) => !m.available);

  return (
    <>
      <PageHeader title={`Hallo ${first}`} description={`Account ${acc.name}`} />
      <div className="grid gap-4 md:grid-cols-3">
        {quick.map((q) => (
          <Link key={q.to} to={q.to} className="group">
            <Card className="h-full p-5 transition-shadow group-hover:shadow-md">
              <q.icon className="size-5 text-primary" />
              <p className="mt-3 font-medium">{q.label}</p>
              <p className="mt-1 text-sm text-muted">{q.text}</p>
              <ArrowRight className="mt-3 size-4 text-muted transition-transform group-hover:translate-x-1" />
            </Card>
          </Link>
        ))}
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-[2fr_1fr]">
        <Card>
          <CardHeader
            title="Gebuchte Module"
            description="Module, die noch in Entwicklung sind, werden freigeschaltet, sobald sie fertig getestet sind."
          />
          <CardBody>
            <ul className="grid gap-2 sm:grid-cols-2">
              {acc.license.modules.map((m) => (
                <li
                  key={m.key}
                  className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm"
                >
                  <span>{m.name}</span>
                  {m.available ? (
                    <Badge tone="success">Verfügbar</Badge>
                  ) : (
                    <Badge>
                      <Hammer className="size-3" /> In Entwicklung
                    </Badge>
                  )}
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Lizenz" />
          <CardBody className="space-y-2 text-sm">
            <p>
              Paket: <strong className="capitalize">{acc.license.plan}</strong>
            </p>
            <p>
              Status:{' '}
              <Badge tone={acc.accessMode === 'full' ? 'success' : 'warning'}>
                {acc.license.status === 'TRIAL' ? 'Testphase' : acc.license.status}
              </Badge>
            </p>
            {days !== null && (
              <p className="text-muted">Testzeitraum endet in {Math.max(days, 0)} Tagen.</p>
            )}
            {upcoming.length > 0 && (
              <p className="text-muted">
                {upcoming.length} Module folgen in den nächsten Entwicklungsphasen.
              </p>
            )}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
