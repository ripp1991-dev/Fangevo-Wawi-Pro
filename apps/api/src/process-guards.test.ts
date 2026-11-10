import { describe, expect, it, vi } from 'vitest';
import { installProcessGuards } from './process-guards';

describe('Prozess-Absicherung', () => {
  it('protokolliert unbehandelte Promise-Fehler, ohne den Prozess zu beenden', () => {
    const before = process.listeners('unhandledRejection').length;
    const logger = { log: vi.fn(), error: vi.fn(), warn: vi.fn() };
    installProcessGuards(logger, 'Test');
    const listeners = process.listeners('unhandledRejection');
    expect(listeners.length).toBe(before + 1);
    const handler = listeners.at(-1)!;
    handler(new Error('kaputt'), Promise.resolve());
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('kaputt'), 'Test');
    process.removeListener('unhandledRejection', handler);
    process.removeListener('uncaughtException', process.listeners('uncaughtException').at(-1)!);
  });
});
