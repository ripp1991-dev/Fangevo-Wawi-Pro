# CLAUDE.md – Arbeitsregeln für dieses Repository

Projekt: **FangEvo Wawi Pro**, eine modulare, mandantenfähige SaaS-Warenwirtschaft.
Verbindliche Grundlage: `docs/product/MASTER_PLAYBOOK_v1.0.md`. Aktueller Plan: `DEVELOPMENT_ROADMAP.md`. Technikentscheidungen: `docs/decisions/`.

## Aktueller Stand

Phase 0–5 sind abgeschlossen (bis Import, öffentliche API und Verkaufskanäle). FangEvo hat beauftragt, alle Phasen nacheinander selbstständig umzusetzen; als Nächstes Phase 6 (Automatisierung). Status in `DEVELOPMENT_ROADMAP.md`. Entscheidungen: `DECISIONS.md` (Frontend mit Vite ist bestätigt, ADR-003).

Wichtige Einstiegspunkte: zentrale Zugriffskontrolle `apps/api/src/core/access/access.guard.ts`, Mandantenzugriff nur über `Database.tenant()` (`apps/api/src/core/database/database.service.ts`), Rechtekatalog `packages/shared/src/permissions.ts`, Modul-/Lizenzkatalog `packages/licensing/src/catalog.ts`.

Werkzeuge für neue Fachmodule: Listen über `buildListArgs` (`core/lists`), eigene Felder über `CustomFieldsService.validate`, Suchindex über `SearchService.upsert`, Ereignisse entstehen automatisch über `AuditService.record` (Outbox), Menüeinträge in `apps/web/src/lib/navigation.ts`, Tabellen mit `DataTable`, Widgets in `packages/shared/src/widgets.ts`.

Fachmodule liegen unter `apps/api/src/modules/*`. Firmenbezogene Daten nur über `CompanyDb.run()` (setzt Account **und** Firma für RLS). Bestände nur über `InventoryService.apply()` (Journal). Geldbeträge als Decimal/Text. Summen und Steuern mit `modules/common/totals.ts`. Belege nur über `DocumentsService` (Festschreiben, PDF, GoBD-Trigger, ADR-008); Aufträge reservieren Bestand in `stock_reservations`. Bestand ist je Lagerplatz, Charge und Seriennummer geführt; Versand über `OrdersService.shipInTx()` (ADR-009). Hintergrundaufgaben über `JobQueue` (`core/jobs`), Importe nur über die Fach-Services (ADR-010).

Tests brauchen PostgreSQL + Redis (siehe `TESTING.md`). Niemals `prisma migrate reset` oder andere destruktive Befehle ohne ausdrückliche Freigabe ausführen.

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
