/**
 * Deterministic, UTC-based date helpers for the forecasting engine.
 *
 * The engine NEVER calls `new Date()` / `Date.now()` on its own — every
 * projection takes an explicit `anchorDate` so runs are reproducible and
 * unit-testable. Dates are passed around as `YYYY-MM-DD` strings (`ISODate`)
 * and manipulated in UTC to avoid timezone drift.
 */

/** A calendar date with no time component, e.g. "2026-07-06". */
export type ISODate = string;

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const MS_PER_DAY = 86_400_000;

/** Average days per month, used only for coarse month-fraction math (burn/runway). */
export const AVG_DAYS_PER_MONTH = 365.25 / 12; // ≈ 30.4375

export function isValidISODate(value: string): boolean {
  if (!ISO_DATE_RE.test(value)) return false;
  const d = parseISO(value);
  return toISO(d) === value; // rejects impossible dates like 2026-02-31
}

/** Parse an `ISODate` into a UTC `Date` at midnight. Throws on malformed input. */
export function parseISO(date: ISODate): Date {
  if (!ISO_DATE_RE.test(date)) {
    throw new Error(`Invalid ISO date: "${date}" (expected YYYY-MM-DD)`);
  }
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d));
}

/** Format a UTC `Date` as an `ISODate`. */
export function toISO(date: Date): ISODate {
  const y = date.getUTCFullYear().toString().padStart(4, "0");
  const m = (date.getUTCMonth() + 1).toString().padStart(2, "0");
  const d = date.getUTCDate().toString().padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function addDays(date: ISODate, days: number): ISODate {
  return toISO(new Date(parseISO(date).getTime() + days * MS_PER_DAY));
}

export function addWeeks(date: ISODate, weeks: number): ISODate {
  return addDays(date, weeks * 7);
}

/**
 * Add calendar months, clamping the day to the target month's length
 * (e.g. Jan 31 + 1 month → Feb 28/29).
 */
export function addMonths(date: ISODate, months: number): ISODate {
  const d = parseISO(date);
  const targetMonthIndex = d.getUTCMonth() + months;
  const year = d.getUTCFullYear() + Math.floor(targetMonthIndex / 12);
  const month = ((targetMonthIndex % 12) + 12) % 12;
  const lastDay = daysInMonth(year, month);
  const day = Math.min(d.getUTCDate(), lastDay);
  return toISO(new Date(Date.UTC(year, month, day)));
}

export function daysInMonth(year: number, monthZeroBased: number): number {
  return new Date(Date.UTC(year, monthZeroBased + 1, 0)).getUTCDate();
}

/** Whole days from `a` to `b` (b − a). Negative if `b` precedes `a`. */
export function daysBetween(a: ISODate, b: ISODate): number {
  return Math.round((parseISO(b).getTime() - parseISO(a).getTime()) / MS_PER_DAY);
}

export function isBefore(a: ISODate, b: ISODate): boolean {
  return parseISO(a).getTime() < parseISO(b).getTime();
}

export function isOnOrBefore(a: ISODate, b: ISODate): boolean {
  return parseISO(a).getTime() <= parseISO(b).getTime();
}

export function maxDate(a: ISODate, b: ISODate): ISODate {
  return isBefore(a, b) ? b : a;
}

export function minDate(a: ISODate, b: ISODate): ISODate {
  return isBefore(a, b) ? a : b;
}

/** Monday of the ISO week containing `date` (weeks start Monday). */
export function startOfWeek(date: ISODate): ISODate {
  const d = parseISO(date);
  const dow = d.getUTCDay(); // 0=Sun..6=Sat
  const backToMonday = (dow + 6) % 7; // Mon→0, Sun→6
  return addDays(date, -backToMonday);
}

/** First day of the month containing `date`. */
export function startOfMonth(date: ISODate): ISODate {
  const d = parseISO(date);
  return toISO(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)));
}

/** Fractional months between two dates, using the average month length. */
export function monthsBetween(a: ISODate, b: ISODate): number {
  return daysBetween(a, b) / AVG_DAYS_PER_MONTH;
}
