/**
 * Sync units for apps (ADR 0009), planned next to the sites' units and run by `runSync` with the
 * same call, time and write budgets, backoff and interruption handling.
 *
 * App Store Connect reports come as files in a chain (request → reports → instances → segments).
 * A unit that discovers the next step enqueues its units at the end of the current run, so a
 * first sync gets going in one pass; whatever does not fit continues next run from the state
 * kept under `app:` meta keys. Instances of one report are read oldest first: a newer instance
 * replaces the days it covers, so the newest one always wins.
 */
import type { SearchkeepConfig } from '../config.js';
import { addDays, daysBetween } from '../dates.js';
import { safeMessage } from '../errors.js';
import { SourceError } from '../http.js';
import type { AscClient, AscReportRequest, SourceClients } from '../sources.js';
import type { Store } from '../store.js';
import type { AppChartRankInput, AppConfig, AppListingValue, AppRatingInput, AppVitalsInput, IsoDate } from '../types.js';
import {
  appTaskId,
  parseJson,
  syncKeys,
  type AscPending,
  type AscReportIds,
  type AscRequestKind,
  type AppStorePublicPart,
  type AscRequestState,
  type PlayListing,
  type ReviewCursor,
  type AscSalesState,
} from '../sync/state.js';
import type { Budget, Unit } from '../sync/unit.js';
import {
  ascReviewInput,
  ASC_REPORTS,
  classifyPlayFile,
  PLAY_COLLECTORS,
  PLAY_FINANCIAL_KINDS,
  PLAY_LISTING_VERSION,
  playReadMark,
  playFinancialPrefixes,
  playPrefixes,
  salesSummaryCollector,
  type AscReportSpec,
  type SalesApp,
} from './reports.js';
import { appStorefronts } from './storefronts.js';

export interface AppSyncContext {
  store: Store;
  config: SearchkeepConfig;
  clients: SourceClients;
  log?: (msg: string) => void;
}

export interface AppPlanArgs {
  ctx: AppSyncContext;
  today: IsoDate;
  /** The run's clock (milliseconds). */
  nowMs?: number;
  /** Meta read at the start of the run. */
  get: (key: string) => string | null;
  budget: Budget;
  /** Adds a unit at the end of the current run (for steps discovered while running). */
  enqueue: (unit: Unit) => void;
}

/** With a snapshot request, the first sync of an ongoing report reads only this many recent instances. */
export const ASC_RECENT_INSTANCES = 6;
/** Report ids of a request are listed again after this many days. */
const ASC_REPORT_IDS_DAYS = 7;
/** App Store reviews read on an app's first sync (200 per page). */
export const ASC_REVIEW_HISTORY_PAGES = 10;
/** Play crash and ANR rates are read for this many days on the first sync; Google keeps more. */
export const PLAY_VITALS_LOOKBACK_DAYS = 60;
/** Play Developer Reporting data is complete about two days after a day ends (Pacific time). */
const PLAY_VITALS_LAG_DAYS = 2;

type Place = (unit: Unit) => void;

/** Units for every app: the latest data per app (round-robin with the sites), then history. */
export function planAppUnits(args: AppPlanArgs): { daily: Unit[][]; history: Unit[] } {
  const { ctx } = args;
  const daily: Unit[][] = [];
  const history: Unit[] = [];
  for (const app of ctx.config.apps) {
    const list: Unit[] = [];
    daily.push(list);
    const place: Place = (u) => (u.backfill ? history.push(u) : list.push(u));
    if (ctx.clients.asc && app.appleId) planAppStore(args, app, ctx.clients.asc, place);
    if (ctx.clients.play && app.playPackage && ctx.config.play.bucket) planPlay(args, app, place);
    if (ctx.clients.appStore && app.appleId) planPublic(args, app, list);
    if (ctx.clients.asc?.listingSnapshot && app.appleId) planListing(args, app, 'apple', list);
    if (ctx.clients.play?.listingSnapshot && app.playPackage && ctx.config.play.metadata) planListing(args, app, 'play', list);
  }
  const salesOwner = ctx.config.apps.find((a) => a.appleId);
  if (ctx.clients.asc?.salesReport && ctx.config.asc.vendorNumber && salesOwner) {
    const i = ctx.config.apps.indexOf(salesOwner);
    planSales(args, ctx.clients.asc, ctx.config.asc.vendorNumber, (u) => (u.backfill ? history.push(u) : daily[i]!.push(u)));
  }
  return { daily, history };
}

// ------------------------------------------------------------------ Store changes

