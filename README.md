# FangEvo Wawi Pro

Modulare, mandantenfähige SaaS-Warenwirtschaft (ERP / E-Commerce) für kleine, mittlere und große Handelsunternehmen.

> **Status:** Phase 1 (Fundament), Phase 2 (Dashboard und Werkzeuge) und Phase 3 (Warenwirtschaft: Artikel, Kunden, Lieferanten, Lager, Aufträge, Belege mit PDF, Einkauf) Phase 4 (Logistik: Picklisten, Packtisch, Versand, Retouren, mobiler Scanner) Phase 5 (Import/Export, öffentliche API, Verkaufskanäle) Phase 6 (Automatisierung: Webhooks, Regeln) Phase 7 (Kommerzialisierung: Abo, Rechnungen, Marketplace, Support, Plattform-Verwaltung) und Phase 8 (Produktionsreife: Sicherheits-, Last-, Migrations- und Wiederherstellungstests, Container-Images, Betriebshandbuch) sind umgesetzt. Nächster Schritt: Pilotkunden ([PILOT.md](PILOT.md)). Details: [Entwicklungsplan](DEVELOPMENT_ROADMAP.md).

## Schnellstart (lokale Entwicklung)

Voraussetzungen: Node.js 22, pnpm 10 (`corepack enable`), Docker (für PostgreSQL, Redis, Mailpit).

```bash
cp .env.example .env            # Werte prüfen, APP_ENCRYPTION_KEY erzeugen (siehe Kommentar)
docker compose -f infrastructure/docker/docker-compose.yml up -d
pnpm install
pnpm db:generate
pnpm db:migrate
pnpm dev                        # API auf :3000 (inkl. Ereignis-Verteiler), Web auf :5173
```

- Web-App: http://localhost:5173 (Registrieren → Bestätigungs-Mail in Mailpit unter http://localhost:8025)
- API-Doku (Swagger): http://localhost:3000/api/docs, OpenAPI: [docs/api/openapi.json](docs/api/openapi.json)
- Lizenz eines Accounts ändern (Plattform-Werkzeug): `pnpm --filter @fangevo/database license:set -- --account <id> --plan business`

## Testumgebung

Produktionsnahe Testumgebung mit realistischen Testdaten und Testablauf für das Team: [docs/TESTUMGEBUNG.md](docs/TESTUMGEBUNG.md).

## Betrieb (Produktion)

Ausführlich im [Betriebshandbuch](OPERATIONS.md) (Container-Images, Docker Compose für den Pilot, Sicherung, Wiederherstellung, Überwachung).

Zwei Prozesse aus demselben Build: `node apps/api/dist/main.js` (API) und `node apps/api/dist/worker.js` (Ereignis-Verteiler, beliebig viele Instanzen). Pflicht in Produktion: `SMTP_HOST`, `APP_ENCRYPTION_KEY`, getrennte Datenbankrollen (siehe [DATABASE.md](DATABASE.md)). Für Abo-Rechnungen zusätzlich die Absenderdaten `PLATFORM_ISSUER_*`, für Support und Plattform-Verwaltung `SUPPORT_EMAIL` und `PLATFORM_ADMIN_EMAILS` (siehe `.env.example`).

## Wichtige Befehle

| Befehl                                                 | Zweck                                                                                   |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| `pnpm lint` / `pnpm format:check`                      | Code-Stil und Modulgrenzen                                                              |
| `pnpm typecheck`                                       | Strenge Typprüfung aller Pakete                                                         |
| `pnpm test`                                            | Unit- und Integrationstests (brauchen PostgreSQL + Redis, Testdatenbank `fangevo_test`) |
| `pnpm test:e2e`                                        | Browser-Test des Kernprozesses (siehe [TESTING.md](TESTING.md))                         |
| `pnpm build`                                           | Produktions-Build von API und Web                                                       |
| `pnpm --filter @fangevo/api perf:lists`                | Lasttest der Listen mit 100.000 Datensätzen (Testdatenbank)                             |
| `pnpm --filter @fangevo/api perf:wawi`                 | Lasttest Warenwirtschaft (100.000 Artikel, 50.000 Aufträge; Testdatenbank)              |
| `pnpm --filter @fangevo/api perf:http`                 | Lasttest über HTTP mit mehreren Accounts (Testdatenbank)                                |
| `scripts/db-backup.sh` / `scripts/db-restore-check.sh` | Sicherung / Wiederherstellungs-Probe (siehe OPERATIONS.md)                              |

## Aufbau

```
apps/api        NestJS-API (Fastify), REST /api/v1
apps/web        React-App (Vite, TanStack Router/Query, Tailwind)
packages/shared       Rechtekatalog, Validierungsschemas, Fehlercodes (Frontend + Backend)
packages/licensing    Modul- und Paketkatalog, Lizenzregeln
packages/database     Prisma-Schema, Migrationen (inkl. Row-Level Security), Mandanten-Helfer
packages/ui           Designsystem-Komponenten
modules/        Fachmodule ab Phase 3
infrastructure/ Docker Compose für die Entwicklung
docs/           Produkt, Architekturentscheidungen, Recherche, API
tests/e2e       Browser-Tests
```

## Dokumentation

| Dokument                                                     | Inhalt                                        |
| ------------------------------------------------------------ | --------------------------------------------- |
| [Master Playbook v1.0](docs/product/MASTER_PLAYBOOK_v1.0.md) | Produktvision, Anforderungen, Regeln          |
| [DEVELOPMENT_ROADMAP.md](DEVELOPMENT_ROADMAP.md)             | Plan, Status der Arbeitspakete, offene Fragen |
| [ARCHITECTURE.md](ARCHITECTURE.md)                           | Aufbau, Anfrageablauf, Modulgrenzen           |
| [DATABASE.md](DATABASE.md)                                   | Datenmodell, Mandantentrennung, Migrationen   |
| [API.md](API.md)                                             | Konventionen, Endpunkte, Fehlercodes          |
| [SECURITY.md](SECURITY.md)                                   | Sicherheitsmaßnahmen und offene Punkte        |
| [LICENSING.md](LICENSING.md)                                 | Lizenz-Kern, Pakete, Limits                   |
| [MODULES.md](MODULES.md)                                     | Modulübersicht und Status                     |
| [TESTING.md](TESTING.md)                                     | Teststrategie und Ausführung                  |
| [DECISIONS.md](DECISIONS.md)                                 | Architekturentscheidungen (ADR)               |
| [CHANGELOG.md](CHANGELOG.md)                                 | Änderungen                                    |
| [CLAUDE.md](CLAUDE.md)                                       | Arbeitsregeln für Claude Code                 |
