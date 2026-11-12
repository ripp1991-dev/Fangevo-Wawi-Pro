# Changelog

## [Unreleased]

### Hinzugefügt

- **Touch-Packtisch** (`/packtisch`): Vollbild-Arbeitsplatz für Packer an einem Lagerrechner mit Touchscreen (ab 1280 × 720, „HD ready“) und USB-Handscanner. Einmalige Einrichtung je Gerät: Firma → Lager → Packplatz (Auswahl erscheint nur, wenn es mehr als eins gibt). Danach ein Schritt pro Bildschirm: Auftrag scannen oder als Kachel antippen, Artikel scannen (große Kacheln mit Zähler, Rückmeldung in Grün/Rot mit Ton), Gewicht über ein Zahlenfeld, „Fertig“ = Versand mit Etikett und Belegen. Die Prüfung bleibt serverseitig (unverändert). Aus der Seite „Packtisch“ über „Touch-Packtisch öffnen“ erreichbar.
- **PIN-Anmeldung am Touch-Packtisch** (ADR-014): Ein Lagerleiter gibt den Lagerrechner einmal frei („Gerät für PIN freigeben“). Danach melden sich Packer dort mit Namen und 4–6-stelliger PIN an. Die PIN-Sitzung erreicht nur den Packtisch der Firma des Geräts, läuft nach 12 Stunden ab und meldet nach 15 Minuten ohne Eingabe ab. Sperre nach 5 Fehlversuchen für 15 Minuten. PIN selbst festlegen (Profil & Sicherheit, mit Passwort) oder durch den Administrator (Benutzer › PIN). Freigegebene Geräte sind unter Packtisch › Packplätze widerrufbar.
- **Automatisch drucken am Touch-Packtisch:** neue Einstellung je Packplatz. Nach „Fertig“ werden Etikett und festgeschriebene Belege sofort gedruckt – ohne Druckdialog, wenn Chrome mit `--kiosk-printing` läuft (Anleitung: `docs/PACKTISCH.md`).
- **Problem melden am Packtisch:** „Artikel fehlt“, „beschädigt“, „falscher Artikel im Lager“ oder „Sonstiges“ mit Notiz. Der Auftrag wird zurückgestellt („In Bearbeitung“), verschwindet aus der Packliste und der Grund steht im Statusverlauf.
- **Packplatz gehört zu einem Lager:** neues Feld `warehouseId` (optional, leer = alle Lager). Die Warteschlange zeigt nur Aufträge aus diesem Lager; Aufträge aus einem anderen Lager sind an diesem Platz immer gesperrt (auch bei „Nur warnen“). Lager anderer Firmen/Accounts und archivierte Lager sind nicht wählbar.
- **Packregeln je Packplatz:** Ein Packplatz kann auf Verkaufskanäle (z. B. nur Shopify, nur Amazon, auch „ohne Kanal“) und auf Kategorien festgelegt werden („nur Kategorien“: alle Artikel des Auftrags aus diesen Kategorien inkl. Unterkategorien; „ohne Kategorien“: reine Aufträge dieser Kategorien ausblenden, gemischte bleiben). Bei Aufträgen, die nicht passen: warnen oder Packen sperren (serverseitig geprüft). Optional festgelegt, sonst können Packer „auch andere Kanäle“ einblenden.
- **Warteschlange am Packtisch** (GET /packing/queue): packbereite Aufträge nach den Regeln des Platzes, älteste zuerst, mit Kanal-Reitern und Zählern; Klick lädt den Auftrag zum Packen.
- **Picklisten nach Packregeln:** Beim Anlegen einer Pickliste lassen sich die Aufträge mit den Regeln eines Packplatzes vorfiltern.

### Behoben

- **Tests unter Windows:** Die Testvorbereitung fand den Projektordner nicht, wenn der Pfad Leerzeichen enthält (`fileURLToPath` statt `URL.pathname`).
- **Entwicklungsumgebung startet wieder:** MinIO veröffentlicht keine Container-Abbilder mehr, `docker compose up` brach deshalb ab. Der Objektspeicher ist aus `infrastructure/docker/docker-compose.yml` entfernt, weil FangEvo derzeit keinen S3-Speicher nutzt (Belege in der Datenbank, ADR-008).

## [0.9.0] – 2026-11-09 – Phase 8: Produktionsreife

### Hinzugefügt

