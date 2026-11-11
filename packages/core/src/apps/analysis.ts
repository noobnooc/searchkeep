/**
 * App analysis (ADR 0009): the functions behind the app MCP tools and the dashboard's Apps area.
 * Every function aggregates on the server and returns a compact, capped result.
 */
import { findApp, SearchkeepError } from '../config.js';
import { addDays, assertRange, isIsoDate, previousPeriod, toIsoDate } from '../dates.js';
import { safeMessage } from '../errors.js';
import { SourceError } from '../http.js';
import type { AscClient, AscReportRequest } from '../sources.js';
import { parseJson, syncKeys, type AscRequestState } from '../sync/state.js';
import {
  ALL_KEY,
  APP_BREAKDOWN_DIMENSIONS,
  APP_STORE_METRICS,
  APP_STORES,
  type AppBreakdownDimension,
  type AppConfig,
  type AppDimension,
  type AppReferrerKind,
  type AppStore,
  type AppStoreMetrics,
  type AppStoreRow,
  type DateRange,
  type IsoDate,
} from '../types.js';
import { clampLimit, round } from '../analysis/common.js';
import { APP_STORE_GENRES } from './genres.js';
import { BREAKDOWN_VALUES_PER_DAY, playCurrencyKey } from './reports.js';
import { appStorefronts, byStorefront } from './storefronts.js';
import { appStoresOf, type OpsContext } from '../analysis/ops.js';

export interface AppParams {
  /** App id, Apple ID or package name; optional when only one app is configured. */
  app?: string;
  /** `apple` or `play`; both when omitted. */
  store?: AppStore;
  start?: string;
  end?: string;
  days?: number;
  limit?: number;
}

interface ResolvedApp {
  app: AppConfig;
  store: AppStore | undefined;
  range: DateRange;
  limit: number;
  notes: string[];
}

async function resolveApp(ctx: OpsContext, p: AppParams, defaults: { days?: number; limit?: number } = {}): Promise<ResolvedApp> {
  const app = findApp(ctx.config, p.app);
  if (p.store !== undefined && !APP_STORES.includes(p.store)) throw new SearchkeepError('bad_request', 'store must be "apple" or "play".');
  if (p.store === 'apple' && !app.appleId) throw new SearchkeepError('bad_request', `${app.name} has no App Store Apple ID.`);
  if (p.store === 'play' && !app.playPackage) throw new SearchkeepError('bad_request', `${app.name} has no Google Play package.`);
  const now = ctx.now ? ctx.now() : new Date();
  let end: string;
  if (p.end !== undefined) {
    if (!isIsoDate(p.end)) throw new SearchkeepError('bad_request', 'end must be YYYY-MM-DD.');
    end = p.end;
  } else end = (await ctx.store.latestAppDate(app.id, p.store)) ?? toIsoDate(new Date(now.getTime() - 86_400_000));
  let start: string;
  if (p.start !== undefined) {
    if (!isIsoDate(p.start)) throw new SearchkeepError('bad_request', 'start must be YYYY-MM-DD.');
    start = p.start;
  } else start = addDays(end, -(Math.max(1, Math.min(3660, Math.floor(p.days ?? defaults.days ?? 28))) - 1));
  let range: DateRange;
  try {
    range = assertRange({ start, end });
  } catch (e) {
    throw new SearchkeepError('bad_request', (e as Error).message);
  }
  return { app, store: p.store, range, limit: clampLimit(p.limit, defaults.limit ?? 50), notes: [] };
}

const maxDate = (a: IsoDate, b: IsoDate) => (a > b ? a : b);

const storesOf = (app: AppConfig, store?: AppStore): AppStore[] =>
  store ? [store] : APP_STORES.filter((s) => (s === 'apple' ? app.appleId : app.playPackage));

const zero = (): AppStoreMetrics => Object.fromEntries(APP_STORE_METRICS.map((m) => [m, 0])) as AppStoreMetrics;

