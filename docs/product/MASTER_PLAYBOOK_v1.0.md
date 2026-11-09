# FANG EVO WAWI PRO – MASTER DEVELOPMENT PLAYBOOK

**Version 1.0 – Produktvision, technische Architektur und Entwicklungsauftrag**

| | |
|---|---|
| Produktname | FangEvo Wawi Pro |
| Produktart | Modulare SaaS-Warenwirtschaft / ERP / E-Commerce-Plattform |
| Zielgruppe | Kleine, mittelständische und große Handelsunternehmen |
| Entwicklungswerkzeug | Claude Code |
| Entwicklungsstrategie | Modular, API-first, Cloud-first, Multi-Tenant |
| Projektstatus | Konzept und technische Spezifikation – JTL-Bestandsaufnahme ausstehend |

> Dieses Dokument ist die verbindliche fachliche Grundlage des Projekts. Änderungen nur mit Freigabe des Product Owners und mit neuer Versionsnummer.

---

## 1. Aufgabe und Ziel

Du bist der leitende Softwarearchitekt und technische Entwickler des Projekts FangEvo Wawi Pro.

Deine Aufgabe ist die Entwicklung einer vollständigen, professionellen und kommerziell vermarktbaren Warenwirtschaft. FangEvo Wawi Pro soll funktional mit etablierten Systemen wie JTL-Wawi und Afterbuy konkurrieren können. Es soll jedoch nicht einfach eine Kopie bestehender Software werden. Unser Ziel ist eine eigenständige, modernere und wesentlich flexiblere Plattform.

Die Software soll folgende Eigenschaften besitzen:

- Vollständige Warenwirtschaft
- Multichannel-E-Commerce
- Artikel- und Produktmanagement
- Auftragsverwaltung
- Kunden- und Lieferantenverwaltung
- Mehrlagerverwaltung
- Einkauf und Bestandsmanagement
- Versand und Retouren
- Import- und Exportmanagement
- Automatisierungen und Workflows
- Individuell konfigurierbare Dashboards
- Offene API
- Erweiterbarer Marketplace
- Mandantenfähigkeit
- Eigenständiges Lizenz- und Abrechnungssystem
- Individuell anpassbare Benutzeroberflächen

Die Software muss langfristig Tausende Kundenunternehmen bedienen können.

**WICHTIG:** Es wird eine vollständig eigenständige Implementierung erstellt. Keine Übernahme proprietären Quellcodes, geschützter Datenbankbestandteile oder vertraulicher Implementierungsdetails anderer Hersteller. Öffentlich dokumentierte Funktionen dürfen als fachliche Referenz dienen.

## 2. Produktphilosophie

FangEvo Wawi Pro verfolgt fünf Grundprinzipien.

### 2.1 Flexibilität

Jedes Unternehmen arbeitet anders. Die Software muss deshalb individuell konfigurierbar sein. Kunden sollen selbst entscheiden können:

- Welche Module sie verwenden.
- Welche Menüpunkte sichtbar sind.
- Welche Informationen angezeigt werden.
- Wie ihre Dashboards aufgebaut sind.
- Welche Datenfelder vorhanden sind.
- Welche Workflows automatisch ausgeführt werden.
- Welche Mitarbeiter welche Funktionen nutzen dürfen.

### 2.2 Benutzerfreundlichkeit

Die Benutzeroberfläche soll deutlich moderner und intuitiver als klassische Warenwirtschaftssysteme sein. Komplexe Prozesse müssen verständlich dargestellt werden. Häufig verwendete Funktionen müssen schnell erreichbar sein.

### 2.3 Modularität

Jede größere Funktion wird als eigenständiges Modul entwickelt. Module müssen einzeln aktiviert, deaktiviert, erweitert und lizenziert werden können.

### 2.4 Erweiterbarkeit

Neue Schnittstellen, Module und individuelle Kundenanforderungen sollen möglichst ohne Änderungen am Kernsystem umgesetzt werden können.

### 2.5 Skalierbarkeit

Die Architektur muss für kleine Händler ebenso geeignet sein wie für Unternehmen mit mehreren Standorten, vielen Mitarbeitern und hohen Bestellvolumen.

## 3. Produktarchitektur

FangEvo Wawi Pro besteht aus folgenden Hauptbereichen:

