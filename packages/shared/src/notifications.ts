/** Arten von Benachrichtigungen. Jede Art kann je Benutzer abgeschaltet werden. */
export const NOTIFICATION_TYPES = {
  'member.joined': {
    label: 'Neue Person ist beigetreten',
    description: 'Für Personen, die Benutzer verwalten',
  },
  'member.disabled': { label: 'Person wurde gesperrt', description: 'Für Inhaber' },
  'member.access_changed': {
    label: 'Meine Rechte wurden geändert',
    description: 'Für die betroffene Person',
  },
  'role.updated': {
    label: 'Eine meiner Rollen wurde geändert',
    description: 'Für Personen mit dieser Rolle',
  },
  'company.created': { label: 'Firma angelegt', description: 'Für Personen, die Firmen verwalten' },
  'company.archived': {
    label: 'Firma archiviert',
    description: 'Für Personen, die Firmen verwalten',
  },
  'license.trial_ending': { label: 'Testphase endet bald', description: 'Für Inhaber' },
  'security.new_device': {
    label: 'Anmeldung von neuem Gerät',
    description: 'Zusätzlich immer per E-Mail',
  },
} as const;

export type NotificationType = keyof typeof NOTIFICATION_TYPES;
export const ALL_NOTIFICATION_TYPES = Object.keys(NOTIFICATION_TYPES) as NotificationType[];
