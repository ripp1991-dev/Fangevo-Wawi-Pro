# ADR-006 – Fachliche Ereignisse über eine Outbox in PostgreSQL

**Stand:** 2026-11-09 · **Status:** angenommen

## Kontext

Ab Phase 2 lösen Änderungen Folgeaktionen aus (Benachrichtigungen, später Webhooks und Workflows). Diese dürfen nicht verloren gehen, auch wenn ein Prozess abstürzt, und sie dürfen die Mandantentrennung nicht umgehen. ADR-001 nannte BullMQ (Redis) für Hintergrundjobs.

## Entscheidung

- Jede auditierte Änderung schreibt in **derselben Transaktion** ein Ereignis in `outbox_events` (mandantenbezogen, RLS, unveränderlich) und einen Eintrag in `outbox_pending` (global, nur IDs).
- Ein **Verteiler** (`EventDispatcher`) holt offene Einträge mit `FOR UPDATE SKIP LOCKED`, sperrt sie 60 s und verarbeitet jedes Ereignis in einer Transaktion **mit Mandantenkontext**. Erfolg → Eintrag gelöscht; Fehler → erneuter Versuch mit wachsender Wartezeit (bis 1 h, nach 10 Versuchen täglich).
- Empfänger (`EventHandler`) müssen **idempotent** sein (z. B. Benachrichtigungen mit `dedupe_key`).
- Betrieb: eigener Prozess `apps/api/src/worker.ts` (beliebig viele Instanzen). In der Entwicklung läuft der Verteiler im API-Prozess (`EVENT_DISPATCH_INLINE`).
- **BullMQ wird vorerst nicht eingesetzt.** Es kommt hinzu, sobald zeitgesteuerte oder rechenintensive Jobs anfallen (Importe, PDF-Erzeugung, Shop-Synchronisation ab Phase 3/5).

## Begründung

Die Outbox in derselben Datenbank garantiert „Änderung und Ereignis oder keins von beiden“, ohne verteilte Transaktionen. Eine reine Redis-Warteschlange könnte Ereignisse verlieren, wenn nach dem Commit der Versand scheitert.

## Konsequenzen

- (+) Keine verlorenen oder doppelten Zustellungen; Mandantentrennung bleibt auch im Hintergrund erhalten.
- (+) Basis für Webhooks und Workflows (Phase 6).
- (−) Polling (1 s) statt Push; für Benachrichtigungen ausreichend. Bei Bedarf später `LISTEN/NOTIFY`.
