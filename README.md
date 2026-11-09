# FangEvo Wawi Pro

Modulare, mandantenfähige SaaS-Warenwirtschaft (ERP / E-Commerce) für kleine, mittlere und große Handelsunternehmen.

> **Status:** Phase 1 (Fundament), Phase 2 (Dashboard und Werkzeuge) und Phase 3 (Warenwirtschaft: Artikel, Kunden, Lieferanten, Lager, Aufträge, Belege mit PDF, Einkauf) sind umgesetzt. Details: [Entwicklungsplan](DEVELOPMENT_ROADMAP.md).

## Schnellstart (lokale Entwicklung)

Voraussetzungen: Node.js 22, pnpm 10 (`corepack enable`), Docker (für PostgreSQL, Redis, MinIO, Mailpit).

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

## Betrieb (Produktion)

Zwei Prozesse aus demselben Build: `node apps/api/dist/main.js` (API) und `node apps/api/dist/worker.js` (Ereignis-Verteiler, beliebig viele Instanzen). Pflicht in Produktion: `SMTP_HOST`, `APP_ENCRYPTION_KEY`, getrennte Datenbankrollen (siehe [DATABASE.md](DATABASE.md)).

## Wichtige Befehle

| Befehl                                  | Zweck                                                                                   |
| --------------------------------------- | --------------------------------------------------------------------------------------- |
| `pnpm lint` / `pnpm format:check`       | Code-Stil und Modulgrenzen                                                              |
| `pnpm typecheck`                        | Strenge Typprüfung aller Pakete                                                         |
| `pnpm test`                             | Unit- und Integrationstests (brauchen PostgreSQL + Redis, Testdatenbank `fangevo_test`) |
| `pnpm test:e2e`                         | Browser-Test des Kernprozesses (siehe [TESTING.md](TESTING.md))                         |
| `pnpm build`                            | Produktions-Build von API und Web                                                       |
| `pnpm --filter @fangevo/api perf:lists` | Lasttest der Listen mit 100.000 Datensätzen (Testdatenbank)                             |
| `pnpm --filter @fangevo/api perf:wawi`  | Lasttest Warenwirtschaft (100.000 Artikel, 50.000 Aufträge; Testdatenbank)              |

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
