import type { SearchkeepConfig } from '../config.js';
import { classifyBrandQueries } from '../brand.js';
import { segmentsEnabled } from '../config.js';
import { AI_CRAWLERS, classifyCrawler, classifySearchCrawler, SEARCH_CRAWLERS, type CrawlerSignature } from '../crawlers.js';
import { addDays, addMonths, toIsoDate } from '../dates.js';
import { safeMessage } from '../errors.js';
import { isRateLimited, SourceError } from '../http.js';
import type { GscClient, GscRow, GscSearchAnalyticsRequest, GscUrlInspection, SitemapReader, SourceClients } from '../sources.js';
import type { Store } from '../store.js';
import {
  PAGE_ONLY_SEARCH_TYPES,
  type AppearanceInput,
  type CrawlerKind,
  type CrawlerRequestInput,
  type DateRange,
  type GscSearchType,
  type IsoDate,
  type SearchFactInput,
  type SegmentInput,
  type SiteConfig,
  type SourceId,
  type SyncRunRecord,
  type SyncTaskResult,
  type UrlInspectionInput,
} from '../types.js';
import { normalizePage } from '../url.js';
import {
  activeBackoff,
  BING_DATASETS,
  CF_CRAWLER_LOOKBACK_DAYS,
  CF_RUM_LOOKBACK_DAYS,
  CF_SEARCH_CRAWLER_LOOKBACK_DAYS,
  CHUNK_DAYS,
  errorDelay,
  formatUntil,
  GSC_MAX_GAP_DAYS,
  GSC_REPULL_DAYS,
  GSC_SEGMENT_MONTHS,
  loadSyncMeta,
  parseJson,
  pruneBackoff,
  rateLimitDelay,
  REINSPECT_DAYS,
  shrinkChunk,
  SOURCE_NAMES,
  sourceBackoffKey,
  syncKeys,
  taskBackoffKey,
  type BackoffMap,
  type GscDailyProgress,
  type GscExtraDataset,
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
  /** History stops for this run once it wrote this many rows (D1 limits work per 10 seconds). Default 20,000. */
  maxRowsPerRun?: number;
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
  /** Rows written; null when there turned out to be nothing to do (the unit is then not reported). */
  run: () => Promise<number | null>;
  /**
   * Gives up on this unit after repeated interruptions: a range is split for the next run
   * (returning what was done), a single day is passed over.
   */
  skip: () => Promise<string | void>;
  /** Splits a multi-day range after an error; false for a single day. */
  shrink?: () => Promise<boolean>;
  /** Also split the range when it needed more calls than one run allows (default true; false when calls do not depend on days). */
  splitOnBudget?: boolean;
  /**
   * Spare-capacity work (index coverage): runs only with calls and time left over after
   * everything else, and never makes a run partial when it stops for lack of either.
   */
  idle?: boolean;
}

/** The call budget shared by every unit of a run. */
interface Budget {
  /** Takes one more call, or stops the unit (BudgetExceeded) when none is left. */
  spend(source: SourceId): void;
  /** Hands back reserved calls a unit did not need. */
  refund(source: SourceId, calls: number): void;
  /** Calls still left in this run. */
  left(): number;
  /** True once the run's time budget is spent. */
  expired(): boolean;
}

/** The range had too many rows for one request: it was split, and the next run continues with smaller ranges. */
class Replan extends Error {}

/** Units interrupted this many times in a row are skipped so sync never gets stuck. */
const MAX_INTERRUPTED_ATTEMPTS = 3;
const INFLIGHT_KEY = 'sync:inflight';

class BudgetExceeded extends Error {}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Rows one GSC request set may return; a range with more is split (D1 limits work per 10 seconds). */
const MAX_ROWS_PER_REQUEST = 10_000;
const MAX_ROWS_PER_RUN = 20_000;
/** Queries whose brand flag a run (re)computes; the rest wait for the next runs. */
const BRAND_QUERIES_PER_RUN = 4_000;
/** A run still marked `running` after this long was interrupted. */
const STALE_RUN_MS = 20 * 60_000;
/** After a unit that wrote many rows, wait this long per row (at most 3 s) before the next one. */
const WRITE_PAUSE_MS_PER_ROW = 0.2;