FangEvo Core · Dashboard · Artikel · Aufträge · Kunden · Lieferanten · Einkauf · Lager · Pack · Import · Versand · Retouren · Multichannel · Automatisierung · CRM · Dokumente · Finanzen · API · Marketplace · Lizenzverwaltung · Analytics · Administration

Alle Module greifen auf eine gemeinsame, zentral verwaltete Geschäftslogik zu. Die einzelnen Module dürfen keine voneinander unabhängigen Datenbestände aufbauen, wenn dieselben Geschäftsdaten zentral verwaltet werden müssen.

## 4. Technische Grundarchitektur

### 4.1 Architekturprinzip

Modulare Plattform mit klarer Trennung zwischen: Frontend, Backend, Geschäftslogik, Datenhaltung, Schnittstellen, Hintergrundprozessen, Lizenzverwaltung, Authentifizierung, Mandantenverwaltung.

Für die erste Version wird ein **modularer Monolith** bevorzugt. Keine unnötige Microservice-Architektur am Anfang. Die Architektur muss jedoch so aufgebaut sein, dass einzelne Komponenten später unabhängig ausgelagert werden können.

### 4.2 Vorgeschlagener Technologie-Stack

Diese Auswahl ist der technische Ausgangsvorschlag und muss vor der Implementierung anhand der Anforderungen validiert werden.

- **Frontend:** React, TypeScript, Next.js, Tailwind CSS, Komponentenbibliothek mit wiederverwendbaren UI-Elementen
- **Backend:** TypeScript, NestJS, REST API, OpenAPI / Swagger, Hintergrundverarbeitung mit Queue-System
- **Datenbank:** PostgreSQL, Prisma ORM, Redis für Caching und Hintergrundaufgaben
- **Dateispeicherung:** S3-kompatibler Objektspeicher; Dokumente und Produktbilder getrennt verwalten
- **Infrastruktur:** Docker, CI/CD, Entwicklungs-, Test- und Produktionsumgebungen, zentralisiertes Logging, Monitoring, automatisierte Backups
- **Desktop- und lokale Anbindung:** Browserbasierte Hauptanwendung, optionaler lokaler FangEvo Connector, Unterstützung für lokale Drucker, Scanner, Waagen und weitere Hardware

Die konkrete Auswahl ist vor Beginn verbindlich zu dokumentieren. Keine Technologie darf allein aufgrund persönlicher Vorlieben eingeführt werden.

## 5. Mandanten- und Firmenverwaltung

Die Software muss von Anfang an mandantenfähig entwickelt werden.

### 5.1 Kundenstruktur

Ein Kunde besitzt einen FangEvo-Account. Unter diesem Account können mehrere Firmen verwaltet werden. Inklusive sind zunächst drei Firmen. Jede weitere Firma ist kostenpflichtig.

### 5.2 Firmenstruktur

Jede Firma kann besitzen: eigene Artikel, Kunden, Lieferanten, Lager, Verkaufskanäle, Mitarbeiterrechte, Einstellungen, Dokumentenvorlagen, Automatisierungen.

Gemeinsam genutzte Ressourcen müssen ausdrücklich konfigurierbar sein. Daten unterschiedlicher Kunden müssen vollständig voneinander getrennt sein.

### 5.3 Mitarbeiter

Jeder Mitarbeiter erhält einen eigenen Zugang. Es muss möglich sein: Benutzer einzuladen, Benutzer zu deaktivieren, Rollen zu vergeben, individuelle Rechte zu vergeben, Zugriffe auf bestimmte Firmen einzuschränken, Zugriffe auf einzelne Module zu beschränken, Aktivitäten zu protokollieren.

## 6. Lizenz- und Abrechnungssystem

Das Lizenzsystem ist eine zentrale Komponente der Software. Es darf nicht fest in die einzelnen Module programmiert werden.

### 6.1 Grundpakete (vorläufige Verkaufspreise)

| Paket | Monatspreis |
|---|---|
| Starter | 199 € |
| Business | 299 € |
| Professional | 499 € |
| Enterprise | Individuell |

Alle Preise sind vorläufig und müssen später kalkuliert werden.

### 6.2 Lizenzarten

