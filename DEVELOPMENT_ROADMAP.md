# FangEvo Wawi Pro – Entwicklungsplan

**Stand:** 2026-11-09 · **Status:** Phase 0–4 abgeschlossen · nächster Schritt: Phase 5 (Import und Multichannel)
Grundlage: [Master Playbook v1.0](docs/product/MASTER_PLAYBOOK_v1.0.md) · Technik: [ADR-001](docs/decisions/ADR-001_TECHNOLOGIE_EMPFEHLUNG.md)

---

## 1. Modulübersicht und Abhängigkeiten

```
                     ┌───────────────────────────── Core ─────────────────────────────┐
                     │ Auth · Mandanten/Firmen · Benutzer/Rollen · Lizenz-Kern ·       │
                     │ Audit-Log · Eigene Felder · Events/Outbox · Nummernkreise        │
                     └───────────────┬────────────────────────────────────────────────┘
                                     │ alle Module hängen vom Core ab
        ┌──────────────┬─────────────┼──────────────┬──────────────┐
     Artikel        Kunden      Lieferanten       Lager        Dokumente
        │              │             │              │              │
        └──────┬───────┴──────┬──────┘              │              │
               │              │                     │              │
           Aufträge ◄─────────┼──── Bestände ◄──────┘              │
               │           Einkauf ◄── (Lieferanten, Artikel, Lager)│
               │                                                   │
      ┌────────┼──────────────┬───────────────┐                    │
   Pack/Versand  Retouren   Finanzen ◄─────────┴────────────────────┘
               │
   Import · Multichannel-Connectoren · Workflows · Webhooks · Analytics · Marketplace
```

| Modul                                                                 | Hängt ab von                 | Phase                     | Priorität              |
| --------------------------------------------------------------------- | ---------------------------- | ------------------------- | ---------------------- |
| Core (Auth, Mandanten, Firmen, Benutzer, Rollen, Audit)               | –                            | 1                         | P0                     |
| Lizenz-Kern (Berechtigungen, Limits)                                  | Core                         | 1                         | P0                     |
| UI-Designsystem, App-Rahmen, Navigation                               | –                            | 1                         | P0                     |
| Tabellen-Baukasten, eigene Felder, globale Suche, Aktivitätsprotokoll | Core                         | 2                         | P0                     |
| Dashboard + Widgets                                                   | Core, später alle Fachmodule | 2 (Rahmen) / 3+ (Widgets) | P1                     |
| Artikel (inkl. Varianten, Preise, Kategorien)                         | Core                         | 3                         | P0                     |
| Kunden                                                                | Core                         | 3                         | P0                     |
| Lieferanten                                                           | Core                         | 3                         | P0                     |
| Lager + Bestandsjournal                                               | Artikel                      | 3                         | P0                     |
| Aufträge (inkl. Statusmaschine)                                       | Artikel, Kunden, Lager       | 3                         | P0                     |
| Dokumente (Rechnung, Lieferschein, Gutschrift, PDF, Nummernkreise)    | Aufträge                     | 3                         | P0                     |
| Einkauf (Bestellungen, Wareneingang)                                  | Lieferanten, Artikel, Lager  | 3                         | P1                     |
| Kommissionierung, Picklisten, mobile Oberfläche                       | Lager, Aufträge              | 4                         | P1                     |
| FangEvo Pack + Versandetiketten                                       | Aufträge, Dokumente          | 4                         | P1                     |
| Retouren                                                              | Aufträge, Lager, Dokumente   | 4                         | P1                     |
| FangEvo Import (CSV/XLSX)                                             | Fachmodule                   | 5                         | P1                     |
| Öffentliche REST-API + API-Schlüssel                                  | Core                         | 5                         | P1                     |
| Connector-Framework + 1–2 erste Shops                                 | Import, API                  | 5                         | P1                     |
| Finanzen (Zahlungsstatus, offene Posten, Buchhaltungsexport)          | Dokumente                    | 5                         | P1                     |
| Workflows, Webhooks, Zeitpläne                                        | Events                       | 6                         | P2                     |
| CRM                                                                   | Kunden                       | 6                         | P2                     |
| Abonnements, Zahlung, Kundenportal                                    | Lizenz-Kern                  | 7                         | P1 (vor Verkaufsstart) |
| Marketplace                                                           | Lizenz, Connectoren          | 7                         | P2                     |
| Analytics (erweitert)                                                 | alle                         | 6–8                       | P2                     |