/**
 * Once a day, a snapshot of the app's store presence (versions, listings, app info; Google Play
 * listings and tracks through an edit that is never committed); fields that differ from the last
 * snapshot are recorded as changes. A key that may not read them is noted, not retried all day.
 */
function planListing(args: AppPlanArgs, app: AppConfig, storeId: 'apple' | 'play', list: Unit[]): void {
  const { ctx, today, get, budget } = args;
  const key = syncKeys.listingChecked(app.id, storeId);
  const saved = parseJson<{ day?: IsoDate; problem?: string }>(get(key));
  if (saved?.day === today) return;
  const calls = 4;
  list.push({
    task: storeId === 'apple' ? 'asc.listing' : 'play.listing',
    siteId: appTaskId(app.id),
    source: storeId === 'apple' ? 'asc' : 'play',
    backfill: false,
    calls,
    key: `${storeId}.listing:${app.id}:${today}`,
    run: async () => {
      let snap: { scopes: string[]; values: AppListingValue[]; calls: number };
      try {
        snap =
          storeId === 'apple'
            ? await ctx.clients.asc!.listingSnapshot!(app.appleId!)
            : await ctx.clients.play!.listingSnapshot!(app.playPackage!);
      } catch (err) {
        if (!(err instanceof SourceError) || (err.status !== 403 && err.status !== 401)) throw err;
        await ctx.store.setMeta(key, JSON.stringify({ day: today, problem: safeMessage(err) }));
        ctx.log?.(`${storeId} ${app.id}: the key may not read the store listing (${err.status})`);
        return null;
      }
      // Calls beyond the reserved ones (more platforms) were made already; take them from the budget.
      for (let i = calls; i < snap.calls; i++) {
        try {
          budget.spend(storeId === 'apple' ? 'asc' : 'play');
        } catch {
          break;
        }
      }
      const changes = await ctx.store.snapshotAppListing(app.id, storeId, today, snap.scopes, snap.values);
      await ctx.store.setMeta(key, JSON.stringify({ day: today }));
      return changes;
    },
    skip: () => ctx.store.setMeta(key, JSON.stringify({ day: today })),
  });
}

// ------------------------------------------------------------------ App Store Sales and Trends

const maxDay = (a: IsoDate, b: IsoDate) => (a > b ? a : b);

/** Apple keeps daily Sales and Trends reports for a year. */
export const ASC_SALES_HISTORY_DAYS = 365;
/** Days read per unit before the next one takes over (each is one call). */
const ASC_SALES_DAYS_PER_UNIT = 30;
/** A day's report is out the next morning (Pacific time); a missing newer day is asked again after this. */
const ASC_SALES_RETRY_MS = 3 * 3_600_000;

/**
 * Summary Sales of the vendor account, one call per day, split between the apps by Apple ID and
 * SKU (ADR 0011). The latest days first, then history back a year, newest first.
 */