- **A. Grundlizenz** – berechtigt zur Nutzung des gebuchten Softwarepakets.
- **B. Firmenlizenz** – drei Firmen inklusive, weitere Firmen kostenpflichtig.
- **C. Benutzerlizenz** – einzelne Mitarbeiter können lizenziert werden.
- **D. Modullizenz** – zusätzliche Funktionen können separat freigeschaltet werden.
- **E. Schnittstellenlizenz** – jede zusätzliche Shop- oder Marktplatzanbindung kann separat lizenziert werden.
- **F. Individuelle Integration** – einmalige Einrichtungskosten und anschließend wiederkehrende Lizenzkosten.

### 6.3 Lizenzverwaltung

Das System muss können: Abonnements erstellen und ändern, Module freischalten und deaktivieren, Benutzer-, Firmen- und Schnittstellenlizenzen verwalten, Testzeiträume ermöglichen, Kündigungen verarbeiten, Zahlungsstatus verwalten, Lizenzhistorie speichern, Rechnungen und Zahlungsinformationen verwalten.

Eine fehlgeschlagene Zahlung darf nicht unmittelbar zu einem Datenverlust führen. Gesperrte Konten müssen einen geregelten Zugriff auf Abrechnung und Datenexport behalten.

## 7. Dashboard und Benutzeroberfläche

Das Design ist ein wesentlicher Wettbewerbsvorteil. FangEvo soll nicht wie eine klassische Windows-Warenwirtschaft aussehen.

### 7.1 Designziele

Modern, übersichtlich, schnell, professionell, hochwertig, individuell anpassbar, responsive, barrierearm.

### 7.2 Dashboard-Baukasten

Widgets hinzufügen, entfernen, verschieben, Größe verändern; eigene Ansichten speichern; eigene Dashboard-Seiten erstellen; Filter speichern; Kennzahlen auswählen; Diagramme konfigurieren.

### 7.3 Dashboard-Widgets

Umsatz heute / Woche / Monat, offene Aufträge, unbearbeitete Bestellungen, offene Retouren, Lagerbestände, Artikel mit Mindestbestand, Versandstatus, Bestellvolumen, Verkaufskanäle, Top-Seller, Umsatzentwicklung, Gewinn- und Margenübersichten, Mitarbeiteraktivitäten.

Finanzkennzahlen müssen auf einer nachvollziehbaren Datenbasis beruhen. Umsatz darf nicht mit Gewinn gleichgesetzt werden.

### 7.4 Individuelle Tabellen

Jede größere Listenansicht soll konfigurierbar sein: Spalten ein-/ausblenden, verschieben, Breite ändern; Sortierung; Filter; Gruppierung; gespeicherte Ansichten; Massenbearbeitung; Export.

### 7.5 Benutzerdefinierte Felder

Kunden müssen eigene Felder definieren können: Text, Zahl, Datum, Ja/Nein, Auswahl, Mehrfachauswahl, Referenz auf andere Datensätze. Benutzerdefinierte Felder müssen in Formularen, Tabellen, Filtern und ausgewählten Workflows verwendbar sein.

## 8. Artikelverwaltung

Die Artikelverwaltung muss eine vollständige Produktdatenbank darstellen.

Funktionen: Artikel anlegen, bearbeiten, archivieren, duplizieren; Varianten; Vater- und Kindartikel; Stücklisten; Sets; Bundles; EAN; GTIN; SKU; Hersteller; Marke; Kategorien; Attribute; Merkmale; Produktbilder; Dokumente; Einkaufspreise; Verkaufspreise; Staffelpreise; Kundengruppenpreise; Lagerbestände; Mindestbestände; Lieferantenbeziehungen; Verkaufskanäle; Produkttexte; Mehrsprachigkeit.

Artikel müssen mehrere Verkaufskanäle bedienen können. Die kanalbezogenen Produktinformationen müssen unabhängig von den zentralen Stammdaten verwaltet werden.

## 9. Auftragsverwaltung

Die Auftragsverwaltung ist eines der wichtigsten Kernmodule.

Funktionen: Aufträge manuell erstellen, importieren, aus Shops und Marktplätzen übernehmen; Auftragspositionen bearbeiten; Kunden zuordnen; Versandart auswählen; Zahlungsart verwalten; Rabatte; Versandkosten; Rechnungen und Gutschriften erzeugen; Stornierungen; Auftragsstatus; Auftragsverlauf; Filter; Massenbearbeitung.

