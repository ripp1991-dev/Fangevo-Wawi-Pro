import { describe, expect, it } from 'vitest';
import { type EntitlementSnapshot } from '@fangevo/licensing';
import { ALL_PERMISSIONS, permissionModule } from '@fangevo/shared';
import { effectivePermissions } from './access.service';

const ent: EntitlementSnapshot = {
  status: 'ACTIVE',
  plan: 'starter',
  modules: ['core'],
  maxCompanies: 3,
  maxUsers: null,
  maxConnectors: null,
  trialEndsAt: null,
  validUntil: null,
};

describe('effectivePermissions', () => {
  it('Inhaber hat alle Rechte, aber nur lizenzierter Module', () => {
    expect(
      effectivePermissions({
        isOwner: true,
        rolePermissions: [],
        directPermissions: [],
        entitlement: ent,
      }).size,
    ).toBe(ALL_PERMISSIONS.filter((p) => permissionModule(p) === 'core').length);
  });
  it('vereinigt Rollen- und Einzelrechte und verwirft Unbekanntes', () => {
    const p = effectivePermissions({
      isOwner: false,
      rolePermissions: ['users.read', 'gibt.es.nicht'],
      directPermissions: ['audit.read'],
      entitlement: ent,
    });
    expect([...p].sort()).toEqual(['audit.read', 'users.read']);
  });
});