/** Funnel metrics with the conversion rates, amounts and ratios derived from them. */
export interface AppFunnel extends AppStoreMetrics {
  /** downloads ÷ unique page views (Google Play: acquisitions ÷ store listing visitors). */
  pageConversion: number | null;
  /** downloads ÷ unique impressions (App Store only). */
  impressionConversion: number | null;
  /** Proceeds and sales in the store's currency (App Store: USD). */
  proceeds: number;
  sales: number;
  /** proceeds ÷ downloads of the same rows: what a download is worth, roughly. */
  proceedsPerDownload: number | null;
  /** sessionSeconds ÷ sessions. */
  averageSessionSeconds: number | null;
  /** sessions ÷ devices with sessions. */
  sessionsPerDevice: number | null;
}

/** Currency of each store's amounts: USD for the App Store, the payout currency of the Play earnings files. */
async function storeCurrency(ctx: OpsContext, appId: string, store: AppStore): Promise<string | null> {
  return store === 'apple' ? 'USD' : await ctx.store.getMeta(playCurrencyKey(appId));
}

function funnel(m: AppStoreMetrics): AppFunnel {
  const proceeds = m.proceedsCents / 100;
  return {
    ...m,
    pageConversion: m.pageViewsUnique > 0 ? round(m.downloads / m.pageViewsUnique, 4) : null,
    impressionConversion: m.impressionsUnique > 0 ? round(m.downloads / m.impressionsUnique, 4) : null,
    proceeds: round(proceeds, 2),
    sales: round(m.salesCents / 100, 2),
    proceedsPerDownload: m.downloads > 0 && m.proceedsCents !== 0 ? round(proceeds / m.downloads, 4) : null,
    averageSessionSeconds: m.sessions > 0 ? round(m.sessionSeconds / m.sessions, 1) : null,
    sessionsPerDevice: m.sessionDevices > 0 ? round(m.sessions / m.sessionDevices, 2) : null,
  };
}

/** Sums the additive metrics of daily rows; active devices is the last day's level. */
function totalOf(rows: AppStoreRow[]): AppStoreMetrics {
  const t = zero();
  let lastDate = '';
  for (const r of rows) {
    for (const m of APP_STORE_METRICS) if (m !== 'activeDevices') t[m] += r[m];
    if (r.date && r.date >= lastDate && r.activeDevices > 0) {
      if (r.date > lastDate) t.activeDevices = 0;
      lastDate = r.date;
      t.activeDevices += r.activeDevices;
    }
  }
  return t;
}

const STORE_NOTES: Record<AppStore, string> = {
  apple:
    "App Store: impressions are list views (search results, charts, Today/Apps tabs), page views are product page views, downloads are first-time downloads (including those straight from search results, so page conversion can exceed 100% for search), installs and deletions count only people who share analytics with developers. Unique counts are summed across devices, so they are approximate. Proceeds and sales are Apple's estimates in USD of paid app and in-app purchases net of refunds (proceeds: after taxes and Apple's commission), attributed to the source and storefront where the buyer found the app; paying users are summed across rows, an upper bound. Sessions count only people who share analytics, and only where at least five people had sessions.",
  play: 'Google Play: page views are store listing visitors (unique users), downloads are store listing acquisitions; Google Play reports no impressions. Proceeds (net of Google\'s fees, taxes and refunds), sales and purchases come from the monthly earnings files in the account\'s payout currency, per buyer country (no source), once the service account may view financial data; a month arrives early in the next month. Google groups the visitors and acquisitions of countries and traffic sources with few users into "OTHER" / "other" (for a small app, all of them, and then it has no search terms); installs, uninstalls and active devices by country come from the installs report, which is not grouped. Data arrives 3-7 days late.',
};

export interface AppPerformanceParams extends AppParams {
  /** Group rows by these (default none: per-store totals only). `referrer` lists referring websites, apps and UTM sources. */
  groupBy?: Array<AppDimension | 'referrer'>;
  territory?: string;
  /** An app source type: search, browse, app_referrer, web_referrer, referral, ... */
  source?: string;
  referrerKind?: AppReferrerKind;
}

/**
 * The store funnel of an app: impressions → page views → downloads, per store, compared with the
 * previous period of the same length, optionally grouped by date, week, month, territory, source
 * or referrer.
 */
