# FangEvo Wawi Pro – Entwicklungsplan

**Stand:** 2026-11-09 · **Status:** Phase 0 und Phase 1 abgeschlossen · nächster Schritt: Freigabe Phase 2
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

Abweichungen vom Plan: eigene Sitzungs-Authentifizierung statt Better Auth ([ADR-002](docs/decisions/ADR-002_AUTHENTIFIZIERUNG.md)); Vite vorläufig gesetzt ([ADR-003](docs/decisions/ADR-003_FRONTEND_VITE.md)); Prisma 6 statt 7 ([ADR-005](docs/decisions/ADR-005_ABHAENGIGKEITSVERSIONEN.md)).

### Phase 2 – Dashboard und Core (grob)

Tabellen-Baukasten mit gespeicherten Ansichten · eigene Felder (Definition, Formular, Tabelle, Filter) · globale Suche · Benachrichtigungen · Aktivitätsprotokoll · Dashboard-Rahmen mit Widget-System (verschieben, Größe, eigene Seiten).

### Phase 3 – Warenwirtschaft (grob)

Reihenfolge: Artikel → Kunden → Lieferanten → Lager/Bestandsjournal → Aufträge (Statusmaschine, Reservierung) → Dokumente (PDF, Nummernkreise, Festschreibung) → Einkauf → erste Dashboard-Widgets.

### Phase 4–8

Wie im Playbook. Sie werden vor Beginn jeweils in Arbeitspakete wie in Phase 1 zerlegt und zur Freigabe vorgelegt.

## 6. Offene Fragen an FangEvo

1. **Frontend:** Vite (Empfehlung) oder Next.js?
2. **Hosting:** Hetzner (günstig, mehr Eigenbetrieb) oder AWS Frankfurt (teurer, mehr verwaltete Dienste)?
3. **Zahlungsanbieter** für Abos später: Stripe oder Mollie?
4. **JTL:** Welche Version läuft, gibt es eine Freigabe für eine anonymisierte Datenbankkopie (siehe [Checkliste](docs/research/02_JTL_CHECKLISTE.md))?
5. **Afterbuy:** Wird es genutzt, gibt es einen Zugang?
6. **Pilotkunden:** Wer testet zuerst (ihr selbst?), welche Shops/Marktplätze nutzen sie? Danach richtet sich die Reihenfolge der Connectoren.
7. **Zielmärkte:** Nur Deutschland zum Start oder auch AT/CH/EU (Steuer, Sprache, E-Rechnung)?
8. **Team und Zeitrahmen:** Wer entwickelt mit, gibt es einen Wunschtermin für die Pilotversion?
9. **Design:** Gibt es Logo, Farben oder ein Corporate Design für FangEvo?