> Die „erste marktfähige Version“ (Playbook Abschnitt 27) umfasst alle P0- und P1-Zeilen.

## 2. Kern-Datenmodell (erste Fassung)

Alle Geschäftstabellen enthalten `id` (UUID v7), `account_id`, `company_id` (wo firmenbezogen), `created_at/by`, `updated_at/by`, `archived_at` sowie `custom_fields` (JSONB, falls erweiterbar).

**Core**

- `Account`: der zahlende FangEvo-Kunde
- `Company`: Firma innerhalb eines Accounts (3 inklusive)
- `User` – `Membership` (User ↔ Account) – `CompanyAccess` (welche Firmen)
- `Role`, `Permission`, `RolePermission` (Rechte wie `orders.read`, `orders.cancel` …)
- `Entitlement`: Lizenz-Kern (Modul X aktiv, max. Firmen, max. Benutzer, max. Connectoren, gültig bis)
- `AuditLog` (unveränderlich), `ActivityEvent`, `OutboxEvent`
- `CustomFieldDefinition` (Entität, Typ, Optionen, Pflichtfeld)
- `NumberSequence` (Nummernkreis pro Firma und Belegart, lückenlos)
- `SavedView` (Tabellenansichten), `DashboardLayout`

**Warenwirtschaft**

- `Product` (Vater/Kind über `parent_id`), `ProductVariantAttribute`, `ProductIdentifier` (SKU/EAN/GTIN), `Category`, `Manufacturer`, `ProductMedia`, `ProductTranslation`
- `PriceList`, `Price` (Kundengruppe, Staffel, Kanal), `BundleComponent` (Stückliste/Set)
- `Customer`, `CustomerGroup`, `Address`, `ContactPerson`
- `Supplier`, `SupplierProduct` (Lieferanten-Art.-Nr., EK-Preis, Lieferzeit, Mindestmenge)
- `Warehouse`, `StorageLocation` (Bereich/Regal/Platz), `StockMovement` (Journal, unveränderlich), `StockLevel` (abgeleitet), `StockReservation`, `Batch`, `SerialNumber`
- `SalesOrder`, `SalesOrderLine`, `OrderStatusHistory`
- `PurchaseOrder`, `PurchaseOrderLine`, `GoodsReceipt`
- `Document` (Rechnung, Lieferschein, Gutschrift … unveränderlich nach Festschreibung), `DocumentLine`, `Payment`
- `Shipment`, `Package`, `Return`, `ReturnLine`
- `SalesChannel`, `ChannelListing` (kanalbezogene Produktdaten), `ConnectorAccount`, `SyncJob`, `ImportJob`, `ImportTemplate`

Details folgen in `DATABASE.md`, sobald Phase 1 startet.

## 3. API-Konzept

- **REST**, versioniert unter `/api/v1/...`, OpenAPI-Dokument automatisch erzeugt.
- Einheitliches Fehlerformat (RFC 9457 „Problem Details“) mit festen Fehlercodes.
- Mandantenkontext kommt **aus der Anmeldung** (Session bzw. API-Schlüssel), nie aus Parametern, die der Client frei wählen kann. Firmenwechsel über Header `X-Company-Id`, serverseitig gegen `CompanyAccess` geprüft.
- Listen: Cursor-Paginierung, Filter, Sortierung, Feldauswahl.
- Schreibende Endpunkte unterstützen `Idempotency-Key` (wichtig für Shop-Connectoren).
- Optimistische Sperre über `version`, damit zwei Mitarbeiter sich nicht gegenseitig überschreiben.
- Interne Frontend-API und öffentliche API sind **dieselbe** API; die öffentliche ist nur ein freigegebener Teil (API-Schlüssel mit Rechten).
- Webhooks (Phase 6) speisen sich aus den Outbox-Events: signiert, mit Wiederholung.

