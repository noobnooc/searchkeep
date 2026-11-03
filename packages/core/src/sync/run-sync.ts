import type { SearchkeepConfig } from '../config.js';
import { classifyBrandQueries } from '../brand.js';
import { AI_CRAWLERS, classifyCrawler } from '../crawlers.js';
import { addDays, addMonths, toIsoDate } from '../dates.js';
import { safeMessage } from '../errors.js';
import type { SourceClients } from '../sources.js';
import type { Store } from '../store.js';
import type { CrawlerRequestInput, IsoDate, SearchFactInput, SiteConfig, SourceId, SyncRunRecord, SyncTaskResult } from '../types.js';
import { normalizePage } from '../url.js';

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
  log?: (msg: string) => void;
}

/** How many days the Cloudflare GraphQL datasets keep data we backfill from. */
const CF_CRAWLER_LOOKBACK_DAYS = 30;
const CF_RUM_LOOKBACK_DAYS = 90;
/** GSC: re-pull at least this many recent days to catch late data. */
const GSC_REPULL_DAYS = 4;
/** GSC: never try to fill gaps further back than this in the daily job. */
const GSC_MAX_GAP_DAYS = 30;

interface Unit {
  task: string;
  siteId: string;
  source: SourceId;
  /** Backfill units stop when the daily write budget is spent. */
  backfill: boolean;
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

/**
 * One sync pass. Safe to call often (the Worker runs it every 15 minutes):
 * it does whatever work is due, within call, time and write budgets, and keeps
 * its progress in the store so the next invocation continues where this one
 * stopped. Daily increments always run before history backfill.
 */
export async function runSync(ctx: SyncContext): Promise<SyncRunRecord> {
  const now = ctx.now ?? new Date();
  const today = toIsoDate(now);
  const started = Date.now();
  const timeBudget = ctx.timeBudgetMs ?? 25_000;
  const { store, config } = ctx;

  await store.syncSites(config.sites);
  const runId = await store.startSyncRun({ startedAt: now.toISOString(), trigger: ctx.trigger, status: 'running', rowsWritten: 0 });

  const writesKey = `sync:writes:${today}`;
  let writesToday = Number((await store.getMeta(writesKey)) ?? '0') || 0;
  let callsLeft = config.sync.maxCallsPerRun;
  let rowsWritten = 0;
  const results = new Map<string, SyncTaskResult>();
  const failedTasks = new Set<string>();

  const record = (u: Unit, status: SyncTaskResult['status'], rows: number, message?: string) => {
    const key = `${u.task}|${u.siteId}`;
    const prev = results.get(key);
    if (prev) {
      prev.rowsWritten += rows;
      if (status === 'error') {
        prev.status = 'error';
        if (message) prev.message = message;
      }
    } else {
      results.set(key, { task: u.task, siteId: u.siteId, source: u.source, status, rowsWritten: rows, ...(message ? { message } : {}) });
    }
  };

  let stoppedFor: string | null = null;
  let inflight = await metaJson<{ key: string; attempts: number }>(store, INFLIGHT_KEY);
  try {
    const units = await planUnits(ctx, today);
    for (const unit of units) {
      if (failedTasks.has(`${unit.task}|${unit.siteId}`)) continue;
      if (Date.now() - started > timeBudget) {
        stoppedFor = 'time budget reached';
        break;
      }
      if (unit.calls > callsLeft) {
        stoppedFor = 'API call budget reached';
        break;
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
      const attempts = inflight && inflight.key === unit.key ? inflight.attempts + 1 : 1;
      await store.setMeta(INFLIGHT_KEY, JSON.stringify({ key: unit.key, attempts }));
      inflight = { key: unit.key, attempts };
      callsLeft -= unit.calls;
      try {
        const rows = await unit.run();
        rowsWritten += rows;
        writesToday += rows;
        record(unit, 'ok', rows);
        await store.deleteMeta(INFLIGHT_KEY);
        inflight = null;
      } catch (err) {
        await store.deleteMeta(INFLIGHT_KEY);
        inflight = null;
        if (err instanceof BudgetExceeded) {
          stoppedFor = 'API call budget reached';
          break;
        }
        const message = safeMessage(err);
        ctx.log?.(`sync ${unit.task} ${unit.siteId}: ${message}`);
        failedTasks.add(`${unit.task}|${unit.siteId}`);
        record(unit, 'error', 0, message);
      }
    }

    for (const site of config.sites) {
      await classifyBrandQueries(store, config, site);
    }

    await store.setMeta(writesKey, String(writesToday));
    const details = [...results.values()];
    const status: SyncRunRecord['status'] =
      details.length === 0
        ? 'skipped'
        : details.some((d) => d.status === 'error')
          ? details.some((d) => d.status === 'ok')
            ? 'partial'
            : 'error'
          : stoppedFor
            ? 'partial'
            : 'ok';
    const message = details.length === 0 ? 'Nothing due.' : stoppedFor ? `Stopped early: ${stoppedFor}; continues next run.` : null;
    const patch: Partial<SyncRunRecord> = { finishedAt: new Date().toISOString(), status, rowsWritten, message, details };
    await store.finishSyncRun(runId, patch);
    await store.setMeta('sync:last_run', JSON.stringify({ at: patch.finishedAt, status, rowsWritten }));
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

async function metaJson<T>(store: Store, key: string): Promise<T | null> {
  const v = await store.getMeta(key);
  if (!v) return null;
  try {
    return JSON.parse(v) as T;
  } catch {
    return null;
  }
}

async function planUnits(ctx: SyncContext, today: IsoDate): Promise<Unit[]> {
  const { config, clients, store } = ctx;
  const daily: Unit[] = [];
  const backfill: Unit[] = [];
  const yesterday = addDays(today, -1);

  for (const site of config.sites) {
    // ---------------- Google Search Console ----------------
    if (clients.gsc && site.gscProperty) {
      const gsc = clients.gsc;
      const property = site.gscProperty;
      const rowsPerDay = config.gsc.rowsPerDay;

      const pullDay = async (date: IsoDate): Promise<number> => {
        let written = 0;
        const totals = await gsc.searchAnalytics({ property, startDate: date, endDate: date, dimensions: ['date'], rowLimit: 10 });
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
      const doneKey = `gsc:daily:${site.id}`;
      const progress = (await metaJson<{ day: IsoDate; pending: IsoDate[] }>(store, `${doneKey}:progress`)) ?? null;
      let pending: IsoDate[];
      if (progress && progress.day === today) {
        pending = progress.pending;
      } else {
        const latest = await store.latestDate(site.id, 'gsc');
        let start = addDays(today, -GSC_REPULL_DAYS);
        if (latest && addDays(latest, -3) < start) start = addDays(latest, -3);
        const floor = addDays(today, -GSC_MAX_GAP_DAYS);
        if (start < floor) start = floor;
        pending = [];
        for (let d = yesterday; d >= start; d = addDays(d, -1)) pending.push(d);
        await store.setMeta(`${doneKey}:progress`, JSON.stringify({ day: today, pending }));
        // The backfill cursor starts where the first increment begins.
        if (!(await store.getMeta(`gsc:backfill:${site.id}`))) await store.setMeta(`gsc:backfill:${site.id}`, start);
      }
      for (const date of [...pending]) {
        const done = async () => {
          pending = pending.filter((d) => d !== date);
          await store.setMeta(`${doneKey}:progress`, JSON.stringify({ day: today, pending }));
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
      if ((await store.getMeta(`gsc:sitemaps:${site.id}`)) !== today) {
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
            await store.setMeta(`gsc:sitemaps:${site.id}`, today);
            return n;
          },
          skip: () => store.setMeta(`gsc:sitemaps:${site.id}`, today),
        });
      }

      // History backfill, newest to oldest, one day per unit.
      const target = addMonths(today, -config.sync.backfillMonths);
      const cursor = await store.getMeta(`gsc:backfill:${site.id}`);
      if (cursor && cursor > target) {
        let c = cursor;
        for (let i = 0; i < 60 && addDays(c, -1) >= target; i++) {
          const date = addDays(c, -1);
          backfill.push({
            task: 'gsc.backfill',
            siteId: site.id,
            source: 'gsc',
            backfill: true,
            calls: callsPerDay,
            key: `gsc.backfill:${site.id}:${date}`,
            run: async () => {
              const n = await pullDay(date);
              await store.setMeta(`gsc:backfill:${site.id}`, date);
              return n;
            },
            skip: () => store.setMeta(`gsc:backfill:${site.id}`, date),
          });
          c = date;
        }
      }
    }

    // ---------------- Bing Webmaster Tools ----------------
    if (clients.bing && site.bingSiteUrl) {
      const bing = clients.bing;
      const siteUrl = site.bingSiteUrl;
      const datasets: Array<{ name: string; run: () => Promise<number> }> = [
        {
          name: 'bing.traffic',
          run: async () => {
            const rows = await bing.getRankAndTrafficStats(siteUrl);
            return store.writeSearchFacts(
              site.id,
              'bing',
              rows.map((r) => ({ date: r.date, kind: 'total', clicks: r.clicks, impressions: r.impressions })),
            );
          },
        },
        {
          name: 'bing.queries',
          run: async () => {
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
        },
        {
          name: 'bing.pages',
          run: async () => {
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
        },
        {
          name: 'bing.crawl_issues',
          run: async () => {
            const rows = await bing.getCrawlIssues(siteUrl);
            return store.replaceCrawlIssues(
              site.id,
              'bing',
              rows.map((r) => ({ url: r.url, issue: r.issue, httpCode: r.httpCode, detectedAt: today })),
            );
          },
        },
      ];
      for (const ds of datasets) {
        const key = `${ds.name}:${site.id}`;
        if ((await store.getMeta(key)) === today) continue;
        daily.push({
          task: ds.name,
          siteId: site.id,
          source: 'bing',
          backfill: false,
          calls: 1,
          key: `${ds.name}:${site.id}:${today}`,
          run: async () => {
            const n = await ds.run();
            await store.setMeta(key, today);
            return n;
          },
          skip: () => store.setMeta(key, today),
        });
      }
    }

    // ---------------- Cloudflare ----------------
    if (clients.cloudflare) {
      const cf = clients.cloudflare;
      if (site.cloudflareZoneId) {
        const zoneId = site.cloudflareZoneId;
        const key = `cf:crawlers:${site.id}`;
        const last = await store.getMeta(key);
        let d = last ? addDays(last, 1) : addDays(today, -CF_CRAWLER_LOOKBACK_DAYS);
        if (d < addDays(today, -CF_CRAWLER_LOOKBACK_DAYS)) d = addDays(today, -CF_CRAWLER_LOOKBACK_DAYS);
        const patterns = AI_CRAWLERS.map((c) => c.match);
        for (; d <= yesterday; d = addDays(d, 1)) {
          const date = d;
          daily.push({
            task: 'cloudflare.ai_crawlers',
            siteId: site.id,
            source: 'cloudflare',
            backfill: false,
            calls: 1,
            key: `cloudflare.ai_crawlers:${site.id}:${date}`,
            skip: () => store.setMeta(key, date),
            run: async () => {
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
              const n = await store.writeCrawlerRequests(site.id, [...merged.values()]);
              await store.setMeta(key, date);
              return n;
            },
          });
        }
      }
      if (site.webAnalyticsSiteTag && ctx.config.cloudflare.accountId) {
        const accountId = ctx.config.cloudflare.accountId;
        const tag = site.webAnalyticsSiteTag;
        const key = `cf:rum:${site.id}`;
        const last = await store.getMeta(key);
        let d = last ? addDays(last, 1) : addDays(today, -CF_RUM_LOOKBACK_DAYS);
        if (d < addDays(today, -CF_RUM_LOOKBACK_DAYS)) d = addDays(today, -CF_RUM_LOOKBACK_DAYS);
        for (; d <= yesterday; d = addDays(d, 1)) {
          const date = d;
          daily.push({
            task: 'cloudflare.web_analytics',
            siteId: site.id,
            source: 'cloudflare',
            backfill: false,
            calls: 2,
            key: `cloudflare.web_analytics:${site.id}:${date}`,
            skip: () => store.setMeta(key, date),
            run: async () => {
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
              await store.setMeta(key, date);
              return n;
            },
          });
        }
      }
    }
  }
  return [...daily, ...backfill];
}

export { BudgetExceeded };
