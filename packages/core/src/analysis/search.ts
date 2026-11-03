import { SearchkeepError } from '../config.js';
import { addDays, previousPeriod, rangeLength, weekStart } from '../dates.js';
import type { DateRange, PerformanceDimension, PerformanceFilters, PerformanceRow, SearchSource } from '../types.js';
import { ANONYMIZED_NOTE, clampLimit, metrics, pct, resolve, round, type AnalysisContext, type CommonParams } from './common.js';

// ---------------------------------------------------------------------------
// query_performance
// ---------------------------------------------------------------------------

export interface QueryPerformanceParams extends CommonParams {
  dimensions?: PerformanceDimension[];
  queryContains?: string;
  pageContains?: string;
  country?: string;
  device?: string;
  orderBy?: 'clicks' | 'impressions' | 'ctr' | 'position' | 'date';
  order?: 'asc' | 'desc';
}

const DIMENSIONS: PerformanceDimension[] = ['date', 'week', 'month', 'query', 'page', 'country', 'device'];

export async function queryPerformance(ctx: AnalysisContext, p: QueryPerformanceParams) {
  const r = await resolve(ctx, p, { limit: 50 });
  const dimensions = p.dimensions ?? [];
  for (const d of dimensions) {
    if (!DIMENSIONS.includes(d)) throw new SearchkeepError('bad_request', `Unknown dimension "${d}". Use: ${DIMENSIONS.join(', ')}.`);
  }
  if (p.orderBy !== undefined && !['clicks', 'impressions', 'ctr', 'position', 'date'].includes(p.orderBy)) {
    throw new SearchkeepError('bad_request', 'orderBy must be one of clicks, impressions, ctr, position, date.');
  }
  if (p.order !== undefined && p.order !== 'asc' && p.order !== 'desc')
    throw new SearchkeepError('bad_request', 'order must be asc or desc.');
  const hasBreakdown = dimensions.some((d) => d === 'country' || d === 'device') || p.country || p.device;
  const hasQP = dimensions.some((d) => d === 'query' || d === 'page') || p.queryContains || p.pageContains || r.brand !== 'all';
  if (hasBreakdown && hasQP) {
    throw new SearchkeepError(
      'bad_request',
      'country/device cannot be combined with query/page dimensions or filters (Search Console stores them separately).',
    );
  }
  if (hasBreakdown && r.source === 'bing') throw new SearchkeepError('bad_request', 'Bing does not provide country/device breakdowns.');
  if (r.source === 'bing' && dimensions.includes('query') && dimensions.includes('page')) {
    throw new SearchkeepError('bad_request', 'Bing reports queries and pages separately; use one of them.');
  }
  const filters: PerformanceFilters = { brand: r.brand };
  if (p.queryContains) filters.queryContains = p.queryContains;
  if (p.pageContains) filters.pageContains = p.pageContains;
  if (p.country) filters.country = p.country.toLowerCase();
  if (p.device) filters.device = p.device.toUpperCase();
  const rows = await ctx.store.queryPerformance({
    siteId: r.site.id,
    source: r.source,
    range: r.range,
    dimensions,
    filters,
    orderBy:
      p.orderBy ?? (dimensions.some((d) => d === 'date' || d === 'week' || d === 'month') && dimensions.length === 1 ? 'date' : 'clicks'),
    order: p.order ?? (dimensions.length === 1 && ['date', 'week', 'month'].includes(dimensions[0]!) ? 'asc' : 'desc'),
    limit: r.limit,
  });
  const notes = [...r.notes];
  if (r.source === 'gsc' && (dimensions.includes('query') || p.queryContains || r.brand !== 'all')) notes.push(ANONYMIZED_NOTE);
  return { site: r.site.id, source: r.source, range: r.range, dimensions, brand: r.brand, rows, notes };
}

// ---------------------------------------------------------------------------
// compare_periods
// ---------------------------------------------------------------------------

