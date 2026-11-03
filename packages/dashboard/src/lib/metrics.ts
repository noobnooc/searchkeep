import { delta, type Delta } from '../components/Stat.svelte';
import { compact, decimal, deltaDecimal, eachDay, int, pctChange, percent, weekStart } from './format';
import type { DateRange, Metrics, OverviewSource, PerformanceRow } from './types';

export function pctDelta(cur: number, prev: number): number | null {
  if (!prev) return null;
  return ((cur - prev) / prev) * 100;
}

/** Big-number display: full digits below 100k, compact above. */
export function big(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  return Math.abs(n) < 100_000 ? int(n) : compact(n);
}

export interface KpiSet {
  label: string;
  value: string;
  sub: string;
  delta: Delta | null;
}

/** The four search KPIs with deltas colored by whether the change is good. */
export function searchKpis(cur: Metrics, prev: Metrics): KpiSet[] {
  const cp = pctDelta(cur.clicks, prev.clicks);
  const ip = pctDelta(cur.impressions, prev.impressions);
  const ctrPp = prev.impressions > 0 && cur.impressions > 0 ? (cur.ctr - prev.ctr) * 100 : null;
  const posD = cur.position !== null && prev.position !== null ? cur.position - prev.position : null;
  return [
    { label: 'Clicks', value: big(cur.clicks), sub: `vs ${big(prev.clicks)}`, delta: delta(cp, pctChange(cp), true, 0.05) },
    { label: 'Impressions', value: big(cur.impressions), sub: `vs ${big(prev.impressions)}`, delta: delta(ip, pctChange(ip), true, 0.05) },
    {
      label: 'CTR',
      value: percent(cur.ctr),
      sub: `vs ${percent(prev.ctr)}`,
      delta: delta(ctrPp, `${deltaDecimal(ctrPp, 2)} pp`, true, 0.005),
    },
    {
      label: 'Avg. position',
      value: decimal(cur.position, 1),
      sub: `vs ${decimal(prev.position, 1)}`,
      delta: delta(posD, deltaDecimal(posD, 1), false, 0.05),
    },
  ];
}

export interface SplitSeries {
  dates: string[];
  prevDates: string[];
  cur: Array<PerformanceRow | null>;
  prev: Array<PerformanceRow | null>;
  weekly: boolean;
}

/** Splits an overview series (previous start → current end) into aligned current/previous periods. */
export function splitSeries(src: OverviewSource | undefined, range: DateRange, prevRange: DateRange): SplitSeries {
  const rows = src?.series ?? [];
  const weekly = src?.source === 'bing';
  const key = (r: PerformanceRow) => (weekly ? r.week : r.date) ?? '';
  const byKey = new Map(rows.map((r) => [key(r), r]));
  let dates: string[];
  let prevDates: string[];
  if (weekly) {
    const curStart = weekStart(range.start);
    const prevStart = weekStart(prevRange.start);
    const weeks = [...byKey.keys()].sort();
    dates = weeks.filter((w) => w >= curStart && w <= range.end);
    prevDates = weeks.filter((w) => w >= prevStart && w < curStart);
  } else {
    dates = eachDay(range.start, range.end);
    prevDates = eachDay(prevRange.start, prevRange.end);
  }
  return {
    dates,
    prevDates: prevDates.slice(0, dates.length),
    cur: dates.map((d) => byKey.get(d) ?? null),
    prev: prevDates.slice(0, dates.length).map((d) => byKey.get(d) ?? null),
    weekly,
  };
}
