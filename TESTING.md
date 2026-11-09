# Tests

## Übersicht (Stand Phase 1)

| Ebene                              | Werkzeug                | Ort                                                                                  | Anzahl   |
| ---------------------------------- | ----------------------- | ------------------------------------------------------------------------------------ | -------- |
| Unit                               | Vitest                  | `packages/*/src/*.test.ts`, `apps/api/src/**/*.test.ts`, `apps/web/src/**/*.test.ts` | 25       |
| Integration (API + echte DB/Redis) | Vitest + Fastify-Inject | `apps/api/test/auth.test.ts`, `admin.test.ts`                                        | 34       |
| **Mandantentrennung (Pflicht)**    | Vitest                  | `apps/api/test/tenant-isolation.test.ts`                                             | 12       |
| End-to-End im Browser              | Playwright              | `tests/e2e/core-flow.mjs`                                                            | 1 Ablauf |

Insgesamt 73 automatisierte Tests + E2E-Ablauf. Kein Merge ohne grüne CI ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)).

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

Der Ablauf: Registrieren (inkl. Validierungsfehler) → E-Mail bestätigen → Anmelden → Firma anlegen → Mitarbeiter einladen → Rollen, Audit-Log, Lizenz, MFA-Einrichtung ansehen → Einladung auf dem Handy annehmen → Rechte prüfen → Dunkelmodus. Screenshots landen in `tests/e2e/screenshots/`. Hinweis: Wiederholte Läufe können das Registrierungs-Limit (10 pro Stunde und IP) erreichen.

## Was die Mandanten-Testsuite prüft

- API: fremde Firmen, Mitglieder, Rollen, Einladungen nicht les- oder änderbar; fremde Firma nicht als Kontext setzbar; kein Wechsel in fremde Accounts; fremde Rollen/Firmen nicht in Einladungen einschleusbar.
- Datenbank: ohne Kontext keine Zeilen; mit Kontext nur eigene; Schreiben in fremden Mandanten von RLS abgelehnt; Kontext endet mit der Transaktion; manipulierter Kontext abgelehnt; Audit-Log unveränderlich; Laufzeit-Rolle ohne `BYPASSRLS`.

**Regel:** Jede neue mandantenbezogene Tabelle bzw. Ressource bekommt Tests in dieser Suite.

## Grenzen

- Die E2E-Stufe in der CI ist eingerichtet, lief aber bis zu diesem Stand nur lokal, noch nicht auf GitHub.
- Last- und Performance-Tests (k6) folgen ab Phase 3.