function planSales(args: AppPlanArgs, asc: AscClient, vendorNumber: string, place: Place): void {
  const { ctx, today, get, budget } = args;
  const { store } = ctx;
  const nowMs = args.nowMs ?? Date.now();
  const appleApps = ctx.config.apps.filter((a) => a.appleId);
  const siteId = appTaskId(appleApps[0]!.id);
  const state = parseJson<AscSalesState>(get(syncKeys.ascSales)) ?? {};
  const yesterday = addDays(today, -1);
  const floor = addDays(today, -ASC_SALES_HISTORY_DAYS);

  /** Apps with their SKUs (refreshed daily; in-app purchase rows name the app by its SKU). */
  const salesApps = async (): Promise<SalesApp[]> => {
    let saved = parseJson<{ day: IsoDate; skus: Record<string, string> }>(await store.getMeta(syncKeys.ascSkus));
    if (!saved || saved.day !== today) {
      budget.spend('asc');
      const skus: Record<string, string> = {};
      for (const a of await asc.listApps()) if (a.sku) skus[a.id] = a.sku;
      saved = { day: today, skus };
      await store.setMeta(syncKeys.ascSkus, JSON.stringify(saved));
    }
    return appleApps.map((a) => ({ appId: a.id, appleId: a.appleId!, sku: saved!.skus[a.appleId!] ?? null }));
  };

  const readDay = async (apps: SalesApp[], day: IsoDate): Promise<{ written: number; found: boolean }> => {
    const collector = salesSummaryCollector(apps);
    const rows = await asc.salesReport!(vendorNumber, day, (row) => collector.add(row));
    // No report: no sales that day (every app's day is cleared), unless it is just not out yet.
    return { written: await collector.write(store, [day]), found: rows !== null };
  };

  const save = async (patch: Partial<AscSalesState>) => {
    const cur = parseJson<AscSalesState>(await store.getMeta(syncKeys.ascSales)) ?? {};
    const next = { ...cur, ...patch };
    // The first day read is where history starts from.
    if (patch.through && !cur.from) next.from = patch.through;
    for (const k of Object.keys(next) as Array<keyof AscSalesState>) if (next[k] === undefined) delete next[k];
    await store.setMeta(syncKeys.ascSales, JSON.stringify(next));
  };

  // Latest days: after `through` up to yesterday (at most a month; history fills the rest).
  const waiting = state.waitUntil && Date.parse(state.waitUntil) > nowMs;
  if ((!state.through || state.through < yesterday) && !waiting) {
    place({
      task: 'asc.sales',
      siteId,
      source: 'asc',
      backfill: false,
      calls: 1,
      key: `asc.sales:${today}:${state.through ?? 'none'}`,
      run: async () => {
        const apps = await salesApps();
        let written = 0;
        const oldest = addDays(yesterday, -ASC_SALES_DAYS_PER_UNIT + 1);
        // First run: from three days back, so at least one day that is surely out starts the history.
        const start = state.through ? maxDay(addDays(state.through, 1), oldest) : addDays(today, -3);
        let n = 0;
        for (let day = start; day <= yesterday; day = addDays(day, 1)) {
          if (n++ > 0) budget.spend('asc');
          const res = await readDay(apps, day);
          written += res.written;
          // The two newest days may simply not be out yet: try again later.
          if (!res.found && day >= addDays(today, -2)) {
            await save({ waitUntil: new Date(nowMs + ASC_SALES_RETRY_MS).toISOString() });
            break;
          }
          await save({ through: day, waitUntil: undefined });
        }
        return written;
      },
      skip: () => save({ waitUntil: new Date(nowMs + ASC_SALES_RETRY_MS).toISOString() }),
    });
  }

  // History: before `from`, back a year, newest first.
  const from = state.from;
  if (from && from > floor) {
    place({
      task: 'asc.sales_history',
      siteId,
      source: 'asc',
      backfill: true,
      date: addDays(from, -1),
      calls: 1,
      key: `asc.sales_history:${from}`,
      run: async () => {
        const apps = await salesApps();
        let written = 0;
        let n = 0;
        for (let day = addDays(from, -1); day >= floor && n < ASC_SALES_DAYS_PER_UNIT; day = addDays(day, -1)) {
          if (n++ > 0) {
            if (budget.expired()) break;
            budget.spend('asc');
          }
          written += (await readDay(apps, day)).written;
          await save({ from: day });
        }
        return written;
      },
      // A day that keeps failing is passed over.
      skip: () => save({ from: addDays(from, -1) }),
    });
  }
}

// ------------------------------------------------------------------ App Store

