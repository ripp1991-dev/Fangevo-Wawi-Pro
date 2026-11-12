import { type QueryClient } from '@tanstack/react-query';
import {
  Outlet,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  redirect,
} from '@tanstack/react-router';
import { Lock } from 'lucide-react';
type ComponentType = () => React.ReactNode;
import { type Permission } from '@fangevo/shared';
import { Button, Card, EmptyState } from '@fangevo/ui';
import { AppShell } from './components/app-shell';
import { sessionQuery, useCan, useSession } from './lib/session';
import { AccountPage } from './pages/admin/account';
import { AuditPage } from './pages/admin/audit';
import { CompaniesPage } from './pages/admin/companies';
import { LicensePage } from './pages/admin/license';
import { BillingPage } from './pages/admin/billing';
import { MarketplacePage } from './pages/admin/marketplace';
import { SupportPage } from './pages/admin/support';
import { PlatformPage } from './pages/admin/platform';
import { MembersPage } from './pages/admin/members';
import { RolesPage } from './pages/admin/roles';
import { LoginPage } from './pages/auth/login';
import { MfaPage } from './pages/auth/mfa';
import { RegisterPage } from './pages/auth/register';
import {
  AcceptInvitationPage,
  ForgotPasswordPage,
  ResetPasswordPage,
  VerifyEmailPage,
} from './pages/auth/token-pages';
import { DashboardPage } from './pages/dashboard/dashboard';
import { CustomFieldsPage } from './pages/admin/custom-fields';
import { ArticlesPage } from './pages/wawi/articles';
import { CompanySettingsPage } from './pages/wawi/company-settings';
import { CustomersPage } from './pages/wawi/customers';
import { DocumentsPage } from './pages/wawi/documents';
import { InventoryPage } from './pages/wawi/inventory';
import { OrdersPage } from './pages/wawi/orders';
import { PurchasingPage } from './pages/wawi/purchasing';
import { PackingPage } from './pages/wawi/packing';
import { PacktischPage } from './pages/packtisch/packtisch';
import { PickingPage } from './pages/wawi/picking';
import { ReturnsPage } from './pages/wawi/returns';
import { ScanPage } from './pages/wawi/scan';
import { ApiKeysPage, ChannelsPage } from './pages/wawi/channels';
import { ImportPage } from './pages/wawi/import';
import { AutomationPage } from './pages/wawi/automation';
import { SuppliersPage } from './pages/wawi/suppliers';
import { SecurityPage } from './pages/settings/security';

const root = createRootRouteWithContext<{ queryClient: QueryClient }>()({ component: Outlet });

// Öffentliche Seiten. Wer bereits angemeldet ist, wird von Login/Registrierung weitergeleitet.
const guestOnly = async ({ context }: { context: { queryClient: QueryClient } }) => {
  const s = await context.queryClient.fetchQuery(sessionQuery);
  if (s && !s.mfaPending) throw redirect({ to: '/' });
};
const publicRoute = (path: string, component: ComponentType, onlyGuests = false) =>
  createRoute({
    getParentRoute: () => root,
    path,
    component,
    beforeLoad: onlyGuests ? guestOnly : undefined,
  });

const mfaRoute = createRoute({
  getParentRoute: () => root,
  path: '/mfa',
  component: MfaPage,
  beforeLoad: async ({ context }) => {
    const s = await context.queryClient.fetchQuery(sessionQuery);
    if (!s) throw redirect({ to: '/login' });
    if (!s.mfaPending) throw redirect({ to: '/' });
  },
});

// Geschützter Bereich
const app = createRoute({
  getParentRoute: () => root,
  id: 'app',
  component: AppShell,
  beforeLoad: async ({ context }) => {
    const s = await context.queryClient.fetchQuery(sessionQuery);
    if (!s) throw redirect({ to: '/login' });
    if (s.mfaPending) throw redirect({ to: '/mfa' });
    // PIN-Sitzungen gelten nur für den Packtisch
    if (s.scope) throw redirect({ to: '/packtisch' });
  },
});

