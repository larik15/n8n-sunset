const DAY_MS = 86_400_000;
const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isIsoDay(value: string): boolean {
  const m = ISO_DAY.exec(value);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toISOString().slice(0, 10) === value;
}

/** Today's date in UTC, as YYYY-MM-DD. Shutdown dates are calendar days, so UTC keeps CI results stable across time zones. */
export function utcToday(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function toUtc(day: string): number {
  const m = ISO_DAY.exec(day);
  if (!m) throw new Error(`Expected YYYY-MM-DD, got "${day}"`);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** Whole days from `from` to `to` (negative when `to` is in the past). */
export function daysBetween(from: string, to: string): number {
  return Math.round((toUtc(to) - toUtc(from)) / DAY_MS);
}