function planAppStore(args: AppPlanArgs, app: AppConfig, asc: AscClient, place: Place): void {
  const { ctx, today, get, budget, enqueue } = args;
  const { store } = ctx;
  const appleId = app.appleId!;
  const siteId = appTaskId(app.id);
  const state = parseJson<AscRequestState>(get(syncKeys.ascRequests(app.id))) ?? {};

  const afterRequests = (st: AscRequestState, to: Place) => {
    if (st.ongoing) planReports(st, 'ongoing', st.ongoing, to);
    if (st.snapshot) planReports(st, 'snapshot', st.snapshot, to);
  };

  if (state.checkedOn !== today) {
    place({
      task: 'asc.requests',
      siteId,
      source: 'asc',
      backfill: false,
      calls: 1,
      key: `asc.requests:${app.id}:${today}`,
      run: async () => {
        const next = await checkRequests(asc, appleId, state, budget, today);
        await store.setMeta(syncKeys.ascRequests(app.id), JSON.stringify(next));
        afterRequests(next, enqueue);
        return 0;
      },
      skip: () => store.setMeta(syncKeys.ascRequests(app.id), JSON.stringify({ ...state, checkedOn: today })),
    });
  } else afterRequests(state, place);

  // Customer reviews, once a day.
  const cursor = parseJson<ReviewCursor & { checkedOn?: IsoDate }>(get(syncKeys.ascReviews(app.id))) ?? {};
  if (cursor.checkedOn !== today) {
    place({
      task: 'asc.reviews',
      siteId,
      source: 'asc',
      backfill: false,
      calls: 1,
      key: `asc.reviews:${app.id}:${today}`,
      run: async () => {
        const maxPages = cursor.historyDone ? 5 : ASC_REVIEW_HISTORY_PAGES;
        let next: string | null = null;
        let newest = cursor.newest;
        let written = 0;
        let pages = 0;
        let reachedEnd = false;
        for (;;) {
          if (pages > 0) budget.spend('asc');
          const page = await asc.listReviews(appleId, { limit: 200, cursor: next });
          pages++;
          const rows = page.reviews.map(ascReviewInput).filter((r) => r !== null);
          const fresh = cursor.newest ? rows.filter((r) => r.createdAt > cursor.newest!) : rows;
          if (fresh.length) written += await store.writeAppReviews(app.id, 'apple', fresh);
          for (const r of rows) if (!newest || r.createdAt > newest) newest = r.createdAt;
          next = page.next;
          // Newest first: once a page reaches reviews already synced, the rest are too.
          if (!next || (cursor.newest && fresh.length < rows.length)) {
            reachedEnd = !next;
            break;
          }
          if (pages >= maxPages) break;
        }
        const historyDone = cursor.historyDone || reachedEnd || pages >= ASC_REVIEW_HISTORY_PAGES;
        await store.setMeta(
          syncKeys.ascReviews(app.id),
          JSON.stringify({ ...(newest ? { newest } : {}), historyDone, checkedOn: today } satisfies ReviewCursor & { checkedOn: IsoDate }),
        );
        return written;
      },
      skip: () => store.setMeta(syncKeys.ascReviews(app.id), JSON.stringify({ ...cursor, checkedOn: today })),
    });
  }

  /** Report ids of a request; listed again weekly or when the request changed. */
  function planReports(st: AscRequestState, kind: AscRequestKind, requestId: string, to: Place) {
    const ids = parseJson<AscReportIds>(get(syncKeys.ascReports(app.id, kind)));
    // Apple creates a request's reports a day or two after it was made: an empty list is checked
    // again the next day, a full one weekly.
    const found = ids ? Object.keys(ids.reports).length : 0;
    // A report kind added since the last listing (new Searchkeep version) is looked for right away.
    const looked = new Set(ids?.looked ?? Object.keys(ids?.reports ?? {}));
    const fresh =
      ids &&
      ids.requestId === requestId &&
      ASC_REPORTS.every((s) => looked.has(s.key)) &&
      (ids.checkedOn === today || (found > 0 && daysBetween(ids.checkedOn, today) < ASC_REPORT_IDS_DAYS));
    if (fresh) {
      for (const spec of ASC_REPORTS) if (ids.reports[spec.key]) planInstances(st, kind, spec, ids.reports[spec.key]!, to);
      return;
    }
    to({
      task: 'asc.reports',
      siteId,
      source: 'asc',
      backfill: kind === 'snapshot',
      ...(kind === 'snapshot' ? { date: today } : {}),
      calls: 1,
      key: `asc.reports:${app.id}:${kind}:${today}`,
      run: async () => {
        const reports = await asc.listReports(requestId);
        const map: Record<string, string> = {};
        for (const spec of ASC_REPORTS) {
          const hit = reports.find((r) => spec.match(r.name));
          if (hit) map[spec.key] = hit.id;
        }
        const saved: AscReportIds = { requestId, checkedOn: today, reports: map, looked: ASC_REPORTS.map((s) => s.key) };
        await store.setMeta(syncKeys.ascReports(app.id, kind), JSON.stringify(saved));
        for (const spec of ASC_REPORTS) if (map[spec.key]) planInstances(st, kind, spec, map[spec.key]!, enqueue);
        return 0;
      },
      skip: async () => undefined,
    });
  }

  /** The instances of one report not read yet, listed once a day, then one unit per instance. */
  function planInstances(st: AscRequestState, kind: AscRequestKind, spec: AscReportSpec, reportId: string, to: Place) {
    const pendingKey = syncKeys.ascPending(app.id, kind, spec.key);
    const pending = parseJson<AscPending>(get(pendingKey));
    const task = `asc.${spec.key}${kind === 'snapshot' ? '_history' : ''}`;
    if (pending && pending.listedOn === today) {
      for (const inst of pending.instances) to(instanceUnit(kind, spec, task, inst));
      return;
    }
    to({
      task,
      siteId,
      source: 'asc',
      backfill: kind === 'snapshot',
      ...(kind === 'snapshot' ? { date: today } : {}),
      calls: 1,
      key: `${task}:${app.id}:list:${today}`,
      run: async () => {
        const all = (await asc.listInstances(reportId, 'DAILY')).sort(
          (a, b) => a.processingDate.localeCompare(b.processingDate) || a.id.localeCompare(b.id),
        );
        let todo: typeof all;
        if (kind === 'ongoing') {
          const cursor = await store.getMeta(syncKeys.ascInstance(app.id, spec.key));
          todo = cursor ? all.filter((i) => i.processingDate > cursor) : st.snapshot ? all.slice(-ASC_RECENT_INSTANCES) : all;
        } else {
          const done = new Set(parseJson<string[]>(await store.getMeta(syncKeys.ascSnapshot(app.id, spec.key))) ?? []);
          todo = all.filter((i) => !done.has(i.id));
        }
        const next: AscPending = { listedOn: today, instances: todo.map((i) => ({ id: i.id, processingDate: i.processingDate })) };
        await store.setMeta(pendingKey, JSON.stringify(next));
        for (const inst of next.instances) enqueue(instanceUnit(kind, spec, task, inst));
        return 0;
      },
      skip: () => store.setMeta(pendingKey, JSON.stringify({ listedOn: today, instances: [] } satisfies AscPending)),
    });
  }

  /** Reads every segment of one instance and writes it; then the instance counts as read. */
  function instanceUnit(kind: AscRequestKind, spec: AscReportSpec, task: string, inst: { id: string; processingDate: IsoDate }): Unit {
    const pendingKey = syncKeys.ascPending(app.id, kind, spec.key);
    const done = async () => {
      const pending = parseJson<AscPending>(await store.getMeta(pendingKey));
      if (pending) {
        pending.instances = pending.instances.filter((i) => i.id !== inst.id);
        await store.setMeta(pendingKey, JSON.stringify(pending));
      }
      if (kind === 'ongoing') {
        const cursor = await store.getMeta(syncKeys.ascInstance(app.id, spec.key));
        if (!cursor || inst.processingDate > cursor) await store.setMeta(syncKeys.ascInstance(app.id, spec.key), inst.processingDate);
      } else {
        const key = syncKeys.ascSnapshot(app.id, spec.key);
        const list = parseJson<string[]>(await store.getMeta(key)) ?? [];
        if (!list.includes(inst.id)) await store.setMeta(key, JSON.stringify([...list, inst.id].slice(-400)));
      }
    };
    return {
      task,
      siteId,
      source: 'asc',
      backfill: kind === 'snapshot',
      // One date for every instance: history is sorted newest date first, and a stable sort keeps
      // these in the oldest-first order they were planned in (a newer instance must win).
      ...(kind === 'snapshot' ? { date: today } : {}),
      calls: 2,
      key: `${task}:${app.id}:${inst.id}`,
      run: async () => {
        // History fills only the days before the ongoing report's first day, so the newer numbers win.
        // Apple may make no daily instance while a report has nothing in it (no downloads or purchases
        // that day), so for a small app that first day can be weeks away or never come. Until then the
        // whole history is written: an ongoing instance read later replaces every day it covers.
        const before: IsoDate | null = kind === 'snapshot' ? await store.getMeta(syncKeys.ascFrom(app.id, spec.key)) : null;
        const segments = await asc.listSegments(inst.id);
        const collector = spec.collector();
        for (let i = 0; i < segments.length; i++) {
          if (i > 0) budget.spend('asc');
          await asc.readSegment(segments[i]!, (row) => collector.add(row));
        }
        const res = await collector.write(store, app.id, before);
        if (kind === 'ongoing' && res.oldest) {
          const from = await store.getMeta(syncKeys.ascFrom(app.id, spec.key));
          if (!from || res.oldest < from) await store.setMeta(syncKeys.ascFrom(app.id, spec.key), res.oldest);
        }
        await done();
        return res.written;
      },
      skip: done,
    };
  }
}

