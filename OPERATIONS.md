# Betriebshandbuch

Wie FangEvo Wawi Pro bereitgestellt, gesichert, aktualisiert und überwacht wird. Stand Phase 8 (2026-11-09).

## Aufbau im Betrieb

| Baustein       | Image / Dienst                                 | Aufgabe                                                                                                   |
| -------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| **web**        | `Dockerfile` Ziel `web` (nginx)                | Oberfläche, leitet `/api` und `/health` an die API weiter (gleiche Adresse → Cookies ohne CORS)           |
| **api**        | Ziel `api` (distroless, ohne Root, ohne Shell) | REST-API. Zustandslos, beliebig viele Instanzen                                                           |
| **worker**     | dasselbe Image, Befehl `dist/worker.js`        | Ereignisse, Webhooks, Regeln, Importe, Abrechnungslauf. Mehrere Instanzen möglich (Sperren in PostgreSQL) |
| **migrate**    | Ziel `migrate`                                 | spielt vor jedem Update die Datenbank-Migrationen ein (einmalig, beendet sich danach)                     |
| **PostgreSQL** | 16 (verwaltet oder Container)                  | alle Daten; Mandantentrennung per Row-Level Security                                                      |
| **Redis**      | 7.4                                            | Rate-Limits und Zwischenspeicher. Kein Datenverlust bei Neustart                                          |
| TLS-Proxy      | vor `web` (Load Balancer, Caddy, Traefik …)    | HTTPS, `Strict-Transport-Security`                                                                        |
| SMTP           | externer Dienst                                | Bestätigungs-, Einladungs-, Rechnungs- und Support-Mails                                                  |

## Datenbank-Rollen

| Rolle            | Rechte                                     | Wofür                                                                      |
| ---------------- | ------------------------------------------ | -------------------------------------------------------------------------- |
| `fangevo_owner`  | Eigentümer der Tabellen, `CREATEDB`        | nur Migrationen                                                            |
| `fangevo_app`    | Lesen/Schreiben, **unterliegt RLS**        | API und Worker                                                             |
| `fangevo_backup` | nur lesen (`pg_read_all_data`), umgeht RLS | nur Sicherungen. Ohne diese Rolle fehlen in Sicherungen die Mandantendaten |
| Administrator    | Superuser des Datenbankservers             | nur Wiederherstellung                                                      |

Für Neuinstallationen legt `infrastructure/production/init-roles.sh` die Rollen mit Passwörtern aus der Umgebung an. Bestehende Server: Die Backup-Rolle einmalig als Administrator anlegen (siehe `infrastructure/docker/postgres-init.sql`).

## Pilotbetrieb auf einem Server (Docker Compose)

```bash
cp infrastructure/production/env.production.example .env.production   # Werte eintragen, Passwörter mit: openssl rand -hex 24
docker compose -f infrastructure/production/docker-compose.yml --env-file .env.production up -d --build --wait
SMOKE_BASE=https://wawi.example.de node tests/smoke/production-smoke.mjs
```

- `APP_ENCRYPTION_KEY` sicher und getrennt von den Sicherungen aufbewahren. Ohne ihn lassen sich verschlüsselte Werte nicht mehr lesen (z. B. Webhook-Schlüssel, MFA-Geheimnisse).
- In Produktion sind Pflicht: `SMTP_HOST`, `APP_ENCRYPTION_KEY`, Rate-Limits aktiv. Für Abo-Rechnungen kommen die `PLATFORM_ISSUER_*`-Angaben hinzu. Fehlen sie, entstehen keine Rechnungen (Fehler `BILLING_NOT_CONFIGURED`).
- Leere Werte in der Konfigurationsdatei gelten als „nicht gesetzt“.
- Der TLS-Proxy muss `X-Forwarded-For` und `X-Forwarded-Proto` setzen. Die API vertraut ihm in Produktion (`trustProxy`).

## Update

1. Sicherung erstellen (siehe unten).
2. `docker compose … up -d --build --wait`. Dabei läuft zuerst `migrate`, danach starten API, Worker und Web neu.
3. Rauchtest ausführen.

Alle Migrationen sind nicht-destruktiv (Projektregel). CI prüft jede Migration auf leerer Datenbank, gleicht das Ergebnis mit dem Schema ab und prüft, dass ein zweites Einspielen nichts ändert (`scripts/db-migration-check.sh`).

## Sicherung

```bash
BACKUP_DATABASE_URL=postgresql://fangevo_backup:…@host:5432/fangevo scripts/db-backup.sh /pfad/zu/backups
```

Im Compose-Betrieb ohne lokale PostgreSQL-Werkzeuge:

```bash
docker run --rm --network fangevo_default -v "$PWD/scripts:/scripts:ro" -v /pfad/zu/backups:/backups \
  -e BACKUP_DATABASE_URL="postgresql://fangevo_backup:${FANGEVO_BACKUP_PASSWORD}@postgres:5432/fangevo" \
  postgres:16.10 bash /scripts/db-backup.sh /backups
```

Ergebnis: `fangevo-<zeit>.dump` (komprimiert), `.sha256` (Prüfsumme) und `.counts` (Zeilen je Tabelle). **Empfehlung:**

- tägliche Sicherung, 30 Tage aufbewahren, verschlüsselt an einem zweiten Standort
- zusätzlich die Point-in-Time-Recovery des Datenbankanbieters (WAL-Archivierung)
- Ziel: höchstens 24 h Datenverlust ohne PITR, wenige Minuten mit PITR. Wiederherstellung in unter 1 h.

## Wiederherstellungs-Probe (monatlich und nach jeder Schemaänderung)

```bash
PG_ADMIN_URL=postgresql://postgres:…@host:5432/postgres scripts/db-restore-check.sh /pfad/zu/backups/fangevo-<zeit>.dump
```

Das Skript spielt die Sicherung in eine **neue, temporäre** Datenbank und prüft:

- Prüfsumme
- fehlerfreie Wiederherstellung
- gleiche Zeilenzahlen je Tabelle
- RLS weiterhin erzwungen
- Migrationen vorhanden

Danach löscht es nur diese temporäre Datenbank. CI macht diese Probe bei jeder Änderung, sowohl mit der Testdatenbank als auch mit dem Produktions-Setup.

## Ernstfall: Wiederherstellen

1. Ursache sichern (Logs), Schreibzugriffe stoppen (`docker compose stop api worker`).
2. Sicherung mit `db-restore-check.sh` und `KEEP=1` in eine neue Datenbank spielen und prüfen.
3. Die Anwendung auf die neue Datenbank umstellen: Datenbankname in den Verbindungs-URLs ändern, dann `up -d`. Die alte Datenbank bleibt zur Analyse erhalten. Gelöscht wird nichts ohne ausdrückliche Freigabe.
4. Rauchtest, Kunden informieren, Vorfall dokumentieren.

## Überwachung

| Was                  | Wie                                                                      | Alarm, wenn                   |
| -------------------- | ------------------------------------------------------------------------ | ----------------------------- |
| Erreichbarkeit       | `GET /health` (prüft Datenbank und Redis), Container-Healthcheck der API | nicht 200 für 2 min           |
| Fehler               | strukturierte JSON-Logs (pino) von API und Worker, Feld `level` ≥ 50     | Häufung von Fehlern           |
| Worker hängt         | Lebenszeichen-Datei (alle 30 s), Container-Healthcheck des Workers       | „unhealthy“                   |
| Unerwartete Abstürze | „Unbehandelte Ausnahme“ im Log, Container-Neustarts                      | jeder Neustart                |
| Hintergrundaufgaben  | Tabellen `job_queue` / `outbox_pending` (Anzahl offener Einträge)        | wachsender Rückstand > 15 min |
| Abrechnung           | Log `Abrechnungslauf`, Plattform-Verwaltung                              | Fehler im Abrechnungslauf     |
| Datenbank            | Verbindungen, Speicher, langsame Abfragen (Anbieter-Monitoring)          | > 80 % Auslastung             |

## Leistung (Lasttest)

`pnpm --filter @fangevo/api perf:http` erzeugt gemischte Last aus mehreren Accounts über echtes HTTP. Er prüft dabei auch die Mandantentrennung. Ergebnisse siehe [TESTING.md](TESTING.md).

- Ein API-Prozess schafft rund 200 Anfragen/s bei p95 unter 250 ms.
- Bei mehr Last weitere API-Instanzen starten. Die API hält keinen Zustand im Prozess.
- Datenbank-Verbindungen: je Prozess Prisma-Standard (CPU-Kerne × 2 + 1). Bei vielen Instanzen einen Verbindungs-Pool (PgBouncer, Transaktionsmodus) vorschalten.

## Sicherheitsroutine

- CI prüft Abhängigkeiten auf bekannte Lücken (`pnpm audit --prod --audit-level high`). Mittlere Funde werden in [SECURITY.md](SECURITY.md) bewertet.
- Updates von Abhängigkeiten nur in gepinnten, mindestens 2 Wochen alten Versionen (ADR-005).
- Zugänge zur Plattform-Verwaltung (`PLATFORM_ADMIN_EMAILS`) regelmäßig prüfen; Zwei-Faktor ist Pflicht.