- **Sicherheitstests über die gesamte API und Datenbank:** jede Tabelle mit Mandantendaten hat erzwungene Row-Level Security; firmenbezogene Tabellen prüfen die Firma; jeder Endpunkt wird ohne Anmeldung abgewiesen; kein Endpunkt erzeugt mit leeren oder unbekannten Eingaben einen Serverfehler; Sicherheits-Header, Cookie-Flags, CSRF.
- **Sicherung und Wiederherstellung:** eigene Sicherungsrolle, Skripte für Sicherung, Wiederherstellungs-Probe und Migrations-Probe; alle drei laufen automatisch in CI.
- **Produktions-Images** (API/Worker distroless ohne Root, Web mit nginx und strenger CSP, Migrationen) und **Pilot-Setup** mit Docker Compose; CI baut die Images, startet das komplette Setup und führt einen Browser-Rauchtest sowie Sicherung/Wiederherstellung im Container aus.
- **Lasttest über HTTP** (`perf:http`) mit mehreren Accounts, gemischter Last und Prüfung der Mandantentrennung unter Last.
- **Rauchtest nach Bereitstellung** (`tests/smoke/production-smoke.mjs`).
- **Betriebshandbuch** (OPERATIONS.md) und **Pilot-Checkliste** (PILOT.md), ADR-013.

### Behoben

- Worker-Logs gingen verloren (gepuffert, nie an den Logger übergeben).
- Leere Werte in der Konfigurationsdatei (z. B. `SUPPORT_EMAIL=`) verhinderten den Start.
- API-Antworten dürfen nicht mehr in Rahmen eingebettet werden (`frame-ancestors 'none'`).

### Geändert

- Unbehandelte Fehler in API und Worker werden protokolliert; bei unbehandelten Ausnahmen beendet sich der Prozess, damit der Prozessmanager ihn neu startet.
- Farbschema-Skript der Web-App als eigene Datei (CSP ohne Inline-Skripte).

## [0.8.0] – 2026-11-09 – Phase 7: Kommerzialisierung

### Hinzugefügt

- **Abo & Rechnungen (Kundenportal):** Paket wählen (monatlich oder jährlich mit 2 Monaten gratis), Abo aus der Testphase starten, Paket wechseln (Hochstufen sofort mit anteiliger Rechnung, Herabstufen zum Laufzeitende), Kündigung zum Laufzeitende und Rücknahme, Rechnungsdaten, Rechnungen als PDF. Die Lizenz wird automatisch aus Abo und Zusatzmodulen berechnet.
- **Rechnungen von FangEvo:** fortlaufende Nummern, PDF (§ 14 UStG) mit Prüfsumme, unveränderlich, Versand per E-Mail, Zahlart Rechnung/Überweisung; Abrechnungslauf im Hintergrund (Verlängerung, Testende, Kündigungsende, Zahlungsverzug – Lesemodus erst nach 30 Tagen).
- **Marketplace:** alle Module mit Beschreibung, Version und vorläufigem Preis; Zusatzmodule 14 Tage testen, danach kostenpflichtig, jederzeit kündbar.
- **Support:** Anfragen mit Kategorie, Priorität und Verlauf; E-Mail an den Support, Benachrichtigung und E-Mail bei Antwort.
- **Plattform-Verwaltung** für FangEvo-Mitarbeiter (E-Mail-Freigabe + Zwei-Faktor Pflicht): Accounts, Lizenz ändern ohne Rechnung, sperren, Testphase verlängern, Rechnungen als bezahlt markieren, Support-Postfach, Abrechnungslauf.
- Neue Rechte `billing.manage`, `support.manage`; Benachrichtigungen „Antwort vom Support“ und „Neue Rechnung“; Marketplace in jedem Paket.
- 8. Browser-E2E-Ablauf (Marketplace → Abo → Support → Plattform).

### Geändert

- Lizenz-Werkzeug `license:set` ändert jetzt das Abo und berechnet die Lizenz daraus (wie die Plattform-Verwaltung).
- Hinweise zu Testphase und Lesemodus verlinken auf „Abo & Rechnungen“.

### Offen

- Zahlungsanbieter (Stripe/Mollie) nach Entscheidung von FangEvo und mit Zugangsdaten; Preise, Umsatzsteuer (OSS) und Rechnungstexte fachlich bestätigen; Stornorechnungen für Plattform-Rechnungen.

## [0.7.0] – 2026-11-09 – Phase 6: Automatisierung

### Hinzugefügt

