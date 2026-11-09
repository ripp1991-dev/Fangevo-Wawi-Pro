# Architektur

Stand: Phase 1 · Grundlage: [ADR-001](docs/decisions/ADR-001_TECHNOLOGIE_EMPFEHLUNG.md)

## Überblick

**Modularer Monolith** in einem TypeScript-Monorepo (pnpm Workspaces + Turborepo).

```
Browser ──► apps/web (React SPA) ──/api/v1──► apps/api (NestJS + Fastify) ──► PostgreSQL (RLS)
                                                        │                └──► Redis (Rate-Limits, später Queues)
                                                        └──► SMTP (E-Mails)
```

- **Frontend** spricht ausschließlich über die REST-API. Es darf weder `@fangevo/database` noch API-Interna importieren (per ESLint erzwungen).
- **Gemeinsame Pakete** (`shared`, `licensing`) enthalten Regeln, die Frontend und Backend identisch brauchen (Rechte, Validierung, Lizenzlogik). Die verbindliche Prüfung findet immer serverseitig statt.
- **Datenzugriff** nur über `packages/database` bzw. `apps/api/src/core/database` (ESLint verbietet direkte Prisma-Imports anderswo).

## Ablauf einer Anfrage (API)

1. **Fastify-Hooks:** Sicherheits-Header (Helmet), globales Rate-Limit, CSRF-Prüfung (Header `x-fangevo-csrf` bei schreibenden Anfragen), CORS nur für `WEB_ORIGIN`.
2. **RateLimitGuard:** strengere Limits je Route (z. B. Login: 10 Versuche / 15 min je E-Mail).
3. **AccessGuard** (zentral, für jede Route):
   1. Sitzung aus HttpOnly-Cookie prüfen (Ablauf, Inaktivität, Widerruf)
   2. Zwei-Faktor-Status prüfen
   3. Account-Kontext laden: Mitgliedschaft, effektive Rechte, Lizenz, zugängliche Firmen
   4. Lizenz: Nur-Lese-Modus bei gesperrtem Account, Modul muss gebucht sein
   5. Rechte prüfen (`@RequirePermission`)
   6. Firmenkontext aus `X-Company-Id` gegen Firmenrechte prüfen
4. **Controller → Service:** Validierung per Zod (`ZodPipe`), Geschäftslogik im Service.
5. **Datenbank:** jeder Mandantenzugriff läuft über `Database.tenant(ctx, fn)`. Das setzt den RLS-Kontext für genau diese Transaktion. Audit-Einträge entstehen in derselben Transaktion.
6. **Fehler:** `ProblemFilter` liefert RFC-9457-Problem-Details mit stabilem `code`.

Decorators (siehe `core/http/context.ts`): `@Public`, `@NoAccount`, `@AllowMfaPending`, `@AllowReadOnly`, `@RequirePermission`, `@RequiresModule`, `@RequiresCompany`, `@RateLimit`.

## Mandanten-Hierarchie

```
Account (zahlender Kunde, Mandant)
 ├── Companies (Firmen; 3 inklusive)
 ├── Memberships (Benutzer ↔ Account) ── Rollen, Einzelrechte, Firmenzugriff
 ├── Roles ── Rechte
 ├── Entitlement (Lizenz-Kern)
 └── AuditLog
User (global; kann Mitglied in mehreren Accounts sein)
```

Ab Phase 3 tragen fachliche Tabellen zusätzlich `company_id`. Der Firmenkontext kommt aus dem bereits geprüften Header `X-Company-Id`.

## Modulgrenzen

- Core-Module liegen unter `apps/api/src/core/*` (je Ordner: Service + Controller).
- Fachmodule entstehen ab Phase 3 als eigene Nest-Module unter `modules/*`. Sie dürfen nur über öffentliche Services anderer Module zugreifen, nie auf fremde Tabellen.
- Lizenzpflichtige Module markieren ihre Controller mit `@RequiresModule('<modul>')`. Rechte werden im zentralen Katalog `packages/shared/src/permissions.ts` registriert.

## Frontend

- Vite + React 19, TanStack Router (codebasierte Routen) und TanStack Query (Server-Zustand).
- Routen-Schutz: `beforeLoad` prüft die Sitzung; Seiten ohne Recht zeigen „Keine Berechtigung“ (nur Komfort, die API prüft selbst).
- Designsystem: `packages/ui` (Buttons, Formulare, Karten, Tabellen, Dialoge) mit semantischen Farb-Tokens für Hell- und Dunkelmodus (`apps/web/src/styles.css`).
- Aktive Firma wird pro Account im Browser gemerkt und bei jeder Anfrage als `X-Company-Id` mitgesendet.

