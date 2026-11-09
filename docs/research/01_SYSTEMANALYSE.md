# Phase 0 · Schritt 1 – Systemanalyse

**Stand:** 2026-11-09 · **Status:** abgeschlossen

## Wichtiger Hinweis zur Umgebung

Diese Analyse wurde in einer **Claude-Code-Cloud-Sitzung** durchgeführt, also in einem kurzlebigen Linux-Container, nicht auf einem Rechner von FangEvo. Alles, was dort nicht per Git gepusht wird, geht beim Beenden der Sitzung verloren. Eine lokale JTL-Installation oder ein lokaler SQL Server ist von hier aus **nicht erreichbar**.

## Repository

| Punkt | Befund |
|---|---|
| Repository | `ripp1991-dev/Fangevo-Wawi-Pro` (privat) |
| Branches | nur `main` |
| Commits | 1 (`Initial commit`) |
| Inhalt | nur `README.md` („Wawi for everyone“) |
| Bestehender Code | keiner, es gibt keine Altlasten und keine Migrationspflichten |

## Laufzeitumgebungen und Werkzeuge (Container)

| Werkzeug | Version | Bewertung |
|---|---|---|
| Betriebssystem | Ubuntu 24.04.5 LTS, x86_64, 4 CPU, 15 GB RAM | ausreichend |
| Node.js | 22.23.4 (LTS) | ✅ passt zum Stack |
| npm / pnpm / yarn / bun | 10.9.9 / 10.28.0 / 1.22.22 / 1.4.4 | ✅ pnpm für Monorepo vorhanden |
| corepack | 0.36.0 | ✅ pnpm-Version kann im Repo fixiert werden |
| Git | 2.43.0 | ✅ |
| GitHub CLI | 2.89.0 | ⚠️ nur auf dieses Repo beschränkt, keine neuen Repos anlegbar |
| Docker CLI / Compose | 29.9.2 / v5.6.1 | ⚠️ CLI vorhanden, **Docker-Daemon läuft nicht** |
| PostgreSQL | 16.15 (Server installiert, Cluster `main` gestoppt) | ✅ kann für Tests gestartet werden |
| Redis | 7.0.15 | ✅ |
| Python | 3.13 | ✅ für Hilfsskripte |
| Java / Go | 21 / 1.24 | nicht benötigt |
| MS SQL Server / sqlcmd | **nicht vorhanden** | ❌ für JTL-Analyse nötig (siehe Checkliste) |
| MySQL | nicht vorhanden | nicht benötigt |

npm-Registry ist erreichbar. Geprüfte aktuelle Versionen: NestJS 12.4, Next.js 16.4, React 19.3, TypeScript 7.0, Prisma 7.10, Drizzle 0.45, BullMQ 6.7.

## Datenbanken

- Keine bestehenden Projektdatenbanken.
- PostgreSQL 16 und Redis lassen sich im Container direkt starten (ohne Docker). Damit sind Integrationstests in dieser Umgebung möglich.
- Für die echte Entwicklungsumgebung werden Docker-Compose-Dateien mitgeliefert (PostgreSQL, Redis, S3-kompatibler Speicher, Mail-Catcher).

## Konsequenzen

1. Es kann auf der grünen Wiese begonnen werden.
2. Entwicklung und automatisierte Tests sind in der Cloud-Sitzung möglich (Postgres + Redis nativ).
3. Die JTL-Analyse kann **nicht** in dieser Umgebung erfolgen, ohne dass eine Datenbankkopie bereitgestellt wird. Empfehlung siehe `02_JTL_CHECKLISTE.md`.
4. Für die lokale Entwicklung bei FangEvo sollten Docker Desktop (oder OrbStack), Node 22 LTS und pnpm installiert sein.
