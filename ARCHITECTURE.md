# Architektur

Stand: Phase 1 · Grundlage: [ADR-001](docs/decisions/ADR-001_TECHNOLOGIE_EMPFEHLUNG.md)

## Überblick

**Modularer Monolith** in einem TypeScript-Monorepo (pnpm Workspaces + Turborepo).

```
Browser ──► apps/web (React SPA) ──/api/v1──► apps/api (NestJS + Fastify) ──► PostgreSQL (RLS)
                                                        │                └──► Redis (Rate-Limits, später Queues)
                                                        └──► SMTP (E-Mails)
```

- **Frontend** spricht ausschließlich über die REST-API. Es darf weder `@fangevo/database` noch API-Interna importieren (per ESLint erzwungen).
- **Gemeinsame Pakete** (`shared`, `licensing`) enthalten Regeln, die Frontend und Backend identisch brauchen (Rechte, Validierung, Lizenzlogik). Die verbindliche Prüfung findet immer serverseitig statt.
- **Datenzugriff** nur über `packages/database` bzw. `apps/api/src/core/database` (ESLint verbietet direkte Prisma-Imports anderswo).

## Ablauf einer Anfrage (API)

1. **Fastify-Hooks:** Sicherheits-Header (Helmet), globales Rate-Limit, CSRF-Prüfung (Header `x-fangevo-csrf` bei schreibenden Anfragen), CORS nur für `WEB_ORIGIN`.
2. **RateLimitGuard:** strengere Limits je Route (z. B. Login: 10 Versuche / 15 min je E-Mail).
3. **AccessGuard** (zentral, für jede Route):
   1. Sitzung aus HttpOnly-Cookie prüfen (Ablauf, Inaktivität, Widerruf)
   2. Zwei-Faktor-Status prüfen
   3. Account-Kontext laden: Mitgliedschaft, effektive Rechte, Lizenz, zugängliche Firmen
   4. Lizenz: Nur-Lese-Modus bei gesperrtem Account, Modul muss gebucht sein
   5. Rechte prüfen (`@RequirePermission`)
   6. Firmenkontext aus `X-Company-Id` gegen Firmenrechte prüfen
4. **Controller → Service:** Validierung per Zod (`ZodPipe`), Geschäftslogik im Service.
5. **Datenbank:** jeder Mandantenzugriff läuft über `Database.tenant(ctx, fn)`. Das setzt den RLS-Kontext für genau diese Transaktion. Audit-Einträge entstehen in derselben Transaktion.
6. **Fehler:** `ProblemFilter` liefert RFC-9457-Problem-Details mit stabilem `code`.

Decorators (siehe `core/http/context.ts`): `@Public`, `@NoAccount`, `@AllowMfaPending`, `@AllowReadOnly`, `@RequirePermission`, `@RequiresModule`, `@RequiresCompany`, `@RateLimit`.

## Mandanten-Hierarchie

```
Account (zahlender Kunde, Mandant)
 ├── Companies (Firmen; 3 inklusive)
 ├── Memberships (Benutzer ↔ Account) ── Rollen, Einzelrechte, Firmenzugriff
 ├── Roles ── Rechte
 ├── Entitlement (Lizenz-Kern)
 └── AuditLog
User (global; kann Mitglied in mehreren Accounts sein)
```

Ab Phase 3 tragen fachliche Tabellen zusätzlich `company_id`. Der Firmenkontext kommt aus dem bereits geprüften Header `X-Company-Id`.

## Modulgrenzen

- Core-Module liegen unter `apps/api/src/core/*` (je Ordner: Service + Controller).
- Fachmodule entstehen ab Phase 3 als eigene Nest-Module unter `modules/*`. Sie dürfen nur über öffentliche Services anderer Module zugreifen, nie auf fremde Tabellen.
- Lizenzpflichtige Module markieren ihre Controller mit `@RequiresModule('<modul>')`. Rechte werden im zentralen Katalog `packages/shared/src/permissions.ts` registriert.

## Frontend

- Vite + React 19, TanStack Router (codebasierte Routen) und TanStack Query (Server-Zustand).
- Routen-Schutz: `beforeLoad` prüft die Sitzung; Seiten ohne Recht zeigen „Keine Berechtigung“ (nur Komfort, die API prüft selbst).
- Designsystem: `packages/ui` (Buttons, Formulare, Karten, Tabellen, Dialoge) mit semantischen Farb-Tokens für Hell- und Dunkelmodus (`apps/web/src/styles.css`).
- Aktive Firma wird pro Account im Browser gemerkt und bei jeder Anfrage als `X-Company-Id` mitgesendet.

## Noch nicht umgesetzt (bewusst später)

Hintergrundjobs (BullMQ, ab Phase 3/5), Dateispeicher (S3, ab Phase 3), Outbox-/Domain-Events (Phase 2/6), Caching des Zugriffskontexts (bei Bedarf nach Lasttests), lokaler Hardware-Connector (Phase 4).