## 4. Teststrategie

| Ebene                 | Werkzeug                                           | Was                                                                                                    |
| --------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Unit                  | Vitest                                             | Geschäftsregeln (Preise, Statusmaschine, Bestand)                                                      |
| Integration           | Vitest + echtes PostgreSQL/Redis                   | Services inkl. Datenbank, RLS                                                                          |
| **Mandantentrennung** | eigene Testsuite                                   | Für **jede** Ressource: Benutzer A darf Daten von Account B weder lesen noch ändern; Pflichttest im CI |
| Rechte / Lizenzen     | Integration                                        | Ohne Recht bzw. Lizenz gibt es 403                                                                     |
| API-Vertrag           | OpenAPI-Abgleich                                   | Keine unbeabsichtigten Breaking Changes                                                                |
| E2E                   | Playwright                                         | Kernprozesse: Registrieren → Firma → Artikel → Auftrag → Rechnung                                      |
| Last                  | k6                                                 | ab Phase 3                                                                                             |
| Sicherheit            | Dependency-Scan, statische Analyse, später Pentest | CI + vor Go-Live                                                                                       |

Regel: Kein Merge auf `main` ohne grüne Pipeline.

## 5. Arbeitspakete

### Phase 1 – Technisches Fundament (detailliert)

| AP   | Inhalt                                                                                                                                                       | Ergebnis / Abnahme                        |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------- |
| 1.1  | Monorepo-Gerüst: pnpm, Turborepo, TypeScript strict, ESLint (inkl. Modulgrenzen), Prettier, Vitest, Ordnerstruktur nach Playbook 23                          | `pnpm lint/typecheck/test` laufen         |
| 1.2  | Docker Compose für Entwicklung: PostgreSQL, Redis, MinIO, Mailpit; `.env.example`                                                                            | Ein Befehl startet die Umgebung           |
| 1.3  | CI (GitHub Actions): Lint, Typen, Tests mit Postgres                                                                                                         | grüner Build                              |
| 1.4  | API-Grundgerüst: NestJS + Fastify, Konfiguration, Logging, Fehlerformat, OpenAPI, Health-Check                                                               | `/api/docs` erreichbar                    |
| 1.5  | Datenbank: Prisma, erste Migration (Account, Company, User, Membership, Role, Permission, Entitlement, AuditLog), RLS-Policies, Mandantenkontext pro Anfrage | Mandanten-Trenntests grün                 |
| 1.6  | Authentifizierung: Registrierung, Login, Logout, Passwort vergessen, E-Mail-Bestätigung, TOTP-MFA, Sessions                                                  | E2E-Test Login                            |
| 1.7  | Account- und Firmenverwaltung (Limit 3 Firmen über Entitlement)                                                                                              | Test: 4. Firma wird ohne Lizenz abgelehnt |
| 1.8  | Benutzer: einladen, deaktivieren, Rollen, Einzelrechte, Firmen- und Modulzugriff                                                                             | Rechte-Tests grün                         |
| 1.9  | Lizenz-Kern: Entitlement-Service, Guard `@RequiresModule()`, Limits                                                                                          | serverseitig geprüft                      |
| 1.10 | Audit-Log für sicherheitsrelevante Aktionen                                                                                                                  | Einträge unveränderlich                   |
| 1.11 | Frontend-Grundgerüst: Vite, Router, Login-Seiten, App-Rahmen mit Navigation, Firmenwechsler, Designsystem-Basis (Farben, Typografie, Hell/Dunkel)            | klickbarer Ablauf Login → Admin           |
| 1.12 | Doku: README, ARCHITECTURE, DATABASE, SECURITY, LICENSING, TESTING, DECISIONS, CHANGELOG                                                                     | aktuell                                   |

#### Status Phase 1 (2026-11-09): abgeschlossen

