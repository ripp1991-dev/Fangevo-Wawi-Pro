import { describe, expect, it } from 'vitest';
import { ALL_PERMISSIONS, PERMISSIONS, SYSTEM_ROLES, isPermission } from './permissions';
import { companyInputSchema, passwordSchema, registerSchema } from './index';

describe('Rechtekatalog', () => {
  it('enthält nur Rechte mit Modul und Bezeichnung', () => {
    for (const p of ALL_PERMISSIONS) {
      expect(PERMISSIONS[p].module).toBeTruthy();
      expect(PERMISSIONS[p].label).toBeTruthy();
    }
  });
  it('erkennt unbekannte Rechte', () => {
    expect(isPermission('users.read')).toBe(true);
    expect(isPermission('users.delete_everything')).toBe(false);
    expect(isPermission('__proto__')).toBe(false);
  });
  it('Systemrollen verwenden nur gültige Rechte', () => {
    for (const role of Object.values(SYSTEM_ROLES)) {
      for (const p of role.permissions) expect(isPermission(p)).toBe(true);
    }
  });
});

describe('Validierung', () => {
  it('verlangt Passwörter mit mindestens 12 Zeichen', () => {
    expect(passwordSchema.safeParse('kurz').success).toBe(false);
    expect(passwordSchema.safeParse('ein-langes-passwort').success).toBe(true);
  });
  it('normalisiert E-Mail-Adressen', () => {
    const r = registerSchema.parse({ name: 'A', email: '  Max@Example.DE ', password: 'x'.repeat(12), accountName: 'F' });
    expect(r.email).toBe('max@example.de');
  });
  it('normalisiert Ländercodes', () => {
    expect(companyInputSchema.parse({ name: 'X', country: 'at' }).country).toBe('AT');
    expect(companyInputSchema.safeParse({ name: 'X', country: 'DEU' }).success).toBe(false);
  });
});