export interface ComparePeriodsParams extends CommonParams {
  dimension?: 'query' | 'page';
  compareStart?: string;
  compareEnd?: string;
}

export async function comparePeriods(ctx: AnalysisContext, p: ComparePeriodsParams) {
  const r = await resolve(ctx, p, { limit: 20 });
  const dimension = p.dimension ?? 'query';
  let previous: DateRange;
  if (p.compareStart || p.compareEnd) {
    // One end is enough: the other is derived so both periods have the same length.
    const len = rangeLength(r.range);
    const start = p.compareStart ?? addDays(p.compareEnd!, -(len - 1));
    const end = p.compareEnd ?? addDays(p.compareStart!, len - 1);
    previous = (await resolve(ctx, { ...p, start, end })).range;
  } else {
    previous = previousPeriod(r.range);
  }
  const base = { siteId: r.site.id, source: r.source, filters: { brand: r.brand } } as const;
  const [curTotals, prevTotals, cur, prev] = await Promise.all([
    ctx.store.queryPerformance({ ...base, range: r.range, dimensions: [], limit: 1 }),
    ctx.store.queryPerformance({ ...base, range: previous, dimensions: [], limit: 1 }),
    ctx.store.queryPerformance({ ...base, range: r.range, dimensions: [dimension], orderBy: 'clicks', order: 'desc', limit: 5000 }),
    ctx.store.queryPerformance({ ...base, range: previous, dimensions: [dimension], orderBy: 'clicks', order: 'desc', limit: 5000 }),
  ]);
  const key = (row: PerformanceRow) => (dimension === 'query' ? row.query : row.page) ?? '';
  const prevMap = new Map(prev.map((row) => [key(row), row]));
  const curMap = new Map(cur.map((row) => [key(row), row]));
  const keys = new Set([...curMap.keys(), ...prevMap.keys()]);
  const changes = [...keys].map((k) => {
    const a = prevMap.get(k);
    const b = curMap.get(k);
    return {
      [dimension]: k,
      clicks: b?.clicks ?? 0,
      previousClicks: a?.clicks ?? 0,
      clicksDelta: (b?.clicks ?? 0) - (a?.clicks ?? 0),
      impressions: b?.impressions ?? 0,
      previousImpressions: a?.impressions ?? 0,
      impressionsDelta: (b?.impressions ?? 0) - (a?.impressions ?? 0),
      position: b?.position ?? null,
      previousPosition: a?.position ?? null,
      positionDelta: b?.position != null && a?.position != null ? round(b.position - a.position, 2) : null,
      status: !a ? 'new' : !b ? 'lost' : 'changed',
    };
  });
  const gainers = changes
    .filter((c) => c.clicksDelta > 0)
    .sort((x, y) => y.clicksDelta - x.clicksDelta)
    .slice(0, r.limit);
  const losers = changes
    .filter((c) => c.clicksDelta < 0)
    .sort((x, y) => x.clicksDelta - y.clicksDelta)
    .slice(0, r.limit);
  const t = (rows: PerformanceRow[]) => rows[0] ?? metrics(0, 0, null);
  const ct = t(curTotals);
  const pt = t(prevTotals);
  const change = (a: number, b: number) => (a === 0 ? null : pct((b - a) / a));
  const notes = [...r.notes];
  if (rangeLength(r.range) !== rangeLength(previous)) notes.push('The two periods have different lengths; compare averages with care.');
  if (r.source === 'gsc' && dimension === 'query') notes.push(ANONYMIZED_NOTE);
  return {
    site: r.site.id,
    source: r.source,
    dimension,
    current: { range: r.range, ...strip(ct) },
    previous: { range: previous, ...strip(pt) },
    change: { clicksPct: change(pt.clicks, ct.clicks), impressionsPct: change(pt.impressions, ct.impressions) },
    gainers,
    losers,
    notes,
  };
}

function strip(row: PerformanceRow) {
  return { clicks: row.clicks, impressions: row.impressions, ctr: row.ctr, position: row.position };
}