**Auftragsstatus:** Neu · Ungeprüft · In Bearbeitung · Wartet auf Zahlung · Wartet auf Bestand · Kommissionierung · Verpackung · Versandbereit · Versendet · Abgeschlossen · Storniert.

Statusübergänge müssen über definierte Regeln erfolgen. Es darf keine unkontrollierten Statusänderungen geben.

## 10. Kunden und Lieferanten

**Kundenverwaltung:** Privatkunden, Geschäftskunden, Ansprechpartner, mehrere Liefer- und Rechnungsadressen, Kundengruppen, Zahlungsbedingungen, individuelle Preise, Bestellhistorie, Dokumentenarchiv, CRM-Notizen, Kommunikationshistorie, Sperrvermerke, kundenspezifische Felder.

**Lieferantenverwaltung:** Stammdaten, Ansprechpartner, Lieferantenartikelnummern, Einkaufspreise, Lieferzeiten, Mindestbestellmengen, Bestellhistorie, Konditionen, Lieferantenrechnungen, Lieferantenbewertung.

## 11. Einkauf und Beschaffung

Bedarfsermittlung, Mindestbestandsüberwachung, Bestellvorschläge, Lieferantenvergleich, Einkaufsbestellungen, Teil- und vollständige Wareneingänge, Lieferterminverwaltung, Rückstände, Einkaufshistorie, automatische Nachbestellung.

Automatisierte Bestellungen benötigen konfigurierbare Freigaberegeln.

## 12. Lagerverwaltung – FangEvo Lager

Mehrere Lager, Lagerbereiche, Regale, Lagerplätze, Barcodeverwaltung, Wareneingang, Warenausgang, Umlagerung, Inventur, Bestandskorrektur, Reservierungen, Mindestbestände, Chargenverwaltung, Seriennummern, MHD-Verwaltung, Picklisten, Kommissionierung.

**Mobile Lagerverwaltung:** Barcode scannen, Artikel suchen, Lagerbestand abfragen, Lagerplatz anzeigen, Wareneingang erfassen, Umlagerungen, Inventur, Kommissionierung.

## 13. FangEvo Pack

Eigenständiger Versandarbeitsplatz, optimiert auf Geschwindigkeit und einfache Bedienung.

Funktionen: Aufträge übernehmen, Picklisten anzeigen, Artikel scannen, Positionen bestätigen, Fehlmengen erkennen, Pakete erstellen, Versanddienstleister auswählen, Versandetiketten erzeugen, Rechnungen und Lieferscheine drucken, Gewicht erfassen, Paketanzahl verwalten, Versand bestätigen, Trackingnummer zurückmelden.

**Packtisch-Arbeitsplätze:** Mehrere Mitarbeiter arbeiten gleichzeitig an unterschiedlichen Packplätzen, jeder mit individueller Konfiguration. Geräte: Barcode-Scanner, Etikettendrucker, A4-Drucker, Waage, Paketmesssystem.

**Fehlervermeidung:** falscher Artikel, falsche Variante, fehlende Position, doppelte Position, unvollständiger Auftrag.

## 14. FangEvo Import

Eigenständiges Werkzeug für Massenimporte und -exporte, orientiert an professionellen Warenwirtschafts-Importwerkzeugen.

- **Quellen:** CSV, XLSX, XML, JSON, REST API, geplante Datenimporte, FTP/SFTP über sichere Konfiguration.
- **Funktionen:** Importvorlagen, Spaltenmapping, Feldzuordnung, Datentypkonvertierung, Standardwerte, Filter, Bedingungen, Vorschau, Testimport, Fehlerprotokoll, Importhistorie, Rollback (soweit fachlich und technisch sicher möglich), geplante Importe, automatisierte Exporte.
- **Module:** Artikel, Varianten, Kunden, Lieferanten, Bestände, Preise, Bestellungen, Kategorien, Produktmerkmale.

Jeder Import muss zuerst validiert werden. Erst nach erfolgreicher Prüfung darf ein Import produktiv ausgeführt werden. Bei großen Importen müssen Fortschritt, Fehler und Ergebnisse angezeigt werden.

## 15. Multichannel und Shopanbindungen

