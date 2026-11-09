import { type Permission } from '@fangevo/shared';
import { AppError } from '../http/errors';
import { type AccountContext } from '../http/context';

/**
 * Schutz gegen Rechteausweitung: Wer kein Inhaber ist, darf nur Rechte vergeben,
 * die er selbst besitzt (direkt oder über Rollen).
 */
export function assertCanGrant(actor: AccountContext, permissions: Iterable<string>): void {
  if (actor.isOwner) return;
  const missing = [...new Set(permissions)].filter((p) => !actor.permissions.has(p as Permission));
  if (missing.length) {
    throw new AppError(403, 'PERMISSION_DENIED', `Sie können keine Rechte vergeben, die Sie selbst nicht haben: ${missing.join(', ')}`);
  }
}