// ---------------------------------------------------------------------------
// find_quick_wins
// ---------------------------------------------------------------------------

export interface QuickWinsParams extends CommonParams {
  minPosition?: number;
  maxPosition?: number;
  minImpressions?: number;
}

/** Benchmark CTR by position used when the site has too little data of its own. */
export const BENCHMARK_CTR: Record<number, number> = {
  1: 0.28,
  2: 0.16,
  3: 0.11,
  4: 0.08,
  5: 0.06,
  6: 0.045,
  7: 0.035,
  8: 0.028,
  9: 0.023,
  10: 0.02,
  11: 0.012,
  12: 0.011,
  13: 0.01,
  14: 0.009,
  15: 0.008,
  16: 0.007,
  17: 0.007,
  18: 0.006,
  19: 0.006,
  20: 0.005,
};

export function benchmarkCtr(position: number): number {
  const p = Math.max(1, Math.min(20, Math.round(position)));
  return BENCHMARK_CTR[p] ?? 0.004;
}

export async function findQuickWins(ctx: AnalysisContext, p: QuickWinsParams) {
  const r = await resolve(ctx, p, { limit: 25 });
  const minPosition = p.minPosition ?? 8;
  const maxPosition = p.maxPosition ?? 20;
  const minImpressions = p.minImpressions ?? Math.max(10, Math.round(rangeLength(r.range) * 2));
  const dims: PerformanceDimension[] = r.source === 'gsc' ? ['query', 'page'] : ['query'];
  const rows = await ctx.store.queryPerformance({
    siteId: r.site.id,
    source: r.source,
    range: r.range,
    dimensions: dims,
    filters: { brand: r.brand },
    having: { minImpressions, minPosition, maxPosition },
    orderBy: 'impressions',
    order: 'desc',
    limit: 2000,
  });
  // One row per query: keep the page with most impressions.
  const best = new Map<string, PerformanceRow>();
  for (const row of rows) {
    const k = row.query ?? '';
    const prev = best.get(k);
    if (!prev || row.impressions > prev.impressions) best.set(k, row);
  }
  const target = benchmarkCtr(3);
  const wins = [...best.values()]
    .map((row) => ({
      query: row.query,
      ...(row.page ? { page: row.page } : {}),
      clicks: row.clicks,
      impressions: row.impressions,
      ctr: row.ctr,
      position: row.position,
      /** Extra clicks if this query reached position ~3 at benchmark CTR. */
      potentialExtraClicks: Math.max(0, Math.round(row.impressions * target - row.clicks)),
    }))
    .sort((a, b) => b.potentialExtraClicks - a.potentialExtraClicks)
    .slice(0, r.limit);
  return {
    site: r.site.id,
    source: r.source,
    range: r.range,
    criteria: { minPosition, maxPosition, minImpressions },
    quickWins: wins,
    notes: [...r.notes, 'potentialExtraClicks assumes a benchmark CTR for position 3; treat it as a ranking signal, not a forecast.'],
  };
}

// ---------------------------------------------------------------------------
// find_cannibalization
// ---------------------------------------------------------------------------

export interface CannibalizationParams extends CommonParams {
  minImpressions?: number;
  /** Minimum share of the query's impressions a page must have to count. Default 0.1. */
  minShare?: number;
}

