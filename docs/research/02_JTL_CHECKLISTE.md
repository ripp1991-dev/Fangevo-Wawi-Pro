# Phase 0 · Schritt 2 – JTL- und Afterbuy-Bestandsaufnahme (Vorbereitung)

**Stand:** 2026-11-09 · **Status:** vorbereitet, wartet auf Informationen von FangEvo

## Grundregeln

- Es werden **keine Zugangsdaten im Chat oder Klartext** übergeben. Passwörter nur über einen Passwortmanager oder als Umgebungsvariable auf dem Analyse-Rechner.
- **Keine Änderung** an der produktiven JTL-Installation oder Datenbank.
- Analyse ausschließlich **lesend** auf einer **gesicherten Kopie** in einer isolierten Umgebung.
- Ergebnis ist eine **fachliche** Funktionsmatrix. Es werden keine Tabellenstrukturen, Stored Procedures oder Programmteile von JTL in FangEvo übernommen (Playbook Abschnitt 1).
- Nur Funktionen dokumentieren, die tatsächlich angesehen wurden. Alles andere bekommt den Status `ungeprüft`.

## A. Rechtliche Vorabklärung (vor jeder technischen Analyse)

- [ ] Wem gehört die JTL-Installation bzw. die Daten? Liegt eine schriftliche Erlaubnis des Eigentümers zur Analyse vor?
- [ ] JTL-Lizenzbedingungen (EULA) prüfen: Ist das Untersuchen der Datenbankstruktur erlaubt? Bis zur Klärung wird nur die **Oberfläche und öffentliche Dokumentation** analysiert, nicht die Datenbankstruktur.
- [ ] Enthält die Kopie personenbezogene Daten (Kunden, Adressen)? Dann entweder **anonymisierte Kopie** verwenden oder Auftragsverarbeitung/DSGVO klären. Empfehlung: anonymisieren.

## B. Informationen, die FangEvo bereitstellen sollte

| # | Information | Wo zu finden | Benötigt für |
|---|---|---|---|
| 1 | JTL-Wawi-Version (z. B. 1.9.x / 1.10.x) | In JTL-Wawi: *Hilfe → Info* | Einordnung, Doku-Abgleich |
| 2 | Lizenz / Edition und gebuchte Zusatzmodule (WMS, Packtisch+, Workflows, POS …) | JTL-Kundencenter | Funktionsumfang |
| 3 | Liste der aktiven Verkaufskanäle (JTL-Shop, eazyAuction, SCX-Marktplätze, Shopify, WooCommerce …) | JTL-Wawi → Verkaufskanäle | Multichannel-Matrix |
| 4 | Genutzte Versanddienstleister (DHL, DPD, GLS …) | JTL-Shipping | Versandmodul |
| 5 | Anzahl Mandanten, Lager, Benutzer, Arbeitsplätze | Admin-Bereich | Mengengerüst |
| 6 | Mengengerüst: Artikel, Varianten, Aufträge/Monat, Kunden | Auswertungen | Performance-Ziele |
| 7 | Screenshots der Hauptmenüs und der 10 meistgenutzten Masken | Oberfläche | Menüstruktur, UX-Vergleich |
| 8 | Liste genutzter Workflows (Name, Auslöser, Zweck) – ohne Passwörter | *Admin → Workflows* | Automatisierungs-Matrix |
| 9 | Genutzte Ameise-Importvorlagen (Name, Zweck, Beispiel-CSV mit Testdaten) | JTL-Ameise | Import-Modul |
| 10 | Was nervt am meisten? Top-10-Schmerzpunkte der Mitarbeiter | Interviews | Produktdifferenzierung |
| 11 | Afterbuy: im Einsatz? Wenn ja, welche Module und Marktplätze | Afterbuy-Konto | Afterbuy-Matrix |

## C. Technische Vorbereitung für eine Datenbank-Analyse (nur nach Freigabe in A)

JTL-Wawi speichert ihre Daten in **Microsoft SQL Server** (Standarddatenbank meist `eazybusiness`).

1. **Backup erzeugen:** Vollsicherung (`.bak`) über JTL-Wawi bzw. SQL Server Management Studio, von einem Administrator bei FangEvo.
2. **Anonymisieren** (empfohlen) oder Freigabe nach A.3.
3. **Isolierte Analyse-Umgebung:** SQL Server 2022 Developer Edition (kostenlos) in Docker oder auf einer separaten VM, **ohne** Verbindung zum Produktivnetz.
4. **Wiederherstellen** des Backups dort.
5. **Nur-Lese-Benutzer anlegen** (`db_datareader`), keine Schreibrechte.
6. Analyse per Skript: Tabellen-/Spaltenliste, Fremdschlüssel, Zeilenanzahlen. Ergebnis als **fachliche Zusammenfassung** (Welche Geschäftsobjekte gibt es? Welche Beziehungen?), nicht als Kopie des Schemas.
7. Zugangsdaten nur als Umgebungsvariablen (`JTL_DB_HOST`, `JTL_DB_USER`, `JTL_DB_PASSWORD`) auf dem Analyse-Rechner, nie im Repository.

**Hinweis:** In der aktuellen Cloud-Sitzung gibt es weder SQL Server noch einen laufenden Docker-Daemon. Diese Analyse sollte daher **lokal bei FangEvo** oder in einer eigens dafür eingerichteten Umgebung stattfinden. Das Analyseskript kann ich vorbereiten.

## D. Afterbuy-Analyse

Ohne eigenen Zugang erfolgt die Analyse anhand der **öffentlichen Dokumentation** (Hilfe-Center, API-Dokumentation, Preis- und Funktionsseiten). Wenn FangEvo einen Afterbuy-Testzugang hat, kann zusätzlich die Oberfläche anhand von Screenshots untersucht werden.

## E. Ergebnisformat – Funktionsmatrix

Wird in `docs/research/FUNKTIONSMATRIX.md` gepflegt:

| Referenzsystem | Funktion | FangEvo-Modul | Priorität | Umsetzungsstatus |
|---|---|---|---|---|
| JTL | Artikel mit Varianten (Vater/Kind) | Artikel | P0 | ungeprüft |
| JTL | Ameise CSV-Import | Import | P1 | ungeprüft |
| Afterbuy | Marktplatz-Listing eBay | Multichannel | P2 | ungeprüft |

*(Die Zeilen sind Beispiele und noch nicht geprüft.)*

Status-Werte: `ungeprüft` · `geprüft – vorhanden` · `geplant` · `in Arbeit` · `umgesetzt` · `getestet`.
