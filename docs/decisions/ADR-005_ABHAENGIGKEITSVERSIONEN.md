# ADR-005 – Abhängigkeitsversionen

**Stand:** 2026-11-09 · **Status:** angenommen

## Entscheidung

- Alle Versionen werden **exakt gepinnt** (kein `^`/`~`) und sind zum Zeitpunkt der Aufnahme **mindestens zwei Wochen alt** (Schutz vor kompromittierten Neuveröffentlichungen).
- Bewährte Hauptversionen vor brandneuen: NestJS 11 (statt 12), Prisma 6 (statt 7/8), TypeScript 5.9 (statt 7), Vite 7, Vitest 3, ESLint 9.
- Sicherheitslücken der Stufe „high“ brechen die CI (`pnpm audit`). Korrekturen in indirekten Abhängigkeiten werden über `pnpm.overrides` erzwungen.

## Konsequenzen

Upgrades auf neue Hauptversionen sind eigene, geplante Arbeitspakete mit Tests (z. B. Prisma 7 mit `prisma.config.ts` und Driver-Adapter).
