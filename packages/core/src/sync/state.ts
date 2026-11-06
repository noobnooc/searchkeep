/**
 * What the sync keeps in the store between runs: cursors, the daily write
 * counter and backoff after failures. Shared by `runSync` (which advances it)
 * and `syncProgress` (which reports it).
 */
import type { SearchkeepConfig } from '../config.js';
import type { Store } from '../store.js';
import type { IsoDate, SourceId } from '../types.js';

/** How many days the Cloudflare GraphQL datasets keep data we backfill from. */
export const CF_CRAWLER_LOOKBACK_DAYS = 30;
export const CF_SEARCH_CRAWLER_LOOKBACK_DAYS = 30;
export const CF_RUM_LOOKBACK_DAYS = 90;
/** GSC: re-pull at least this many recent days to catch late data. */
export const GSC_REPULL_DAYS = 4;
/** GSC: never try to fill gaps further back than this in the daily job. */
export const GSC_MAX_GAP_DAYS = 30;
/** GSC country × device segments of queries and pages (opt-in) keep this much history. */
export const GSC_SEGMENT_MONTHS = 3;
/** Index coverage: a URL is inspected again once its last inspection is this old. */
export const REINSPECT_DAYS = 7;

/**
 * Days per request. Search Console and both Cloudflare datasets answer for a
 * range with one row per day, so one request covers many days. A range that
 * returns too many rows, or that the API refuses, is split (see `shrinkChunk`).
 * Cloudflare's ranges stay inside the datasets' maximum (30 and 93 days).
 */
export const CHUNK_DAYS = { gsc: 30, cfCrawlers: 30, cfRum: 90 } as const;

/**
 * Search Console datasets besides web search, each with its own cursors (so
 * they backfill on their own when a deployment starts syncing them).
 */
export type GscExtraDataset = 'image' | 'video' | 'news' | 'discover' | 'googleNews' | 'appearance' | 'segments';

/** A range is cut to a third when it has to be split: 30 → 10 → 3 → 1 day. */
export const shrinkChunk = (days: number) => Math.max(1, Math.floor(days / 3));

/** Bing datasets; each is one call that returns everything Bing holds. */
export const BING_DATASETS = ['bing.traffic', 'bing.queries', 'bing.pages', 'bing.crawl_issues'] as const;

export const SOURCE_NAMES: Record<SourceId, string> = { gsc: 'Search Console', bing: 'Bing', cloudflare: 'Cloudflare' };

export const syncKeys = {
  /** Today's GSC increment: days still to pull. */
  gscDaily: (site: string) => `gsc:daily:${site}:progress`,
  /** Oldest GSC day pulled; the history backfill walks it back. */
  gscBackfill: (site: string) => `gsc:backfill:${site}`,
  gscSitemaps: (site: string) => `gsc:sitemaps:${site}`,
  /** The same three cursors for the other Search Console datasets (search types, appearance, segments). */
  gscExtraDaily: (dataset: GscExtraDataset, site: string) => `gsc:${dataset}:daily:${site}:progress`,
  gscExtraBackfill: (dataset: GscExtraDataset, site: string) => `gsc:${dataset}:backfill:${site}`,
  gscExtraChunk: (dataset: GscExtraDataset, site: string) => `gsc:${dataset}:chunk:${site}`,
  /** Day the tracked index coverage URLs were last refreshed from the sitemaps. */
  gscIndexUrls: (site: string) => `gsc:index_urls:${site}`,
  /** URL inspections done today: `{ day, done }`. */
  gscInspections: (site: string) => `gsc:inspections:${site}`,
  /** Day a Bing dataset was last refreshed. */
  bing: (dataset: string, site: string) => `${dataset}:${site}`,
  /** Newest Cloudflare AI crawler day synced (moves forward). */
  cfCrawlers: (site: string) => `cf:crawlers:${site}`,
  /** Oldest Cloudflare AI crawler day synced (the lookback walks it back). */
  cfCrawlersFrom: (site: string) => `cf:crawlers:from:${site}`,
  /** Newest and oldest Cloudflare search engine crawler day synced. */
  cfSearchCrawlers: (site: string) => `cf:search_crawlers:${site}`,
  cfSearchCrawlersFrom: (site: string) => `cf:search_crawlers:from:${site}`,
  cfSearchCrawlersChunk: (site: string) => `cf:search_crawlers:chunk:${site}`,
  cfRum: (site: string) => `cf:rum:${site}`,
  cfRumFrom: (site: string) => `cf:rum:from:${site}`,
  /** Days per request, when smaller than the default (stored after a range had to be split). */
  gscChunk: (site: string) => `gsc:chunk:${site}`,
  cfCrawlersChunk: (site: string) => `cf:crawlers:chunk:${site}`,
  cfRumChunk: (site: string) => `cf:rum:chunk:${site}`,
  writes: (day: IsoDate) => `sync:writes:${day}`,
  backoff: 'sync:backoff',
  lastRun: 'sync:last_run',
} as const;