/**
 * Finds the app's report requests with the Sales and Reports key. If the key may not list them,
 * the ids stored when the reports were started are used.
 */
async function checkRequests(
  asc: AscClient,
  appleId: string,
  prev: AscRequestState,
  budget: Budget,
  today: IsoDate,
): Promise<AscRequestState> {
  let list: AscReportRequest[];
  try {
    list = await asc.listReportRequests(appleId);
  } catch (err) {
    if (!(err instanceof SourceError) || err.status !== 403) throw err;
    if (!prev.ongoing) {
      return {
        checkedOn: today,
        problem: 'App Store reports are not started for this app (or the key cannot see them). Start them in Settings → Apps.',
      };
    }
    // The key may read reports but not list requests: check the stored ongoing request directly.
    budget.spend('asc');
    try {
      const r = await asc.getReportRequest(prev.ongoing);
      return {
        ...prev,
        stopped: r.stoppedDueToInactivity,
        checkedOn: today,
        ...(r.stoppedDueToInactivity ? { problem: STOPPED } : { problem: undefined }),
      };
    } catch (e) {
      return { ...prev, checkedOn: today, problem: `Could not check the App Store report request: ${safeMessage(e)}` };
    }
  }
  const ongoingAll = list.filter((r) => r.accessType === 'ONGOING');
  const ongoing = ongoingAll.find((r) => !r.stoppedDueToInactivity) ?? ongoingAll[0];
  const snapshots = list.filter((r) => r.accessType === 'ONE_TIME_SNAPSHOT');
  const snapshot = snapshots.find((r) => r.id === prev.snapshot) ?? snapshots.at(-1);
  const next: AscRequestState = { checkedOn: today };
  if (ongoing) next.ongoing = ongoing.id;
  if (snapshot) next.snapshot = snapshot.id;
  if (prev.snapshotRequestedOn) next.snapshotRequestedOn = prev.snapshotRequestedOn;
  if (ongoing?.stoppedDueToInactivity) {
    next.stopped = true;
    next.problem = STOPPED;
  } else if (!ongoing) next.problem = 'App Store reports are not started for this app yet. Start them in Settings → Apps.';
  return next;
}

