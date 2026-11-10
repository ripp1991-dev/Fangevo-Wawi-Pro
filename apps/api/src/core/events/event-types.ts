import { type Tx } from '@fangevo/database';

export interface DomainEvent {
  id: string;
  accountId: string;
  type: string;
  entityType: string | null;
  entityId: string | null;
  actorUserId: string | null;
  companyId: string | null;
  payload: Record<string, unknown> | null;
  createdAt: Date;
}

/**
 * Empfänger von Ereignissen. Wird innerhalb der Mandanten-Transaktion aufgerufen.
 * Muss idempotent sein: Bei Fehlern wird das Ereignis erneut zugestellt.
 */
export interface EventHandler {
  readonly name: string;
  handles(type: string): boolean;
  handle(tx: Tx, event: DomainEvent): Promise<void>;
}

export const EVENT_HANDLERS = Symbol('EVENT_HANDLERS');
