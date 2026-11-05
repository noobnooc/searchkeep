/**
 * How far the sync has come, per site and dataset, from the cursors the sync
 * keeps. Cheap to compute (a handful of reads), so the dashboard can poll it.
 */
import type { SearchkeepConfig } from '../config.js';
import { addDays, addMonths, toIsoDate } from '../dates.js';
import type { SourceClients } from '../sources.js';
import type { Store } from '../store.js';
import type { IsoDate, SiteConfig, SourceId } from '../types.js';
import {
  activeBackoff,
  BING_DATASETS,
  CF_CRAWLER_LOOKBACK_DAYS,
  CF_RUM_LOOKBACK_DAYS,
  CF_SEARCH_CRAWLER_LOOKBACK_DAYS,
  loadSyncMeta,
  parseJson,
  syncKeys,
  taskBackoffKey,
  type BackoffMap,
  type GscDailyProgress,
  type LastRunMeta,
} from './state.js';

/**
 * - `waiting`: nothing synced yet.
 * - `recent`: the latest days are still coming in.
 * - `history`: the latest days are in; older history is still being filled.
 * - `done`: everything that can be synced is in.
 */
export type SyncPhase = 'waiting' | 'recent' | 'history' | 'done';
export type SyncDataset = 'gsc' | 'bing' | 'ai_crawlers' | 'search_crawlers' | 'web_analytics';

export interface DatasetProgress {
  dataset: SyncDataset;
  source: SourceId;
  /** `error` and `paused` win over the others; see `message` and `retryAt`. */
  state: 'waiting' | 'syncing' | 'paused' | 'error' | 'done';
  /** The latest days are in. */
  recent: boolean;
  /** Everything in the window is in. */
  complete: boolean;
  /** Share of the window synced, 0–100. */
  percent: number;
  /** Oldest day synced, when known. */
  from: IsoDate | null;
  /** Oldest day the window reaches back to (null for Bing, which sends everything at once). */
  target: IsoDate | null;
  message?: string;
  retryAt?: string;
}

export interface SiteSyncProgress {
  siteId: string;
  domain: string;
  phase: SyncPhase;
  datasets: DatasetProgress[];
}

export interface SyncProgressReport {
  checkedAt: string;
  phase: SyncPhase;
  summary: {
    sites: number;
    /** Sites whose latest days are in for every dataset. */
    sitesWithRecentData: number;
    /** History synced across all sites and datasets, weighted by the API calls each needs, 0–100. */
    historyPercent: number;
    /** Datasets that failed and wait to be retried. */
    issues: number;
  };
  /** Sources paused for every site after a rate limit. */
  paused: Array<{ source: SourceId; until: string; reason: string }>;
  /** Rows written today; history (not the daily increments) waits for tomorrow once `reached`. */
  writeBudget: { used: number; limit: number; reached: boolean };
  lastRun: LastRunMeta | null;
  sites: SiteSyncProgress[];
}

export interface ProgressContext {
  store: Store;
  config: SearchkeepConfig;
  clients: SourceClients;
  now?: () => Date;
}

const TASKS: Record<SyncDataset, string[]> = {
  gsc: ['gsc.search_analytics', 'gsc.backfill', 'gsc.sitemaps'],
  bing: [...BING_DATASETS],
  ai_crawlers: ['cloudflare.ai_crawlers'],
  search_crawlers: ['cloudflare.search_crawlers'],
  web_analytics: ['cloudflare.web_analytics'],
};

const DAY_MS = 86_400_000;
const days = (from: IsoDate, to: IsoDate) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
const clampPct = (n: number) => Math.max(0, Math.min(100, Math.round(n * 10) / 10));