Geplante Integrationen: Amazon, eBay, Kaufland, OTTO, Shopify, WooCommerce, Shopware, Etsy, TikTok Shop, weitere Systeme über API.

Zentrale Funktionen: Produkte, Preise und Bestände synchronisieren; Bestellungen abrufen; Bestellstatus zurückmelden; Trackingdaten übertragen; Produktdaten kanalbezogen anpassen; Verkaufskanäle getrennt konfigurieren.

**Schnittstellenarchitektur:** Jede Integration wird als eigenständiger Connector implementiert. Ein Connector benötigt: Authentifizierung, Konfiguration, Feldmapping, Synchronisationsregeln, Fehlerprotokoll, Wiederholungslogik, Rate-Limit-Behandlung, Statusanzeige, Lizenzprüfung.

Die Connectoren dürfen nicht direkt auf interne Datenbanktabellen zugreifen. Sie kommunizieren über definierte interne Services und Schnittstellen.

**Priorisierung:** Zunächst wird die Connector-Architektur entwickelt. Danach werden die wichtigsten Integrationen anhand von Nachfrage, API-Verfügbarkeit, technischen Einschränkungen und Betriebskosten priorisiert. Keine Schnittstelle darf als fertig bezeichnet werden, bevor echte Sandbox- oder Integrationstests durchgeführt wurden.

## 16. Automatisierung und Workflows

Kunden müssen eigene Regeln erstellen können.

Beispiel – Wenn eine neue Bestellung eingeht, dann: Auftrag prüfen, Bestand reservieren, Versandart bestimmen, Mitarbeiter informieren.

Weitere Auslöser: Bestand unter Mindestbestand, Bestellung mit bestimmtem Warenwert, Kunde aus bestimmtem Land, Auftrag wartet zu lange, Retoure eingegangen, Lieferantenlieferung verspätet, Artikel nicht verfügbar.

**Workflow-Editor (später, grafisch):** Auslöser auswählen, Bedingungen definieren, Aktionen auswählen, Verzögerungen, Verzweigungen, Benachrichtigungen, Workflow testen, Workflow aktivieren.

Workflows benötigen Versionierung, Ausführungsprotokolle, Fehlerbehandlung und Schutz vor Endlosschleifen.

## 17. FangEvo CRM

Kundenübersicht, Ansprechpartner, Kommunikationshistorie, Aufgaben, Wiedervorlagen, Notizen, Kundengruppen, Verkaufschancen, Umsatzhistorie, Kundenaktivitäten, individuelle Felder. Das CRM muss eng mit der Warenwirtschaft verbunden sein.

## 18. Dokumente und Finanzen

**Dokumenttypen:** Angebote, Auftragsbestätigungen, Rechnungen, Lieferscheine, Gutschriften, Stornorechnungen, Mahnungen, Einkaufsbestellungen.

**Anforderungen:** PDF-Erzeugung, Dokumentenvorlagen, Nummernkreise, firmenbezogene Einstellungen, mehrsprachige Dokumente, Dokumentenarchiv, E-Mail-Versand, Änderungsprotokoll.

**Finanzfunktionen:** Zahlungsstatus, Zahlungszuordnung, offene Posten, Zahlungsabgleich, Steuerinformationen, Export für Buchhaltungssysteme.

Die Software muss steuerliche Anforderungen für die jeweiligen Zielmärkte berücksichtigen. Rechtlich verbindliche Rechnungs- und Buchhaltungsfunktionen müssen vor Markteinführung fachlich und rechtlich geprüft werden. Keine automatische Steuer- oder Buchhaltungslogik ohne geprüfte Spezifikation.

## 19. Marketplace

Kunden sollen zusätzliche Funktionen buchen können: Shop- und Marktplatzanbindungen, Versandmodule, individuelle Importvorlagen, erweiterte Automatisierungen, Reportingmodule, CRM-Erweiterungen, Branchenmodule.

Funktionen: Modulübersicht, Beschreibung, Preis, Lizenzmodell, Testversion, Installation, Aktivierung, Deaktivierung, Verlängerung, Kündigung, Versionsverwaltung.

Erweiterungen müssen vor Veröffentlichung geprüft und freigegeben werden.

## 20. API und Entwicklerplattform

