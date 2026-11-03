import { findSite, SearchkeepError, type SearchkeepConfig } from '../config.js';
import { addDays, assertRange, isIsoDate, toIsoDate, weekStart } from '../dates.js';
import type { Store } from '../store.js';
import type { BrandFilter, DateRange, Metrics, SearchSource, SiteConfig } from '../types.js';
import { classifyBrandQueries } from '../brand.js';

export interface AnalysisContext {
  store: Store;
  config: SearchkeepConfig;
  now?: () => Date;
}

/** Parameters shared by most analysis functions and MCP tools. */
export interface CommonParams {
  /** Site id or domain; optional when only one site is configured. */
  site?: string;
  /** YYYY-MM-DD; defaults to `end - days + 1`. */
  start?: string;
  /** YYYY-MM-DD; defaults to the latest date with data. */
  end?: string;
  /** Window length when start is omitted. Default 28. */
  days?: number;
  source?: SearchSource;
  brand?: BrandFilter;
  limit?: number;
}

export interface Resolved {
  site: SiteConfig;
  source: SearchSource;
  range: DateRange;
  brand: BrandFilter;
  limit: number;
  notes: string[];
}

export const MAX_LIMIT = 500;

export function clampLimit(limit: number | undefined, fallback: number, max = MAX_LIMIT): number {
  if (limit === undefined || !Number.isFinite(limit)) return fallback;
  return Math.max(1, Math.min(max, Math.floor(limit)));
}

export async function resolve(ctx: AnalysisContext, p: CommonParams, defaults: { days?: number; limit?: number } = {}): Promise<Resolved> {
  const site = findSite(ctx.config, p.site);
  const source: SearchSource = p.source ?? 'gsc';
  if (source !== 'gsc' && source !== 'bing') throw new SearchkeepError('bad_request', 'source must be "gsc" or "bing".');
  const notes: string[] = [];
  const now = ctx.now ? ctx.now() : new Date();
  let end: string;
  if (p.end !== undefined) {
    if (!isIsoDate(p.end)) throw new SearchkeepError('bad_request', 'end must be YYYY-MM-DD.');
    end = p.end;
  } else {
    end = (await ctx.store.latestDate(site.id, source)) ?? toIsoDate(new Date(now.getTime() - 86_400_000));
  }
  let start: string;
  if (p.start !== undefined) {
    if (!isIsoDate(p.start)) throw new SearchkeepError('bad_request', 'start must be YYYY-MM-DD.');
    start = p.start;
  } else {
    const days = Math.max(1, Math.min(3660, Math.floor(p.days ?? defaults.days ?? 28)));
    start = addDays(end, -(days - 1));
  }
  let range: DateRange;
  try {
    range = assertRange({ start, end });
  } catch (e) {
    throw new SearchkeepError('bad_request', (e as Error).message);
  }
  if (source === 'bing') {
    // Bing reports weekly buckets; align to whole weeks so comparisons are fair.
    range = { start: weekStart(range.start), end: addDays(weekStart(range.end), 6) };
    notes.push('Bing data is weekly; the date range was aligned to whole weeks (Monday–Sunday).');
  }
  const brand: BrandFilter = p.brand ?? 'all';
  if (brand !== 'all') {
    await classifyBrandQueries(ctx.store, ctx.config, site);
    if (!(site.brandRegex ?? ctx.config.brandRegex)) {
      notes.push('No brand regex is configured (BRAND_REGEX or the site\'s brandRegex), so every query counts as non-brand.');
    }
  }
  return { site, source, range, brand, limit: clampLimit(p.limit, defaults.limit ?? 50), notes };
}

export function metrics(clicks: number, impressions: number, position: number | null): Metrics {
  return {
    clicks,
    impressions,
    ctr: impressions > 0 ? round(clicks / impressions, 4) : 0,
    position: position === null ? null : round(position, 2),
  };
}

export function round(n: number, digits = 2): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

export function pct(n: number): number {
  return round(n * 100, 1);
}

export const ANONYMIZED_NOTE =
  'Google hides anonymized (rare) queries, so totals grouped by query are lower than site totals.';
