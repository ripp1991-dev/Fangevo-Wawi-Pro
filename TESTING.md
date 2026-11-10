# Tests

## Übersicht (Stand Phase 6)

| Ebene                                       | Werkzeug                | Ort                                                                                                                                                         | Anzahl    |
| ------------------------------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| Unit                                        | Vitest                  | `packages/*/src/**/*.test.ts`, `apps/api/src/**/*.test.ts`, `apps/web/src/**/*.test.ts`                                                                     | 46        |
| Integration (API + echte DB/Redis)          | Vitest + Fastify-Inject | `apps/api/test/auth.test.ts`, `admin.test.ts`, `phase2.test.ts`, `phase3a.test.ts`, `phase3b.test.ts`, `phase4.test.ts`, `phase5.test.ts`, `phase6.test.ts` | 101       |
| **Mandanten- und Firmentrennung (Pflicht)** | Vitest                  | `apps/api/test/tenant-isolation.test.ts` + Abschnitte „Trennung“ in `phase3a.test.ts`, `phase3b.test.ts`, `phase4.test.ts`                                  | 14 + 4    |
| End-to-End im Browser                       | Playwright              | `tests/e2e/core-flow.mjs`, `phase2-flow.mjs`, `phase3a-flow.mjs`, `phase3b-flow.mjs`, `phase4-flow.mjs`, `phase5-flow.mjs`, `phase6-flow.mjs`               | 7 Abläufe |
| Last                                        | eigenes Skript          | `apps/api/scripts/perf-lists.ts`, `perf-wawi.ts`                                                                                                            | manuell   |

Insgesamt 161 automatisierte Tests + 7 E2E-Abläufe. `phase4-flow.mjs` bis `phase6-flow.mjs` setzen das Testkonto mit dem Plattform-Werkzeug `license:set` auf Paket Business bzw. Professional (braucht `DATABASE_URL`). Kein Merge ohne grüne CI ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)).

## Ausführen

Voraussetzung: PostgreSQL mit den Rollen aus `infrastructure/docker/postgres-init.sql` (inkl. Datenbank `fangevo_test`) und Redis.

```bash
pnpm db:generate
pnpm test
```

Die Tests spielen vorher alle Migrationen in `fangevo_test` ein (nicht-destruktiv) und verwenden eindeutige Testdaten. Die Datenbank muss daher nicht geleert werden. Es werden **keine** produktiven Daten verwendet. Andere Verbindungen über `TEST_DATABASE_URL`, `TEST_DATABASE_MIGRATE_URL`, `TEST_REDIS_URL`.

### End-to-End

```bash
# Terminal 1: API mit Mail-Ausgabe ins Log
cd apps/api && MAIL_TRANSPORT=log npx dotenv -e ../../.env -- tsx src/main.ts > /tmp/fangevo-api.log 2>&1
# Terminal 2
cd apps/web && npx vite
# Terminal 3 (einmalig: pnpm exec playwright install chromium)
E2E_API_LOG=/tmp/fangevo-api.log pnpm test:e2e
```

Für den Phase-7-Ablauf muss die API mit `PLATFORM_ADMIN_EMAILS=@platform.example.test` laufen (der Test legt einen FangEvo-Mitarbeiter mit Zwei-Faktor an). Ohne vorinstallierte Playwright-Browser kann mit `E2E_CHROMIUM_PATH` ein vorhandenes Chromium genutzt werden.

Der Ablauf: Registrieren (inkl. Validierungsfehler) → E-Mail bestätigen → Anmelden → Firma anlegen → Mitarbeiter einladen → Rollen, Audit-Log, Lizenz, MFA-Einrichtung ansehen → Einladung auf dem Handy annehmen → Rechte prüfen → Dunkelmodus. Screenshots landen in `tests/e2e/screenshots/`. Hinweis: Wiederholte Läufe können das Registrierungs-Limit (10 pro Stunde und IP) erreichen.

## Was die Mandanten-Testsuite prüft

- API: fremde Firmen, Mitglieder, Rollen, Einladungen nicht les- oder änderbar; fremde Firma nicht als Kontext setzbar; kein Wechsel in fremde Accounts; fremde Rollen/Firmen nicht in Einladungen einschleusbar.
- Datenbank: ohne Kontext keine Zeilen; mit Kontext nur eigene; Schreiben in fremden Mandanten von RLS abgelehnt; Kontext endet mit der Transaktion; manipulierter Kontext abgelehnt; Audit-Log unveränderlich; Laufzeit-Rolle ohne `BYPASSRLS`.

**Regel:** Jede neue mandantenbezogene Tabelle bzw. Ressource bekommt Tests in dieser Suite.

## Lasttest Listen (Stand 2026-11-09, Cloud-Container, 4 CPU)

100.000 Firmen in einem Account, gemessen über die echte API inkl. Anmeldung, Rechteprüfung und RLS (Median aus 5 Läufen):