Anforderungen: REST API, OpenAPI-Dokumentation, API-Schlüssel, OAuth2 (wo erforderlich), Rollen und Berechtigungen, Rate Limits, Webhooks, API-Versionierung, Protokollierung, Fehlercodes, Entwicklerdokumentation.

Webhooks u. a. bei: neue Bestellung, Bestellung geändert, Artikel geändert, Bestand geändert, Kunde angelegt, Versand abgeschlossen, Retoure eingegangen.

Externe Systeme erhalten ausschließlich die Daten und Funktionen, für die sie berechtigt sind.

## 21. Sicherheit und Datenschutz

Sicherheit ist Bestandteil der Architektur und darf nicht nachträglich ergänzt werden.

Verbindlich: sichere Authentifizierung, Mehr-Faktor-Authentifizierung, rollenbasierte Rechte, Mandantentrennung, verschlüsselte Kommunikation, sichere Geheimnisverwaltung, Audit-Logs, Backupkonzept, Wiederherstellungstests, Schutz vor SQL-Injection, XSS und CSRF (soweit relevant), Rate Limiting, sichere Sessionverwaltung, sichere Dateiuploads, Zugriffskontrollen für APIs.

DSGVO-Anforderungen sind von Beginn an zu berücksichtigen. Personenbezogene Daten müssen nach einem definierten Lösch- und Aufbewahrungskonzept behandelt werden. Sicherheitskritische Vorgänge müssen protokolliert werden.

## 22. JTL- und Afterbuy-Analyse

Vor der vollständigen Funktionsimplementierung muss eine strukturierte Bestandsaufnahme erfolgen. Ziel ist ein fachlicher Vergleich.

**JTL – zu untersuchen:** installierte Version, verfügbare Module, Menüstruktur, Artikelverwaltung, Auftragsverwaltung, Kundenverwaltung, Lieferantenverwaltung, Einkauf, Lager, Versand, Retouren, Ameise, Packtisch, Workflows, Benutzerverwaltung, Datenbankstruktur, Schnittstellen.

**Afterbuy – zu untersuchen:** Multichannel-Funktionen, Produktverwaltung, Auftragsmanagement, Lagerverwaltung, Automatisierungen, Kundenmanagement, Versandprozesse, API, Schnittstellen.

**Analyseergebnis:** Funktionsmatrix mit den Spalten *Referenzsystem | Funktion | FangEvo-Modul | Priorität | Umsetzungsstatus*.

Prioritäten: **P0** für das Grundsystem zwingend · **P1** für die erste marktfähige Version wichtig · **P2** Erweiterung · **P3** spätere Optimierung.

Unbekannte Funktionen werden als ungeprüft gekennzeichnet. Keine Funktionen als vorhanden dokumentieren, wenn sie nicht tatsächlich untersucht wurden. Die JTL-Datenbank darf nur mit ausdrücklicher Berechtigung untersucht werden. Die Analyse erfolgt zunächst lesend und vorzugsweise anhand einer gesicherten Kopie. Keine Änderungen an produktiven Kundendaten.

## 23. Projektstruktur (Vorschlag)

```
fang-evo-wawi-pro/
  apps/            web, api, admin, connector
  packages/        ui, shared, database, authentication, licensing,
                   integrations, workflow-engine, validation
  modules/         articles, orders, customers, suppliers, purchasing,
                   inventory, warehouse, packing, import-export, shipping,
                   returns, multichannel, crm, documents, finance,
                   marketplace, analytics
  infrastructure/  docker, deployment, monitoring
  docs/            architecture, product, database, api, modules,
                   research, decisions
  tests/           integration, e2e, security
  scripts/
```

Die konkrete Struktur kann angepasst werden, sofern die modulare Trennung erhalten bleibt.

## 24. Entwicklungsstrategie

