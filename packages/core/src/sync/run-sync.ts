import type { SearchkeepConfig } from '../config.js';
import { classifyBrandQueries } from '../brand.js';
import { AI_CRAWLERS, classifyCrawler } from '../crawlers.js';
import { addDays, addMonths, toIsoDate } from '../dates.js';
import { safeMessage } from '../errors.js';
import { isRateLimited } from '../http.js';
import type { SourceClients } from '../sources.js';
import type { Store } from '../store.js';
import type { CrawlerRequestInput, IsoDate, SearchFactInput, SourceId, SyncRunRecord, SyncTaskResult } from '../types.js';
import { normalizePage } from '../url.js';
import {
  activeBackoff,
  BING_DATASETS,
  CF_CRAWLER_LOOKBACK_DAYS,
  CF_RUM_LOOKBACK_DAYS,
  errorDelay,
  formatUntil,
  GSC_MAX_GAP_DAYS,
  GSC_REPULL_DAYS,
  loadSyncMeta,
  parseJson,
  pruneBackoff,
  rateLimitDelay,
  SOURCE_NAMES,
  sourceBackoffKey,
  syncKeys,
  taskBackoffKey,
  type BackoffMap,
  type GscDailyProgress,
  type LastRunMeta,
} from './state.js';

/** D1 key that records "readiness reached `ready`"; cron syncs only while it is set. */
export const READY_FLAG_KEY = 'readiness:ready';

export interface SyncContext {
  store: Store;
  config: SearchkeepConfig;
  clients: SourceClients;
  trigger: 'cron' | 'manual';
  now?: Date;
  /** Wall-clock budget for this invocation. */
  timeBudgetMs?: number;
  /** Minimum gap between two calls to the same source, in ms. Defaults to `DEFAULT_PACING`. */
  pacing?: Partial<Record<SourceId, number>>;
  log?: (msg: string) => void;
}

/**
 * Bing throttles quickly (it answers `ThrottleUser`), and each of its calls
 * returns everything it holds, so its calls are spaced out and capped per run.
 */
export const DEFAULT_PACING: Partial<Record<SourceId, number>> = { bing: 1_000 };
export const SOURCE_CALLS_PER_RUN: Partial<Record<SourceId, number>> = { bing: 8 };

/** GSC history days planned per site and run (more than one run can take; the rest is planned next run). */
const GSC_HISTORY_DAYS_PER_RUN = 60;

interface Unit {
  task: string;
  siteId: string;
  source: SourceId;
  /** History work (GSC backfill, Cloudflare lookback): runs after every increment and stops at the daily write budget. */
  backfill: boolean;
  /** The day a history unit pulls; history runs newest first across all sites. */
  date?: IsoDate;
  /** Upper bound of API calls this unit makes. */
  calls: number;
  /** Stable id used to detect invocations killed mid-unit (e.g. CPU limit). */
  key: string;
  run: () => Promise<number>;
  /** Advances past this unit without running it. */
  skip: () => Promise<void>;
}

/** Units interrupted this many times in a row are skipped so sync never gets stuck. */
const MAX_INTERRUPTED_ATTEMPTS = 3;
const INFLIGHT_KEY = 'sync:inflight';

class BudgetExceeded extends Error {}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * One sync pass. Safe to call often (the Worker runs it every 15 minutes):
 * it does whatever work is due, within call, time and write budgets, and keeps
 * its progress in the store so the next invocation continues where this one
 * stopped.
 *
 * Order: the latest days of every site first (round-robin over sites, so one
 * site never waits for all the others), then history for all sites and
 * sources together, newest day first. A source that rate-limits us is paused
 * for every site with a growing backoff; a task that fails is retried later
 * with a growing backoff. Neither stops the other sources.
 */
