# Module

Katalog: [`packages/licensing/src/catalog.ts`](packages/licensing/src/catalog.ts). „In Entwicklung“ heißt: geplant, aber **nicht** implementiert. Die Oberfläche zeigt das ehrlich an.

| Modul                                                             | Phase | Status    | Inhalt heute                                                                                                                                      |
| ----------------------------------------------------------------- | ----- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Core                                                              | 1     | ✅ fertig | Registrierung, Login, MFA, Sitzungen, Accounts, Firmen, Benutzer, Einladungen, Rollen & Rechte, Lizenz-Kern, Audit-Log, Administrationsoberfläche |
| Dashboard                                                         | 2     | geplant   | (Startseite zeigt bis dahin nur echte Daten: Module, Lizenz, Schnellzugriffe)                                                                     |
| Artikel, Kunden, Lieferanten, Aufträge, Lager, Dokumente, Einkauf | 3     | geplant   | –                                                                                                                                                 |
| Pack, Versand, Retouren                                           | 4     | geplant   | –                                                                                                                                                 |
| Import, Multichannel, Finanzen, API                               | 5     | geplant   | –                                                                                                                                                 |
| Automatisierung, CRM, Analytics                                   | 6     | geplant   | –                                                                                                                                                 |
| Marketplace                                                       | 7     | geplant   | –                                                                                                                                                 |

## Core im Detail

| Bereich                            | API                                    | Oberfläche                                                  | Tests                                  |
| ---------------------------------- | -------------------------------------- | ----------------------------------------------------------- | -------------------------------------- |
| Registrierung & E-Mail-Bestätigung | `core/auth`                            | `/register`, `/verify-email`                                | auth.test, E2E                         |
| Login, Zwei-Faktor, Sitzungen      | `core/auth`                            | `/login`, `/mfa`, `/settings/security`                      | auth.test, E2E                         |
| Passwort vergessen/ändern          | `core/auth`                            | `/forgot-password`, `/reset-password`, `/settings/security` | auth.test                              |
| Firmen                             | `core/companies`                       | `/admin/companies`                                          | admin.test, tenant-isolation.test, E2E |
| Benutzer & Einladungen             | `core/members`                         | `/admin/members`, `/accept-invitation`                      | admin.test, E2E                        |
| Rollen & Rechte                    | `core/roles`, `core/access`            | `/admin/roles`                                              | admin.test                             |
| Lizenz-Kern                        | `core/licensing`, `packages/licensing` | `/admin/license`                                            | entitlement.test, admin.test           |
| Audit-Log                          | `core/audit`                           | `/admin/audit`                                              | admin.test, tenant-isolation.test      |
| Account                            | `core/accounts`                        | `/admin/account`, Account-Wechsel                           | admin.test                             |

## Neues Modul anlegen (ab Phase 3)

1. Rechte in `packages/shared/src/permissions.ts` ergänzen (`<modul>.read`, `<modul>.manage` …).
2. Im Modulkatalog `available: true` erst setzen, wenn das Modul die Definition of Done erfüllt.
3. Nest-Modul unter `modules/<name>` mit Service + Controller; Controller mit `@RequiresModule('<name>')` und `@RequirePermission(...)`.
4. Tabellen mit `account_id` (+ `company_id`) und RLS-Policy in der Migration; Mandanten-Trenntests ergänzen.
5. Dokumentation in `docs/modules/<name>.md`.