- **Webhooks:** Abonnements je Firma für 19 Ereignisse (Aufträge, Versand, Artikel, Bestand, Kunden, Retouren, Belege, Zahlungen); signierte Zustellung (HMAC-SHA256) im Hintergrund, Wiederholungen mit wachsender Wartezeit, Zustellprotokoll, Test-Ping, erneut senden, Schlüssel erneuern, automatisches Abschalten nach Dauerfehlern mit Benachrichtigung, Schutz gegen Aufrufe ins interne Netz.
- **Regeln (Workflows):** Auslöser (neue Bestellung, Statuswechsel, Versand, Retoure eingegangen, Bestand unter Mindestbestand, zeitgesteuert), Bedingungen (Warenwert, Land, Kundenart/-gruppe, Zahlungs-/Versandart, Kanal, Positionen, Stunden im Status …), Aktionen (Status setzen, Versandart setzen, Mitarbeiter benachrichtigen, E-Mail, Webhook) mit Platzhaltern. Versionen, Ausführungsprotokoll mit Schritten, Testlauf ohne Ausführung, Schutz vor Endlosschleifen.
- **Zeitgesteuerte Prüfungen** (stündlich/täglich): Aufträge warten zu lange, Lieferantenbestellungen überfällig, Artikel unter Mindestbestand.
- Neue Rechte `webhooks.manage`, `workflows.read/manage`; Modul Automatisierung freigeschaltet (ab Professional); Benachrichtigungsarten „Hinweise aus Regeln“ und „Webhook abgeschaltet“.
- 7. Browser-E2E-Ablauf (Regel greift, Webhook signiert zugestellt).

## [0.6.0] – 2026-11-09 – Phase 5: Import und Multichannel

### Hinzugefügt

- **FangEvo Import:** CSV (Trennzeichen und Zeichensatz werden erkannt, z. B. JTL-Export) und Excel; Datenarten Artikel, Kunden, Lieferanten, Bestände, Preise, Kategorien; automatischer Spaltenvorschlag, Standardwerte, Vorgehen (neu/ändern/beides), Prüflauf ohne Speichern mit Fehlern je Zeile, Ausführung im Hintergrund mit Fortschritt, Verlauf, Vorlagen, Rückgängig für neu angelegte Stammdaten; fehlende Kategorien/Hersteller/Lagerplätze auf Wunsch anlegen.
- **Export** von Artikeln, Kunden, Lieferanten und Beständen als CSV (Excel-tauglich, passt wieder zum Import).
- **Hintergrundaufgaben** (`job_queue`) mit Wiederholungen und Fortsetzung nach Abbruch.
- **Öffentliche API:** API-Schlüssel je Firma mit ausgewählten Rechten, Ablaufdatum, Sperren, Rate-Limit, letzte Nutzung; Anmeldung per `Authorization: Bearer fe_live_…`.
- **Verkaufskanäle:** Kanal „Eigener Shop über API“ – Bestellungen übernehmen (doppelte Übergabe erkannt, Kunde über E-Mail/externe ID), Bestände und Preise je Kanal abrufen, Status und Trackingnummern abrufen; Artikel je Kanal (aktiv, eigener Preis); Protokoll mit Fehlern. Geplante Marktplätze werden angezeigt, aber nicht als verfügbar ausgegeben.
- Neue Rechte `import.execute`, `api_keys.manage`, `channels.read/manage`; Module Import (ab Business), Öffentliche API und Multichannel (ab Professional) freigeschaltet.
- 6. Browser-E2E-Ablauf (Import → API-Schlüssel → Kanal → Shop-Bestellung).

## [0.5.0] – 2026-11-09 – Phase 4: Logistik

### Hinzugefügt

- **Lager:** Bestand je Lagerplatz, Charge, Seriennummer und MHD; Umlagerung und Inventur auch für Chargen/Seriennummern; Seriennummern sind eindeutig im Bestand; zusätzliche Barcodes je Artikel; Scan-Auflösung für Artikel (GTIN, Artikelnummer, Zusatz-Barcode) und Lagerplätze.
- **Verkauf von Chargen- und Seriennummern-Artikeln:** Versand entnimmt Chargen mit frühestem MHD zuerst; Seriennummern werden am Packtisch gescannt.
- **Kommissionierung:** Picklisten aus mehreren Aufträgen, Rundgang sortiert nach Lagerplatz, Platz- und Chargenvorschlag, Teilmengen, Abschluss setzt vollständige Aufträge auf „Verpackung“, Storno setzt zurück, Druckansicht.
- **FangEvo Pack:** Packplätze mit eigener Einstellung (Versandart, Lieferschein/Rechnung automatisch); Auftrag scannen, Artikel scannen mit sofortiger Fehlermeldung (falscher Artikel, Variante, doppelt), Seriennummern erfassen, Pakete mit Gewicht, Abschluss mit Prüfung auf dem Server, Versand und Belegen in einem Schritt.
- **Versand:** Sendungen mit Paketen und Trackingnummer (nachtragbar), eigenes Adressetikett als PDF. Versanddienstleister (DHL, DPD, …) folgen erst nach Zugangsdaten und Test im Testsystem.
- **Retouren:** Anmeldung zu versendeten Aufträgen (nicht mehr als versendet), Eingang mit Zustand (wieder verkaufbar/beschädigt/entsorgen), Einlagerung mit Buchungsart „Retoure“, Gutschrift als Entwurf.
- **Mobile Scan-Seite** `/scan`: Handscanner, Kamera (wo der Browser es kann) oder Eingabe; Bestand je Platz/Charge; Zugang, Umlagerung, Inventur; offene Picklisten.
- Widget „Offene Retouren“; neue Rechte `picking.execute`, `packing.execute`, `shipping.manage`, `returns.read/manage`; Module Pack, Versand und Retouren freigeschaltet (ab Paket Business).
- 5. Browser-E2E-Ablauf (Pickliste → Packtisch → Retoure → Handy-Scan).