export async function runSync(ctx: SyncContext): Promise<SyncRunRecord> {
  const now = ctx.now ?? new Date();
  const nowMs = now.getTime();
  const today = toIsoDate(now);
  const started = Date.now();
  const timeBudget = ctx.timeBudgetMs ?? 25_000;
  const pacing = ctx.pacing ?? DEFAULT_PACING;
  const { store, config } = ctx;

  await store.syncSites(config.sites);
  const runId = await store.startSyncRun({ startedAt: now.toISOString(), trigger: ctx.trigger, status: 'running', rowsWritten: 0 });

  const writesKey = syncKeys.writes(today);
  let writesToday = Number((await store.getMeta(writesKey)) ?? '0') || 0;
  let callsLeft = config.sync.maxCallsPerRun;
  let rowsWritten = 0;
  const results = new Map<string, SyncTaskResult>();
  const failedTasks = new Set<string>();
  const sourceCalls = new Map<SourceId, number>();
  const lastCallAt = new Map<SourceId, number>();
  /** Sources paused by a rate limit (until when), tasks waiting after errors, sources at their per-run cap. */
  const paused = new Map<SourceId, string>();
  const waiting = new Set<string>();
  const capped = new Set<SourceId>();

  const record = (u: Unit, status: SyncTaskResult['status'], rows: number, message?: string) => {
    const key = `${u.task}|${u.siteId}`;
    const prev = results.get(key);
    if (prev) {
      prev.rowsWritten += rows;
      if (status === 'error') prev.status = 'error';
      if (message) prev.message = message;
    } else {
      results.set(key, { task: u.task, siteId: u.siteId, source: u.source, status, rowsWritten: rows, ...(message ? { message } : {}) });
    }
  };

  const storedBackoff = parseJson<BackoffMap>(await store.getMeta(syncKeys.backoff)) ?? {};
  const backoff = pruneBackoff(storedBackoff, config);
  let backoffDirty = Object.keys(backoff).length !== Object.keys(storedBackoff).length;
  const saveBackoff = async () => {
    if (!backoffDirty) return;
    backoffDirty = false;
    if (Object.keys(backoff).length) await store.setMeta(syncKeys.backoff, JSON.stringify(backoff));
    else await store.deleteMeta(syncKeys.backoff);
  };
  const clearBackoff = (key: string) => {
    if (backoff[key]) {
      delete backoff[key];
      backoffDirty = true;
    }
  };

  let stoppedFor: string | null = null;
  let inflight = parseJson<{ key: string; attempts: number }>(await store.getMeta(INFLIGHT_KEY));
  try {
    await saveBackoff();
    // A unit that turns out to need fewer calls than planned hands the rest back.
    const refund = (source: SourceId, calls: number) => {
      callsLeft += calls;
      sourceCalls.set(source, Math.max(0, (sourceCalls.get(source) ?? 0) - calls));
    };
    const retried = new Set<SourceId>();
    const units = await planUnits(ctx, today, refund);
    for (const unit of units) {
      const taskKey = `${unit.task}|${unit.siteId}`;
      if (failedTasks.has(taskKey)) continue;
      const cooling = activeBackoff(backoff[sourceBackoffKey(unit.source)], nowMs);
      // "Sync now" tries a paused source once: the limit may have lifted, and Bing's
      // ThrottleIP depends on the egress IP, which differs between locations.
      if (cooling && !(ctx.trigger === 'manual' && !retried.has(unit.source))) {
        paused.set(unit.source, cooling.until);
        continue;
      }
      if (cooling) retried.add(unit.source);
      // "Sync now" retries failed tasks right away; the cron waits out their backoff.
      if (ctx.trigger === 'cron' && activeBackoff(backoff[taskBackoffKey(unit.task, unit.siteId)], nowMs)) {
        waiting.add(taskKey);
        continue;
      }
      if (Date.now() - started > timeBudget) {
        stoppedFor = 'time budget reached';
        break;
      }
      if (unit.calls > callsLeft) {
        stoppedFor = 'API call budget reached';
        break;
      }
      const cap = SOURCE_CALLS_PER_RUN[unit.source];
      if (cap !== undefined && (sourceCalls.get(unit.source) ?? 0) + unit.calls > cap) {
        capped.add(unit.source);
        continue;
      }
      if (unit.backfill && writesToday >= config.sync.dailyWriteBudget) {
        stoppedFor = 'daily write budget reached';
        continue;
      }
      if (inflight && inflight.key === unit.key && inflight.attempts >= MAX_INTERRUPTED_ATTEMPTS) {
        await unit.skip();
        await store.deleteMeta(INFLIGHT_KEY);
        inflight = null;
        record(
          unit,
          'error',
          0,
          `Skipped ${unit.key} after ${MAX_INTERRUPTED_ATTEMPTS} interrupted attempts (likely the Worker CPU limit; lower GSC_ROWS_PER_DAY).`,
        );
        continue;
      }
      const gap = pacing[unit.source] ?? 0;
      const last = lastCallAt.get(unit.source);
      if (gap > 0 && last !== undefined && last + gap > Date.now()) await sleep(last + gap - Date.now());

      const attempts = inflight && inflight.key === unit.key ? inflight.attempts + 1 : 1;
      await store.setMeta(INFLIGHT_KEY, JSON.stringify({ key: unit.key, attempts }));
      inflight = { key: unit.key, attempts };
      callsLeft -= unit.calls;
      sourceCalls.set(unit.source, (sourceCalls.get(unit.source) ?? 0) + unit.calls);
      try {
        const rows = await unit.run();
        rowsWritten += rows;
        writesToday += rows;
        record(unit, 'ok', rows);
        await store.deleteMeta(INFLIGHT_KEY);
        inflight = null;
        clearBackoff(taskBackoffKey(unit.task, unit.siteId));
        clearBackoff(sourceBackoffKey(unit.source));
        await saveBackoff();
      } catch (err) {
        await store.deleteMeta(INFLIGHT_KEY);
        inflight = null;
        if (err instanceof BudgetExceeded) {
          stoppedFor = 'API call budget reached';
          break;
        }
        const message = safeMessage(err);
        ctx.log?.(`sync ${unit.task} ${unit.siteId}: ${message}`);
        if (isRateLimited(err)) {
          // Pause the whole source: every other call to it would be refused too.
          const key = sourceBackoffKey(unit.source);
          const failures = (backoff[key]?.failures ?? 0) + 1;
          const until = new Date(nowMs + rateLimitDelay(failures, err.retryAfterMs)).toISOString();
          backoff[key] = { until, failures, reason: message };
          backoffDirty = true;
          await saveBackoff();
          paused.set(unit.source, until);
          const name = SOURCE_NAMES[unit.source];
          record(
            unit,
            'skipped',
            0,
            `Rate limited by ${name}; ${name} is paused until ${formatUntil(until, today)}, then continues on its own.`,
          );
          continue;
        }
        failedTasks.add(taskKey);
        record(unit, 'error', 0, message);
        const key = taskBackoffKey(unit.task, unit.siteId);
        const failures = (backoff[key]?.failures ?? 0) + 1;
        backoff[key] = { until: new Date(nowMs + errorDelay(failures)).toISOString(), failures, reason: message };
        backoffDirty = true;
        await saveBackoff();
      } finally {
        lastCallAt.set(unit.source, Date.now());
      }
    }

    for (const site of config.sites) {
      await classifyBrandQueries(store, config, site);
    }

    await store.setMeta(writesKey, String(writesToday));
    const details = [...results.values()];
    const anyError = details.some((d) => d.status === 'error');
    const anyOk = details.some((d) => d.status === 'ok');
    const notes: string[] = [];
    if (stoppedFor) notes.push(`Stopped early: ${stoppedFor}; continues next run.`);
    for (const [source, until] of paused) {
      notes.push(`${SOURCE_NAMES[source]} is paused until ${formatUntil(until, today)} (rate limited); other sources continue.`);
    }
    for (const source of capped) {
      if (!paused.has(source)) notes.push(`More ${SOURCE_NAMES[source]} calls are spread over the next runs to stay under its rate limit.`);
    }
    if (waiting.size) notes.push(`${waiting.size} failed ${waiting.size === 1 ? 'task waits' : 'tasks wait'} to be retried.`);
    const status: SyncRunRecord['status'] =
      details.length === 0
        ? 'skipped'
        : anyError
          ? anyOk
            ? 'partial'
            : 'error'
          : stoppedFor || paused.size || capped.size || waiting.size
            ? 'partial'
            : 'ok';
    const message = notes.length ? notes.join(' ') : details.length === 0 ? 'Nothing due.' : null;
    const patch: Partial<SyncRunRecord> = { finishedAt: new Date().toISOString(), status, rowsWritten, message, details };
    await store.finishSyncRun(runId, patch);
    const lastRun: LastRunMeta = { at: patch.finishedAt!, status, rowsWritten, message };
    await store.setMeta(syncKeys.lastRun, JSON.stringify(lastRun));
    return { id: runId, startedAt: now.toISOString(), trigger: ctx.trigger, ...patch, status, rowsWritten } as SyncRunRecord;
  } catch (err) {
    const message = safeMessage(err);
    await store.finishSyncRun(runId, {
      finishedAt: new Date().toISOString(),
      status: 'error',
      rowsWritten,
      message,
      details: [...results.values()],
    });
    throw err;
  }
}