export async function appPerformance(ctx: OpsContext, p: AppPerformanceParams) {
  const r = await resolveApp(ctx, p, { days: 28, limit: 50 });
  const prev = previousPeriod(r.range);
  const stores = storesOf(r.app, r.store);
  const filters = {
    ...(p.territory ? { territory: p.territory.trim().toUpperCase() } : {}),
    ...(p.source ? { source: p.source.trim().toLowerCase() } : {}),
  };
  const perStore = await Promise.all(
    stores.map(async (store) => {
      const q = {
        appId: r.app.id,
        store,
        dimensions: ['date'] as AppDimension[],
        ...filters,
        orderBy: 'date' as const,
        order: 'asc' as const,
        limit: 4000,
      };
      const [cur, before] = await Promise.all([
        ctx.store.queryAppStore({ ...q, range: r.range }),
        ctx.store.queryAppStore({ ...q, range: prev }),
      ]);
      return {
        store,
        currency: await storeCurrency(ctx, r.app.id, store),
        current: funnel(totalOf(cur)),
        previous: funnel(totalOf(before)),
        series: cur.map((x) => ({ date: x.date!, ...funnel(x) })),
      };
    }),
  );
  const groupBy = (p.groupBy ?? []).filter((g) => g !== 'referrer') as AppDimension[];
  const valid: Array<AppDimension | 'referrer'> = ['date', 'week', 'month', 'store', 'territory', 'source', 'referrer'];
  for (const g of p.groupBy ?? [])
    if (!valid.includes(g)) throw new SearchkeepError('bad_request', `groupBy must be any of ${valid.join(', ')}.`);
  const rows = groupBy.length
    ? (
        await ctx.store.queryAppStore({
          appId: r.app.id,
          ...(r.store ? { store: r.store } : {}),
          range: r.range,
          dimensions: groupBy,
          ...filters,
          orderBy: groupBy.some((g) => g === 'date' || g === 'week' || g === 'month') ? 'date' : 'pageViewsUnique',
          order: groupBy.some((g) => g === 'date' || g === 'week' || g === 'month') ? 'asc' : 'desc',
          limit: r.limit,
        })
      ).map((x) => ({ ...x, ...funnel(x) }))
    : [];
  let referrers:
    Array<{ store: AppStore; kind: AppReferrerKind; referrer: string; pageViews: number; downloads: number; ownSite: boolean }> | undefined;
  if (p.groupBy?.includes('referrer')) {
    const own = ownDomains(ctx, r.app);
    referrers = (
      await ctx.store.queryAppReferrers({
        appId: r.app.id,
        ...(r.store ? { store: r.store } : {}),
        range: r.range,
        ...(p.referrerKind ? { kind: p.referrerKind } : {}),
        limit: r.limit,
      })
    ).map((x) => {
      // Websites, and UTM sources named after a domain, are the user's own when they match one of their sites.
      const host = x.referrer.toLowerCase().replace(/^www\./, '');
      return { ...x, ownSite: x.kind !== 'app' && own.some((d) => host === d || host.endsWith(`.${d}`)) };
    });
  }
  const charts = r.store !== 'play' && r.app.appleId ? await latestCharts(ctx, r.app, r.range) : [];
  const notes = [...r.notes, ...stores.map((s) => STORE_NOTES[s])];
  if (p.source && stores.includes('play') && p.territory)
    notes.push('Google Play reports sources and territories separately, so it has no rows for a territory and a source together.');
  if (referrers !== undefined)
    notes.push(
      'Referrers: App Store web and app referrers come from the Detailed reports (small numbers are left out or noised by Apple); Google Play lists UTM sources of third-party referrals.',
    );
  return {
    app: r.app.id,
    name: r.app.name,
    range: r.range,
    previousRange: prev,
    stores: perStore,
    ...(rows.length || groupBy.length ? { rows } : {}),
    ...(referrers ? { referrers } : {}),
    ...(charts.length ? { charts } : {}),
    notes,
  };
}

/** Domains of the user's own site linked to the app (and of every site, as a fallback). */
function ownDomains(ctx: OpsContext, app: AppConfig): string[] {
  const linked = app.siteId ? ctx.config.sites.find((s) => s.id === app.siteId) : undefined;
  const sites = linked ? [linked] : ctx.config.sites;
  return [...new Set(sites.map((s) => s.domain.replace(/^www\./, '')))];
}

/**
 * Positions from the latest check of each storefront (charts no longer checked drop out), with the
 * previous check's position and the category name, most important storefront first.
 */
