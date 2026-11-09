# Module

Katalog: [`packages/licensing/src/catalog.ts`](packages/licensing/src/catalog.ts). „In Entwicklung“ heißt: geplant, aber **nicht** implementiert. Die Oberfläche zeigt das ehrlich an.

| Modul                                                             | Phase | Status    | Inhalt heute                                                                                                                                      |
| ----------------------------------------------------------------- | ----- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Core                                                              | 1     | ✅ fertig | Registrierung, Login, MFA, Sitzungen, Accounts, Firmen, Benutzer, Einladungen, Rollen & Rechte, Lizenz-Kern, Audit-Log, Administrationsoberfläche |
| Dashboard und Core-Werkzeuge                                      | 2     | ✅ fertig | Dashboard-Baukasten, Tabellen-Baukasten, eigene Felder, globale Suche, Benachrichtigungen, Aktivitäten, anpassbares Menü                          |
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

## Werkzeuge aus Phase 2 im Detail

| Bereich            | API                        | Oberfläche                             | Tests                                              |
| ------------------ | -------------------------- | -------------------------------------- | -------------------------------------------------- |
| Ereignisse         | `core/events`, `worker.ts` | –                                      | phase2.test                                        |
| Benachrichtigungen | `core/notifications`       | Glocke, „Profil & Sicherheit“          | phase2.test, E2E                                   |
| Eigene Felder      | `core/customfields`        | `/admin/custom-fields`, Firmenformular | phase2.test, tenant-isolation.test, E2E            |
| Listen/Tabellen    | `core/lists`, `core/views` | `DataTable`                            | list-query.test, phase2.test, client-ops.test, E2E |
| Suche              | `core/search`              | Strg+K                                 | phase2.test, search.service.test, E2E              |
| Aktivitäten        | `core/activity`            | Reiter „Verlauf“, Widget               | phase2.test, E2E                                   |
| Menü               | `core/preferences`         | „Menü anpassen“                        | phase2.test, navigation.test, E2E                  |
| Dashboard          | `core/dashboards`          | Startseite                             | phase2.test, E2E                                   |

## Neues Modul anlegen (ab Phase 3)

1. Rechte in `packages/shared/src/permissions.ts` ergänzen (`<modul>.read`, `<modul>.manage` …).
2. Im Modulkatalog `available: true` erst setzen, wenn das Modul die Definition of Done erfüllt.
3. Nest-Modul unter `modules/<name>` mit Service + Controller; Controller mit `@RequiresModule('<name>')` und `@RequirePermission(...)`.
4. Tabellen mit `account_id` (+ `company_id`) und RLS-Policy in der Migration; Mandanten-Trenntests ergänzen.
5. Liste über `buildListArgs` mit Feld-Freigabeliste; Tabelle im Frontend mit `DataTable` (`mode="server"`).
6. Eigene Felder: Datensatztyp in `CUSTOM_FIELD_ENTITIES` ergänzen, Spalte `custom_fields` anlegen, `CustomFieldsService.validate` nutzen.
7. Suchindex mit `SearchService.upsert` in derselben Transaktion pflegen; Menüeintrag in `apps/web/src/lib/navigation.ts`; Widgets in `packages/shared/src/widgets.ts`.
8. Änderungen über `AuditService.record` protokollieren, dann entstehen Ereignisse und Verlauf automatisch.
9. Dokumentation in `docs/modules/<name>.md`.