export async function syncProgress(ctx: ProgressContext): Promise<SyncProgressReport> {
  const { store, config, clients } = ctx;
  const now = ctx.now ? ctx.now() : new Date();
  const nowMs = now.getTime();
  const today = toIsoDate(now);
  const yesterday = addDays(today, -1);
  const [meta, backoffRaw, writesRaw, lastRunRaw] = await Promise.all([
    loadSyncMeta(store),
    store.getMeta(syncKeys.backoff),
    store.getMeta(syncKeys.writes(today)),
    store.getMeta(syncKeys.lastRun),
  ]);
  const backoff = parseJson<BackoffMap>(backoffRaw) ?? {};
  const get = (key: string): string | null => meta[key] ?? null;
  const callsPerGscDay = 2 + Math.ceil(config.gsc.rowsPerDay / 25_000);

  const pausedSources = new Map<SourceId, { until: string; reason: string }>();
  for (const [key, entry] of Object.entries(backoff)) {
    if (!key.startsWith('source:') || !activeBackoff(entry, nowMs)) continue;
    pausedSources.set(key.slice('source:'.length) as SourceId, { until: entry.until, reason: entry.reason });
  }

  let weightTotal = 0;
  let weightDone = 0;
  let issues = 0;

  const finish = (
    site: SiteConfig,
    p: Omit<DatasetProgress, 'state' | 'message' | 'retryAt'> & { started: boolean },
    weight: number,
  ): DatasetProgress => {
    const { started, ...rest } = p;
    weightTotal += weight;
    weightDone += (weight * rest.percent) / 100;
    const issue = TASKS[rest.dataset].map((t) => backoff[taskBackoffKey(t, site.id)]).find(Boolean);
    const pause = rest.complete ? undefined : pausedSources.get(rest.source);
    if (issue) {
      issues++;
      return { ...rest, state: 'error', message: issue.reason, retryAt: issue.until };
    }
    if (rest.complete) return { ...rest, state: 'done' };
    if (pause) return { ...rest, state: 'paused', message: pause.reason, retryAt: pause.until };
    return { ...rest, state: started ? 'syncing' : 'waiting' };
  };

  /** Cloudflare datasets: a forward cursor (newest day) and a lookback cursor (oldest day). */
  const cloudflare = (site: SiteConfig, dataset: SyncDataset, lastKey: string, fromKey: string, lookbackDays: number, calls: number) => {
    const floor = addDays(today, -lookbackDays);
    const last = get(lastKey);
    // Without a lookback cursor (older versions) the window was synced forward from its start.
    const from = get(fromKey) ?? (last ? floor : null);
    const lo = from && from > floor ? from : floor;
    const hi = last && last < yesterday ? last : yesterday;
    const covered = last && from ? Math.max(0, days(lo, hi) + 1) : 0;
    const recent = Boolean(last && last >= addDays(yesterday, -2));
    const complete = recent && Boolean(from && from <= floor);
    return finish(
      site,
      {
        dataset,
        source: 'cloudflare',
        recent,
        complete,
        percent: complete ? 100 : clampPct((covered / lookbackDays) * 100),
        from: last ? from : null,
        target: floor,
        started: Boolean(last),
      },
      lookbackDays * calls,
    );
  };

  const sites: SiteSyncProgress[] = config.sites.map((site) => {
    const datasets: DatasetProgress[] = [];

    if (clients.gsc && site.gscProperty) {
      const progress = parseJson<GscDailyProgress>(get(syncKeys.gscDaily(site.id)));
      const cursor = get(syncKeys.gscBackfill(site.id));
      const target = addMonths(today, -config.sync.backfillMonths);
      const recent = progress ? (progress.ready ?? (progress.day !== today || progress.pending.length === 0)) : false;
      const window = Math.max(1, days(target, yesterday));
      const covered = cursor ? Math.min(window, Math.max(0, days(cursor, yesterday))) : 0;
      const historyDone = Boolean(cursor && cursor <= target);
      datasets.push(
        finish(
          site,
          {
            dataset: 'gsc',
            source: 'gsc',
            recent,
            complete: recent && historyDone,
            percent: historyDone ? 100 : clampPct((covered / window) * 100),
            from: recent ? cursor : null,
            target,
            started: Boolean(progress),
          },
          window * callsPerGscDay,
        ),
      );
    }

    if (clients.bing && site.bingSiteUrl) {
      const done = BING_DATASETS.filter((name) => get(syncKeys.bing(name, site.id))).length;
      const complete = done === BING_DATASETS.length;
      datasets.push(
        finish(
          site,
          {
            dataset: 'bing',
            source: 'bing',
            recent: complete,
            complete,
            percent: clampPct((done / BING_DATASETS.length) * 100),
            from: null,
            target: null,
            started: done > 0,
          },
          BING_DATASETS.length,
        ),
      );
    }

    if (clients.cloudflare && site.cloudflareZoneId) {
      datasets.push(
        cloudflare(site, 'ai_crawlers', syncKeys.cfCrawlers(site.id), syncKeys.cfCrawlersFrom(site.id), CF_CRAWLER_LOOKBACK_DAYS, 1),
        cloudflare(
          site,
          'search_crawlers',
          syncKeys.cfSearchCrawlers(site.id),
          syncKeys.cfSearchCrawlersFrom(site.id),
          CF_SEARCH_CRAWLER_LOOKBACK_DAYS,
          1,
        ),
      );
    }
    if (clients.cloudflare && site.webAnalyticsSiteTag && config.cloudflare.accountId) {
      datasets.push(cloudflare(site, 'web_analytics', syncKeys.cfRum(site.id), syncKeys.cfRumFrom(site.id), CF_RUM_LOOKBACK_DAYS, 2));
    }

    return { siteId: site.id, domain: site.domain, phase: phaseOf(datasets), datasets };
  });

  const used = Number(writesRaw ?? '0') || 0;
  return {
    checkedAt: now.toISOString(),
    phase: overallPhase(sites.map((s) => s.phase)),
    summary: {
      sites: sites.length,
      sitesWithRecentData: sites.filter((s) => s.phase === 'history' || s.phase === 'done').length,
      historyPercent: weightTotal === 0 ? 100 : clampPct((weightDone / weightTotal) * 100),
      issues,
    },
    paused: [...pausedSources].map(([source, p]) => ({ source, ...p })),
    writeBudget: { used, limit: config.sync.dailyWriteBudget, reached: used >= config.sync.dailyWriteBudget },
    lastRun: parseJson<LastRunMeta>(lastRunRaw),
    sites,
  };
}

function phaseOf(all: DatasetProgress[]): SyncPhase {
  // Paused and failing datasets are reported on their own (paused, issues); they do not hold
  // the site back once the others are in. Bing can be paused for days (ThrottleIP).
  const healthy = all.filter((d) => d.state !== 'paused' && d.state !== 'error');
  const datasets = healthy.length > 0 ? healthy : all;
  if (datasets.every((d) => d.complete)) return 'done';
  if (datasets.every((d) => d.recent)) return 'history';
  if (datasets.some((d) => d.recent || d.percent > 0 || d.state === 'syncing')) return 'recent';
  return 'waiting';
}

function overallPhase(phases: SyncPhase[]): SyncPhase {
  if (phases.every((p) => p === 'done')) return 'done';
  if (phases.every((p) => p === 'done' || p === 'history')) return 'history';
  if (phases.some((p) => p !== 'waiting')) return 'recent';
  return 'waiting';
}
