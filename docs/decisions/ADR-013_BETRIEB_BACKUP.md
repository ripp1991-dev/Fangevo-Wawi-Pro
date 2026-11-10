# ADR-013 – Betrieb: Container-Images, Sicherung mit eigener Rolle, automatische Proben

**Stand:** 2026-11-09 · **Status:** angenommen

## Kontext

Phase 8 verlangt Sicherheits-, Last-, Migrations- und Wiederherstellungstests sowie die Vorbereitung des Pilotbetriebs. Ein Test zeigte: `pg_dump` mit der Eigentümer-Rolle bricht ab, weil Row-Level Security auch für den Eigentümer erzwungen ist (ADR-004). Das ist gewollt, macht aber eine eigene Sicherungsrolle nötig.

## Entscheidung

1. **Sicherungsrolle `fangevo_backup`:** `pg_read_all_data` + `BYPASSRLS`, kein Schreibrecht. Sie wird nur für Sicherungen genutzt. Wiederherstellungen laufen mit der Administrator-Rolle des Datenbankservers (in Tabellen mit erzwungener RLS kann nur sie schreiben). Die Eigentümer bleiben erhalten.
2. **Skripte:**
   - `scripts/db-backup.sh`: Dump im custom-Format, Prüfsumme, Zeilenzahlen.
   - `scripts/db-restore-check.sh`: Wiederherstellung **nur in eine neue, temporäre Datenbank**, Abgleich von Prüfsumme, Zeilen, RLS und Migrationen, danach Entfernen nur dieser Datenbank.
   - `scripts/db-migration-check.sh`: alle Migrationen auf leerer Datenbank, Abgleich mit dem Prisma-Schema, Idempotenz.
   - Keines der Skripte überschreibt oder löscht bestehende Datenbanken.
3. **Container-Images** aus einem `Dockerfile`:
   - `api`: distroless Node 22, ohne Root und ohne Shell, per Digest gepinnt. Dasselbe Image dient mit `dist/worker.js` als Worker.
   - `web`: nginx mit strenger CSP ohne Inline-Skripte; das Farbschema-Skript liegt deshalb in `theme-init.js`.
   - `migrate`: einmalige Migrationen.
   - Prisma erzeugt zusätzlich die Engine `debian-openssl-3.0.x` für das Produktions-Image.
4. **Pilot-Setup** `infrastructure/production/docker-compose.yml`: Rollen und Passwörter nur aus der Umgebung (`init-roles.sh`); nginx löst die API-Adresse neu auf (kein 502 nach API-Neustart).
5. **CI** prüft bei jeder Änderung zusätzlich:
   - Migrations-Probe
   - Sicherung und Wiederherstellung der Testdatenbank
   - Bau aller Images, Start des kompletten Produktions-Setups, Browser-Rauchtest (inkl. CSP-Fehler)
   - Sicherung und Wiederherstellung im Container
6. **Generische Sicherheitstests** (`phase8-security.test.ts`):
   - jede Tabelle mit `account_id` hat erzwungene RLS
   - firmenbezogene Tabellen prüfen die Firma
   - jeder Endpunkt der OpenAPI-Beschreibung wird ohne Anmeldung abgewiesen
   - kein Endpunkt erzeugt mit leeren Eingaben einen Serverfehler
   - Sicherheits-Header, Cookie-Flags, CSRF
   - Neue Tabellen und Endpunkte werden automatisch mitgeprüft.

## Konsequenzen

- (+) Sicherungen enthalten nachweislich alle Mandanten; Wiederherstellung ist geübt und automatisiert geprüft.
- (+) Fehler beim Betrieb (Konfiguration, Proxy, Logs) fallen vor dem Pilot auf. Drei solche Fehler wurden in Phase 8 gefunden und behoben: leere Konfigurationswerte, verlorene Worker-Logs, 502 nach API-Neustart.
- (−) Die Sicherungsrolle umgeht RLS. Ihre Zugangsdaten gehören nur in den Backup-Job.
- (−) Das Migrations-Image ist groß (enthält die Build-Werkzeuge); es läuft nur kurz bei Updates.