### Geändert

- Lagerbestände zeigen Charge, Seriennummer, MHD und die Reservierungen je Lager (statt einer stets leeren Spalte je Lagerplatz).
- Picklisten übernehmen neue Aufträge automatisch in „In Bearbeitung“.

## [0.4.0] – 2026-11-09 – Phase 3b: Aufträge, Belege, Einkauf

### Hinzugefügt

- **Aufträge:** Anlage mit Kunde, Artikeln und Freitextpositionen; Preise ermittelt der Server (Kundengruppenpreis vor Staffelpreis vor Verkaufspreis, Gruppenrabatt, Varianten erben vom Vaterartikel); Versandkosten; Summen je Steuersatz. Kontrollierte Statuswechsel mit Verlauf. Bestand wird ab Anlage reserviert (ältere Aufträge zuerst); Fehlmengen werden angezeigt. „Versenden“ bucht den Bestand über das Bestandsjournal ab (Sets über ihre Komponenten, mehrere Lagerplätze). Storno gibt Reservierungen frei. Gesperrte Kunden, Vaterartikel und inaktive Artikel werden abgelehnt.
- **Belege:** Angebot, Auftragsbestätigung, Lieferschein, Rechnung aus dem Auftrag; Gutschrift (ganz oder je Position) und Stornorechnung. Erst Entwurf, beim Festschreiben lückenlose Nummer und PDF mit Pflichtangaben (§ 14 UStG) und Steuer je Satz. Das PDF wird mit SHA-256-Prüfsumme unveränderlich gespeichert; festgeschriebene Belege, Zahlungen und PDFs sind per Datenbank-Trigger geschützt (GoBD). Versand per E-Mail mit PDF-Anhang. Zahlungen mit Zahlungsstatus (offen, teilweise, bezahlt, storniert).
- **Einkauf:** Bestellvorschläge (Bestand − Reservierungen + offene Bestellungen unter Mindestbestand, bevorzugter/günstigster Lieferant, Mindestbestellmenge), Bestellungen mit Lieferanten-Artikelnummer und PDF, Versand per E-Mail, Wareneingang auch teilweise (mit Lagerplatz, Charge, MHD), Überlieferung wird abgelehnt.
- **Firmeneinstellungen:** Angaben auf Belegen (Steuernummer, Geschäftsführung, Register, Bank mit IBAN-Prüfung, Fußzeile, Logo). Nummernkreise für Aufträge, alle Belegarten und Bestellungen (auch für bestehende Firmen ergänzt).
- **Dashboard-Widgets:** Umsatz (heute, Woche, Monat, offene Rechnungen), Offene Aufträge, Topseller.
- Neue Rechte `orders.read/manage`, `documents.read/manage`, `purchasing.read/manage`; Rolle „Mitarbeiter“ darf die neuen Bereiche ansehen.
- Module Aufträge, Dokumente und Einkauf sind im Katalog freigeschaltet (Einkauf ab Paket Business).
- Lasttest Warenwirtschaft mit 100.000 Artikeln, 20.000 Kunden und 50.000 Aufträgen (`pnpm --filter @fangevo/api perf:wawi`).
- 4. Browser-E2E-Ablauf (Auftrag → Versand → Rechnung → Zahlung → Umsatz-Widget).

### Geändert

- Verlauf zeigt deutsche Texte für alle Aktionen der Warenwirtschaft.
- ID-Felder in Listenfiltern werden exakt verglichen (vorher Textvergleich, der bei UUID-Spalten fehlschlagen konnte).

### Behoben (während der Entwicklung gefunden)

- Administratoren konnten die Rolle „Administrator“ nicht mehr weitergeben, sobald sie Rechte eines nicht gebuchten Moduls enthielt. Maßstab ist jetzt der eigene Rechteumfang ohne Lizenzfilter; Rechteausweitung bleibt ausgeschlossen (Test vorhanden).
- Browser-Test aus Phase 1 erwartete noch die alten Mitarbeiter-Rechte; versehentlich eingecheckte Redis-Dateien (`dump.rdb`) entfernt.

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