async function latestCharts(ctx: OpsContext, app: AppConfig, range: DateRange) {
  const rows = await ctx.store.queryAppChartRanks(app.id, { start: addDays(range.end, -30), end: addDays(range.end, 7) });
  const lastCheck = new Map<string, IsoDate>();
  for (const x of rows) if (x.date > (lastCheck.get(x.territory) ?? '')) lastCheck.set(x.territory, x.date);
  const before = new Map<string, { date: IsoDate; rank: number | null }>();
  for (const x of rows) {
    if (x.date >= lastCheck.get(x.territory)!) continue;
    const key = `${x.territory}|${x.chart}|${x.genre}`;
    if (x.date > (before.get(key)?.date ?? '')) before.set(key, { date: x.date, rank: x.rank });
  }
  const latest = rows
    .filter((x) => x.date === lastCheck.get(x.territory))
    .map((x) => {
      const previous = before.get(`${x.territory}|${x.chart}|${x.genre}`);
      return {
        ...x,
        ...(x.genre ? { genreName: APP_STORE_GENRES[x.genre] ?? null } : {}),
        ...(previous ? { previous } : {}),
      };
    })
    .sort((a, b) => Number(Boolean(a.genre)) - Number(Boolean(b.genre)) || a.chart.localeCompare(b.chart));
  const order = await appStorefronts(ctx.store, app, toIsoDate(ctx.now ? ctx.now() : new Date()));
  return byStorefront(latest, order);
}

export interface AppSearchTermsParams extends AppParams {
  termContains?: string;
  sortBy?: 'visitors' | 'acquisitions' | 'conversion' | 'change';
  /** Terms with fewer visitors are left out of `lowConverting`. Default 20. */
  minVisitors?: number;
}

/**
 * Google Play search terms that brought store listing visitors: visitors, acquisitions,
 * conversion and change against the previous period, plus well-visited terms that convert poorly.
 */
export async function appSearchTerms(ctx: OpsContext, p: AppSearchTermsParams) {
  const r = await resolveApp(ctx, { ...p, store: 'play' }, { days: 28, limit: 50 });
  const prev = previousPeriod(r.range);
  const base = { appId: r.app.id, ...(p.termContains ? { termContains: p.termContains } : {}), limit: 2000 };
  const [cur, before] = await Promise.all([
    ctx.store.queryAppSearchTerms({ ...base, range: r.range }),
    ctx.store.queryAppSearchTerms({ ...base, range: prev }),
  ]);
  const old = new Map(before.map((x) => [x.term.toLowerCase(), x]));
  const visitors = cur.reduce((t, x) => t + x.visitors, 0);
  const acquisitions = cur.reduce((t, x) => t + x.acquisitions, 0);
  const overall = visitors > 0 ? acquisitions / visitors : null;
  const terms = cur.map((x) => {
    const o = old.get(x.term.toLowerCase());
    return {
      term: x.term,
      visitors: x.visitors,
      acquisitions: x.acquisitions,
      conversion: x.visitors > 0 ? round(x.acquisitions / x.visitors, 4) : null,
      previousVisitors: o?.visitors ?? 0,
      visitorsChange: x.visitors - (o?.visitors ?? 0),
    };
  });
  const sortBy = p.sortBy ?? 'visitors';
  const key = (t: (typeof terms)[number]) =>
    sortBy === 'acquisitions'
      ? t.acquisitions
      : sortBy === 'conversion'
        ? (t.conversion ?? -1)
        : sortBy === 'change'
          ? t.visitorsChange
          : t.visitors;
  terms.sort((a, b) => key(b) - key(a) || b.visitors - a.visitors);
  const minVisitors = Math.max(1, Math.floor(p.minVisitors ?? 20));
  const lowConverting =
    overall === null
      ? []
      : terms
          .filter((t) => t.visitors >= minVisitors && t.conversion !== null && t.conversion < overall * 0.6)
          .sort((a, b) => b.visitors - a.visitors)
          .slice(0, 20);
  const notes = [
    'Search terms come from Google Play (store performance by traffic source). The App Store does not report search terms.',
    'Terms with few visitors are grouped by Google under "Other" and are not listed separately.',
  ];
  if (!r.app.playPackage) notes.unshift(`${r.app.name} has no Google Play package, so there are no search terms.`);
  if (cur.length === 0 && r.app.playPackage)
    notes.push('No search terms in this range yet. The Play Console publishes them 3-7 days late.');
  return {
    app: r.app.id,
    range: r.range,
    previousRange: prev,
    totals: { terms: cur.length, visitors, acquisitions, conversion: overall === null ? null : round(overall, 4) },
    terms: terms.slice(0, r.limit),
    lowConverting,
    notes,
  };
}