export async function findCannibalization(ctx: AnalysisContext, p: CannibalizationParams) {
  const r = await resolve(ctx, { ...p, source: 'gsc' }, { limit: 25 });
  const minImpressions = p.minImpressions ?? 10;
  const minShare = p.minShare ?? 0.1;
  const rows = await ctx.store.queryPerformance({
    siteId: r.site.id,
    source: 'gsc',
    range: r.range,
    dimensions: ['query', 'page'],
    filters: { brand: r.brand },
    having: { minImpressions },
    orderBy: 'impressions',
    order: 'desc',
    limit: 10_000,
  });
  const byQuery = new Map<string, PerformanceRow[]>();
  for (const row of rows) {
    const list = byQuery.get(row.query!) ?? [];
    list.push(row);
    byQuery.set(row.query!, list);
  }
  const issues = [];
  for (const [query, pages] of byQuery) {
    if (pages.length < 2) continue;
    const total = pages.reduce((s, x) => s + x.impressions, 0);
    const competing = pages.filter((x) => x.impressions / total >= minShare);
    if (competing.length < 2) continue;
    issues.push({
      query,
      impressions: total,
      clicks: pages.reduce((s, x) => s + x.clicks, 0),
      pages: competing
        .sort((a, b) => b.impressions - a.impressions)
        .slice(0, 5)
        .map((x) => ({
          page: x.page,
          impressions: x.impressions,
          clicks: x.clicks,
          position: x.position,
          share: round(x.impressions / total, 3),
        })),
    });
  }
  issues.sort((a, b) => b.impressions - a.impressions);
  const notes = [...r.notes];
  if (p.source === 'bing') notes.push('Cannibalization needs query × page data, which only Search Console provides; GSC was used.');
  return {
    site: r.site.id,
    source: 'gsc' as SearchSource,
    range: r.range,
    criteria: { minImpressions, minShare },
    issues: issues.slice(0, r.limit),
    notes,
  };
}

// ---------------------------------------------------------------------------
// find_ctr_anomalies
// ---------------------------------------------------------------------------

export interface CtrAnomalyParams extends CommonParams {
  minImpressions?: number;
  /** Flag when CTR is below this fraction of the expected CTR. Default 0.5. */
  threshold?: number;
}

export async function findCtrAnomalies(ctx: AnalysisContext, p: CtrAnomalyParams) {
  const r = await resolve(ctx, p, { limit: 25 });
  const minImpressions = p.minImpressions ?? Math.max(50, rangeLength(r.range) * 5);
  const threshold = p.threshold ?? 0.5;
  const rows = await ctx.store.queryPerformance({
    siteId: r.site.id,
    source: r.source,
    range: r.range,
    dimensions: ['query'],
    filters: { brand: r.brand },
    having: { minImpressions, maxPosition: 20 },
    orderBy: 'impressions',
    order: 'desc',
    limit: 5000,
  });
  // Expected CTR per position bucket, calibrated on this site's own data.
  const buckets = new Map<number, number[]>();
  for (const row of rows) {
    if (row.position == null) continue;
    const b = Math.max(1, Math.min(20, Math.round(row.position)));
    const list = buckets.get(b) ?? [];
    list.push(row.ctr);
    buckets.set(b, list);
  }
  const expectedFor = (position: number) => {
    const b = Math.max(1, Math.min(20, Math.round(position)));
    const list = buckets.get(b);
    if (list && list.length >= 8) {
      const sorted = [...list].sort((x, y) => x - y);
      return { ctr: sorted[Math.floor(sorted.length / 2)]!, basis: 'site' as const };
    }
    return { ctr: benchmarkCtr(position), basis: 'benchmark' as const };
  };
  const anomalies = rows
    .filter((row) => row.position != null)
    .map((row) => {
      const exp = expectedFor(row.position!);
      return {
        query: row.query,
        clicks: row.clicks,
        impressions: row.impressions,
        ctr: row.ctr,
        position: row.position,
        expectedCtr: round(exp.ctr, 4),
        expectedBasis: exp.basis,
        lostClicks: Math.max(0, Math.round(row.impressions * exp.ctr - row.clicks)),
      };
    })
    .filter((a) => a.ctr < a.expectedCtr * threshold && a.lostClicks > 0)
    .sort((a, b) => b.lostClicks - a.lostClicks)
    .slice(0, r.limit);
  return {
    site: r.site.id,
    source: r.source,
    range: r.range,
    criteria: { minImpressions, threshold },
    anomalies,
    notes: [
      ...r.notes,
      "Expected CTR is the median CTR of this site's queries at the same rounded position (benchmark curve when fewer than 8 samples). Low CTR often means a weak title/snippet, a SERP feature above you, or mismatched intent.",
    ],
  };
}