| Abfrage                         | Median |
| ------------------------------- | ------ |
| Erste Seite, sortiert nach Name | 73 ms  |
| Seite 1000                      | 107 ms |
| Sortiert nach Ort               | 66 ms  |
| Textsuche                       | 183 ms |
| Filter Land                     | 87 ms  |
| Filter eigenes Feld             | 120 ms |
| 1000 Zeilen (Export-Seite)      | 99 ms  |

Ausführen: `pnpm --filter @fangevo/api perf:lists` (nur gegen `*_test`-Datenbanken).

## Lasttest Warenwirtschaft (Stand 2026-11-09, Cloud-Container, 4 CPU)

`pnpm --filter @fangevo/api perf:wawi` legt in der Testdatenbank eine Firma mit 100.000 Artikeln (mit Bestand), 20.000 Kunden und 50.000 Aufträgen mit je 3 Positionen an und misst über die echte API (RLS, Rechte, Lizenz, JSON). Mediane aus 5 Läufen:

| Vorgang                                    |                                     Median |
| ------------------------------------------ | -----------------------------------------: |
| Artikel: erste Seite                       |                                      85 ms |
| Artikel: Suche „Wobbler Modell 4711“       |                                     237 ms |
| Artikel: Seite 1000 nach Name              |                                     174 ms |
| Kunden: Suche                              |                                      97 ms |
| Aufträge: erste Seite / Status-Filter      |                                 67 / 26 ms |
| Aufträge: Suche Nummer                     |                                      94 ms |
| Kennzahlen Aufträge (offen, Topseller)     |                                     200 ms |
| Kennzahlen Umsatz                          |                                      18 ms |
| Unter Mindestbestand                       |                                     135 ms |
| Bestellvorschläge                          | 277 ms (vorher 1.315 ms, Abfrage umgebaut) |
| Auftrag anlegen inkl. Reservierung         |                                      77 ms |
| Versand (Bestand abbuchen)                 |                                      49 ms |
| Rechnung erstellen / festschreiben mit PDF |                                 30 / 53 ms |

## Grenzen

- Last- und Performance-Tests (k6) folgen ab Phase 3.

## Phase 7 (Stand 2026-11-09)

`test/phase7.test.ts` prüft: Aktivierung mit Rechnung (Beträge, PDF, E-Mail, Unveränderlichkeit), Hochstufen mit anteiliger Rechnung, Herabstufen und Verlängerung im Abrechnungslauf (ohne doppelte Rechnung), Zusatzmodul-Test und Umstellung, Kündigung und Lesemodus, Zahlungsverzug (30 Tage), Rechte und Account-Trennung, Support mit Antwort und Benachrichtigung, Plattform-Zugang nur mit Freigabe und 2FA, Lizenzänderung und Sperre, Zahlung markieren. Preis- und Lizenzregeln: `packages/licensing/src/billing.test.ts`. Zeitabhängige Abläufe werden mit `BillingService.processAccount(accountId, zeitpunkt)` simuliert.

## Phase 8: Produktionsreife (Stand 2026-11-09)

| Prüfung                               | Befehl                                                                   | Wo                            |
| ------------------------------------- | ------------------------------------------------------------------------ | ----------------------------- |
| Sicherheit/Robustheit aller Endpunkte | `pnpm test` (`phase8-security.test.ts`)                                  | lokal, CI                     |
| Migrationen auf leerer Datenbank      | `MIGRATE_ADMIN_URL=… scripts/db-migration-check.sh`                      | lokal, CI                     |
| Sicherung + Wiederherstellung         | `scripts/db-backup.sh`, `scripts/db-restore-check.sh`                    | lokal, CI (2×)                |
| Produktions-Images + Rauchtest        | `docker compose … up --build --wait`, `tests/smoke/production-smoke.mjs` | CI (Job „Produktions-Images“) |
| Lasttest HTTP                         | `pnpm --filter @fangevo/api perf:http`                                   | lokal (Testdatenbank)         |

**Lasttest HTTP** (Cloud-Container, 4 CPU, ein API-Prozess, Lastgenerator im selben Prozess, 8 Accounts mit Artikeln, Kunden und Aufträgen; Mischung aus Listen, Details, Suche, Benachrichtigungen, 8 % neue Aufträge, 2 % Fremdzugriffe):

| Benutzer gleichzeitig | Anfragen/s | p50 Lesen | p95 Lesen | p95 Auftrag anlegen | Fehler | Fremdzugriffe korrekt abgewiesen |
| --------------------- | ---------- | --------- | --------- | ------------------- | ------ | -------------------------------- |
| 1                     | 52         | 17 ms     | 25 ms     | 49 ms               | 0      | 8 / 8                            |
| 40                    | 196        | 200 ms    | 246 ms    | 304 ms              | 0      | 61 / 61                          |

Bei 40 gleichzeitigen Benutzern ist der eine Prozess ausgelastet. Die Antwortzeit besteht dann überwiegend aus Wartezeit, nicht aus Rechenzeit. Für mehr Last werden weitere API-Instanzen gestartet; die API ist zustandslos.

**Rauchtest** gegen eine Installation:

```bash
SMOKE_BASE=https://wawi.example.de node tests/smoke/production-smoke.mjs
```

Ohne `SMOKE_MAILPIT` werden keine Daten angelegt.