export interface AppReviewsParams extends AppParams {
  /** Only these star ratings, e.g. [1, 2]. */
  ratings?: number[];
  territory?: string;
  version?: string;
  contains?: string;
}

/** Ratings (averages over time) and reviews (star distribution and the reviews themselves). */
export async function appReviews(ctx: OpsContext, p: AppReviewsParams) {
  const r = await resolveApp(ctx, p, { days: 90, limit: 30 });
  const ratingsFilter = p.ratings?.filter((x) => Number.isInteger(x) && x >= 1 && x <= 5);
  const [stats, reviews, ratingRows] = await Promise.all([
    ctx.store.appReviewStats(r.app.id, r.range, r.store),
    ctx.store.listAppReviews({
      appId: r.app.id,
      ...(r.store ? { store: r.store } : {}),
      range: r.range,
      ...(ratingsFilter?.length ? { ratings: ratingsFilter } : {}),
      ...(p.territory ? { territory: p.territory.trim().toUpperCase() } : {}),
      ...(p.version ? { version: p.version.trim() } : {}),
      ...(p.contains ? { contains: p.contains } : {}),
      limit: r.limit,
    }),
    // The current rating may be newer than the range's last day (the public feed is read daily).
    ctx.store.queryAppRatings({
      appId: r.app.id,
      ...(r.store ? { store: r.store } : {}),
      range: { start: r.range.start, end: maxDate(r.range.end, toIsoDate(ctx.now ? ctx.now() : new Date())) },
    }),
  ]);
  // App Store ratings are per storefront: show the most important one that has ratings.
  const storefronts = (await appStorefronts(ctx.store, r.app, toIsoDate(ctx.now ? ctx.now() : new Date()))).map((t) => t.toUpperCase());
  const summary = storesOf(r.app, r.store).map((store) => {
    const dist: Record<string, number> = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 };
    for (const s of stats) if (s.store === store) dist[String(s.rating)] = s.reviews;
    const count = Object.values(dist).reduce((a, b) => a + b, 0);
    const avg = count ? Object.entries(dist).reduce((t, [k, v]) => t + Number(k) * v, 0) / count : null;
    // The rating everyone sees: Google Play's overall average, or the App Store's (public feed) in
    // the first storefront with ratings. An average of 0 (stored before it meant "no ratings") is none.
    const series = ratingRows
      .filter((x) => x.store === store && (store === 'play' ? x.territory === ALL_KEY : true))
      .map((x) => (x.average === 0 ? { ...x, average: null } : x));
    const ordered = byStorefront(
      [...new Set(series.map((x) => x.territory))].map((t) => ({ territory: t })),
      storefronts,
    ).map((x) => x.territory);
    const rated = (t: string) => series.some((x) => x.territory === t && x.average !== null);
    const territory = store === 'apple' ? (ordered.find(rated) ?? ordered[0] ?? null) : ALL_KEY;
    const own = series.filter((x) => x.territory === territory);
    const latest = own.at(-1) ?? null;
    const inRange = own.filter((x) => x.date <= r.range.end);
    return {
      store,
      reviews: count,
      reviewAverage: avg === null ? null : round(avg, 2),
      distribution: dist,
      rating: latest ? { date: latest.date, territory: latest.territory, average: latest.average, count: latest.count ?? null } : null,
      ratingSeries: inRange.map((x) => ({
        date: x.date,
        average: x.average,
        dailyAverage: x.dailyAverage ?? null,
        count: x.count ?? null,
      })),
    };
  });
  const notes = [
    'Reviews are stored without reviewer names. App Store reviews come from App Store Connect; Google Play reviews from the monthly Play Console files (3-7 days late).',
  ];
  if (summary.some((s) => s.store === 'apple' && !s.rating))
    notes.push(
      ctx.config.appStorePublic
        ? 'The App Store average rating comes from the public feed, read once a day.'
        : 'App Store Connect has no API for the average rating; turn on the opt-in public feeds (APP_STORE_PUBLIC_DATA=true) to keep it.',
    );
  return { app: r.app.id, range: r.range, summary, reviews, notes };
}

