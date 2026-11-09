import { describe, expect, it } from 'vitest';
import { SecretBox, hashPassword, hashToken, randomToken, verifyPassword } from './crypto';

describe('crypto', () => {
  it('Passwort-Hash ist Argon2id und prüfbar', async () => {
    const h = await hashPassword('ein-sicheres-passwort');
    expect(h.startsWith('$argon2id$')).toBe(true);
    expect(await verifyPassword(h, 'ein-sicheres-passwort')).toBe(true);
    expect(await verifyPassword(h, 'falsch')).toBe(false);
    expect(await verifyPassword('kaputt', 'x')).toBe(false);
  });
  it('Tokens sind zufällig und werden gehasht gespeichert', () => {
    const a = randomToken();
    expect(a).not.toBe(randomToken());
    expect(hashToken(a)).toHaveLength(64);
    expect(hashToken(a)).not.toContain(a);
  });
  it('SecretBox verschlüsselt mit Integritätsschutz', () => {
    const box = new SecretBox(Buffer.alloc(32, 7).toString('base64'));
    const enc = box.encrypt('geheim');
    expect(enc).not.toContain('geheim');
    expect(box.decrypt(enc)).toBe('geheim');
    const parts = enc.split(':');
    parts[3] = Buffer.from('manipuliert').toString('base64');
    expect(() => box.decrypt(parts.join(':'))).toThrow();
  });
});
