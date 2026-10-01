import type { DatePrecision } from './registry.js';

const DAY_MS = 86_400_000;
const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_MONTH = /^(\d{4})-(\d{2})$/;

export function isIsoDay(value: string): boolean {
  const m = ISO_DAY.exec(value);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toISOString().slice(0, 10) === value;
}

/** Today's date in the local time zone, as YYYY-MM-DD. */
export function localToday(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * The day a date takes effect. A month-precision date ("2026-10") resolves to the
 * first day of that month, so CI warns as early as the change could land.
 */
export function effectiveDay(date: string, precision: DatePrecision): string {
  if (precision === 'month') {
    if (!ISO_MONTH.test(date)) throw new Error(`Expected YYYY-MM, got "${date}"`);
    return `${date}-01`;
  }
  if (!isIsoDay(date)) throw new Error(`Expected YYYY-MM-DD, got "${date}"`);
  return date;
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
