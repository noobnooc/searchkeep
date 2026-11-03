import type { DateRange, IsoDate } from './types.js';

const DAY_MS = 86_400_000;
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: unknown): value is IsoDate {
  if (typeof value !== 'string' || !ISO_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export function toIsoDate(date: Date): IsoDate {
  return date.toISOString().slice(0, 10);
}

export function parseIsoDate(value: IsoDate): Date {
  return new Date(`${value}T00:00:00Z`);
}

export function addDays(date: IsoDate, days: number): IsoDate {
  return toIsoDate(new Date(parseIsoDate(date).getTime() + days * DAY_MS));
}

export function daysBetween(a: IsoDate, b: IsoDate): number {
  return Math.round((parseIsoDate(b).getTime() - parseIsoDate(a).getTime()) / DAY_MS);
}

/** Inclusive list of dates from start to end. */
export function eachDay(range: DateRange): IsoDate[] {
  const out: IsoDate[] = [];
  for (let d = range.start; d <= range.end; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Monday of the ISO week containing the date. */
export function weekStart(date: IsoDate): IsoDate {
  const d = parseIsoDate(date);
  const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
  return addDays(date, -dow);
}

export function monthOf(date: IsoDate): string {
  return date.slice(0, 7);
}

export function rangeLength(range: DateRange): number {
  return daysBetween(range.start, range.end) + 1;
}

/** The period of equal length immediately before `range`. */
export function previousPeriod(range: DateRange): DateRange {
  const len = rangeLength(range);
  return { start: addDays(range.start, -len), end: addDays(range.start, -1) };
}

export function assertRange(range: DateRange): DateRange {
  if (!isIsoDate(range.start) || !isIsoDate(range.end)) {
    throw new RangeError('Dates must be YYYY-MM-DD');
  }
  if (range.start > range.end) throw new RangeError('start must be on or before end');
  return range;
}

export function addMonths(date: IsoDate, months: number): IsoDate {
  const d = parseIsoDate(date);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return toIsoDate(d);
}