/** Retries a final write while the database is busy (1 s, then 3 s), then gives up with the error. */
async function whileBusy<T>(store: Store, fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= 2 || !store.isBusy?.(err)) throw err;
      await sleep(attempt === 0 ? 1_000 : 3_000);
    }
  }
}

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
  // A run still marked as running long after it started was interrupted (CPU limit, busy database).
  for (const r of await store.listSyncRuns(10)) {
    if (r.status === 'running' && r.id !== undefined && Date.parse(r.startedAt) < nowMs - STALE_RUN_MS) {
      await store.finishSyncRun(r.id, {
        status: 'error',
        message: 'Did not finish: the run was interrupted or the database was busy. Its work up to then is kept.',
      });
    }
  }
  const runId = await store.startSyncRun({ startedAt: now.toISOString(), trigger: ctx.trigger, status: 'running', rowsWritten: 0 });
  const maxRowsPerRun = ctx.maxRowsPerRun ?? MAX_ROWS_PER_RUN;

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
      left: () => callsLeft,
      expired: () => Date.now() - started > timeBudget,
    };
    const retried = new Set<SourceId>();
    const units = await planUnits(ctx, today, nowMs, budget);
    // Any write of the loop (progress markers, cursors, backoff) may find the database busy too.
    try {
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
          if (!unit.idle) stoppedFor = 'time budget reached';
          break;
        }
        if (unit.calls > callsLeft) {
          if (!unit.idle) stoppedFor = 'API call budget reached';
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
        if (unit.backfill && rowsWritten >= maxRowsPerRun) {
          stoppedFor = 'enough rows for one run';
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
          const out = await unit.run();
          const rows = out ?? 0;
          rowsWritten += rows;
          writesToday += rows;
          if (out !== null) record(unit, 'ok', rows);
          // Spread large writes out: D1 limits the work one database does per 10 seconds.
          if (rows > 1_000) await sleep(Math.min(3_000, rows * WRITE_PAUSE_MS_PER_ROW));
          await store.deleteMeta(INFLIGHT_KEY);
          inflight = null;
          clearBackoff(taskBackoffKey(unit.task, unit.siteId));
          clearBackoff(sourceBackoffKey(unit.source));
          await saveBackoff();
        } catch (err) {
          if (store.isBusy?.(err)) {
            // Not this task's fault: stop writing for this run, the next one continues. The busy
            // database may refuse the cleanup too; a leftover marker only counts one interruption.
            await store.deleteMeta(INFLIGHT_KEY).catch(() => undefined);
            inflight = null;
            stoppedFor = 'database busy';
            record(unit, 'skipped', 0, 'The database was busy; continues next run.');
            break;
          }
          await store.deleteMeta(INFLIGHT_KEY);
          inflight = null;
          if (err instanceof BudgetExceeded) {
            if (unit.idle) break;
            stoppedFor = 'API call budget reached';
            // A range that ran out after half a run's budget or more might never fit one: split it, so
            // it can finish. One that ran out with little budget left gets more once earlier work is done.
            if (
              (callsBefore - callsLeft) * 2 >= config.sync.maxCallsPerRun &&
              unit.splitOnBudget !== false &&
              unit.shrink &&
              (await unit.shrink())
            ) {
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
    } catch (err) {
      if (!store.isBusy?.(err)) throw err;
      stoppedFor = 'database busy';
    }

    // A few thousand brand flags per run: new queries are classified over the next runs. A failure
    // here leaves the flags for the next run; it must not fail a run whose data is already written.
    let brandLeft = BRAND_QUERIES_PER_RUN;
    let brandFailed = false;
    for (const site of config.sites) {
      if (brandLeft <= 0) break;
      try {
        brandLeft -= await classifyBrandQueries(store, config, site, brandLeft);
      } catch (err) {
        if (!store.isBusy?.(err)) {
          brandFailed = true;
          ctx.log?.(`sync brand ${site.id}: ${safeMessage(err)}`);
        }
        break;
      }
    }

    await whileBusy(store, () => store.setMeta(writesKey, String(writesToday)));
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
    if (brandFailed) notes.push('Brand flags could not be updated; the next run continues.');
    const status: SyncRunRecord['status'] =
      details.length === 0
        ? 'skipped'
        : anyError
          ? anyOk
            ? 'partial'
            : 'error'
          : stoppedFor || paused.size || capped.size || waiting.size || brandFailed
            ? 'partial'
            : 'ok';
    const message = notes.length ? notes.join(' ') : details.length === 0 ? 'Nothing due.' : null;
    const patch: Partial<SyncRunRecord> = { finishedAt: new Date().toISOString(), status, rowsWritten, message, details };
    await whileBusy(store, () => store.finishSyncRun(runId, patch));
    const lastRun: LastRunMeta = { at: patch.finishedAt!, status, rowsWritten, message };
    await whileBusy(store, () => store.setMeta(syncKeys.lastRun, JSON.stringify(lastRun)));
    return { id: runId, startedAt: now.toISOString(), trigger: ctx.trigger, ...patch, status, rowsWritten } as SyncRunRecord;
  } catch (err) {
    const message = safeMessage(err);
    await whileBusy(store, () =>
      store.finishSyncRun(runId, {
        finishedAt: new Date().toISOString(),
        status: 'error',
        rowsWritten,
        message,
        details: [...results.values()],
      }),
    ).catch(() => undefined); // The next run marks it as interrupted.
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

async function planUnits(ctx: SyncContext, today: IsoDate, nowMs: number, budget: Budget): Promise<Unit[]> {
  const { config, clients, store } = ctx;
  const meta = await loadSyncMeta(store);
  const get = (key: string): string | null => meta[key] ?? null;
  const increments: Unit[][] = [];
  const extraIncrements: Unit[][] = [];
  const spareWork: Unit[][] = [];
  const history: Unit[] = [];
  const yesterday = addDays(today, -1);

  for (const site of config.sites) {
    // Tiers: web search, Bing and the main Cloudflare datasets first; then the other datasets.
    const daily: Unit[] = [];
    const extras: Unit[] = [];
    const spare: Unit[] = [];
    increments.push(daily);
    extraIncrements.push(extras);
    spareWork.push(spare);

    // ---------------- Google Search Console ----------------
    if (clients.gsc && site.gscProperty) {
      const gsc = clients.gsc;
      const property = site.gscProperty;
      const rowsPerDay = config.gsc.rowsPerDay;
      /** Rows one request may return: as before for one day; for a range at most 10,000 and a tenth of the daily write budget. */
      const pageRows = Math.min(25_000, rowsPerDay);
      const rangeCap = (days: number, perDay = rowsPerDay) =>
        Math.max(perDay, Math.min(perDay * days, Math.floor(config.sync.dailyWriteBudget / 10), MAX_ROWS_PER_REQUEST));
      let latestWeb: Promise<IsoDate | null> | undefined;

      type Req = Omit<GscSearchAnalyticsRequest, 'property' | 'startDate' | 'endDate' | 'rowLimit' | 'startRow'>;
      const query = (range: DateRange, req: Req, rowLimit: number, startRow = 0) =>
        gsc.searchAnalytics({ property, startDate: range.start, endDate: range.end, rowLimit, startRow, ...req });

      /** All pages of one request, up to `cap` rows; `complete` is false when more rows were left. */
      const pages = async (range: DateRange, req: Req, size: number, cap: number) => {
        const rows: GscRow[] = [];
        for (let startRow = 0; ; startRow += size) {
          if (startRow > 0) budget.spend('gsc');
          const page = await query(range, req, size, startRow);
          rows.push(...page);
          if (page.length < size) return { rows, complete: true };
          if (rows.length >= cap) return { rows, complete: false };
        }
      };

      /** At most `perDay` rows per day (keys[0] is the date), the most clicked first. */
      const topPerDay = (rows: GscRow[], perDay: number): GscRow[] => {
        const byDay = new Map<string, GscRow[]>();
        for (const r of rows) {
          const list = byDay.get(r.keys[0]!) ?? [];
          list.push(r);
          byDay.set(r.keys[0]!, list);
        }
        const out: GscRow[] = [];
        for (const list of byDay.values()) {
          list.sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions);
          out.push(...list.slice(0, perDay));
        }
        return out;
      };

      /**
       * One Search Console dataset: a daily increment (the most recent days plus any recent gap)
       * and a history backfill, newest to oldest, `chunk` days per request. Each dataset keeps
       * its own cursors, so a dataset added later backfills on its own. `pull` returns the rows
       * written, or null when the range has more rows than one request set may return: nothing
       * is written then and the range is split for the next run.
       */
      const dataset = (opts: {
        task: string;
        historyTask: string;
        keys: { daily: string; backfill: string; chunk: string };
        months: number;
        /** Calls reserved per range; extra pages take more from the budget as they go. */
        calls: number;
        /** Web search goes first; the other datasets follow every site's web increment. */
        tier: Unit[];
        splitOnBudget?: boolean;
        pull: (range: DateRange) => Promise<number | null>;
      }) => {
        const chunk = Math.max(1, Math.min(CHUNK_DAYS.gsc, Number(get(opts.keys.chunk)) || CHUNK_DAYS.gsc));
        const splitRange = async (days: number): Promise<boolean> => {
          if (days <= 1) return false;
          await store.setMeta(opts.keys.chunk, String(shrinkChunk(Math.min(days, chunk))));
          return true;
        };
        /** A unit for one range: `done` records it; a range with too many rows is split for the next run. */
        const rangeUnit = (task: string, range: DateRange, isHistory: boolean, done: () => Promise<void>): Unit => {
          const days = spanDays(range);
          const label = `${range.start}..${range.end}`;
          return {
            task,
            siteId: site.id,
            source: 'gsc',
            backfill: isHistory,
            ...(isHistory ? { date: range.end } : {}),
            calls: opts.calls,
            key: `${task}:${site.id}:${label}`,
            run: async () => {
              const n = await opts.pull(range);
              if (n === null) {
                await splitRange(days);
                throw new Replan(`More Search Console rows for ${label} than one request may return; continues with shorter ranges.`);
              }
              await done();
              return n;
            },
            skip: async () => {
              if (await splitRange(days)) return `Interrupted 3 times on ${label}; continues with shorter ranges.`;
              await done();
            },
            shrink: () => splitRange(days),
            ...(opts.splitOnBudget === false ? { splitOnBudget: false } : {}),
          };
        };
        return (async () => {
          const progress = parseJson<GscDailyProgress>(get(opts.keys.daily));
          let pending: IsoDate[];
          let ready: boolean;
          if (progress && progress.day === today) {
            pending = progress.pending;
            ready = progress.ready ?? pending.length === 0;
          } else {
            const latest = await (latestWeb ??= store.latestDate(site.id, 'gsc'));
            let start = addDays(today, -GSC_REPULL_DAYS);
            if (latest && addDays(latest, -3) < start) start = addDays(latest, -3);
            const floor = addDays(today, -GSC_MAX_GAP_DAYS);
            if (start < floor) start = floor;
            pending = [];
            for (let d = yesterday; d >= start; d = addDays(d, -1)) pending.push(d);
            // A site that synced on an earlier day had its first increment then (older records carry no flag).
            ready = progress ? (progress.ready ?? true) : false;
            await store.setMeta(opts.keys.daily, JSON.stringify({ day: today, pending, ready } satisfies GscDailyProgress));
            // The backfill cursor starts where the first increment begins.
            if (!get(opts.keys.backfill)) {
              await store.setMeta(opts.keys.backfill, start);
              meta[opts.keys.backfill] = start;
            }
          }
          // The pending days are consecutive, newest first: one request per `chunk` days.
          for (let i = 0; i < pending.length; i += chunk) {
            const group = pending.slice(i, i + chunk);
            const range = { start: group[group.length - 1]!, end: group[0]! };
            const done = async () => {
              pending = pending.filter((d) => !group.includes(d));
              if (pending.length === 0) ready = true;
              await store.setMeta(opts.keys.daily, JSON.stringify({ day: today, pending, ready } satisfies GscDailyProgress));
            };
            opts.tier.push(rangeUnit(opts.task, range, false, done));
          }
          // History, newest to oldest.
          const target = addMonths(today, -opts.months);
          const cursor = get(opts.keys.backfill);
          if (cursor && cursor > target) {
            let end = addDays(cursor, -1);
            for (let i = 0; i < GSC_HISTORY_UNITS_PER_RUN && end >= target; i++) {
              const range = { start: maxDate(target, addDays(end, -(chunk - 1))), end };
              history.push(rangeUnit(opts.historyTask, range, true, () => store.setMeta(opts.keys.backfill, range.start)));
              end = addDays(range.start, -1);
            }
          }
        })();
      };

      // Web search: totals per day, country × device and query × page, each with one row per day.
      // A range without impressions (the latest days, GSC lags 2-3 days; old history of small sites)
      // costs only the totals call.
      const reservedWeb = 3;
      await dataset({
        task: 'gsc.search_analytics',
        historyTask: 'gsc.backfill',
        keys: { daily: syncKeys.gscDaily(site.id), backfill: syncKeys.gscBackfill(site.id), chunk: syncKeys.gscChunk(site.id) },
        months: config.sync.backfillMonths,
        calls: reservedWeb,
        tier: daily,
        pull: async (range) => {
          const totals = await query(range, { dimensions: ['date'] }, 25_000);
          if (totals.length === 0) {
            budget.refund('gsc', reservedWeb - 1);
            return 0;
          }
          const days = new Set(totals.map((r) => r.keys[0]!)).size;
          const breakdowns = await pages(range, { dimensions: ['date', 'country', 'device'] }, MAX_ROWS_PER_REQUEST, MAX_ROWS_PER_REQUEST);
          const queryPages = await pages(range, { dimensions: ['date', 'query', 'page'] }, pageRows, rangeCap(days));
          // One day keeps the top rows like it always has; a longer range is split instead.
          if (spanDays(range) > 1 && (!queryPages.complete || !breakdowns.complete)) return null;
          const facts: SearchFactInput[] = topPerDay(queryPages.rows, rowsPerDay).map((r) => ({
            date: r.keys[0]!,
            kind: 'query_page',
            query: r.keys[1]!,
            page: normalizePage(r.keys[2]!, site.domain),
            clicks: r.clicks,
            impressions: r.impressions,
            position: r.position,
          }));
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
        },
      });

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

      const extraKeys = (d: GscExtraDataset) => ({
        daily: syncKeys.gscExtraDaily(d, site.id),
        backfill: syncKeys.gscExtraBackfill(d, site.id),
        chunk: syncKeys.gscExtraChunk(d, site.id),
      });

      // Other search types (image, video, News tab, Discover, Google News): totals per day and
      // query × page (Discover and Google News: page only; they have no queries and no position).
      for (const type of config.gsc.searchTypes) {
        const pageOnly = PAGE_ONLY_SEARCH_TYPES.includes(type);
        const reserved = 2;
        await dataset({
          task: `gsc.${type}`,
          historyTask: `gsc.${type}_backfill`,
          keys: extraKeys(type as GscExtraDataset),
          months: config.sync.backfillMonths,
          calls: reserved,
          tier: extras,
          pull: async (range) => {
            const totals = await query(range, { dimensions: ['date'], type }, 25_000);
            if (totals.length === 0) {
              budget.refund('gsc', reserved - 1);
              return 0;
            }
            const days = new Set(totals.map((r) => r.keys[0]!)).size;
            const detail = await pages(
              range,
              { dimensions: pageOnly ? ['date', 'page'] : ['date', 'query', 'page'], type },
              pageRows,
              rangeCap(days),
            );
            if (spanDays(range) > 1 && !detail.complete) return null;
            const position = (r: GscRow) => (pageOnly || !(r.position > 0) ? null : r.position);
            const facts: SearchFactInput[] = topPerDay(detail.rows, rowsPerDay).map((r) =>
              pageOnly
                ? {
                    date: r.keys[0]!,
                    kind: 'page',
                    page: normalizePage(r.keys[1]!, site.domain),
                    clicks: r.clicks,
                    impressions: r.impressions,
                  }
                : {
                    date: r.keys[0]!,
                    kind: 'query_page',
                    query: r.keys[1]!,
                    page: normalizePage(r.keys[2]!, site.domain),
                    clicks: r.clicks,
                    impressions: r.impressions,
                    position: position(r),
                  },
            );
            let written = await store.writeSearchFacts(
              site.id,
              'gsc',
              totals.map((r) => ({ date: r.keys[0]!, kind: 'total', clicks: r.clicks, impressions: r.impressions, position: position(r) })),
              type,
            );
            written += await store.writeSearchFacts(site.id, 'gsc', facts, type);
            return written;
          },
        });
      }

      // Search appearance (web search). Search Console reports it only on its own, so it takes two
      // steps: the appearances of the range, then one daily series per appearance.
      if (config.gsc.searchAppearance) {
        // The calls depend on the number of appearances, not on the days: never split for the budget,
        // and leave room in one run for the list and the series.
        const maxSeries = Math.max(1, config.sync.maxCallsPerRun - 2);
        await dataset({
          task: 'gsc.appearance',
          historyTask: 'gsc.appearance_backfill',
          keys: extraKeys('appearance'),
          months: config.sync.backfillMonths,
          calls: 1,
          tier: extras,
          splitOnBudget: false,
          pull: async (range) => {
            const list = await query(range, { dimensions: ['searchAppearance'] }, 1_000);
            const rows: AppearanceInput[] = [];
            for (const a of list.slice(0, maxSeries)) {
              const appearance = a.keys[0]!;
              budget.spend('gsc');
              const series = await query(range, { dimensions: ['date'], searchAppearance: appearance }, 25_000);
              for (const r of series) {
                rows.push({ date: r.keys[0]!, appearance, clicks: r.clicks, impressions: r.impressions, position: r.position });
              }
            }
            return store.writeSearchAppearances(site.id, 'web', rows);
          },
        });
      }

      // Opt-in: query and page rows per country and device, for a shorter history (row volume).
      if (segmentsEnabled(config, site.id)) {
        const perDay = Math.min(rowsPerDay, SEGMENT_ROWS_PER_DAY);
        await dataset({
          task: 'gsc.segments',
          historyTask: 'gsc.segments_backfill',
          keys: extraKeys('segments'),
          months: Math.min(config.sync.backfillMonths, GSC_SEGMENT_MONTHS),
          calls: 2,
          tier: extras,
          pull: async (range) => {
            const cap = rangeCap(spanDays(range), perDay);
            const byQuery = await pages(range, { dimensions: ['date', 'query', 'country', 'device'] }, pageRows, cap);
            if (spanDays(range) > 1 && !byQuery.complete) return null;
            const byPage = await pages(range, { dimensions: ['date', 'page', 'country', 'device'] }, pageRows, cap);
            if (spanDays(range) > 1 && !byPage.complete) return null;
            const rows: SegmentInput[] = [];
            for (const [kind, res] of [
              ['query', byQuery],
              ['page', byPage],
            ] as const) {
              for (const r of topPerDay(res.rows, perDay)) {
                rows.push({
                  date: r.keys[0]!,
                  kind,
                  key: kind === 'page' ? normalizePage(r.keys[1]!, site.domain) : r.keys[1]!,
                  country: r.keys[2]!,
                  device: r.keys[3]!,
                  clicks: r.clicks,
                  impressions: r.impressions,
                  position: r.position,
                });
              }
            }
            return store.writeSearchSegments(site.id, rows);
          },
        });
      }

      // Index coverage: sitemap URLs inspected in batches with the calls left over after everything else.
      if (clients.sitemaps && config.gsc.inspectionsPerDay > 0) {
        spare.push(...indexCoverageUnits({ site, gsc, property, reader: clients.sitemaps, store, budget, today, nowMs, config, get }));
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
      /** Where the daily units go (default: with the other sources' increments). */
      tier?: Unit[];
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
        (opts.tier ?? daily).push(
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
        /** Requests per day, crawler, page and status; `perDay` caps the rows per day (the rest is folded into one row per crawler and status). */
        const crawlerPull =
          (kind: CrawlerKind, patterns: string[], classify: (ua: string) => CrawlerSignature | null, perDay?: number) =>
          async (range: DateRange) => {
            const res = await cf.crawlerRequests(zoneId, range, patterns);
            if (!res.complete && spanDays(range) > 1) return null;
            const merged = new Map<string, CrawlerRequestInput>();
            for (const r of res.rows) {
              const sig = classify(r.userAgent);
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
            const rows = perDay ? capCrawlerRows([...merged.values()], perDay) : [...merged.values()];
            return store.writeCrawlerRequests(site.id, rows, kind);
          };
        cloudflareDays({
          task: 'cloudflare.ai_crawlers',
          lookbackDays: CF_CRAWLER_LOOKBACK_DAYS,
          defaultChunk: CHUNK_DAYS.cfCrawlers,
          calls: 1,
          lastKey: syncKeys.cfCrawlers(site.id),
          fromKey: syncKeys.cfCrawlersFrom(site.id),
          chunkKey: syncKeys.cfCrawlersChunk(site.id),
          pull: crawlerPull(
            'ai',
            AI_CRAWLERS.map((c) => c.match),
            classifyCrawler,
          ),
        });
        // Search engine crawlers (Googlebot, Bingbot, ...): the closest thing to Search Console's
        // Crawl stats report, which has no API.
        cloudflareDays({
          task: 'cloudflare.search_crawlers',
          lookbackDays: CF_SEARCH_CRAWLER_LOOKBACK_DAYS,
          defaultChunk: CHUNK_DAYS.cfCrawlers,
          calls: 1,
          lastKey: syncKeys.cfSearchCrawlers(site.id),
          fromKey: syncKeys.cfSearchCrawlersFrom(site.id),
          chunkKey: syncKeys.cfSearchCrawlersChunk(site.id),
          tier: extras,
          pull: crawlerPull('search', SEARCH_CRAWLER_PATTERNS, classifySearchCrawler, SEARCH_CRAWLER_ROWS_PER_DAY),
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
  return [...interleave(increments), ...interleave(extraIncrements), ...history, ...interleave(spareWork)];
}

/** User agent patterns for the Cloudflare query: a pattern that contains another one adds nothing. */
const SEARCH_CRAWLER_PATTERNS = SEARCH_CRAWLERS.map((c) => c.match).filter((p, _i, all) => !all.some((q) => q !== p && p.includes(q)));

/** Search engine crawler rows kept per site and day; the rest is folded into `OTHER_PAGES`. */
const SEARCH_CRAWLER_ROWS_PER_DAY = 2_000;
/** Page key for the requests to pages beyond the per-day cap. */
export const OTHER_PAGES = '(other pages)';

/** Keeps the `perDay` largest rows of each day; the others are summed per crawler and status into `OTHER_PAGES`. */
export function capCrawlerRows(rows: CrawlerRequestInput[], perDay: number): CrawlerRequestInput[] {
  const byDay = new Map<string, CrawlerRequestInput[]>();
  for (const r of rows) {
    const list = byDay.get(r.date) ?? [];
    list.push(r);
    byDay.set(r.date, list);
  }
  const out: CrawlerRequestInput[] = [];
  for (const list of byDay.values()) {
    if (list.length <= perDay) {
      out.push(...list);
      continue;
    }
    list.sort((a, b) => b.requests - a.requests);
    out.push(...list.slice(0, perDay - 1));
    const rest = new Map<string, CrawlerRequestInput>();
    for (const r of list.slice(perDay - 1)) {
      const k = `${r.crawler}|${r.status}`;
      const prev = rest.get(k);
      if (prev) prev.requests += r.requests;
      else rest.set(k, { ...r, path: OTHER_PAGES });
    }
    out.push(...rest.values());
  }
  return out;
}

/** GSC query and page rows per country and device kept per day and kind (opt-in segments). */
const SEGMENT_ROWS_PER_DAY = 1_000;
/** Sitemap files read per site and day, and URLs tracked per site. */
const MAX_SITEMAP_FILES = 25;
export const MAX_INDEX_URLS = 5_000;
/** URL inspections per unit; several units per site and run go round-robin over the sites. */
const INSPECTIONS_PER_UNIT = 10;
const UNITS_PER_SITE_AND_RUN = 4;

/** Whether `url` belongs to the Search Console property (the URL Inspection API refuses others). */
export function inPropertyScope(url: string, property: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
  if (property.startsWith('sc-domain:')) {
    const d = property.slice('sc-domain:'.length).toLowerCase();
    const host = u.hostname.toLowerCase();
    return host === d || host.endsWith(`.${d}`);
  }
  return url.toLowerCase().startsWith(property.toLowerCase());
}

/** Whether a sitemap URL may be fetched: http(s) on the site's domain or one of its subdomains. */
function onSiteDomain(url: string, domain: string): boolean {
  try {
    const u = new URL(url);
    const d = domain.toLowerCase().replace(/^www\./, '');
    const host = u.hostname.toLowerCase();
    return (u.protocol === 'https:' || u.protocol === 'http:') && (host === d || host.endsWith(`.${d}`));
  } catch {
    return false;
  }
}

function inspectionInput(r: GscUrlInspection, inspectedAt: string): UrlInspectionInput {
  return {
    url: r.url,
    inspectedAt,
    verdict: r.verdict,
    coverageState: r.coverageState,
    indexingState: r.indexingState,
    pageFetchState: r.pageFetchState,
    robotsTxtState: r.robotsTxtState,
    lastCrawlTime: r.lastCrawlTime,
    googleCanonical: r.googleCanonical,
    userCanonical: r.userCanonical,
    crawledAs: r.crawledAs,
    richResultsVerdict: r.richResultsVerdict,
    richResultTypes: r.richResultTypes,
    richResultIssues: r.richResultIssues,
    error: null,
  };
}

function failedInspection(url: string, inspectedAt: string, error: string): UrlInspectionInput {
  return {
    url,
    inspectedAt,
    verdict: null,
    coverageState: null,
    indexingState: null,
    pageFetchState: null,
    robotsTxtState: null,
    lastCrawlTime: null,
    googleCanonical: null,
    userCanonical: null,
    crawledAs: null,
    richResultsVerdict: null,
    richResultTypes: [],
    richResultIssues: [],
    error: error.slice(0, 300),
  };
}

/**
 * Index coverage for one site: once a day the tracked URLs are refreshed from the sitemaps,
 * then due URLs are inspected (never inspected first, then those inspected longest ago), up to
 * GSC_INSPECTIONS_PER_DAY. Both run with spare capacity only (see `Unit.idle`). Reaching the
 * URL Inspection quota stops the inspections for the day without pausing Search Console.
 */
function indexCoverageUnits(o: {
  site: SiteConfig;
  gsc: GscClient;
  property: string;
  reader: SitemapReader;
  store: Store;
  budget: Budget;
  today: IsoDate;
  nowMs: number;
  config: SearchkeepConfig;
  get: (key: string) => string | null;
}): Unit[] {
  const { site, gsc, property, reader, store, budget, today, nowMs, config, get } = o;
  const units: Unit[] = [];
  const urlsKey = syncKeys.gscIndexUrls(site.id);
  if (get(urlsKey) !== today) {
    units.push({
      task: 'gsc.index_urls',
      siteId: site.id,
      source: 'gsc',
      backfill: false,
      idle: true,
      calls: 1,
      key: `gsc.index_urls:${site.id}:${today}`,
      run: async () => {
        const queue = (await store.listSitemaps(site.id, 'gsc')).map((m) => m.path).filter((u) => onSiteDomain(u, site.domain));
        const seen = new Set<string>();
        const urls = new Set<string>();
        // Complete only when every sitemap was read in full: only then are URLs that left the sitemaps dropped.
        let complete = queue.length > 0;
        let files = 0;
        while (queue.length > 0) {
          const next = queue.shift()!;
          if (seen.has(next)) continue;
          seen.add(next);
          if (files >= MAX_SITEMAP_FILES || urls.size >= MAX_INDEX_URLS) {
            complete = false;
            break;
          }
          if (files > 0) budget.spend('gsc');
          files++;
          let contents;
          try {
            contents = await reader.read(next);
          } catch {
            // One unreadable sitemap must not stop the others; its URLs are kept as they are.
            complete = false;
            continue;
          }
          if (contents.truncated) complete = false;
          for (const u of contents.urls) {
            if (urls.size >= MAX_INDEX_URLS) {
              complete = false;
              break;
            }
            if (inPropertyScope(u, property)) urls.add(u);
          }
          for (const m of contents.sitemaps) if (onSiteDomain(m, site.domain) && !seen.has(m)) queue.push(m);
        }
        const known = new Set(await store.listIndexUrls(site.id));
        const add = [...urls].filter((u) => !known.has(u));
        const remove = complete ? [...known].filter((u) => !urls.has(u)) : [];
        const n = await store.updateIndexUrls(site.id, add, remove, today);
        await store.setMeta(urlsKey, today);
        return n;
      },
      skip: () => store.setMeta(urlsKey, today),
    });
  }

  const quotaKey = syncKeys.gscInspections(site.id);
  const state = parseJson<{ day: IsoDate; done: number }>(get(quotaKey));
  let done = state?.day === today ? state.done : 0;
  const allowance = config.gsc.inspectionsPerDay;
  const unitsToday = Math.min(UNITS_PER_SITE_AND_RUN, Math.ceil(Math.max(0, allowance - done) / INSPECTIONS_PER_UNIT));
  for (let i = 0; i < unitsToday; i++) {
    units.push({
      task: 'gsc.inspect',
      siteId: site.id,
      source: 'gsc',
      backfill: false,
      idle: true,
      calls: 1,
      key: `gsc.inspect:${site.id}:${today}:${done}:${i}`,
      run: async () => {
        const left = allowance - done;
        if (left <= 0) {
          budget.refund('gsc', 1);
          return null;
        }
        const nowIso = new Date(nowMs).toISOString();
        const cutoff = new Date(nowMs - REINSPECT_DAYS * 86_400_000).toISOString();
        const due = await store.listUrlsToInspect(site.id, cutoff, Math.min(left, INSPECTIONS_PER_UNIT));
        if (due.length === 0) {
          budget.refund('gsc', 1);
          return null;
        }
        const results: UrlInspectionInput[] = [];
        let quotaReached = false;
        let failure: unknown = null;
        try {
          for (const url of due) {
            if (results.length > 0) {
              if (budget.left() < 1 || budget.expired()) break;
              budget.spend('gsc');
            }
            try {
              results.push(inspectionInput(await gsc.inspectUrl(property, url), nowIso));
            } catch (err) {
              // The daily URL Inspection quota: stop for today, but keep Search Console's other calls going.
              if (isRateLimited(err)) {
                quotaReached = true;
                break;
              }
              // A URL Google refuses to inspect (not in the property, malformed) is recorded and not retried before the others.
              if (err instanceof SourceError && (err.status === 400 || err.status === 404)) {
                results.push(failedInspection(url, nowIso, safeMessage(err)));
                continue;
              }
              throw err;
            }
          }
        } catch (err) {
          failure = err;
        }
        // What was inspected before a failure is kept; the failure then backs the task off.
        done = quotaReached ? allowance : done + results.length;
        await store.setMeta(quotaKey, JSON.stringify({ day: today, done }));
        const n = results.length ? await store.writeUrlInspections(site.id, results) : 0;
        if (failure) throw failure;
        return n;
      },
      skip: async () => {
        done = allowance;
        await store.setMeta(quotaKey, JSON.stringify({ day: today, done }));
      },
    });
  }
  return units;
}

export { BudgetExceeded };
