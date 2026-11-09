import { type Permission } from '@fangevo/shared';
import { AppError } from '../http/errors';
import { type AccountContext } from '../http/context';

/**
 * Schutz gegen Rechteausweitung: Wer kein Inhaber ist, darf nur Rechte vergeben,
 * die er selbst besitzt (direkt oder über Rollen).
 */
export function assertCanGrant(actor: AccountContext, permissions: Iterable<string>): void {
  if (actor.isOwner) return;
  // Maßstab sind die eigenen Rechte ohne Lizenzfilter: Rechte nicht gebuchter Module dürfen nur
  // weitergegeben werden, wenn man sie selbst besitzt (sie werden erst mit der Buchung wirksam).
  const missing = [...new Set(permissions)].filter(
    (p) => !actor.permissions.has(p as Permission) && !actor.grantable.has(p),
  );
  if (missing.length) {
    throw new AppError(
      403,
      'PERMISSION_DENIED',
      `Sie können keine Rechte vergeben, die Sie selbst nicht haben: ${missing.join(', ')}`,
    );
  }
}
