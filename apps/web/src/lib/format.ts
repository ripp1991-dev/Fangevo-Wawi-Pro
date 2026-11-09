const dt = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' });
const d = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium' });

export const formatDateTime = (v: string | Date | null | undefined) =>
  v ? dt.format(new Date(v)) : '–';
export const formatDate = (v: string | Date | null | undefined) =>
  v ? d.format(new Date(v)) : '–';

export function daysUntil(v: string | null | undefined): number | null {
  if (!v) return null;
  return Math.ceil((new Date(v).getTime() - Date.now()) / 86_400_000);
}