// ---------------------------------------------------------------------------
// find_content_decay
// ---------------------------------------------------------------------------

export interface ContentDecayParams extends CommonParams {
  /** Weeks of history to analyse. Default 16. */
  weeks?: number;
  /** Minimum clicks per week at the baseline peak. Default 5. */
  minWeeklyClicks?: number;
  /** Minimum decline from the baseline (0..1). Default 0.3. */
  minDecline?: number;
}

export async function findContentDecay(ctx: AnalysisContext, p: ContentDecayParams) {
  const weeks = Math.max(8, Math.min(104, Math.floor(p.weeks ?? 16)));
  const r0 = await resolve(ctx, { ...p, start: undefined, days: 7 }, { limit: 25 });
  // Whole weeks ending at the last complete week of data.
  const lastWeekStart = weekStart(addDays(r0.range.end, -6));
  const range: DateRange = { start: addDays(lastWeekStart, -(weeks - 1) * 7), end: addDays(lastWeekStart, 6) };
  const minWeekly = p.minWeeklyClicks ?? 5;
  const minDecline = p.minDecline ?? 0.3;
  const rows = await ctx.store.queryPerformance({
    siteId: r0.site.id,
    source: r0.source,
    range,
    dimensions: ['page', 'week'],
    filters: { brand: r0.brand },
    orderBy: 'clicks',
    order: 'desc',
    limit: 50_000,
  });
  const weekKeys: string[] = [];
  for (let i = 0; i < weeks; i++) weekKeys.push(addDays(range.start, i * 7));
  const series = new Map<string, number[]>();
  for (const row of rows) {
    const s = series.get(row.page!) ?? new Array(weeks).fill(0);
    const idx = weekKeys.indexOf(row.week!);
    if (idx >= 0) s[idx] += row.clicks;
    series.set(row.page!, s);
  }
  const decaying = [];
  for (const [page, s] of series) {
    const recent = avg(s.slice(-4));
    let peak = 0;
    let peakWeek = 0;
    for (let i = 0; i + 4 <= s.length - 4; i++) {
      const a = avg(s.slice(i, i + 4));
      if (a > peak) {
        peak = a;
        peakWeek = i;
      }
    }
    if (peak < minWeekly) continue;
    const decline = 1 - recent / peak;
    const trend = slope(s.slice(peakWeek));
    if (decline >= minDecline && trend < 0) {
      decaying.push({
        page,
        peakWeeklyClicks: round(peak, 1),
        peakWeekOf: weekKeys[peakWeek],
        recentWeeklyClicks: round(recent, 1),
        declinePct: pct(decline),
        lostClicksPerWeek: round(peak - recent, 1),
        weekly: s,
      });
    }
  }
  decaying.sort((a, b) => b.lostClicksPerWeek - a.lostClicksPerWeek);
  return {
    site: r0.site.id,
    source: r0.source,
    range,
    weeks: weekKeys,
    criteria: { minWeeklyClicks: minWeekly, minDecline },
    decaying: decaying.slice(0, clampLimit(p.limit, 25)),
    notes: [
      ...r0.notes.filter((n) => !n.startsWith('Bing data is weekly')),
      'Compares the last 4 weeks with the best earlier 4-week window and requires a downward trend since that peak.',
    ],
  };
}

function avg(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((s, x) => s + x, 0) / xs.length;
}

function slope(ys: number[]): number {
  const n = ys.length;
  if (n < 2) return 0;
  const mx = (n - 1) / 2;
  const my = avg(ys);
  let num = 0;
  let den = 0;
  ys.forEach((y, x) => {
    num += (x - mx) * (y - my);
    den += (x - mx) ** 2;
  });
  return den === 0 ? 0 : num / den;
}