## Noch nicht umgesetzt (bewusst später)

Hintergrundjobs für Importe/PDF/Synchronisation (BullMQ, ab Phase 3/5), Dateispeicher (S3, ab Phase 3), Caching des Zugriffskontexts (bei Bedarf nach Lasttests), lokaler Hardware-Connector (Phase 4).

## Phase 2: Ereignisse und Werkzeuge

```
Änderung (Service) ──► AuditService.record ──┬─► audit_logs
                         (eine Transaktion)    ├─► outbox_events (Inhalt, RLS)
                                               └─► outbox_pending (nur IDs, global)
Worker / EventDispatcher ──► holt outbox_pending (SKIP LOCKED) ──► Transaktion mit Mandantenkontext
                         ──► EventHandler (z. B. NotificationHandler) ──► notifications
```

- **Ereignisse** (ADR-006): Jede auditierte Aktion ist zugleich ein Ereignis. Neue Empfänger implementieren `EventHandler` und werden in `EVENT_HANDLERS` registriert (später Webhooks, Workflows).
- **Listen:** `buildListArgs` übersetzt `?q=&sort=&filters=&page=&pageSize=` in Prisma-Bedingungen. Erlaubt sind nur Felder aus einer Freigabeliste (`FieldSpec`); eigene Felder mit Präfix `cf.`.
- **Eigene Felder:** Definitionen in `custom_field_definitions`, Werte als JSONB am Datensatz (`custom_fields`). `CustomFieldsService.validate` prüft Typ, Pflicht, Optionen und Verweise (innerhalb des Mandanten).
- **Suche:** `search_documents` wird in derselben Transaktion wie die Änderung gepflegt (`SearchService.upsert`). Abfrage: deutscher Volltext + Präfix + Trigramm, gefiltert nach Rechten und Firmenzugriff.
- **Einstellungen und Dashboards:** persönlicher Wert vor Account-Standard vor eingebautem Standard. Widgets prüfen ihr Recht serverseitig beim Ausliefern.
- **Zugriffskontext:** Bei „alle Firmen“ werden die Firmen nicht aufgezählt; eine angefragte Firma (`X-Company-Id`) wird gezielt geprüft.
- **Frontend:** `DataTable` (Tabellen-Baukasten), `CommandPalette` (Strg+K), `NotificationBell` (Abfrage alle 30 s), Menü-Registrierung `lib/navigation.ts`, Dashboard mit `react-grid-layout`.

## Phase 3a: Fachmodule

- Fachmodule liegen unter `apps/api/src/modules/<name>` (Service + Controller): `settings`, `articles`, `customers`, `suppliers`, `inventory`; gemeinsame Helfer in `modules/common` (`CompanyDb`, Adressen/Ansprechpartner, Decimal).
- **Firmenkontext:** Controller sind mit `@RequiresCompany()` markiert. `CompanyDb.run(t, fn)` setzt `app.account_id`, `app.user_id` und `app.company_id` für die RLS und legt beim ersten Zugriff die Standardwerte der Firma an (ADR-007).
- **Bestand:** ausschließlich über `InventoryService.apply()`: Bestandszeile sperren und fortschreiben, Journalbuchung schreiben, Minusbestand prüfen. Spätere Module (Aufträge, Wareneingang, Pack) buchen über diese Funktion.
- **Nummern:** `CompanyDb.nextNumber()` (lückenlos, gesperrte Zeile).
- **Frontend:** Seiten unter `apps/web/src/pages/wawi`, Auswahllisten über `useMasterData()`; Beträge als Text, Anzeige mit `formatMoney`/`formatQty`.

## Phase 3b: Aufträge, Belege, Einkauf