export interface GscDailyProgress {
  day: IsoDate;
  pending: IsoDate[];
  /** The site's first increment has completed (missing in records from older versions). */
  ready?: boolean;
  /** Newest day of the last increment that completed: the next day's increment starts after it at the latest. */
  through?: IsoDate;
}

export interface LastRunMeta {
  at: string;
  status: string;
  rowsWritten: number;
  message?: string | null;
}

/**
 * Work that is paused after a failure. Keys are `source:<source>` when an API
 * rate-limited us (every site waits) and `task:<task>|<site>` after an error.
 */
export interface Backoff {
  until: string;
  failures: number;
  reason: string;
}
export type BackoffMap = Record<string, Backoff>;

export const sourceBackoffKey = (source: SourceId) => `source:${source}`;
export const taskBackoffKey = (task: string, siteId: string) => `task:${task}|${siteId}`;

/** After a rate limit: 30 min, doubling to 8 h, unless the API said how long. */
const RATE_LIMIT_BASE_MS = 30 * 60_000;
const RATE_LIMIT_MAX_MS = 8 * 3_600_000;
/** After an error: 10 min, doubling to 6 h. */
const ERROR_BASE_MS = 10 * 60_000;
const ERROR_MAX_MS = 6 * 3_600_000;

export function rateLimitDelay(failures: number, retryAfterMs: number | null): number {
  if (retryAfterMs !== null && retryAfterMs > 0) return Math.min(Math.max(retryAfterMs, 60_000), 24 * 3_600_000);
  return Math.min(RATE_LIMIT_BASE_MS * 2 ** Math.max(0, failures - 1), RATE_LIMIT_MAX_MS);
}

export function errorDelay(failures: number): number {
  return Math.min(ERROR_BASE_MS * 2 ** Math.max(0, failures - 1), ERROR_MAX_MS);
}

/** The entry when it still applies at `nowMs`. */
export function activeBackoff(entry: Backoff | undefined, nowMs: number): Backoff | null {
  return entry && Date.parse(entry.until) > nowMs ? entry : null;
}

/** Drops task entries of sites that are no longer configured. */
export function pruneBackoff(map: BackoffMap, config: SearchkeepConfig): BackoffMap {
  const ids = new Set(config.sites.map((s) => s.id));
  return Object.fromEntries(
    Object.entries(map).filter(([k]) => {
      if (!k.startsWith('task:')) return true;
      const site = k.slice(k.lastIndexOf('|') + 1);
      return ids.has(site);
    }),
  );
}

export function parseJson<T>(value: string | null | undefined): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

/** Every cursor the sync keeps, in three range reads instead of a few reads per site. */
export async function loadSyncMeta(store: Store): Promise<Record<string, string>> {
  const parts = await Promise.all([store.listMeta('gsc:'), store.listMeta('bing.'), store.listMeta('cf:')]);
  return Object.assign({}, ...parts) as Record<string, string>;
}

/** `14:30 UTC` today, `Oct 21, 02:30 UTC` on another day. */
export function formatUntil(iso: string, today: IsoDate): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const time = `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')} UTC`;
  if (iso.slice(0, 10) === today) return time;
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()];
  return `${month} ${d.getUTCDate()}, ${time}`;
}
