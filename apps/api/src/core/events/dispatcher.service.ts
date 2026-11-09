import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { Database } from '../database/database.service';
import { EVENT_HANDLERS, type DomainEvent, type EventHandler } from './event-types';

const LOCK_SECONDS = 60;
const MAX_ATTEMPTS = 10;

interface Claimed {
  event_id: string;
  account_id: string;
  attempts: number;
}

/**
 * Ereignis-Verteiler (Outbox-Muster).
 * - Holt offene Ereignisse aus `outbox_pending` (global, nur IDs) und sperrt sie kurzzeitig.
 *   Mehrere Worker können parallel laufen (FOR UPDATE SKIP LOCKED).
 * - Verarbeitet jedes Ereignis in einer Transaktion MIT Mandantenkontext. Die
 *   Mandantentrennung bleibt also auch im Hintergrund erhalten.
 * - Erfolg: Eintrag wird entfernt. Fehler: erneuter Versuch mit wachsender Wartezeit.
 * - Absturz mitten in der Verarbeitung: Die Sperre läuft ab, das Ereignis wird erneut zugestellt.
 */
@Injectable()
export class EventDispatcher implements OnModuleDestroy {
  private readonly logger = new Logger('EventDispatcher');
  private timer: NodeJS.Timeout | undefined;
  private stopped = false;

  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(EVENT_HANDLERS) private readonly handlers: EventHandler[],
  ) {}

  /** Verarbeitet bis zu `limit` Ereignisse. Gibt die Anzahl zurück. */
  async runOnce(limit = 50): Promise<number> {
    const claimed = await this.db.global.$queryRaw<Claimed[]>`
      UPDATE outbox_pending SET locked_until = now() + make_interval(secs => ${LOCK_SECONDS}), attempts = attempts + 1
      WHERE event_id IN (
        SELECT event_id FROM outbox_pending
        WHERE available_at <= now() AND (locked_until IS NULL OR locked_until < now())
        ORDER BY created_at
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING event_id, account_id, attempts`;
    for (const c of claimed) await this.process(c);
    return claimed.length;
  }

  private async process(c: Claimed): Promise<void> {
    try {
      await this.db.tenant({ accountId: c.account_id, userId: null }, async (tx) => {
        const row = await tx.outboxEvent.findUnique({ where: { id: c.event_id } });
        if (row) {
          const event: DomainEvent = {
            ...row,
            payload: (row.payload ?? null) as Record<string, unknown> | null,
          };
          for (const h of this.handlers) if (h.handles(event.type)) await h.handle(tx, event);
        }
        await tx.outboxPending.delete({ where: { eventId: c.event_id } });
      });
    } catch (err) {
      const delaySec = c.attempts >= MAX_ATTEMPTS ? 24 * 3600 : Math.min(2 ** c.attempts * 5, 3600);
      this.logger.error(
        `Ereignis ${c.event_id} fehlgeschlagen (Versuch ${c.attempts}): ${String(err)}`,
      );
      await this.db.global.outboxPending.update({
        where: { eventId: c.event_id },
        data: {
          lockedUntil: null,
          availableAt: new Date(Date.now() + delaySec * 1000),
          lastError: String(err).slice(0, 1000),
        },
      });
    }
  }

  /** Dauerbetrieb (Worker-Prozess oder in der Entwicklung im API-Prozess). */
  start(intervalMs = 1000): void {
    const loop = async () => {
      if (this.stopped) return;
      let n = 0;
      try {
        n = await this.runOnce();
      } catch (err) {
        this.logger.error(`Verteiler-Fehler: ${String(err)}`);
      }
      this.timer = setTimeout(loop, n > 0 ? 0 : intervalMs);
    };
    void loop();
    this.logger.log('Ereignis-Verteiler gestartet');
  }

  onModuleDestroy(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }
}