export interface AppStabilityParams extends AppParams {
  /** `date` (default) for the trend, `version` to compare app versions. */
  groupBy?: 'date' | 'version';
}

/** Crash and ANR rates (Google Play) and crash counts (App Store), per day or app version. */
export async function appStability(ctx: OpsContext, p: AppStabilityParams) {
  const r = await resolveApp(ctx, p, { days: 28, limit: 100 });
  const groupBy = p.groupBy ?? 'date';
  if (groupBy !== 'date' && groupBy !== 'version') throw new SearchkeepError('bad_request', 'groupBy must be "date" or "version".');
  const rows = await ctx.store.queryAppVitals({
    appId: r.app.id,
    ...(r.store ? { store: r.store } : {}),
    range: r.range,
    groupBy,
    limit: r.limit,
  });
  const totals = await ctx.store.queryAppVitals({
    appId: r.app.id,
    ...(r.store ? { store: r.store } : {}),
    range: r.range,
    groupBy: 'version',
    limit: 500,
  });
  const summary = storesOf(r.app, r.store).map((store) => {
    const all = totals.find((x) => x.store === store && x.version === '');
    return {
      store,
      crashRate: all?.crashRate ?? null,
      userPerceivedCrashRate: all?.userPerceivedCrashRate ?? null,
      anrRate: all?.anrRate ?? null,
      userPerceivedAnrRate: all?.userPerceivedAnrRate ?? null,
      crashes: all?.crashes ?? null,
      crashDevices: all?.crashDevices ?? null,
    };
  });
  return {
    app: r.app.id,
    range: r.range,
    groupBy,
    summary,
    rows: groupBy === 'version' ? rows.filter((x) => x.version !== '') : rows,
    notes: [
      'Google Play rates are shares of daily users (Play Developer Reporting API); Google flags apps above 1.09% user-perceived crash rate or 0.47% user-perceived ANR rate. App Store numbers are crash counts from people who share analytics with developers.',
    ],
  };
}

export interface AppBreakdownParams extends AppParams {
  /** `app_version` (default), `device` or `os_version`. */
  dimension?: AppBreakdownDimension;
}

/**
 * An app's numbers per app version, device model or OS version (ADR 0010): Google Play installs,
 * uninstalls, active devices, ratings, crashes and ANRs; App Store sessions, and crash counts per
 * app version. Ties a release, a device or an OS version to its ratings and crashes.
 */
export async function appBreakdown(ctx: OpsContext, p: AppBreakdownParams) {
  const r = await resolveApp(ctx, p, { days: 28, limit: 50 });
  const dimension = p.dimension ?? 'app_version';
  if (!APP_BREAKDOWN_DIMENSIONS.includes(dimension))
    throw new SearchkeepError('bad_request', `dimension must be one of ${APP_BREAKDOWN_DIMENSIONS.join(', ')}.`);
  const rows = await ctx.store.queryAppBreakdowns({
    appId: r.app.id,
    ...(r.store ? { store: r.store } : {}),
    dimension,
    range: r.range,
    limit: r.limit,
  });
  // App Store crash counts per app version come from the App Crashes report (app_stability).
  if (dimension === 'app_version' && r.store !== 'play' && r.app.appleId) {
    const crashes = await ctx.store.queryAppVitals({ appId: r.app.id, store: 'apple', range: r.range, groupBy: 'version', limit: 500 });
    for (const c of crashes) {
      if (!c.version || !c.crashes) continue;
      const row = rows.find((x) => x.store === 'apple' && x.value === c.version);
      if (row) row.crashes += c.crashes;
      else
        rows.push({
          store: 'apple',
          value: c.version,
          days: 0,
          installs: 0,
          deletions: 0,
          activeDevices: 0,
          crashes: c.crashes,
          anrs: 0,
          dailyRating: null,
          totalRating: null,
          sessions: 0,
          sessionSeconds: 0,
          sessionDevices: 0,
        });
    }
  }
  return {
    app: r.app.id,
    range: r.range,
    dimension,
    rows: rows.map((x) => ({
      ...x,
      averageSessionSeconds: x.sessions > 0 ? round(x.sessionSeconds / x.sessions, 1) : null,
      crashesPerSession: x.sessions > 0 && x.crashes > 0 ? round(x.crashes / x.sessions, 4) : null,
    })),
    notes: [
      `Per ${dimension.replace('_', ' ')}: Google Play installs, uninstalls, active devices (on the last day), ratings (the daily average averaged over days, and the last total average), crashes and ANRs from the Play Console's files; App Store sessions (people who share analytics, at least five per value) and crash counts. At most ${BREAKDOWN_VALUES_PER_DAY} values a day are kept; the rest are summed into "Other".`,
    ],
  };
}