- Neue Module `modules/orders`, `modules/documents`, `modules/purchasing`. Gemeinsame Rechenhilfen in `modules/common/totals.ts` (Rundung, Summen je Steuersatz).
- **Aufträge** (`OrdersService`): Preisermittlung (`resolvePrice`), Statusmaschine aus `packages/shared/src/schemas/sales.ts`, Reservierung (`stock_reservations`), Fehlmengen (`shortages`), Versand bucht über `InventoryService.apply()`.
- **Belege** (`DocumentsService`): lesen Aufträge nur über `OrdersService.forDocument()`; Aufträge prüfen offene Rechnungen über die Abfragefunktion `documents/document-queries.ts` (keine gegenseitige Abhängigkeit der Services). PDF über `document-pdf.ts` (pdfkit), Ablage mit Prüfsumme, E-Mail über `MailService` mit Anhang.
- **Einkauf** (`PurchasingService`): Wareneingang prüft Lagerplatz und Rückverfolgung über `InventoryService.checkSlot/checkTracking` und bucht über `apply()`; das Bestellungs-PDF nutzt denselben Generator.
- **Oberfläche:** Seiten `orders.tsx`, `documents.tsx`, `purchasing.tsx`; Suchfelder für Kunde/Lieferant/Artikel in `components/pickers.tsx`; PDF-Abruf mit Firmenkontext über `openPdf()` in `lib/sales.ts`.
- Entscheidungen dazu: [ADR-008](docs/decisions/ADR-008_BELEGE_RESERVIERUNG.md).

## Phase 4: Logistik

- Modul `modules/logistics` mit `ScanService`, `PickingService`, `PackingService`, `ReturnsService`; Etikett-PDF in `label-pdf.ts`.
- Packtisch und Picklisten nutzen nur Services anderer Module: `OrdersService.demands/transitionInTx/shipInTx`, `DocumentsService.fromOrderInTx/doFinalize/creditNoteInTx`, `InventoryService.apply/checkSlot/checkTracking`.
- Versanddienstleister sind als austauschbare Arten (`CARRIERS` in `packages/shared/src/schemas/logistics.ts`) angelegt; echte Anbindungen kommen als zusätzliche Arten (ADR-009).
- Oberfläche: `picking.tsx`, `packing.tsx`, `returns.tsx`, `scan.tsx` (mobil); Barcodes als Reiter im Artikel.

## Phase 5: Import, API, Kanäle

- `core/jobs/JobQueue`: Hintergrundaufgaben (Worker und im Entwicklungsmodus auch die API). Handler registrieren sich über `JOB_HANDLERS`.
- `modules/import`: Datei lesen (`parse.ts`), Zeilen vorbereiten und über `ArticlesService`, `CustomersService`, `SuppliersService`, `InventoryService` ausführen; Kategorien/Hersteller/Lagerplätze über `MasterDataService` (settings).
- `core/apikeys` + `AccessGuard`: Bearer-Anmeldung baut denselben Kontext wie eine Sitzung (Firma fest, Rechte = Schlüssel ∩ Person).
- `modules/channels`: Kanäle, Artikel je Kanal, Shop-Schnittstelle; Aufträge über `OrdersService.createInTx`, Kunden über `CustomersService.createInTx`.

## Phase 6: Automatisierung

- `WebhooksService` ist Ereignis-Handler (erzeugt Zustellungen) und Job-Handler (`webhook_delivery`).
- `WorkflowsService` ist Ereignis-Handler (legt Läufe an); `WorkflowRunHandler`/`WorkflowScheduleHandler` führen im Hintergrund aus; `startScheduler()` prüft jede Minute die Fälligkeiten.
- Aktionen laufen über `OrdersService`, `NotificationsService`, `MailService`, `WebhooksService`.

## Phase 7: Kommerzialisierung

```
Kunde (Portal/Marketplace) ─┐
Plattform-Verwaltung ───────┼─► subscriptions + subscription_addons ─► computeEntitlement ─► entitlements
Abrechnungslauf (Worker) ───┘            │                                                   (Zugriffskontrolle)
                                         └─► platform_invoices (PDF, unveränderlich) ─► E-Mail
```

Der Abrechnungslauf läuft im Worker (alle 15 Minuten) und ist durch eine Zeilensperre je Abo mehrfach startbar. Support-Tickets bleiben beim Account; der Support arbeitet über einen globalen Index. Zahlungsanbieter sind bewusst noch nicht angebunden (ADR-012).

## Phase 8: Betrieb

```
Internet ─► TLS-Proxy ─► web (nginx, CSP) ─┬─► /            statische Oberfläche
                                            └─► /api, /health ─► api (n Instanzen, distroless)
                                                                    │
                     worker (n Instanzen) ──────────────────────────┤
                                                                    ▼
                                    PostgreSQL (RLS) ◄── fangevo_backup (pg_dump)   Redis
```

Details: [OPERATIONS.md](OPERATIONS.md), ADR-013.