| AP                    | Status                                         | Nachweis                                                                                                                                                                                                   |
| --------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.1 Monorepo          | ✅                                             | `pnpm lint`, `typecheck`, `test`, `build` grün                                                                                                                                                             |
| 1.2 Docker Compose    | ✅ erstellt, ⚠️ nicht ausgeführt               | In der Cloud-Sitzung lief kein Docker-Daemon. PostgreSQL und Redis wurden dort nativ mit identischer Rollen-Einrichtung (`postgres-init.sql`) betrieben. Bitte einmal lokal mit `docker compose up` prüfen |
| 1.3 CI                | ✅ erstellt, ⚠️ noch nicht auf GitHub gelaufen | Alle CI-Schritte lokal identisch ausgeführt und grün                                                                                                                                                       |
| 1.4 API-Grundgerüst   | ✅                                             | `/health`, `/api/docs`, `docs/api/openapi.json`, Problem-Details                                                                                                                                           |
| 1.5 Datenbank + RLS   | ✅                                             | 12 Mandanten-Trenntests grün (API- und DB-Ebene)                                                                                                                                                           |
| 1.6 Authentifizierung | ✅                                             | 16 Tests + Browser-E2E (Registrierung, Bestätigung, Login)                                                                                                                                                 |
| 1.7 Account/Firmen    | ✅                                             | Test: 4. Firma wird abgelehnt; Archivieren, optimistische Sperre                                                                                                                                           |
| 1.8 Benutzer & Rechte | ✅                                             | Einladung, Sperren, Rollen, Einzelrechte, Firmenzugriff, Schutz vor Rechteausweitung                                                                                                                       |
| 1.9 Lizenz-Kern       | ✅                                             | Module, Limits, Testphase, Nur-Lese-Modus serverseitig                                                                                                                                                     |
| 1.10 Audit-Log        | ✅                                             | unveränderlich (Trigger + Rechte), Oberfläche mit Filter                                                                                                                                                   |
| 1.11 Frontend         | ✅                                             | E2E-Ablauf Login → Administration, mobil und Dunkelmodus                                                                                                                                                   |
| 1.12 Doku             | ✅                                             | README, ARCHITECTURE, DATABASE, API, SECURITY, LICENSING, MODULES, TESTING, CHANGELOG, DECISIONS                                                                                                           |

Abweichungen vom Plan: eigene Sitzungs-Authentifizierung statt Better Auth ([ADR-002](docs/decisions/ADR-002_AUTHENTIFIZIERUNG.md)); Vite statt Next.js, von FangEvo bestätigt ([ADR-003](docs/decisions/ADR-003_FRONTEND_VITE.md)); Prisma 6 statt 7 ([ADR-005](docs/decisions/ADR-005_ABHAENGIGKEITSVERSIONEN.md)).

### Phase 2 – Dashboard und Core (detailliert) · Status: abgeschlossen (2026-11-09)

**Wichtige Rahmenbedingung:** Fachdaten (Artikel, Aufträge, Umsätze) gibt es erst ab Phase 3. Phase 2 baut deshalb die **Werkzeuge** (Dashboard-Baukasten, Tabellen, eigene Felder, Suche, Benachrichtigungen) und erprobt sie an den vorhandenen Daten (Firmen, Benutzer, Audit-Log). Umsatz- und Lager-Widgets werden **nicht vorgetäuscht**, sondern kommen mit den Fachmodulen in Phase 3. Jedes neue Modul kann die Werkzeuge dann ohne Zusatzaufwand nutzen.