- **Phase 0 – Bestandsaufnahme:** Entwicklungsumgebung prüfen, bestehende Dateien und Repositories prüfen, JTL-Version erfassen, installierte Komponenten dokumentieren, Datenbankzugriff klären, Afterbuy recherchieren, offene technische Fragen dokumentieren, Architekturentscheidungen vorbereiten. *Ergebnis: Analysebericht und technische Entscheidungsgrundlage.*
- **Phase 1 – Technisches Fundament:** Repository, Entwicklungsumgebung, Datenbank, Authentifizierung, Mandanten-, Firmen- und Benutzerverwaltung, Rollen und Rechte, grundlegendes UI-Designsystem. *Ergebnis: Grundsystem mit Login, Mandanten und Administration.*
- **Phase 2 – Dashboard und Core:** Hauptnavigation, Dashboard, Widget-System, Tabellenkomponenten, benutzerdefinierte Felder, globale Suche, Benachrichtigungen, Aktivitätsprotokoll. *Ergebnis: verwendbare, individualisierbare Arbeitsoberfläche.*
- **Phase 3 – Warenwirtschaft:** Artikel, Kunden, Lieferanten, Einkauf, Aufträge, Lager, Bestände, Dokumente. *Ergebnis: funktionsfähige Grundwarenwirtschaft.*
- **Phase 4 – Logistik:** FangEvo Lager, FangEvo Pack, mobile Scanner-Oberfläche, Picklisten, Kommissionierung, Versandetiketten, Retouren. *Ergebnis: durchgängiger Lager- und Versandprozess.*
- **Phase 5 – Import und Multichannel:** FangEvo Import, CSV/Excel, Feldmapping, Importvorlagen, API, Connector-System, erste Shop- und Marktplatzanbindungen. *Ergebnis: externe Verkaufskanäle anbindbar.*
- **Phase 6 – Automatisierung:** Workflow-Engine, Regelverwaltung, Ereignissystem, Webhooks, zeitgesteuerte Prozesse. *Ergebnis: automatisierbare Geschäftsprozesse.*
- **Phase 7 – Kommerzialisierung:** Lizenzsystem, Abonnements, Zahlungsintegration, Marketplace, Kundenportal, Modulverwaltung, Supportverwaltung. *Ergebnis: verkaufbare SaaS-Plattform.*
- **Phase 8 – Produktionsreife:** Sicherheits-, Performance- und Lasttests, Mandantentrennung testen, Datenmigration testen, Backup/Wiederherstellung testen, Fehlerbehandlung, Dokumentation, Pilotkunden. *Ergebnis: produktionsfähige Version.*

## 25. Verbindliche Entwicklungsregeln für Claude Code

1. Entwickle niemals die gesamte Software in einem einzigen Arbeitsschritt.
2. Arbeite immer in klar abgegrenzten Modulen.
3. Prüfe vor jeder Änderung die bestehende Projektstruktur.
4. Erstelle vor größeren Änderungen einen Umsetzungsplan.
5. Ändere bestehende funktionierende Module nicht unnötig.
6. Verwende TypeScript und strenge Typisierung.
7. Vermeide unkontrollierte Datenbankzugriffe.
8. Verwende gemeinsame Services für zentrale Geschäftslogik.
9. Jede relevante Funktion benötigt Tests.
10. Keine Zugangsdaten im Quellcode.
11. Keine produktiven Kundendaten für Entwicklungstests.
12. Jede Datenbankmigration muss nachvollziehbar sein.
13. Keine destruktiven Datenbankänderungen ohne ausdrückliche Freigabe.
14. Mandantentrennung muss bei jeder Datenabfrage gewährleistet sein.
15. Lizenzprüfungen müssen serverseitig erfolgen.
16. Module müssen sauber voneinander getrennt sein.
17. Fehler müssen verständlich protokolliert werden.
18. Keine erfundenen API-Funktionen.
19. Keine vorgetäuschten Integrationen.
20. Keine Dummy-Funktionen als fertige Features deklarieren.

Nach jedem abgeschlossenen Entwicklungsschritt: Tests ausführen, Fehler beheben, Dokumentation aktualisieren, Status dokumentieren, Änderungen nachvollziehbar festhalten.

## 26. Qualitätskriterien

Ein Modul gilt erst als fertig, wenn: die Oberfläche funktioniert, die Daten korrekt gespeichert werden, Berechtigungen berücksichtigt werden, Mandantentrennung gewährleistet ist, Fehler behandelt werden, relevante Tests vorhanden sind, die Dokumentation aktualisiert wurde, die Integration mit anderen Modulen funktioniert.

- Eine optisch fertige Oberfläche ist keine fertige Funktion.
- Eine erfolgreiche API-Antwort ohne korrekte Datenverarbeitung ist keine fertige Integration.
- Ein importierter Datensatz ohne Validierung ist kein fertiger Importprozess.

