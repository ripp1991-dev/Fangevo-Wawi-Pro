import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { uuidv7, type Tx } from '@fangevo/database';
import { Database } from '../database/database.service';

const LOCK_SECONDS = 15 * 60;
const MAX_ATTEMPTS = 3;

export interface QueuedJob {
  id: string;
  kind: string;
  accountId: string;
  companyId: string | null;
  userId: string | null;
  refId: string;
  attempts: number;
}

/** Verarbeitet eine Art von Hintergrundaufgaben (z. B. Importe). */
export interface JobHandler {
  readonly kind: string;
  run(job: QueuedJob): Promise<void>;
  /** Wird nach dem letzten fehlgeschlagenen Versuch aufgerufen. */
  failed?(job: QueuedJob, error: unknown): Promise<void>;
}

export const JOB_HANDLERS = Symbol('JOB_HANDLERS');

/**
 * Warteschlange für Hintergrundaufgaben. Die globale Tabelle `job_queue` enthält nur IDs;
 * die Handler arbeiten mit Mandanten- und Firmenkontext (RLS). Mehrere Worker sind möglich
 * (FOR UPDATE SKIP LOCKED); bei einem Absturz läuft die Sperre ab und die Aufgabe wird erneut versucht.
 */
@Injectable()
export class JobQueue implements OnModuleDestroy {
  private readonly logger = new Logger('JobQueue');
  private timer: NodeJS.Timeout | undefined;
  private stopped = false;

  constructor(
    @Inject(Database) private readonly db: Database,
    // Handler werden erst bei Bedarf geholt: Sie hängen selbst von der Warteschlange ab (enqueue).
    @Inject(ModuleRef) private readonly moduleRef: ModuleRef,
  ) {}

  private get handlers(): JobHandler[] {
    return this.moduleRef.get<JobHandler[]>(JOB_HANDLERS, { strict: false });
  }

  /** Aufgabe einreihen (in derselben Transaktion wie die fachliche Änderung). */
  async enqueue(
    tx: Tx,
    job: {
      kind: string;
      accountId: string;
      companyId?: string | null;
      userId?: string | null;
      refId: string;
    },
  ): Promise<void> {
    await tx.jobQueue.create({
      data: {
        id: uuidv7(),
        kind: job.kind,
        accountId: job.accountId,
        companyId: job.companyId ?? null,
        userId: job.userId ?? null,
        refId: job.refId,
      },
    });
  }

  async runOnce(limit = 5): Promise<number> {
    const claimed = await this.db.global.$queryRaw<
      {
        id: string;
        kind: string;
        account_id: string;
        company_id: string | null;
        user_id: string | null;
        ref_id: string;
        attempts: number;
      }[]
    >`
      UPDATE job_queue SET locked_until = now() + make_interval(secs => ${LOCK_SECONDS}), attempts = attempts + 1
      WHERE id IN (
        SELECT id FROM job_queue
        WHERE available_at <= now() AND (locked_until IS NULL OR locked_until < now())
        ORDER BY created_at
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id, kind, account_id, company_id, user_id, ref_id, attempts`;
    for (const r of claimed) {
      const job: QueuedJob = {
        id: r.id,
        kind: r.kind,
        accountId: r.account_id,
        companyId: r.company_id,
        userId: r.user_id,
        refId: r.ref_id,
        attempts: r.attempts,
      };
      const handler = this.handlers.find((h) => h.kind === job.kind);
      try {
        if (!handler) throw new Error(`Kein Handler für ${job.kind}`);
        await handler.run(job);
        await this.db.global.jobQueue.delete({ where: { id: job.id } });
      } catch (err) {
        this.logger.error(
          `Aufgabe ${job.kind}/${job.refId} fehlgeschlagen (Versuch ${job.attempts}): ${String(err)}`,
        );
        if (job.attempts >= MAX_ATTEMPTS) {
          await handler?.failed?.(job, err).catch(() => undefined);
          await this.db.global.jobQueue.delete({ where: { id: job.id } });
        } else {
          await this.db.global.jobQueue.update({
            where: { id: job.id },
            data: {
              lockedUntil: null,
              availableAt: new Date(Date.now() + 30_000 * job.attempts),
              lastError: String(err).slice(0, 1000),
            },
          });
        }
      }
    }
    return claimed.length;
  }

  start(intervalMs = 1000): void {
    const loop = async () => {
      if (this.stopped) return;
      let n = 0;
      try {
        n = await this.runOnce();
      } catch (err) {
        this.logger.error(`Warteschlange: ${String(err)}`);
      }
      this.timer = setTimeout(loop, n > 0 ? 0 : intervalMs);
    };
    void loop();
  }

  onModuleDestroy(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }
}