| AP  | Inhalt                                                                                                                                                                                                                                                                                                                                                                            | Ergebnis / Abnahme                                                             |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| 2.1 | **Ereignis-System:** Jede fachliche Änderung erzeugt in derselben Transaktion ein Ereignis (Outbox-Tabelle). Ein Verteiler (Redis + BullMQ, eigener Worker-Prozess) liefert es an Empfänger aus: jetzt Benachrichtigungen und Aktivitäten, später Webhooks und Workflows (Phase 6)                                                                                                | kein Ereignis geht verloren, auch bei Absturz; Wiederholung bei Fehlern; Tests |
| 2.2 | **Hauptnavigation:** Module melden ihre Menüpunkte zentral an; nicht gebuchte oder nicht erlaubte Punkte sind unsichtbar. Benutzer können Menüpunkte ausblenden, sortieren und als Favoriten anheften. Befehlspalette mit **Strg+K**                                                                                                                                              | Menü passt sich Lizenz, Rechten und persönlicher Einstellung an                |
| 2.3 | **Tabellen-Baukasten:** eine gemeinsame Tabellenkomponente mit Spalten ein-/ausblenden, verschieben, Breite ändern, Sortieren, Filtern, Gruppieren, Mehrfachauswahl mit Massenaktionen, CSV-Export. **Gespeicherte Ansichten** persönlich oder für alle im Account freigegeben. Einheitliche Listen-Schnittstelle in der API (Filter, Sortierung, Seiten)                         | eingesetzt bei Firmen, Benutzern, Audit-Log                                    |
| 2.4 | **Eigene Felder:** Kunden legen eigene Felder an (Text, Zahl, Datum, Ja/Nein, Auswahl, Mehrfachauswahl, Verweis auf anderen Datensatz), inkl. Pflichtfeld und Reihenfolge. Prüfung serverseitig. Nutzbar in Formularen, Tabellen und Filtern                                                                                                                                      | Erprobt an Firmen; Phase-3-Module übernehmen es automatisch                    |
| 2.5 | **Globale Suche:** ein Suchfeld über alles, auf das der Benutzer Zugriff hat (Volltextsuche in PostgreSQL, deutsche Wortstämme, tolerant bei Tippfehlern). Ergebnisse beachten Mandantentrennung und Rechte                                                                                                                                                                       | findet Firmen, Benutzer, Rollen, Menüpunkte; Mandanten-Trenntests              |
| 2.6 | **Benachrichtigungen:** Glocke oben rechts mit Zähler, Liste, „gelesen“-Markierung, persönliche Einstellungen je Ereignisart. Anfangs z. B.: Einladung angenommen, Rechte geändert, Testphase endet bald, Anmeldung von neuem Gerät                                                                                                                                               | Benachrichtigungen erscheinen ohne Neuladen der Seite                          |
| 2.7 | **Aktivitätsprotokoll:** verständlicher Verlauf „wer hat wann was geändert“, als Gesamtliste, als Verlauf je Datensatz (z. B. Reiter „Verlauf“ bei einer Firma) und als Dashboard-Widget. Basis ist das Audit-Log                                                                                                                                                                 | nur sichtbar, was der Benutzer sehen darf                                      |
| 2.8 | **Dashboard-Baukasten:** Widgets hinzufügen, entfernen, verschieben, Größe ändern, einstellen; mehrere eigene Dashboard-Seiten; Administratoren legen eine Standard-Ansicht für alle fest, jeder kann sie für sich anpassen. Erste Widgets mit echten Daten: Schnellzugriffe, Aktivitäten, Benachrichtigungen, Lizenz & Nutzung, Team & Einladungen, Firmenübersicht, Notizzettel | Layout wird gespeichert und geräteübergreifend geladen                         |
| 2.9 | Tests (inkl. Mandanten-Trenntests für alle neuen Tabellen), E2E-Ablauf erweitern, Doku, Lasttest der Listen-Schnittstelle mit 100.000 Testdatensätzen                                                                                                                                                                                                                             | CI grün                                                                        |

**Reihenfolge:** 2.1 → 2.3 + 2.4 → 2.5 → 2.6 + 2.7 → 2.2 → 2.8 → 2.9. Es entsteht je Arbeitspaket ein eigener, geprüfter Zwischenstand.

**Neue Tabellen (alle mit `account_id` + RLS):** `outbox_events`, `notifications`, `notification_preferences`, `saved_views`, `custom_field_definitions`, `user_preferences` (Menü, Favoriten), `dashboards`, `dashboard_widgets`, `search_documents`. Bestehende Tabellen bekommen nur neue Spalten (`custom_fields`), es wird nichts gelöscht.

**Festlegungen (von FangEvo bestätigt am 2026-11-09):**

1. Dashboard und Menü: Administratoren legen den Standard fest, jeder Benutzer darf ihn für sich anpassen.
2. Gespeicherte Tabellenansichten: persönlich, mit Option „für alle im Account freigeben“.
3. Benachrichtigungen: zunächst nur in der Software; per E-Mail nur sicherheitsrelevante (z. B. Anmeldung von neuem Gerät).

