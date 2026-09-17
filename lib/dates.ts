/**
 * Date helpers.
 *
 * Thin wrappers over date-fns, kept as a module so the rest of the codebase
 * speaks in `YYYY-MM-DD` strings rather than passing Date objects around. The
 * engine never reads the system clock — callers always pass the reference date
 * in, which is what keeps decisions reproducible.
 */

import {
  addDays as fnsAddDays,
  addMonths as fnsAddMonths,
  differenceInCalendarDays,
  format,
  getDate,
  getDaysInMonth,
  parseISO,
} from 'date-fns';

/** Parse `YYYY-MM-DD`, or the date half of an ISO timestamp. */
export function parseDate(iso: string): Date {
  return parseISO(iso.slice(0, 10));
}

export function toISODate(date: Date): string {
  return format(date, 'yyyy-MM-dd');
}

export function addDays(iso: string, days: number): string {
  return toISODate(fnsAddDays(parseDate(iso), days));
}

/** Adds months, clamping the day to the target month's length (Jan 31 → Feb 28). */
export function addMonths(iso: string, months: number): string {
  return toISODate(fnsAddMonths(parseDate(iso), months));
}

/** Whole days from `from` to `to`. Negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  return differenceInCalendarDays(parseDate(to), parseDate(from));
}

/** `YYYY-MM`, used to bucket the ledger by month. */
export function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

export function dayOfMonth(iso: string): number {
  return getDate(parseDate(iso));
}

export function daysInMonth(iso: string): number {
  return getDaysInMonth(parseDate(iso));
}

/** `19 Sep 2026` — for EMI schedules. */
export function formatDisplayDate(iso: string): string {
  return format(parseDate(iso), 'd MMM yyyy');
}

/** `19 Sep 26` — the compact form used in the UI. */
export function formatShortDate(iso: string): string {
  return format(parseDate(iso), 'd MMM yy');
}
