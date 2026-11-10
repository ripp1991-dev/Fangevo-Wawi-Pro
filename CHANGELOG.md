# Changelog

## [0.3.0] – 2026-11-09 – Phase 3a: Warenwirtschaft – Stammdaten und Lager

### Hinzugefügt

- **Firmentrennung** in der Datenbank: Fachdaten zusätzlich je Firma per RLS getrennt (ADR-007).
- **Firmeneinstellungen:** frei anlegbare Steuersätze (Vorschlag 19/7/0 %, je Artikel wählbar), Kundengruppen (brutto/netto, Rabatt), Kategorien (Baum, ohne Zyklen), Hersteller, Lager und Lagerplätze, lückenlose Nummernkreise, Minusbestand an/aus.
- **Artikel:** Stammdaten, EAN/GTIN mit Prüfziffer, Kategorien, Hersteller/Marke, Einheiten, Gewicht, Mindestbestand, Einkaufs-/Verkaufspreis, Staffel- und Kundengruppenpreise, Sets (Stücklisten), Vaterartikel mit Varianten-Erzeugung, Chargen/Seriennummern/MHD-Pflicht, eigene Felder, Verlauf. Einkaufspreise nur mit Recht „Preise“.
- **Kunden:** Privat/Geschäft, mehrere Rechnungs- und Lieferadressen, Ansprechpartner, Kundengruppe, Zahlungsziel, Sperre mit Grund, eigene Felder, Verlauf.
- **Lieferanten:** Stammdaten, Adressen, Ansprechpartner, Lieferanten-Artikel (Lief.-Art.-Nr., EK, Lieferzeit, Mindestmenge, bevorzugte Bezugsquelle).
- **Lager & Bestand:** Zugang, Abgang, Umlagerung, Inventur/Korrektur; unveränderliches Journal; Bestände je Lager(platz); Liste „Unter Mindestbestand“ und Dashboard-Widget.
- Neue Rechte: `company_settings.manage`, `articles.read/manage/prices`, `customers.read/manage`, `suppliers.read/manage`, `inventory.read/manage`. Rolle „Mitarbeiter“ darf die neuen Bereiche ansehen.
- Module Artikel, Kunden, Lieferanten und Lager sind im Katalog freigeschaltet.
- Anleitung für den lesenden JTL-Export ([docs/research/03_JTL_EXPORT_AUFTRAG.md](docs/research/03_JTL_EXPORT_AUFTRAG.md)).
- 3. Browser-E2E-Ablauf (Phase 3a).

### Behoben (während der Entwicklung gefunden)

- Standardwerte einer Firma gingen verloren, wenn der allererste Zugriff fehlschlug (jetzt eigene Transaktion, sicher bei gleichzeitigen Zugriffen).
- Personen ohne Preisrecht konnten Artikel nicht speichern, weil ausgeblendete Preise als „0“ mitgeschickt wurden (Preise sind jetzt optional).
- Reihenfolge der Variantenmerkmale wurde von der Datenbank vertauscht (jetzt geordnete Liste).

## [0.2.0] – 2026-11-09 – Phase 2: Dashboard und Core-Werkzeuge

### Hinzugefügt

- **Ereignis-System (Outbox)** mit ausfallsicherem Verteiler und eigenem Worker-Prozess (ADR-006).
- **Benachrichtigungen**: Glocke mit Zähler, Liste, gelesen/alle gelesen, Einstellungen je Art. Hinweise u. a. bei Beitritt, Rechteänderung, geänderter Rolle, angelegter/archivierter Firma, Ende der Testphase, Anmeldung von neuem Gerät (zusätzlich per E-Mail).
- **Tabellen-Baukasten**: Suche, Filter, Sortierung, Spalten ein-/ausblenden, verschieben, Breite ändern, Gruppieren, Mehrfachauswahl mit Massenaktionen, CSV-Export (Excel-tauglich, Schutz gegen Formel-Einschleusung), gespeicherte Ansichten (persönlich oder für alle). Eingesetzt bei Firmen, Benutzern, Audit-Log.
- **Einheitliche Listen-Schnittstelle** (Filter, Sortierung, Seiten) mit Freigabeliste der Felder.
- **Eigene Felder** (Text, Zahl, Datum, Ja/Nein, Auswahl, Mehrfachauswahl, Verweis) mit serverseitiger Prüfung; nutzbar in Formularen, Tabellen und Filtern; Archivieren statt Löschen. Neues Recht `custom_fields.manage`.
- **Globale Suche** mit Strg+K (Volltext deutsch, Wortanfänge, tippfehlertolerant), beachtet Mandant, Rechte und Firmenzugriff.
- **Aktivitäten**: Verlauf je Datensatz (Reiter „Verlauf“ bei Firmen) und Gesamtverlauf mit Änderungsdetails.
- **Menü nach Wunsch**: ausblenden, sortieren, Favoriten; Administratoren legen den Standard für alle fest.
- **Dashboard-Baukasten**: Widgets hinzufügen, entfernen, verschieben, Größe ändern, einstellen; mehrere Seiten; Account-Vorlage; Zurücksetzen. Widgets: Schnellzugriffe, Aktivitäten, Benachrichtigungen, Lizenz & Nutzung, Team, Firmen, Notiz.
- Lasttest der Listen mit 100.000 Datensätzen (`pnpm --filter @fangevo/api perf:lists`).
- 2. Browser-E2E-Ablauf für Phase 2.