#### Status Phase 2 (2026-11-09): abgeschlossen

| AP                        | Status | Nachweis                                                                                                            |
| ------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------- |
| 2.1 Ereignis-System       | ✅     | Outbox + Verteiler + Worker; Tests: Zustellung, Idempotenz ([ADR-006](docs/decisions/ADR-006_EREIGNISSE_OUTBOX.md)) |
| 2.2 Hauptnavigation       | ✅     | Menü-Registrierung, ausblenden/sortieren/Favoriten, Account-Standard, Strg+K                                        |
| 2.3 Tabellen-Baukasten    | ✅     | Firmen (in der API), Benutzer und Audit-Log (im Browser, kleine Listen); E2E: Filter, Ansicht, Export               |
| 2.4 Eigene Felder         | ✅     | an Firmen erprobt; Prüfung, Filter, Spalten, Formular; Tests inkl. Verweise und Mandantentrennung                   |
| 2.5 Globale Suche         | ✅     | Firmen, Benutzer, Rollen, Menüpunkte; Rechte- und Mandantentests                                                    |
| 2.6 Benachrichtigungen    | ✅     | Glocke (Aktualisierung alle 30 s), Einstellungen, E-Mail bei neuem Gerät                                            |
| 2.7 Aktivitätsprotokoll   | ✅     | Verlauf je Firma, Gesamtverlauf, Dashboard-Widget                                                                   |
| 2.8 Dashboard-Baukasten   | ✅     | 7 Widgets mit echten Daten, mehrere Seiten, Vorlage für alle, mobil gestapelt                                       |
| 2.9 Tests, Doku, Lasttest | ✅     | 77 API-Tests, 2 E2E-Abläufe, Lasttest 100.000 Firmen: Listen 70–120 ms, Suche ~180 ms                               |

Abweichungen vom Plan: BullMQ noch nicht eingesetzt, der Verteiler läuft über PostgreSQL (ADR-006). Dashboard-Widgets werden als JSON an der Dashboard-Seite gespeichert statt in einer eigenen Tabelle `dashboard_widgets`. Benutzer- und Audit-Listen filtern im Browser (kleine Datenmengen), Firmen in der API. Filter „leer/nicht leer“ für eigene Felder folgt später.

### Phase 3 – Warenwirtschaft (grob)

Reihenfolge: Artikel → Kunden → Lieferanten → Lager/Bestandsjournal → Aufträge (Statusmaschine, Reservierung) → Dokumente (PDF, Nummernkreise, Festschreibung) → Einkauf → erste Dashboard-Widgets.

### Phase 3 – Warenwirtschaft (von FangEvo freigegeben am 2026-11-09)

**Festlegungen:** (1) Daten je Firma getrennt, keine gemeinsam genutzten Artikel. (2) Steuersätze legt der Kunde selbst an und wählt sie je Artikel; EU-Sonderregeln erst nach steuerlicher Prüfung. (3) In Phase 3 PDF-Rechnungen; E-Rechnung (XRechnung/ZUGFeRD) als eigenes Paket direkt danach, nach Prüfung durch Steuerberater. (4) Minusbestand standardmäßig aus, je Firma einschaltbar. (5) Testdaten aus der JTL-Wawi von FangEvo (lesender Export, siehe [03_JTL_EXPORT_AUFTRAG.md](docs/research/03_JTL_EXPORT_AUFTRAG.md)); bis dahin Beispieldaten.

#### Status Phase 3a (2026-11-09): abgeschlossen

| AP                  | Status | Nachweis                                                                                                                                        |
| ------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| 3.1 Grundlagen      | ✅     | Firmentrennung per RLS (ADR-007), Steuersätze, Kundengruppen, Kategorien, Hersteller, Lager/Lagerplätze, Nummernkreise, Geldbeträge als Decimal |
| 3.2 Artikel         | ✅     | Preise inkl. Staffel/Kundengruppe, Sets, Varianten, EAN-Prüfung, Preisrecht, eigene Felder, Suche, Verlauf                                      |
| 3.3 Kunden          | ✅     | Privat/Geschäft, Adressen, Ansprechpartner, Gruppen, Sperre                                                                                     |
| 3.4 Lieferanten     | ✅     | Stammdaten, Lieferanten-Artikel, bevorzugte Bezugsquelle                                                                                        |
| 3.5 Lager & Bestand | ✅     | Journal, Zugang/Abgang/Umlagerung/Inventur, Minusbestand-Einstellung, Chargen/SN/MHD-Pflicht, gleichzeitige Buchungen getestet                  |

