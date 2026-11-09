import { describe, expect, it } from 'vitest';
import { loadConfig } from './config';

const base = { DATABASE_URL: 'postgresql://x', APP_ENCRYPTION_KEY: Buffer.alloc(32).toString('base64') };

describe('Konfiguration', () => {
  it('liest "false" korrekt als falsch (Rate-Limit bleibt aktiv)', () => {
    expect(loadConfig({ ...base, RATE_LIMIT_DISABLED: 'false' }).RATE_LIMIT_DISABLED).toBe(false);
    expect(loadConfig({ ...base, RATE_LIMIT_DISABLED: 'true' }).RATE_LIMIT_DISABLED).toBe(true);
    expect(loadConfig(base).RATE_LIMIT_DISABLED).toBe(false);
  });
  it('verbietet unsichere Einstellungen in Produktion', () => {
    expect(() => loadConfig({ ...base, NODE_ENV: 'production', RATE_LIMIT_DISABLED: 'true' })).toThrow();
    expect(() => loadConfig({ ...base, NODE_ENV: 'production', MAIL_TRANSPORT: 'memory' })).toThrow();
  });
  it('verlangt einen 32-Byte-Schlüssel', () => {
    expect(() => loadConfig({ ...base, APP_ENCRYPTION_KEY: 'zu-kurz' })).toThrow(/APP_ENCRYPTION_KEY/);
  });
});
