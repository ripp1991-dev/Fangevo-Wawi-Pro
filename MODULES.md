# Module

Katalog: [`packages/licensing/src/catalog.ts`](packages/licensing/src/catalog.ts). „In Entwicklung“ heißt: geplant, aber **nicht** implementiert. Die Oberfläche zeigt das ehrlich an.

| Modul                               | Phase | Status    | Inhalt heute                                                                                                                                                                    |
| ----------------------------------- | ----- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Core                                | 1     | ✅ fertig | Registrierung, Login, MFA, Sitzungen, Accounts, Firmen, Benutzer, Einladungen, Rollen & Rechte, Lizenz-Kern, Audit-Log, Administrationsoberfläche                               |
| Dashboard und Core-Werkzeuge        | 2     | ✅ fertig | Dashboard-Baukasten, Tabellen-Baukasten, eigene Felder, globale Suche, Benachrichtigungen, Aktivitäten, anpassbares Menü                                                        |
| Artikel, Kunden, Lieferanten, Lager | 3a    | ✅ fertig | Stammdaten, Preise, Varianten, Sets, Adressen, Bezugsquellen, Bestandsjournal, Firmeneinstellungen                                                                              |
| Aufträge, Belege, Einkauf           | 3b    | ✅ fertig | Aufträge mit Preisermittlung, Reservierung und Versand; Belege mit PDF, E-Mail, Zahlungen, Gutschrift, Storno; Bestellvorschläge, Bestellungen, Wareneingang                    |
| Pack, Versand, Retouren             | 4     | ✅ fertig | Chargen/SN-Bestand, Picklisten, Packtisch mit Prüfung und Packregeln je Packplatz (Kanal, Kategorie), Sendungen mit eigenem Etikett, Retouren, mobile Scan-Seite (Versanddienstleister folgen nach Sandbox-Test)               |
| Import, Multichannel, API           | 5     | ✅ fertig | FangEvo Import (CSV/XLSX, Prüflauf, Hintergrund, Rückgängig), Export, API-Schlüssel, Verkaufskanal „Eigener Shop über API“ (Marktplätze erst nach Sandbox-Test); Finanzen folgt |
| Automatisierung                     | 6     | ✅ fertig | Webhooks (signiert, Wiederholungen), Regeln „Wenn–und–dann“ mit Versionen, Protokoll, Testlauf, Schleifenschutz, Zeitsteuerung; grafischer Editor folgt                         |
| CRM, Analytics                      | 6+    | geplant   | –                                                                                                                                                                               |
| Marketplace                         | 7     | geplant   | –                                                                                                                                                                               |

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

## Warenwirtschaft (Phase 3a und 3b) im Detail

| Bereich              | API                                 | Oberfläche                               | Tests             |
| -------------------- | ----------------------------------- | ---------------------------------------- | ----------------- |
| Firmeneinstellungen  | `modules/settings`                  | `/company-settings`                      | phase3a.test, E2E |
| Artikel              | `modules/articles`                  | `/articles`                              | phase3a.test, E2E |
| Kunden, Lieferanten  | `modules/customers`, `suppliers`    | `/customers`, `/suppliers`               | phase3a.test, E2E |
| Lager & Bestand      | `modules/inventory`                 | `/inventory`                             | phase3a.test, E2E |
| Aufträge             | `modules/orders`                    | `/orders`                                | phase3b.test, E2E |
| Belege und Zahlungen | `modules/documents` (PDF: pdfkit)   | `/documents`, Reiter „Belege“ im Auftrag | phase3b.test, E2E |
| Einkauf              | `modules/purchasing`                | `/purchasing`                            | phase3b.test      |
| Picklisten           | `modules/logistics/picking.service` | `/picking`                               | phase4.test, E2E  |
| Packtisch, Sendungen | `modules/logistics/packing.service` | `/packing`                               | phase4.test, E2E  |
| Retouren             | `modules/logistics/returns.service` | `/returns`                               | phase4.test, E2E  |
| Scannen, Barcodes    | `modules/logistics/scan.service`    | `/scan`, Reiter „Barcodes“               | phase4.test, E2E  |

Bekannte Grenzen (bewusst, folgen später):

- Etiketten von Versanddienstleistern (DHL, DPD, GLS, UPS …) fehlen noch: Sie brauchen Zugangsdaten und einen Test im Testsystem des Anbieters (Playbook 15).
- E-Rechnung (XRechnung/ZUGFeRD) folgt nach Prüfung durch den Steuerberater; Sonderfälle wie Reverse-Charge, innergemeinschaftliche Lieferung und Kleinunternehmerregelung werden noch nicht automatisch auf der Rechnung vermerkt.
- Gutschriften für einzelne Positionen sind über die API möglich, die Oberfläche bietet die Gutschrift über die ganze Rechnung.

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

## Phase 5 im Detail

| Bereich        | API                              | Oberfläche        | Tests            |
| -------------- | -------------------------------- | ----------------- | ---------------- |
| Import, Export | `modules/import` (+ `core/jobs`) | `/import`         | phase5.test, E2E |
| API-Schlüssel  | `core/apikeys`, `AccessGuard`    | `/admin/api-keys` | phase5.test, E2E |
| Verkaufskanäle | `modules/channels`               | `/channels`       | phase5.test, E2E |

## Phase 6 im Detail

| Bereich  | API                                    | Oberfläche                      | Tests            |
| -------- | -------------------------------------- | ------------------------------- | ---------------- |
| Webhooks | `modules/automation/webhooks.service`  | `/automation` (Reiter Webhooks) | phase6.test, E2E |
| Regeln   | `modules/automation/workflows.service` | `/automation`                   | phase6.test, E2E |

## Phase 7 im Detail

- **Abo & Rechnungen** (`modules/billing`): `BillingService` mit Kundenportal, Marketplace, Abrechnungslauf (`startScheduler`, `processAccount`) und `syncEntitlement`. Regeln als reine Funktionen in `packages/licensing/src/billing.ts`.
- **Support** (`modules/support`): Anfragen, Verlauf, E-Mails, Antwort des Supports.
- **Plattform-Verwaltung** (`modules/platform`): `PlatformAdminGuard` (E-Mail-Freigabe + 2FA), Accounts, Lizenz, Rechnungen, Support-Postfach.
- Oberfläche: `/admin/billing`, `/marketplace`, `/support`, `/platform` (nur für FangEvo-Mitarbeiter sichtbar).