Offen bzw. bewusst später: Produktbilder (Dateispeicher folgt mit Phase 3b), Bestände je Charge/Seriennummer (Phase 4, FangEvo Lager), Import der JTL-Daten (Phase 5, Import-Assistent; die Testdaten werden vorher geprüft).

#### Status Phase 3b (2026-11-09): abgeschlossen

| AP             | Status | Nachweis                                                                                                                                                                           |
| -------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3.6 Aufträge   | ✅     | Preisermittlung (Gruppe, Staffel, Verkaufspreis, Gruppenrabatt), Statusmaschine mit Verlauf, Reservierung nach Anlage-Reihenfolge, Versand bucht Bestand (auch Sets), Storno       |
| 3.7 Belege     | ✅     | Angebot, AB, Lieferschein, Rechnung, Gutschrift, Stornorechnung; Festschreiben mit lückenloser Nummer, PDF mit Prüfsumme, DB-Schutz (GoBD), E-Mail mit Anhang, Zahlungen (ADR-008) |
| 3.8 Einkauf    | ✅     | Bestellvorschläge, Bestellungen mit PDF und E-Mail, Teil-Wareneingang mit Lagerplatz/Charge/MHD                                                                                    |
| 3.9 Startseite | ✅     | Widgets Umsatz, Offene Aufträge, Topseller                                                                                                                                         |
| 3.10 Lasttest  | ✅     | `perf:wawi` mit 100.000 Artikeln, 20.000 Kunden, 50.000 Aufträgen (Ergebnisse in TESTING.md)                                                                                       |

Bewusst später: E-Rechnung (XRechnung/ZUGFeRD) und Steuer-Sonderfälle (Reverse-Charge, innergemeinschaftliche Lieferung, Kleinunternehmer) nach Prüfung durch den Steuerberater; Verkauf von Artikeln mit Chargen-/Seriennummernpflicht (Auswahl beim Versand, Phase 4); Produktbilder und Dateispeicher (mit Phase 4/5); Prioritäten zwischen Aufträgen bei knappem Bestand (Phase 4, FangEvo Pack); Mahnwesen (Phase 5, Finanzen).

### Phase 4 – Logistik (gestartet 2026-11-09 auf Auftrag „alle Phasen automatisch durcharbeiten“) · Status: abgeschlossen

| AP                       | Inhalt                                                                                                                                                                                                                                                                   |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 4.1 Lager mit Chargen/SN | Bestand je Lagerplatz **und** Charge/Seriennummer/MHD; zusätzliche Barcodes je Artikel; Scan-Auflösung (Artikel, Lagerplatz); Verkauf von Chargen-/SN-Artikeln (Charge nach MHD zuerst, SN beim Packen scannen)                                                          |
| 4.2 Picklisten           | Pickliste aus mehreren Aufträgen, Platzvorschlag (Lagerplatz mit Bestand, Charge mit frühestem MHD), Pick bestätigen, Fehlmengen; Aufträge wechseln auf „Kommissionierung“/„Verpackung“                                                                                  |
| 4.3 FangEvo Pack         | Packtisch-Arbeitsplätze, Auftrag scannen, Artikel scannen mit Fehlerprüfung (falscher Artikel, Variante, doppelt, unvollständig), Seriennummern, Gewicht/Pakete, Abschluss = Versand + Belege                                                                            |
| 4.4 Versand              | Sendungen mit Paketen, Trackingnummer, Versandetikett. Versanddienstleister als austauschbare Adapter; ohne Zugangsdaten und Sandbox-Test nur „manuell“ (eigene Trackingnummer) und „eigenes Adressetikett“ (PDF). DHL/DPD/GLS usw. werden **nicht** als fertig gemeldet |
| 4.5 Retouren             | Retoure zum Auftrag, Wareneingang mit Zustand (wieder verkaufbar/beschädigt/entsorgen), Bestandsbuchung, Gutschrift aus der Rechnung                                                                                                                                     |
| 4.6 Mobile Scanner       | Handy-Oberfläche `/scan`: Artikel/Platz scannen (Kamera, wo der Browser es kann, sonst Handscanner/Eingabe), Bestand abfragen, Wareneingang, Umlagerung, Inventur, Kommissionieren                                                                                       |

