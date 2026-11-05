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
export const CF_RUM_LOOKBACK_DAYS = 90;
/** GSC: re-pull at least this many recent days to catch late data. */
export const GSC_REPULL_DAYS = 4;
/** GSC: never try to fill gaps further back than this in the daily job. */
export const GSC_MAX_GAP_DAYS = 30;

/** Bing datasets; each is one call that returns everything Bing holds. */
export const BING_DATASETS = ['bing.traffic', 'bing.queries', 'bing.pages', 'bing.crawl_issues'] as const;

export const SOURCE_NAMES: Record<SourceId, string> = { gsc: 'Search Console', bing: 'Bing', cloudflare: 'Cloudflare' };

export const syncKeys = {
  /** Today's GSC increment: days still to pull. */
  gscDaily: (site: string) => `gsc:daily:${site}:progress`,
  /** Oldest GSC day pulled; the history backfill walks it back. */
  gscBackfill: (site: string) => `gsc:backfill:${site}`,
  gscSitemaps: (site: string) => `gsc:sitemaps:${site}`,
  /** Day a Bing dataset was last refreshed. */
  bing: (dataset: string, site: string) => `${dataset}:${site}`,
  /** Newest Cloudflare AI crawler day synced (moves forward). */
  cfCrawlers: (site: string) => `cf:crawlers:${site}`,
  /** Oldest Cloudflare AI crawler day synced (the lookback walks it back). */
  cfCrawlersFrom: (site: string) => `cf:crawlers:from:${site}`,
  cfRum: (site: string) => `cf:rum:${site}`,
  cfRumFrom: (site: string) => `cf:rum:from:${site}`,
  writes: (day: IsoDate) => `sync:writes:${day}`,
  backoff: 'sync:backoff',
  lastRun: 'sync:last_run',
} as const;

export interface GscDailyProgress {
  day: IsoDate;
  pending: IsoDate[];
  /** The site's first increment has completed (missing in records from older versions). */
  ready?: boolean;
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