## 27. Erste marktfähige Version

Muss vollständig beherrschen: Kundenkonto erstellen, Firma anlegen, Mitarbeiter einladen, Benutzerrechte vergeben, Artikel erstellen, Lagerbestand verwalten, Kunden anlegen, Bestellungen importieren oder manuell erfassen, Aufträge bearbeiten, Waren kommissionieren, Pakete erstellen, Versand abwickeln, Rechnungen erzeugen, Retouren bearbeiten, Umsätze und Bestände auswerten.

Die erste Version muss nicht sämtliche geplanten Integrationen enthalten, aber eine saubere Architektur für spätere Erweiterungen besitzen.

## 28. Dokumentationspflicht

Kontinuierlich zu pflegen: README.md, ARCHITECTURE.md, DATABASE.md, API.md, SECURITY.md, LICENSING.md, MODULES.md, DEVELOPMENT_ROADMAP.md, TESTING.md, CHANGELOG.md, DECISIONS.md. Zusätzlich erhält jedes größere Modul eine eigene Dokumentation.

## 29. Definition of Done

Das Projekt gilt nicht als abgeschlossen, nur weil die Anwendung gestartet werden kann. FangEvo Wawi Pro ist erst marktreif, wenn: die Warenwirtschaft vollständig funktionsfähig ist, die zentralen Geschäftsprozesse funktionieren, Mandanten sicher getrennt sind, das Lizenzsystem zuverlässig arbeitet, die Benutzerverwaltung funktioniert, die wichtigsten Schnittstellen produktiv getestet sind, Import und Export funktionieren, Lager und Versand funktionieren, Backups und Wiederherstellung geprüft sind, Sicherheitsprüfungen durchgeführt wurden, die Dokumentation vollständig ist und Pilotkunden erfolgreich arbeiten können.

## 30. Erster Arbeitsauftrag an Claude Code

**WICHTIG:** Beginne NICHT sofort mit der vollständigen Entwicklung.

1. **Systemanalyse** – Arbeitsverzeichnis, vorhandene Projekte, Laufzeitumgebungen (Node.js, npm/pnpm, Docker, Git), Datenbanken, Entwicklungswerkzeuge, vorhandene Projektdateien prüfen.
2. **JTL-Bestandsaufnahme vorbereiten** – benötigte Informationen ermitteln, Checkliste erstellen, keine Zugangsdaten im Klartext anfordern, keine Änderungen an JTL-Installation oder Datenbank, sichere lesende Analyse einer autorisierten Kopie vorbereiten.
3. **Technische Entscheidungen** – vorgeschlagene Architektur prüfen; Vorteile, Nachteile, Risiken, Betriebskosten, Skalierbarkeit, Wartbarkeit, Sicherheitsanforderungen dokumentieren; begründete Technologieempfehlung.
4. **Projektplan** – Module, Abhängigkeiten, Datenmodelle, API-Konzepte, Teststrategie, Arbeitspakete, Prioritäten.
5. **Freigabe** – Ergebnisse präsentieren und auf Freigabe warten, bevor grundlegende Architekturentscheidungen umgesetzt oder größere Änderungen an vorhandenen Dateien vorgenommen werden.

## Abschließende Produktvision

FangEvo Wawi Pro soll nicht einfach eine weitere Warenwirtschaft sein. Wir wollen eine Plattform entwickeln, die sich dem Unternehmen anpasst und nicht das Unternehmen zwingt, sich einer starren Software anzupassen. Die Software muss mit dem Kunden wachsen können: Ein kleiner Händler beginnt mit den Grundfunktionen, ein mittelständischer Händler fügt Lager, Mitarbeiter und Schnittstellen hinzu, ein großes Unternehmen betreibt individuelle Prozesse, mehrere Firmen und komplexe Automatisierungen. Die gesamte Plattform wird über ein einheitliches Lizenzsystem verwaltet.

**FangEvo Wawi Pro verbindet die Funktionsvielfalt einer professionellen Warenwirtschaft mit der Flexibilität moderner SaaS-Plattformen. Eine Plattform. Unzählige Möglichkeiten. Angepasst an jedes Unternehmen.**

*Ende Master Development Playbook – Version 1.0*