// Touch-Packtisch: Vollbild ohne Menü. Ohne Anmeldung zeigt die Seite die PIN-Anmeldung
// (nur an freigegebenen Geräten, sonst Hinweis mit Link zur Anmeldung). Rechte prüft die API.
const packtischRoute = createRoute({
  getParentRoute: () => root,
  path: '/packtisch',
  component: PacktischPage,
  beforeLoad: async ({ context }) => {
    const s = await context.queryClient.fetchQuery(sessionQuery);
    if (s?.mfaPending) throw redirect({ to: '/mfa' });
  },
});

function NoAccountPage() {
  return (
    <Card>
      <EmptyState
        icon={<Lock />}
        title="Kein aktiver Account"
        description="Sie sind aktuell keinem Account zugeordnet oder Ihr Zugang wurde gesperrt. Bitte wenden Sie sich an Ihren Administrator."
      />
    </Card>
  );
}

/** Zeigt die Seite nur mit passendem Recht. Die eigentliche Prüfung erfolgt immer in der API. */
function guarded(Component: ComponentType, permission?: Permission): ComponentType {
  return function Guarded() {
    const s = useSession();
    const can = useCan();
    if (!s.account) return <NoAccountPage />;
    if (permission && !can(permission)) {
      return (
        <Card>
          <EmptyState
            icon={<Lock />}
            title="Keine Berechtigung"
            description="Für diese Seite fehlt Ihnen das nötige Recht."
            action={
              <a href="/">
                <Button variant="secondary">Zur Übersicht</Button>
              </a>
            }
          />
        </Card>
      );
    }
    return <Component />;
  };
}

const page = (path: string, component: ComponentType, permission?: Permission) =>
  createRoute({ getParentRoute: () => app, path, component: guarded(component, permission) });

const routeTree = root.addChildren([
  publicRoute('/login', LoginPage, true),
  publicRoute('/register', RegisterPage, true),
  publicRoute('/forgot-password', ForgotPasswordPage, true),
  publicRoute('/reset-password', ResetPasswordPage),
  publicRoute('/verify-email', VerifyEmailPage),
  publicRoute('/accept-invitation', AcceptInvitationPage),
  mfaRoute,
  packtischRoute,
  app.addChildren([
    page('/', DashboardPage),
    page('/orders', OrdersPage, 'orders.read'),
    page('/documents', DocumentsPage, 'documents.read'),
    page('/purchasing', PurchasingPage, 'purchasing.read'),
    page('/picking', PickingPage, 'picking.execute'),
    page('/packing', PackingPage, 'packing.execute'),
    page('/returns', ReturnsPage, 'returns.read'),
    page('/scan', ScanPage, 'inventory.read'),
    page('/import', ImportPage, 'import.execute'),
    page('/channels', ChannelsPage, 'channels.read'),
    page('/automation', AutomationPage),
    page('/admin/api-keys', ApiKeysPage, 'api_keys.manage'),
    page('/articles', ArticlesPage, 'articles.read'),
    page('/customers', CustomersPage, 'customers.read'),
    page('/suppliers', SuppliersPage, 'suppliers.read'),
    page('/inventory', InventoryPage, 'inventory.read'),
    page('/company-settings', CompanySettingsPage, 'company_settings.manage'),
    page('/admin/companies', CompaniesPage, 'companies.read'),
    page('/admin/members', MembersPage, 'users.read'),
    page('/admin/roles', RolesPage, 'roles.read'),
    page('/admin/audit', AuditPage, 'audit.read'),
    page('/admin/custom-fields', CustomFieldsPage, 'custom_fields.manage'),
    page('/admin/license', LicensePage, 'license.read'),
    page('/admin/billing', BillingPage, 'billing.manage'),
    page('/marketplace', MarketplacePage, 'license.read'),
    page('/support', SupportPage, 'support.manage'),
    page('/platform', PlatformPage),
    page('/admin/account', AccountPage, 'account.manage'),
    createRoute({ getParentRoute: () => app, path: '/settings/security', component: SecurityPage }),
  ]),
]);

export function createAppRouter(queryClient: QueryClient) {
  return createRouter({ routeTree, context: { queryClient }, defaultPreload: 'intent' });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
