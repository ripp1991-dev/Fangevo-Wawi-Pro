export function daysLeft(d: Date | null, now = new Date()): number | null {
  return d ? Math.ceil((d.getTime() - now.getTime()) / 86_400_000) : null;
}