const STOPPED =
  'Apple stopped generating App Store reports for this app (no downloads for a long time). Start them again in Settings → Apps.';

// ------------------------------------------------------------------ Google Play

function monthEnd(month: string): IsoDate {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(4, 6));
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

function planPlay(args: AppPlanArgs, app: AppConfig, place: Place): void {
  const { ctx, today, get, budget, enqueue } = args;
  const { store } = ctx;
  const play = ctx.clients.play!;
  const bucket = ctx.config.play.bucket!;
  const pkg = app.playPackage!;
  const siteId = appTaskId(app.id);
  /** This month and last month are the latest data; older months are history. */
  const recentMonths = new Set([
    today.slice(0, 7).replace('-', ''),
    addDays(`${today.slice(0, 7)}-01`, -1)
      .slice(0, 7)
      .replace('-', ''),
  ]);

  const financeKey = syncKeys.playFinanceListing(app.id);
  const financeDenied = async () => parseJson<PlayListing>(await store.getMeta(financeKey))?.finance === 'denied';
  /**
   * Without "View financial data" the financial files can still be listed, but reading one answers
   * 403: today's financial listing is then emptied and marked denied, and the rest goes on.
   */
  const denyFinance = async (name: string) => {
    const saved = parseJson<PlayListing>(await store.getMeta(financeKey));
    await store.setMeta(
      financeKey,
      JSON.stringify({ day: saved?.day ?? today, v: PLAY_LISTING_VERSION, objects: [], finance: 'denied' } satisfies PlayListing),
    );
    ctx.log?.(`play ${app.id}: ${name.slice(0, 120)} answered 403; revenue and subscriptions need "View financial data"`);
  };

  const planObjects = (objects: PlayListing['objects'], to: Place, fresh: boolean) => {
    for (const obj of objects) {
      const info = classifyPlayFile(obj.name, pkg);
      if (!info) continue;
      const financial = PLAY_FINANCIAL_KINDS.includes(info.kind);
      const key = syncKeys.playObject(app.id, obj.name);
      // A file read by an older reader of its kind is read again.
      const mark = playReadMark(info.kind, obj.generation);
      // Planned from today's listing: skip files already read (the meta read at plan time may be stale for new listings).
      if (!fresh && get(key) === mark) continue;
      const recent = recentMonths.has(info.month);
      to({
        task: `play.${info.kind}${recent ? '' : '_history'}`,
        siteId,
        source: 'play',
        backfill: !recent,
        ...(recent ? {} : { date: monthEnd(info.month) }),
        calls: 1,
        key: `play.${info.kind}:${app.id}:${obj.name}:${mark}`,
        run: async () => {
          if (fresh && (await store.getMeta(key)) === mark) return null;
          // Another financial file was refused earlier today: this one is not tried until tomorrow.
          if (financial && (await financeDenied())) return null;
          const collector = PLAY_COLLECTORS[info.kind](info, pkg, obj.name);
          try {
            await play.readCsv(bucket, obj.name, (row) => collector.add(row));
          } catch (err) {
            if (!financial || !(err instanceof SourceError) || (err.status !== 403 && err.status !== 401)) throw err;
            await denyFinance(obj.name);
            return null;
          }
          const res = await collector.write(store, app.id);
          await store.setMeta(key, mark);
          return res.written;
        },
        skip: () => store.setMeta(key, mark),
      });
    }
  };

  /**
   * One listing of report files per day. The financial files (ADR 0010) are listed by a unit of
   * their own: they need "View financial data", and both units fit the smallest call budget.
   */
  const planListing = (kind: 'reports' | 'finance') => {
    const key = kind === 'reports' ? syncKeys.playListing(app.id) : syncKeys.playFinanceListing(app.id);
    const saved = parseJson<PlayListing>(get(key));
    // Listed today by this version (an older one may not have known every kind of file yet).
    if (saved && saved.day === today && saved.v === PLAY_LISTING_VERSION) return planObjects(saved.objects, place, false);
    const prefixes = kind === 'reports' ? playPrefixes(pkg) : playFinancialPrefixes(pkg);
    place({
      task: kind === 'reports' ? 'play.list' : 'play.finance_list',
      siteId,
      source: 'play',
      backfill: false,
      calls: prefixes.length,
      key: `play.${kind === 'reports' ? 'list' : 'finance_list'}:${app.id}:${today}`,
      run: async () => {
        const objects: PlayListing['objects'] = [];
        let finance: PlayListing['finance'];
        for (const prefix of prefixes) {
          let list: Awaited<ReturnType<typeof play.listObjects>>;
          try {
            list = await play.listObjects(bucket, prefix);
          } catch (err) {
            // Without "View financial data" the financial folders answer 403; the rest goes on.
            if (kind === 'reports' || !(err instanceof SourceError) || (err.status !== 403 && err.status !== 401)) throw err;
            finance = 'denied';
            continue;
          }
          for (const o of list) if (classifyPlayFile(o.name, pkg)) objects.push({ name: o.name, generation: o.generation });
        }
        if (kind === 'finance') finance ??= 'ok';
        // Installs files first (they choose the values a breakdown keeps per day, which the ratings
        // and crashes files then follow); within a kind, newest months first.
        const rank = (name: string) => (name.startsWith('stats/installs/') ? 0 : 1);
        objects.sort((a, b) => rank(a.name) - rank(b.name) || b.name.localeCompare(a.name));
        await store.setMeta(
          key,
          JSON.stringify({ day: today, v: PLAY_LISTING_VERSION, objects, ...(finance ? { finance } : {}) } satisfies PlayListing),
        );
        if (kind === 'reports' && objects.length === 0) ctx.log?.(`play ${app.id}: no report files for ${pkg} in the bucket yet`);
        planObjects(objects, enqueue, true);
        return 0;
      },
      skip: () => store.setMeta(key, JSON.stringify({ day: today, v: PLAY_LISTING_VERSION, objects: [] } satisfies PlayListing)),
    });
  };
  planListing('reports');
  planListing('finance');

  // Crash and ANR rates, once a day.
  const vitals = parseJson<{ through?: IsoDate; checkedOn?: IsoDate }>(get(syncKeys.playVitals(app.id))) ?? {};
  const end = addDays(today, -PLAY_VITALS_LAG_DAYS);
  if (vitals.checkedOn !== today) {
    const start = vitals.through ? addDays(vitals.through, -2) : addDays(end, -(PLAY_VITALS_LOOKBACK_DAYS - 1));
    place({
      task: 'play.vitals',
      siteId,
      source: 'play',
      backfill: false,
      // Per metric: its freshness, then the query.
      calls: 4,
      key: `play.vitals:${app.id}:${today}`,
      run: async () => {
        if (start > end) return null;
        const range = { start, end };
        const [crash, anr] = [await play.vitals(pkg, 'crash', range), await play.vitals(pkg, 'anr', range)];
        const rows = new Map<string, AppVitalsInput>();
        const totals = new Map<
          IsoDate,
          { users: number; crash: number; crashUp: number; anr: number; anrUp: number; crashW: number; anrW: number }
        >();
        const add = (kind: 'crash' | 'anr', r: (typeof crash)[number]) => {
          const key = `${r.date}|${r.version}`;
          const e = rows.get(key) ?? { date: r.date, version: r.version };
          if (kind === 'crash') {
            e.crashRate = r.rate;
            e.userPerceivedCrashRate = r.userPerceivedRate;
          } else {
            e.anrRate = r.rate;
            e.userPerceivedAnrRate = r.userPerceivedRate;
          }
          if (r.distinctUsers !== null) e.distinctUsers = Math.max(e.distinctUsers ?? 0, r.distinctUsers);
          rows.set(key, e);
          // All versions: rates weighted by each version's distinct users.
          const users = r.distinctUsers ?? 0;
          const t = totals.get(r.date) ?? { users: 0, crash: 0, crashUp: 0, anr: 0, anrUp: 0, crashW: 0, anrW: 0 };
          if (kind === 'crash') {
            t.users += users;
            t.crash += (r.rate ?? 0) * users;
            t.crashUp += (r.userPerceivedRate ?? 0) * users;
            t.crashW += users;
          } else {
            t.anr += (r.rate ?? 0) * users;
            t.anrUp += (r.userPerceivedRate ?? 0) * users;
            t.anrW += users;
          }
          totals.set(r.date, t);
        };
        for (const r of crash) add('crash', r);
        for (const r of anr) add('anr', r);
        for (const [date, t] of totals) {
          rows.set(`${date}|`, {
            date,
            version: '',
            crashRate: t.crashW ? t.crash / t.crashW : null,
            userPerceivedCrashRate: t.crashW ? t.crashUp / t.crashW : null,
            anrRate: t.anrW ? t.anr / t.anrW : null,
            userPerceivedAnrRate: t.anrW ? t.anrUp / t.anrW : null,
            distinctUsers: t.users || null,
          });
        }
        const written = await store.writeAppVitals(app.id, 'play', {
          metrics: ['crashRate', 'userPerceivedCrashRate', 'anrRate', 'userPerceivedAnrRate', 'distinctUsers'],
          rows: [...rows.values()],
        });
        // Up to the newest day Google had (its freshness can lag); without rows, the window stays.
        const newest = [...crash, ...anr].reduce<IsoDate | null>((m, r) => (!m || r.date > m ? r.date : m), null);
        const through = newest && newest < end ? newest : newest ? end : vitals.through;
        await store.setMeta(
          syncKeys.playVitals(app.id),
          JSON.stringify({ ...(through ? { through } : {}), checkedOn: today, ...(newest ? {} : { empty: true }) }),
        );
        return written;
      },
      skip: () => store.setMeta(syncKeys.playVitals(app.id), JSON.stringify({ ...vitals, checkedOn: today })),
    });
  }
}