/** Round-robin: the first unit of every list, then the second of every list, and so on. */
function interleave<T>(lists: T[][]): T[] {
  const out: T[] = [];
  const longest = lists.reduce((m, l) => Math.max(m, l.length), 0);
  for (let i = 0; i < longest; i++) for (const l of lists) if (i < l.length) out.push(l[i]!);
  return out;
}

async function planUnits(ctx: SyncContext, today: IsoDate, refund: (source: SourceId, calls: number) => void): Promise<Unit[]> {
  const { config, clients, store } = ctx;
  const meta = await loadSyncMeta(store);
  const get = (key: string): string | null => meta[key] ?? null;
  const increments: Unit[][] = [];
  const history: Unit[] = [];
  const yesterday = addDays(today, -1);

  for (const site of config.sites) {
    const daily: Unit[] = [];
    increments.push(daily);

    // ---------------- Google Search Console ----------------
    if (clients.gsc && site.gscProperty) {
      const gsc = clients.gsc;
      const property = site.gscProperty;
      const rowsPerDay = config.gsc.rowsPerDay;

      const pullDay = async (date: IsoDate): Promise<number> => {
        let written = 0;
        const totals = await gsc.searchAnalytics({ property, startDate: date, endDate: date, dimensions: ['date'], rowLimit: 10 });
        // No totals: no impressions that day (or not final yet), so the other breakdowns are empty too.
        // Common for the latest days (GSC lags 2-3 days) and for small sites; saves two calls per day.
        if (totals.length === 0) {
          refund('gsc', callsPerDay - 1);
          return 0;
        }
        written += await store.writeSearchFacts(
          site.id,
          'gsc',
          totals.map((r) => ({ date: r.keys[0]!, kind: 'total', clicks: r.clicks, impressions: r.impressions, position: r.position })),
        );
        const breakdowns = await gsc.searchAnalytics({
          property,
          startDate: date,
          endDate: date,
          dimensions: ['date', 'country', 'device'],
          rowLimit: 25_000,
        });
        written += await store.writeBreakdowns(
          site.id,
          'gsc',
          breakdowns.map((r) => ({
            date: r.keys[0]!,
            country: r.keys[1]!,
            device: r.keys[2]!,
            clicks: r.clicks,
            impressions: r.impressions,
            position: r.position,
          })),
        );
        const facts: SearchFactInput[] = [];
        for (let startRow = 0; startRow < rowsPerDay; startRow += 25_000) {
          const rowLimit = Math.min(25_000, rowsPerDay - startRow);
          const rows = await gsc.searchAnalytics({
            property,
            startDate: date,
            endDate: date,
            dimensions: ['date', 'query', 'page'],
            rowLimit,
            startRow,
          });
          for (const r of rows) {
            facts.push({
              date: r.keys[0]!,
              kind: 'query_page',
              query: r.keys[1]!,
              page: normalizePage(r.keys[2]!, site.domain),
              clicks: r.clicks,
              impressions: r.impressions,
              position: r.position,
            });
          }
          if (rows.length < rowLimit) break;
        }
        written += await store.writeSearchFacts(site.id, 'gsc', facts);
        return written;
      };
      const callsPerDay = 2 + Math.ceil(rowsPerDay / 25_000);

      // Daily increment: re-pull the most recent days plus any recent gap.
      const progressKey = syncKeys.gscDaily(site.id);
      const backfillKey = syncKeys.gscBackfill(site.id);
      const progress = parseJson<GscDailyProgress>(get(progressKey));
      let pending: IsoDate[];
      let ready: boolean;
      if (progress && progress.day === today) {
        pending = progress.pending;
        ready = progress.ready ?? pending.length === 0;
      } else {
        const latest = await store.latestDate(site.id, 'gsc');
        let start = addDays(today, -GSC_REPULL_DAYS);
        if (latest && addDays(latest, -3) < start) start = addDays(latest, -3);
        const floor = addDays(today, -GSC_MAX_GAP_DAYS);
        if (start < floor) start = floor;
        pending = [];
        for (let d = yesterday; d >= start; d = addDays(d, -1)) pending.push(d);
        // A site that synced on an earlier day had its first increment then (older records carry no flag).
        ready = progress ? (progress.ready ?? true) : false;
        await store.setMeta(progressKey, JSON.stringify({ day: today, pending, ready } satisfies GscDailyProgress));
        // The backfill cursor starts where the first increment begins.
        if (!get(backfillKey)) {
          await store.setMeta(backfillKey, start);
          meta[backfillKey] = start;
        }
      }
      for (const date of [...pending]) {
        const done = async () => {
          pending = pending.filter((d) => d !== date);
          if (pending.length === 0) ready = true;
          await store.setMeta(progressKey, JSON.stringify({ day: today, pending, ready } satisfies GscDailyProgress));
        };
        daily.push({
          task: 'gsc.search_analytics',
          siteId: site.id,
          source: 'gsc',
          backfill: false,
          calls: callsPerDay,
          key: `gsc.daily:${site.id}:${date}`,
          run: async () => {
            const n = await pullDay(date);
            await done();
            return n;
          },
          skip: () => done(),
        });
      }

      // Sitemaps snapshot once a day.
      if (get(syncKeys.gscSitemaps(site.id)) !== today) {
        daily.push({
          task: 'gsc.sitemaps',
          siteId: site.id,
          source: 'gsc',
          backfill: false,
          calls: 1,
          key: `gsc.sitemaps:${site.id}:${today}`,
          run: async () => {
            const maps = await gsc.listSitemaps(property);
            const n = await store.replaceSitemaps(site.id, 'gsc', maps);
            await store.setMeta(syncKeys.gscSitemaps(site.id), today);
            return n;
          },
          skip: () => store.setMeta(syncKeys.gscSitemaps(site.id), today),
        });
      }

      // History backfill, newest to oldest, one day per unit.
      const target = addMonths(today, -config.sync.backfillMonths);
      const cursor = get(backfillKey);
      if (cursor && cursor > target) {
        let c = cursor;
        for (let i = 0; i < GSC_HISTORY_DAYS_PER_RUN && addDays(c, -1) >= target; i++) {
          const date = addDays(c, -1);
          history.push({
            task: 'gsc.backfill',
            siteId: site.id,
            source: 'gsc',
            backfill: true,
            date,
            calls: callsPerDay,
            key: `gsc.backfill:${site.id}:${date}`,
            run: async () => {
              const n = await pullDay(date);
              await store.setMeta(backfillKey, date);
              return n;
            },
            skip: () => store.setMeta(backfillKey, date),
          });
          c = date;
        }
      }
    }

    // ---------------- Bing Webmaster Tools ----------------
    if (clients.bing && site.bingSiteUrl) {
      const bing = clients.bing;
      const siteUrl = site.bingSiteUrl;
      const pull: Record<(typeof BING_DATASETS)[number], () => Promise<number>> = {
        'bing.traffic': async () => {
          const rows = await bing.getRankAndTrafficStats(siteUrl);
          return store.writeSearchFacts(
            site.id,
            'bing',
            rows.map((r) => ({ date: r.date, kind: 'total', clicks: r.clicks, impressions: r.impressions })),
          );
        },
        'bing.queries': async () => {
          const rows = await bing.getQueryStats(siteUrl);
          return store.writeSearchFacts(
            site.id,
            'bing',
            rows.map((r) => ({
              date: r.date,
              kind: 'query',
              query: r.query,
              clicks: r.clicks,
              impressions: r.impressions,
              position: r.avgImpressionPosition,
            })),
          );
        },
        'bing.pages': async () => {
          const rows = await bing.getPageStats(siteUrl);
          return store.writeSearchFacts(
            site.id,
            'bing',
            rows.map((r) => ({
              date: r.date,
              kind: 'page',
              page: normalizePage(r.page, site.domain),
              clicks: r.clicks,
              impressions: r.impressions,
              position: r.avgImpressionPosition,
            })),
          );
        },
        'bing.crawl_issues': async () => {
          const rows = await bing.getCrawlIssues(siteUrl);
          return store.replaceCrawlIssues(
            site.id,
            'bing',
            rows.map((r) => ({ url: r.url, issue: r.issue, httpCode: r.httpCode, detectedAt: today })),
          );
        },
      };
      for (const name of BING_DATASETS) {
        const key = syncKeys.bing(name, site.id);
        if (get(key) === today) continue;
        daily.push({
          task: name,
          siteId: site.id,
          source: 'bing',
          backfill: false,
          calls: 1,
          key: `${name}:${site.id}:${today}`,
          run: async () => {
            const n = await pull[name]();
            await store.setMeta(key, today);
            return n;
          },
          skip: () => store.setMeta(key, today),
        });
      }
    }

    // ---------------- Cloudflare ----------------
    // Each dataset keeps two cursors: the newest day synced moves forward with
    // the daily increments, the oldest day synced moves back with the lookback
    // (history). A new site gets yesterday first, then the lookback.
    const cloudflareDays = (opts: {
      task: string;
      lookbackDays: number;
      calls: number;
      lastKey: string;
      fromKey: string;
      pull: (date: IsoDate) => Promise<number>;
    }) => {
      const floor = addDays(today, -opts.lookbackDays);
      const last = get(opts.lastKey);
      const from = get(opts.fromKey);
      const fresh = !last;
      const unit = (date: IsoDate, isHistory: boolean, advance: () => Promise<void>): Unit => ({
        task: opts.task,
        siteId: site.id,
        source: 'cloudflare',
        backfill: isHistory,
        ...(isHistory ? { date } : {}),
        calls: opts.calls,
        key: `${opts.task}:${site.id}:${date}`,
        skip: advance,
        run: async () => {
          const n = await opts.pull(date);
          await advance();
          return n;
        },
      });
      let d = last ? addDays(last, 1) : yesterday;
      if (d < floor) d = floor;
      for (; d <= yesterday; d = addDays(d, 1)) {
        const date = d;
        daily.push(
          unit(date, false, async () => {
            await store.setMeta(opts.lastKey, date);
            if (fresh && !(await store.getMeta(opts.fromKey))) await store.setMeta(opts.fromKey, date);
          }),
        );
      }
      // Deployments from before the lookback cursor existed synced the window forward, so they have no lookback left.
      const lookbackFrom = from ?? (fresh ? yesterday : null);
      if (lookbackFrom) {
        for (let x = addDays(lookbackFrom, -1); x >= floor; x = addDays(x, -1)) {
          const date = x;
          history.push(unit(date, true, () => store.setMeta(opts.fromKey, date)));
        }
      }
    };

    if (clients.cloudflare) {
      const cf = clients.cloudflare;
      if (site.cloudflareZoneId) {
        const zoneId = site.cloudflareZoneId;
        const patterns = AI_CRAWLERS.map((c) => c.match);
        cloudflareDays({
          task: 'cloudflare.ai_crawlers',
          lookbackDays: CF_CRAWLER_LOOKBACK_DAYS,
          calls: 1,
          lastKey: syncKeys.cfCrawlers(site.id),
          fromKey: syncKeys.cfCrawlersFrom(site.id),
          pull: async (date) => {
            const rows = await cf.aiCrawlerRequests(zoneId, date, patterns);
            const merged = new Map<string, CrawlerRequestInput>();
            for (const r of rows) {
              const sig = classifyCrawler(r.userAgent);
              if (!sig) continue;
              const path = normalizePage(r.path, site.domain, r.host);
              const k = `${sig.name}|${path}|${r.status}`;
              const prev = merged.get(k);
              if (prev) prev.requests += r.requests;
              else
                merged.set(k, {
                  date,
                  crawler: sig.name,
                  operator: sig.operator,
                  purpose: sig.purpose,
                  path,
                  status: r.status,
                  requests: r.requests,
                });
            }
            return store.writeCrawlerRequests(site.id, [...merged.values()]);
          },
        });
      }
      if (site.webAnalyticsSiteTag && config.cloudflare.accountId) {
        const accountId = config.cloudflare.accountId;
        const tag = site.webAnalyticsSiteTag;
        cloudflareDays({
          task: 'cloudflare.web_analytics',
          lookbackDays: CF_RUM_LOOKBACK_DAYS,
          calls: 2,
          lastKey: syncKeys.cfRum(site.id),
          fromKey: syncKeys.cfRumFrom(site.id),
          pull: async (date) => {
            const rum = await cf.webAnalytics(accountId, tag, date);
            let n = await store.writeWebAnalytics(
              site.id,
              rum.map((r) => ({
                date,
                path: normalizePage(r.path, site.domain, r.host),
                refererHost: r.refererHost.toLowerCase(),
                visits: r.visits,
                pageViews: r.pageViews,
              })),
            );
            const vitals = await cf.webVitals(accountId, tag, date);
            n += await store.writeWebVitals(
              site.id,
              vitals.map((v) => ({
                date,
                path: normalizePage(v.path, site.domain, v.host),
                lcpP75: v.lcpP75,
                inpP75: v.inpP75,
                clsP75: v.clsP75,
                samples: v.samples,
              })),
            );
            return n;
          },
        });
      }
    }
  }

  // Stable sort: on the same day, sites keep their order and each site keeps GSC before Cloudflare.
  history.sort((a, b) => (a.date! < b.date! ? 1 : a.date! > b.date! ? -1 : 0));
  return [...interleave(increments), ...history];
}

export { BudgetExceeded };