Ergebnis Phase 4: alle Arbeitspakete umgesetzt und getestet (phase4.test, E2E `phase4-flow.mjs`). Offen: Etiketten echter Versanddienstleister (brauchen Zugangsdaten und Sandbox-Test), Reservierung je Charge, Waagen-/Druckeranbindung am Packplatz (heute Browser-Druck).

### Phase 5 – Import und Multichannel (gestartet 2026-11-09)

| AP                         | Inhalt                                                                                                                                                                                                 |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 5.1 FangEvo Import         | CSV (Trennzeichen/Zeichensatz automatisch, z. B. JTL-Export) und Excel (XLSX); Spaltenzuordnung mit Vorschlag, Standardwerte, Vorschau, Prüflauf (Testimport ohne Speichern), Ausführung im Hintergrund mit Fortschritt, Fehlerprotokoll je Zeile, Historie, Vorlagen; Rückgängig für neu angelegte Stammdaten (archivieren). Datenarten: Artikel, Kunden, Lieferanten, Bestände, Preise, Kategorien |
| 5.2 Export                 | CSV-Export von Artikeln, Kunden, Lieferanten und Beständen über die API (Excel-tauglich)                                                                                                              |
| 5.3 Öffentliche API        | API-Schlüssel je Firma mit ausgewählten Rechten, nur gehasht gespeichert, Ablaufdatum, Sperren, Rate-Limit je Schlüssel, Protokoll der letzten Nutzung                                                |
| 5.4 Connector-Architektur  | Verkaufskanäle mit Konfiguration (Geheimnisse verschlüsselt), Statusanzeige, Protokoll, Wiederholungen; Zuordnung externe ↔ interne IDs; kanalbezogene Artikeldaten (aktiv, Preis)                    |
| 5.5 Erster Kanal           | „Eigener Shop über API“: Bestellungen per API übernehmen (doppelte Übernahme ausgeschlossen), Bestände und Preise je Kanal abrufen, Status/Tracking abrufen. Echte Marktplätze/Shopsysteme (Amazon, eBay, Shopify …) erst mit Zugangsdaten und Sandbox-Test |

### Phase 5–8

Wie im Playbook. Sie werden vor Beginn jeweils in Arbeitspakete wie in Phase 1 zerlegt und zur Freigabe vorgelegt.

## 6. Offene Fragen an FangEvo

1. ~~**Frontend:** Vite (Empfehlung) oder Next.js?~~ Entschieden am 2026-11-09: **Vite** (ADR-003).
2. **Hosting:** Hetzner (günstig, mehr Eigenbetrieb) oder AWS Frankfurt (teurer, mehr verwaltete Dienste)?
3. **Zahlungsanbieter** für Abos später: Stripe oder Mollie?
4. **JTL:** Welche Version läuft, gibt es eine Freigabe für eine anonymisierte Datenbankkopie (siehe [Checkliste](docs/research/02_JTL_CHECKLISTE.md))?
5. **Afterbuy:** Wird es genutzt, gibt es einen Zugang?
6. **Pilotkunden:** Wer testet zuerst (ihr selbst?), welche Shops/Marktplätze nutzen sie? Danach richtet sich die Reihenfolge der Connectoren.
7. **Zielmärkte:** Nur Deutschland zum Start oder auch AT/CH/EU (Steuer, Sprache, E-Rechnung)?
8. **Team und Zeitrahmen:** Wer entwickelt mit, gibt es einen Wunschtermin für die Pilotversion?
9. **Design:** Gibt es Logo, Farben oder ein Corporate Design für FangEvo?
