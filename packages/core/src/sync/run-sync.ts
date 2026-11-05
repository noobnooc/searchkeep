import type { SearchkeepConfig } from '../config.js';
import { classifyBrandQueries } from '../brand.js';
import { AI_CRAWLERS, classifyCrawler } from '../crawlers.js';
import { addDays, addMonths, toIsoDate } from '../dates.js';
import { safeMessage } from '../errors.js';
import { isRateLimited } from '../http.js';
import type { GscRow, SourceClients } from '../sources.js';
import type { Store } from '../store.js';
import type { CrawlerRequestInput, DateRange, IsoDate, SearchFactInput, SourceId, SyncRunRecord, SyncTaskResult } from '../types.js';
import { normalizePage } from '../url.js';
import {
  activeBackoff,
  BING_DATASETS,
  CF_CRAWLER_LOOKBACK_DAYS,
  CF_RUM_LOOKBACK_DAYS,
  CHUNK_DAYS,
  errorDelay,
  formatUntil,
  GSC_MAX_GAP_DAYS,
  GSC_REPULL_DAYS,
  loadSyncMeta,
  parseJson,
  pruneBackoff,
  rateLimitDelay,
  shrinkChunk,
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

/** GSC history requests planned per site and run (more than one run can take; the rest is planned next run). */
const GSC_HISTORY_UNITS_PER_RUN = 60;

interface Unit {
  task: string;
  siteId: string;
  source: SourceId;
  /** History work (GSC backfill, Cloudflare lookback): runs after every increment and stops at the daily write budget. */
  backfill: boolean;
  /** The newest day a history unit pulls; history runs newest first across all sites. */
  date?: IsoDate;
  /** API calls reserved before the unit runs; extra pages take more from the budget as they go. */
  calls: number;
  /** Stable id used to detect invocations killed mid-unit (e.g. CPU limit). */
  key: string;
  run: () => Promise<number>;
  /**
   * Gives up on this unit after repeated interruptions: a range is split for the next run
   * (returning what was done), a single day is passed over.
   */
  skip: () => Promise<string | void>;
  /** Splits a multi-day range after an error; false for a single day. */
  shrink?: () => Promise<boolean>;
}

/** The call budget shared by every unit of a run. */
interface Budget {
  /** Takes one more call, or stops the unit (BudgetExceeded) when none is left. */
  spend(source: SourceId): void;
  /** Hands back reserved calls a unit did not need. */
  refund(source: SourceId, calls: number): void;
}

/** The range had too many rows for one request: it was split, and the next run continues with smaller ranges. */
class Replan extends Error {}

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
    const budget: Budget = {
      spend(source) {
        if (callsLeft < 1) throw new BudgetExceeded();
        callsLeft -= 1;
        sourceCalls.set(source, (sourceCalls.get(source) ?? 0) + 1);
      },
      // A unit that turns out to need fewer calls than reserved hands the rest back.
      refund(source, calls) {
        callsLeft += calls;
        sourceCalls.set(source, Math.max(0, (sourceCalls.get(source) ?? 0) - calls));
      },
    };
    const retried = new Set<SourceId>();
    const units = await planUnits(ctx, today, budget);
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
        const split = await unit.skip();
        await store.deleteMeta(INFLIGHT_KEY);
        inflight = null;
        if (split) {
          failedTasks.add(taskKey);
          record(unit, 'skipped', 0, split);
        } else {
          record(
            unit,
            'error',
            0,
            `Skipped ${unit.key} after ${MAX_INTERRUPTED_ATTEMPTS} interrupted attempts (likely the Worker CPU limit; lower GSC_ROWS_PER_DAY).`,
          );
        }
        continue;
      }
      const gap = pacing[unit.source] ?? 0;
      const last = lastCallAt.get(unit.source);
      if (gap > 0 && last !== undefined && last + gap > Date.now()) await sleep(last + gap - Date.now());

      const attempts = inflight && inflight.key === unit.key ? inflight.attempts + 1 : 1;
      await store.setMeta(INFLIGHT_KEY, JSON.stringify({ key: unit.key, attempts }));
      inflight = { key: unit.key, attempts };
      const callsBefore = callsLeft;
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
          // A range that ran out after half a run's budget or more might never fit one: split it, so
          // it can finish. One that ran out with little budget left gets more once earlier work is done.
          if ((callsBefore - callsLeft) * 2 >= config.sync.maxCallsPerRun && unit.shrink && (await unit.shrink())) {
            record(unit, 'skipped', 0, 'Needs more calls than one run allows; continues with shorter ranges.');
          }
          break;
        }
        if (err instanceof Replan) {
          // Not an error: the next run asks for smaller ranges. The task's other planned ranges wait for it.
          failedTasks.add(taskKey);
          record(unit, 'skipped', 0, err.message);
          continue;
        }
        const message = safeMessage(err);
        ctx.log?.(`sync ${unit.task} ${unit.siteId}: ${message}`);
        if (isRateLimited(err)) {
          // Pause the whole source: every other call to it would be refused too. A pause set
          // during this run holds for the rest of it, also for "Sync now".
          retried.add(unit.source);
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
        // A range the API refuses (too wide for its plan, for one) is first retried as smaller ranges.
        if (unit.shrink && (await unit.shrink())) {
          record(unit, 'skipped', 0, `Asking for shorter ranges next run after: ${message}`);
          continue;
        }
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

/** Days from `start` to `end`, both included. */
function spanDays(range: DateRange): number {
  return Math.round((Date.parse(`${range.end}T00:00:00Z`) - Date.parse(`${range.start}T00:00:00Z`)) / 86_400_000) + 1;
}

const minDate = (a: IsoDate, b: IsoDate) => (a < b ? a : b);
const maxDate = (a: IsoDate, b: IsoDate) => (a > b ? a : b);

async function planUnits(ctx: SyncContext, today: IsoDate, budget: Budget): Promise<Unit[]> {
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
      const chunkKey = syncKeys.gscChunk(site.id);
      const chunk = Math.max(1, Math.min(CHUNK_DAYS.gsc, Number(get(chunkKey)) || CHUNK_DAYS.gsc));
      const splitRange = async (days: number): Promise<boolean> => {
        if (days <= 1) return false;
        await store.setMeta(chunkKey, String(shrinkChunk(Math.min(days, chunk))));
        return true;
      };
      /** Rows one request may return: as before for one day, and never more than a tenth of the daily write budget. */
      const pageRows = Math.min(25_000, rowsPerDay);
      const rangeCap = (days: number) => Math.max(rowsPerDay, Math.min(rowsPerDay * days, Math.floor(config.sync.dailyWriteBudget / 10)));
      // Totals, the first country × device page and the first query × page page.
      const reserved = 3;

      /** All pages of one request, up to `cap` rows; `complete` is false when more rows were left. */
      const pages = async (
        range: DateRange,
        dimensions: Array<'date' | 'query' | 'page' | 'country' | 'device'>,
        size: number,
        cap: number,
      ) => {
        const rows: GscRow[] = [];
        for (let startRow = 0; ; startRow += size) {
          if (startRow > 0) budget.spend('gsc');
          const page = await gsc.searchAnalytics({
            property,
            startDate: range.start,
            endDate: range.end,
            dimensions,
            rowLimit: size,
            startRow,
          });
          rows.push(...page);
          if (page.length < size) return { rows, complete: true };
          if (rows.length >= cap) return { rows, complete: false };
        }
      };

      /**
       * One request set for the days of `range`: totals per day, country × device and query × page,
       * each with one row per day. Returns null when the range has more rows than one request may
       * return; nothing is written then and the caller splits the range.
       */
      const pullRange = async (range: DateRange): Promise<number | null> => {
        const totals = await gsc.searchAnalytics({
          property,
          startDate: range.start,
          endDate: range.end,
          dimensions: ['date'],
          rowLimit: 25_000,
        });
        // No impressions in the whole range (or not final yet): the other breakdowns are empty too.
        // Common for the latest days (GSC lags 2-3 days) and for the older history of small sites.
        if (totals.length === 0) {
          budget.refund('gsc', reserved - 1);
          return 0;
        }
        const days = new Set(totals.map((r) => r.keys[0]!)).size;
        const breakdowns = await pages(range, ['date', 'country', 'device'], 25_000, 250_000);
        const queryPages = await pages(range, ['date', 'query', 'page'], pageRows, rangeCap(days));
        // One day keeps the top rows like it always has; a longer range is split instead.
        if (spanDays(range) > 1 && (!queryPages.complete || !breakdowns.complete)) return null;

        // At most GSC_ROWS_PER_DAY query × page rows per day, the most clicked first.
        const byDay = new Map<string, GscRow[]>();
        for (const r of queryPages.rows) {
          const list = byDay.get(r.keys[0]!) ?? [];
          list.push(r);
          byDay.set(r.keys[0]!, list);
        }
        const facts: SearchFactInput[] = [];
        for (const list of byDay.values()) {
          list.sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions);
          for (const r of list.slice(0, rowsPerDay)) {
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
        }
        let written = await store.writeSearchFacts(
          site.id,
          'gsc',
          totals.map((r) => ({ date: r.keys[0]!, kind: 'total', clicks: r.clicks, impressions: r.impressions, position: r.position })),
        );
        written += await store.writeBreakdowns(
          site.id,
          'gsc',
          breakdowns.rows.map((r) => ({
            date: r.keys[0]!,
            country: r.keys[1]!,
            device: r.keys[2]!,
            clicks: r.clicks,
            impressions: r.impressions,
            position: r.position,
          })),
        );
        written += await store.writeSearchFacts(site.id, 'gsc', facts);
        return written;
      };

      /** A unit for one range: `done` records it; a range with too many rows is split for the next run. */
      const rangeUnit = (opts: {
        task: string;
        range: DateRange;
        history: boolean;
        done: () => Promise<void>;
        passOver: () => Promise<void>;
      }): Unit => {
        const days = spanDays(opts.range);
        const label = `${opts.range.start}..${opts.range.end}`;
        return {
          task: opts.task,
          siteId: site.id,
          source: 'gsc',
          backfill: opts.history,
          ...(opts.history ? { date: opts.range.end } : {}),
          calls: reserved,
          key: `${opts.task}:${site.id}:${label}`,
          run: async () => {
            const n = await pullRange(opts.range);
            if (n === null) {
              await splitRange(days);
              throw new Replan(`More Search Console rows for ${label} than one request may return; continues with shorter ranges.`);
            }
            await opts.done();
            return n;
          },
          skip: async () => {
            if (await splitRange(days)) return `Interrupted 3 times on ${label}; continues with shorter ranges.`;
            await opts.passOver();
          },
          shrink: () => splitRange(days),
        };
      };

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
      // The pending days are consecutive, newest first: one request per `chunk` days.
      for (let i = 0; i < pending.length; i += chunk) {
        const group = pending.slice(i, i + chunk);
        const range = { start: group[group.length - 1]!, end: group[0]! };
        const done = async () => {
          pending = pending.filter((d) => !group.includes(d));
          if (pending.length === 0) ready = true;
          await store.setMeta(progressKey, JSON.stringify({ day: today, pending, ready } satisfies GscDailyProgress));
        };
        daily.push(rangeUnit({ task: 'gsc.search_analytics', range, history: false, done, passOver: done }));
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

      // History backfill, newest to oldest, `chunk` days per request.
      const target = addMonths(today, -config.sync.backfillMonths);
      const cursor = get(backfillKey);
      if (cursor && cursor > target) {
        let end = addDays(cursor, -1);
        for (let i = 0; i < GSC_HISTORY_UNITS_PER_RUN && end >= target; i++) {
          const range = { start: maxDate(target, addDays(end, -(chunk - 1))), end };
          const advance = () => store.setMeta(backfillKey, range.start);
          history.push(rangeUnit({ task: 'gsc.backfill', range, history: true, done: advance, passOver: advance }));
          end = addDays(range.start, -1);
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
    // (history). A new site gets yesterday first, then the lookback. One request
    // covers up to `chunk` days; a range with too many rows, or one the API
    // refuses, is split for the next run.
    const cloudflareDays = (opts: {
      task: string;
      lookbackDays: number;
      defaultChunk: number;
      calls: number;
      lastKey: string;
      fromKey: string;
      chunkKey: string;
      /** Rows written, or null when the range has more rows than one request returns. */
      pull: (range: DateRange) => Promise<number | null>;
    }) => {
      const floor = addDays(today, -opts.lookbackDays);
      const last = get(opts.lastKey);
      const from = get(opts.fromKey);
      const fresh = !last;
      const chunk = Math.max(1, Math.min(opts.defaultChunk, Number(get(opts.chunkKey)) || opts.defaultChunk));
      const splitRange = async (days: number): Promise<boolean> => {
        if (days <= 1) return false;
        await store.setMeta(opts.chunkKey, String(shrinkChunk(Math.min(days, chunk))));
        return true;
      };
      const unit = (range: DateRange, isHistory: boolean, advance: () => Promise<void>): Unit => {
        const days = spanDays(range);
        const label = `${range.start}..${range.end}`;
        return {
          task: opts.task,
          siteId: site.id,
          source: 'cloudflare',
          backfill: isHistory,
          ...(isHistory ? { date: range.end } : {}),
          calls: opts.calls,
          key: `${opts.task}:${site.id}:${label}`,
          run: async () => {
            const n = await opts.pull(range);
            if (n === null && (await splitRange(days)))
              throw new Replan(`More Cloudflare rows for ${label} than one request returns; continues with shorter ranges.`);
            await advance();
            return n ?? 0;
          },
          skip: async () => {
            if (await splitRange(days)) return `Interrupted 3 times on ${label}; continues with shorter ranges.`;
            await advance();
          },
          shrink: () => splitRange(days),
        };
      };
      // Forward, oldest first: the cursor only moves ahead.
      let d = last ? addDays(last, 1) : yesterday;
      if (d < floor) d = floor;
      while (d <= yesterday) {
        const range = { start: d, end: minDate(addDays(d, chunk - 1), yesterday) };
        daily.push(
          unit(range, false, async () => {
            await store.setMeta(opts.lastKey, range.end);
            if (fresh && !(await store.getMeta(opts.fromKey))) await store.setMeta(opts.fromKey, range.start);
          }),
        );
        d = addDays(range.end, 1);
      }
      // Lookback, newest first. Deployments from before the lookback cursor existed synced
      // the window forward, so they have no lookback left.
      const lookbackFrom = from ?? (fresh ? yesterday : null);
      if (lookbackFrom) {
        for (let end = addDays(lookbackFrom, -1); end >= floor;) {
          const range = { start: maxDate(floor, addDays(end, -(chunk - 1))), end };
          history.push(unit(range, true, () => store.setMeta(opts.fromKey, range.start)));
          end = addDays(range.start, -1);
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
          defaultChunk: CHUNK_DAYS.cfCrawlers,
          calls: 1,
          lastKey: syncKeys.cfCrawlers(site.id),
          fromKey: syncKeys.cfCrawlersFrom(site.id),
          chunkKey: syncKeys.cfCrawlersChunk(site.id),
          pull: async (range) => {
            const res = await cf.aiCrawlerRequests(zoneId, range, patterns);
            if (!res.complete && spanDays(range) > 1) return null;
            const merged = new Map<string, CrawlerRequestInput>();
            for (const r of res.rows) {
              const sig = classifyCrawler(r.userAgent);
              if (!sig) continue;
              const path = normalizePage(r.path, site.domain, r.host);
              const k = `${r.date}|${sig.name}|${path}|${r.status}`;
              const prev = merged.get(k);
              if (prev) prev.requests += r.requests;
              else
                merged.set(k, {
                  date: r.date,
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
          defaultChunk: CHUNK_DAYS.cfRum,
          calls: 2,
          lastKey: syncKeys.cfRum(site.id),
          fromKey: syncKeys.cfRumFrom(site.id),
          chunkKey: syncKeys.cfRumChunk(site.id),
          pull: async (range) => {
            const multiDay = spanDays(range) > 1;
            const rum = await cf.webAnalytics(accountId, tag, range);
            if (!rum.complete && multiDay) {
              budget.refund('cloudflare', 1);
              return null;
            }
            const vitals = await cf.webVitals(accountId, tag, range);
            if (!vitals.complete && multiDay) return null;
            let n = await store.writeWebAnalytics(
              site.id,
              rum.rows.map((r) => ({
                date: r.date,
                path: normalizePage(r.path, site.domain, r.host),
                refererHost: r.refererHost.toLowerCase(),
                visits: r.visits,
                pageViews: r.pageViews,
              })),
            );
            n += await store.writeWebVitals(
              site.id,
              vitals.rows.map((v) => ({
                date: v.date,
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