export interface AppSubscriptionsParams extends Omit<AppParams, 'store'> {
  product?: string;
  territory?: string;
}

/**
 * Google Play subscriptions (ADR 0010): new, canceled and active subscriptions per product and
 * country over the range, against the previous period, with the daily trend.
 */
export async function appSubscriptions(ctx: OpsContext, p: AppSubscriptionsParams) {
  const r = await resolveApp(ctx, { ...p, store: 'play' }, { days: 28, limit: 50 });
  if (!r.app.playPackage)
    throw new SearchkeepError('bad_request', 'This app has no Google Play package; subscriptions come from Google Play.');
  const prev = previousPeriod(r.range);
  const q = {
    appId: r.app.id,
    ...(p.product ? { product: p.product.trim() } : {}),
    ...(p.territory ? { territory: p.territory.trim().toUpperCase() } : {}),
  };
  const [current, previous, products, territories, series] = await Promise.all([
    ctx.store.queryAppSubscriptions({ ...q, range: r.range, dimensions: [] }),
    ctx.store.queryAppSubscriptions({ ...q, range: prev, dimensions: [] }),
    ctx.store.queryAppSubscriptions({ ...q, range: r.range, dimensions: ['product'], limit: r.limit }),
    ctx.store.queryAppSubscriptions({ ...q, range: r.range, dimensions: ['territory'], limit: r.limit }),
    ctx.store.queryAppSubscriptions({ ...q, range: r.range, dimensions: ['date'], limit: 1000 }),
  ]);
  const none = { newSubscriptions: 0, canceledSubscriptions: 0, activeSubscriptions: 0 };
  const total = (x: (typeof current)[number] | undefined) => {
    const t = x ?? none;
    return { ...none, ...t, net: t.newSubscriptions - t.canceledSubscriptions };
  };
  return {
    app: r.app.id,
    range: r.range,
    previousRange: prev,
    current: total(current[0]),
    previous: total(previous[0]),
    products: products.map((x) => ({ ...x, net: x.newSubscriptions - x.canceledSubscriptions })),
    territories: territories.map((x) => ({ ...x, net: x.newSubscriptions - x.canceledSubscriptions })),
    series,
    notes: [
      'Google Play subscription statistics: new and canceled subscriptions are summed over the range; active subscriptions are those on the last day with data. They need the service account to view financial data.',
    ],
  };
}

/** Configured apps, which stores are connected, App Store report status and stored data. */
export async function listApps(ctx: OpsContext) {
  const coverage = await ctx.store.appCoverage();
  const apps = await Promise.all(
    ctx.config.apps.map(async (app) => {
      const st = app.appleId ? parseJson<AscRequestState>(await ctx.store.getMeta(syncKeys.ascRequests(app.id))) : null;
      return {
        id: app.id,
        name: app.name,
        ...(app.appleId ? { appleId: app.appleId } : {}),
        ...(app.playPackage ? { playPackage: app.playPackage } : {}),
        ...(app.siteId ? { siteId: app.siteId } : {}),
        ...(app.territories ? { territories: app.territories } : {}),
        origin: app.origin ?? 'secret',
        stores: appStoresOf(ctx, app),
        ...(app.appleId
          ? {
              appStoreReports: {
                started: Boolean(st?.ongoing),
                stopped: Boolean(st?.stopped),
                snapshot: Boolean(st?.snapshot),
                ...(st?.snapshotRequestedOn ? { snapshotRequestedOn: st.snapshotRequestedOn } : {}),
                ...(st?.problem ? { problem: st.problem } : {}),
              },
            }
          : {}),
        data: coverage.filter((c) => c.appId === app.id).map(({ appId: _a, ...rest }) => rest),
      };
    }),
  );
  return { apps };
}