// --------------------------------------------------------- App Store public feeds

const CHARTS = ['top-free', 'top-paid'] as const;

function planPublic(args: AppPlanArgs, app: AppConfig, list: Unit[]): void {
  const { ctx, today, get, budget } = args;
  if (get(syncKeys.appStorePublic(app.id)) === today) return;
  const pub = ctx.clients.appStore!;
  list.push({
    task: 'appstore.public',
    siteId: appTaskId(app.id),
    source: 'appstore',
    backfill: false,
    calls: 1,
    key: `appstore.public:${app.id}:${today}`,
    run: async () => {
      // Each storefront is saved once read (up to 3 calls), so a run that runs out of calls
      // continues with the next storefront instead of starting over.
      const part = parseJson<AppStorePublicPart>(await ctx.store.getMeta(syncKeys.appStorePublicPart(app.id)));
      const done = new Set(part?.day === today ? part.done : []);
      let written = 0;
      let first = true;
      for (const country of await appStorefronts(ctx.store, app, today)) {
        if (done.has(country)) continue;
        if (!first) budget.spend('appstore');
        first = false;
        const info = await pub.lookup(app.appleId!, country);
        // Not sold in this storefront: no rating and no chart to be in.
        if (info) {
          const territory = country.toUpperCase();
          const rating: AppRatingInput = { date: today, territory, average: info.averageUserRating, count: info.userRatingCount };
          // A free app can only be in the free charts and a paid app only in the paid ones: check
          // those, for all apps and for the app's category. Both overall charts when the price is unknown.
          const paid = info.price === null ? null : info.price > 0;
          type Chart = (typeof CHARTS)[number];
          const overall: readonly Chart[] = paid === null ? CHARTS : [paid ? 'top-paid' : 'top-free'];
          const charts = overall.map((c): [Chart, string | null] => [c, null]);
          if (info.primaryGenreId) charts.push([paid ? 'top-paid' : 'top-free', info.primaryGenreId]);
          const ranks: AppChartRankInput[] = [];
          for (const [chart, genre] of charts) {
            budget.spend('appstore');
            const ids = await pub.topChart(country, chart, genre);
            const at = ids.indexOf(app.appleId!);
            // Only the user's own app's position is kept, never the other apps in the chart.
            ranks.push({ date: today, territory, chart, genre: genre ?? '', rank: at === -1 ? null : at + 1 });
          }
          written += await ctx.store.writeAppRatings(app.id, 'apple', [rating]);
          written += await ctx.store.writeAppChartRanks(app.id, ranks);
        }
        done.add(country);
        await ctx.store.setMeta(
          syncKeys.appStorePublicPart(app.id),
          JSON.stringify({ day: today, done: [...done] } satisfies AppStorePublicPart),
        );
      }
      await ctx.store.setMeta(syncKeys.appStorePublic(app.id), today);
      return written;
    },
    skip: () => ctx.store.setMeta(syncKeys.appStorePublic(app.id), today),
  });
}
