# CLAUDE.md – Arbeitsregeln für dieses Repository

Projekt: **FangEvo Wawi Pro**, eine modulare, mandantenfähige SaaS-Warenwirtschaft.
Verbindliche Grundlage: `docs/product/MASTER_PLAYBOOK_v1.0.md`. Aktueller Plan: `DEVELOPMENT_ROADMAP.md`. Technikentscheidungen: `docs/decisions/`.

## Aktueller Stand
Phase 0 (Bestandsaufnahme) ist abgeschlossen. **Phase 1 startet erst nach Freigabe durch den Product Owner.** Architekturentscheidungen in ADR-001 sind ein Vorschlag, bis sie als „angenommen“ markiert sind.

## Verbindliche Regeln (Playbook Abschnitt 25)
- Nie die ganze Software in einem Schritt bauen. Immer in klar abgegrenzten Modulen bzw. Arbeitspaketen arbeiten.
- Vor jeder Änderung die bestehende Struktur prüfen; vor größeren Änderungen einen Umsetzungsplan vorlegen.
- Funktionierende Module nicht unnötig ändern.
- TypeScript mit `strict`. Zentrale Geschäftslogik nur in gemeinsamen Services, keine Zugriffe auf Tabellen fremder Module.
- **Mandantentrennung bei jeder Datenabfrage** (`account_id`/`company_id` + RLS). Lizenz- und Rechteprüfungen nur serverseitig.
- Jede relevante Funktion braucht Tests; Mandanten-Trenntests sind Pflicht.
- Keine Zugangsdaten im Code, keine produktiven Kundendaten in Tests.
- Migrationen nachvollziehbar; **keine destruktiven Datenbankänderungen ohne ausdrückliche Freigabe**.
- Keine erfundenen APIs, keine vorgetäuschten Integrationen, keine Dummy-Funktionen als „fertig“ melden.
- Keine Übernahme von Code, Datenbankstrukturen oder vertraulichen Details von JTL, Afterbuy oder anderen Herstellern.
- Geldbeträge nie als Float. Bestände nur über das Bestandsjournal ändern.

## Nach jedem Arbeitsschritt
Tests ausführen → Fehler beheben → Doku aktualisieren (README, ARCHITECTURE, DATABASE, API, SECURITY, LICENSING, MODULES, TESTING, CHANGELOG, DECISIONS) → Status in `DEVELOPMENT_ROADMAP.md` festhalten.

## Definition „fertig“
Oberfläche funktioniert, Daten korrekt gespeichert, Rechte und Mandantentrennung geprüft, Fehler behandelt, Tests vorhanden, Doku aktualisiert, Integration mit anderen Modulen funktioniert. Eine optisch fertige Oberfläche ist keine fertige Funktion.

## Sprache
Dokumentation und Kommunikation mit dem Product Owner auf Deutsch, einfach und verständlich. Code, Bezeichner und Commit-Nachrichten auf Englisch.