/**
 * The one-time action that starts App Store reports (ADR 0009, option B). `admin` is a client
 * built from a temporary Admin key for this one call; the key is never stored. Creates the ongoing
 * request (or finds it; a request Apple stopped is replaced) and a one-time snapshot for history
 * when there is none (`snapshot: true` asks for a new one, `false` for none; Apple allows one a
 * month). Only the request ids are stored.
 */
export async function startAppStoreReports(ctx: OpsContext, p: { app?: string; snapshot?: boolean }, admin: AscClient) {
  const app = findApp(ctx.config, p.app);
  if (!app.appleId) throw new SearchkeepError('bad_request', `${app.name} has no App Store Apple ID.`);
  const describe = (err: unknown) =>
    err instanceof SourceError && err.status === 403
      ? 'The key was refused (HTTP 403). Use a key with the Admin role for this one step.'
      : safeMessage(err);
  let existing: AscReportRequest[];
  try {
    existing = await admin.listReportRequests(app.appleId);
  } catch (err) {
    throw new SearchkeepError('upstream', `Could not read the App Store report requests: ${describe(err)}`);
  }
  const notes: string[] = [];
  let ongoing = existing.find((x) => x.accessType === 'ONGOING' && !x.stoppedDueToInactivity);
  let ongoingCreated = false;
  if (!ongoing) {
    for (const stopped of existing.filter((x) => x.accessType === 'ONGOING')) {
      try {
        await admin.deleteReportRequest(stopped.id);
        notes.push('Replaced the ongoing request Apple had stopped for inactivity.');
      } catch (err) {
        throw new SearchkeepError('upstream', `Could not remove the stopped report request: ${describe(err)}`);
      }
    }
    try {
      ongoing = await admin.createReportRequest(app.appleId, 'ONGOING');
      ongoingCreated = true;
    } catch (err) {
      throw new SearchkeepError('upstream', `Could not start App Store reports: ${describe(err)}`);
    }
  }
  const prev = parseJson<AscRequestState>(await ctx.store.getMeta(syncKeys.ascRequests(app.id))) ?? {};
  const today = toIsoDate(ctx.now ? ctx.now() : new Date());
  let snapshot = existing.filter((x) => x.accessType === 'ONE_TIME_SNAPSHOT').at(-1) ?? null;
  let snapshotCreated = false;
  let snapshotError: string | null = null;
  // A snapshot is requested when there is none yet, or when asked for (to fill a gap; one a month).
  if (p.snapshot === true || (p.snapshot === undefined && !snapshot)) {
    try {
      snapshot = await admin.createReportRequest(app.appleId, 'ONE_TIME_SNAPSHOT');
      snapshotCreated = true;
    } catch (err) {
      snapshotError = `History (one-time snapshot) was not requested: ${describe(err)} Apple allows one snapshot a month; try again next month.`;
    }
  }
  const state: AscRequestState = {
    ongoing: ongoing.id,
    ...(snapshot ? { snapshot: snapshot.id } : {}),
    ...(snapshotCreated
      ? { snapshotRequestedOn: today }
      : prev.snapshotRequestedOn
        ? { snapshotRequestedOn: prev.snapshotRequestedOn }
        : {}),
  };
  // No `checkedOn`: the next sync checks the requests with the Sales and Reports key.
  await ctx.store.setMeta(syncKeys.ascRequests(app.id), JSON.stringify(state));
  if (ongoingCreated) notes.push('Apple generates the first reports within 24-48 hours; the sync picks them up on its own.');
  if (snapshotCreated) notes.push('History back to January 2024 arrives through the one-time snapshot over the next days.');
  if (snapshotError) notes.push(snapshotError);
  notes.push(
    'The Admin key was used for this request only and was not stored. Revoke it now in App Store Connect → Users and Access → Integrations.',
  );
  return {
    app: app.id,
    ongoing: { id: ongoing.id, created: ongoingCreated },
    snapshot: snapshot ? { id: snapshot.id, created: snapshotCreated } : null,
    notes,
  };
}
