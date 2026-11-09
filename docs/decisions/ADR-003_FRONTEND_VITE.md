# ADR-003 – Frontend mit Vite statt Next.js

**Stand:** 2026-11-09 · **Status:** vorläufig – Bestätigung durch FangEvo offen

## Kontext

Das Playbook schlägt Next.js vor. In ADR-001 wurde Vite empfohlen und die Entscheidung FangEvo überlassen. Phase 1 wurde ohne ausdrückliche Antwort freigegeben.

## Entscheidung

Die Web-App ist eine Single-Page-App mit **Vite + React + TanStack Router/Query + Tailwind CSS**. Begründung: Die Anwendung liegt komplett hinter einem Login. Serverseitiges Rendering und SEO bringen dort kaum Nutzen, eine zweite Server-Schicht neben NestJS würde Authentifizierung und Logik doppeln.

## Konsequenzen

- Die App spricht ausschließlich mit der REST-API. Ein späterer Wechsel des Frontend-Frameworks berührt das Backend nicht.
- Öffentliche Seiten (Marketing-Website, Marketplace-Katalog) können später mit Next.js gebaut werden.
- **Falls FangEvo Next.js für die App wünscht:** Der Wechsel betrifft nur `apps/web`. Seiten, Komponenten (`packages/ui`), API-Client und Validierung sind wiederverwendbar.