### Geändert

- Rechte der Systemrollen werden aus dem Code gelesen, damit neue Rechte sofort bei allen Accounts wirken.
- `GET /admin/companies` liefert jetzt eine Seite (`items`, `total`, `page`, `pageSize`) statt einer Liste.
- Zugriffsprüfung zählt bei „alle Firmen“ nicht mehr sämtliche Firmen auf (Listen 4–5× schneller bei großen Datenmengen).

### Behoben (während der Entwicklung gefunden)

- Prüfung gegen Rechteausweitung las Rechte der Systemrollen noch aus der Datenbank.
- Verlauf einer fremden Firma lieferte eine leere Liste statt „nicht gefunden“.
- Einladungsdialog blieb gesperrt, wenn das Recht „Firmen ansehen“ fehlte.
- Dashboard: Breite des Rasters wurde falsch gemessen (Kacheln ragten über den Rand); Notiz ging verloren, wenn während des Speicherns getippt wurde.
- Aktive Firma sprang nach dem Anlegen einer neuen Firma.

## [0.1.0] – 2026-11-09 – Phase 1: Technisches Fundament

### Hinzugefügt

- Monorepo (pnpm, Turborepo), TypeScript strict, ESLint mit Modulgrenzen, Prettier, Vitest, CI (GitHub Actions), Docker Compose für die Entwicklung.
- Datenbank: Kernschema mit Mandantentrennung per Row-Level Security, unveränderlichem Audit-Log, Lizenzhistorie und Sicherheitsereignissen.
- API (NestJS/Fastify): Registrierung mit E-Mail-Bestätigung, Login, Zwei-Faktor (TOTP + Wiederherstellungscodes), Sitzungsverwaltung, Passwort vergessen/ändern, Account-Wechsel, Firmen, Benutzer und Einladungen, Rollen und Einzelrechte, Firmenzugriff, Lizenz-Kern (Module, Limits, Testphase, Nur-Lese-Modus), Audit-Log, Health-Check, OpenAPI.
- Sicherheit: CSRF-Schutz, Rate-Limits, Schutz gegen Rechteausweitung, Helmet, Log-Redaktion.
- Web-App: Anmeldeseiten, App-Rahmen mit Navigation, Account- und Firmenwechsler, Hell-/Dunkelmodus, responsiv, Verwaltung von Firmen, Benutzern, Rollen, Audit-Log, Lizenz, Account sowie Profil & Sicherheit.
- Designsystem-Grundlage `@fangevo/ui`.
- 73 automatisierte Tests inkl. Pflicht-Testsuite zur Mandantentrennung, Browser-E2E-Test.
- Dokumentation: README, ARCHITECTURE, DATABASE, API, SECURITY, LICENSING, MODULES, TESTING, DECISIONS.

### Behoben (während der Entwicklung durch Tests gefunden)

- `RATE_LIMIT_DISABLED=false` wurde als „aktiv“ gelesen und hätte den Brute-Force-Schutz abgeschaltet.
- Nach dem Login leitete der Routen-Schutz wegen veralteter Sitzungsdaten zurück zum Login.
- Der E-Mail-Bestätigungslink wurde im Entwicklungsmodus doppelt gesendet und dadurch als ungültig angezeigt.
- Der Einladungsdialog konnte ohne vorausgewählte Rolle öffnen.
- Sicherheitsupdates für fastify, nodemailer, @fastify/static und indirekte Abhängigkeiten.

## [0.0.1] – 2026-11-09 – Phase 0: Bestandsaufnahme

- Master Playbook, Systemanalyse, JTL-/Afterbuy-Checkliste, Technologieempfehlung (ADR-001), Entwicklungsplan.
