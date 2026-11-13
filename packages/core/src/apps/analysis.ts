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
  type AppSourceType,
  type DateRange,
  type IsoDate,
  VOLUME_PURCHASE_SOURCES,
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
  groupBy?: Array<AppDimension | 'referrer' | 'page_type' | 'page_title'>;
  territory?: string;
  /** An app source type: search, browse, app_referrer, web_referrer, referral, ... */
  source?: string;
  referrerKind?: AppReferrerKind;
  /** Attach the store changes of each day to the series (default true). */
  includeChanges?: boolean;
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
  // Licenses bought in bulk are not people finding the app: left out unless a source is asked for.
  const hidden = p.source ? [] : VOLUME_PURCHASE_SOURCES;
  const exclude = hidden.length ? { excludeSources: hidden } : {};
  const changes =
    p.includeChanges === false
      ? []
      : await ctx.store.queryAppChanges({ appId: r.app.id, ...(r.store ? { store: r.store } : {}), range: r.range, limit: 2000 });
  const changesOn = (store: AppStore, date: IsoDate) => {
    const list = changes
      .filter((c) => c.store === store && c.date === date)
      .map((c) => ({ entity: c.entity, locale: c.locale, field: c.field }));
    return list.length ? { changes: list } : {};
  };
  const perStore = await Promise.all(
    stores.map(async (store) => {
      const q = {
        appId: r.app.id,
        store,
        dimensions: ['date'] as AppDimension[],
        ...filters,
        ...exclude,
        orderBy: 'date' as const,
        order: 'asc' as const,
        limit: 4000,
      };
      const [cur, before, volume] = await Promise.all([
        ctx.store.queryAppStore({ ...q, range: r.range }),
        ctx.store.queryAppStore({ ...q, range: prev }),
        hidden.length && store === 'apple'
          ? ctx.store.queryAppStore({ appId: r.app.id, store, range: r.range, dimensions: ['source'], ...filters })
          : [],
      ]);
      const volumePurchaseDownloads = volume.filter((x) => hidden.includes(x.source as AppSourceType)).reduce((t, x) => t + x.downloads, 0);
      // Share of first-time downloaders who share analytics (App Store Opt-in report).
      const optIn = store === 'apple' ? await ctx.store.queryAppOptIn(r.app.id, r.range) : null;
      const analyticsSharing =
        optIn && optIn.days > 0
          ? {
              downloadingUsers: optIn.downloadingUsers,
              optingInUsers: optIn.optingInUsers,
              rate: optIn.downloadingUsers > 0 ? round(optIn.optingInUsers / optIn.downloadingUsers, 4) : null,
            }
          : undefined;
      return {
        store,
        currency: await storeCurrency(ctx, r.app.id, store),
        current: funnel(totalOf(cur)),
        previous: funnel(totalOf(before)),
        series: cur.map((x) => ({ date: x.date!, ...funnel(x), ...changesOn(store, x.date!) })),
        ...(volumePurchaseDownloads > 0 ? { volumePurchaseDownloads } : {}),
        ...(analyticsSharing ? { analyticsSharing } : {}),
      };
    }),
  );
  const groupBy = (p.groupBy ?? []).filter((g) => g !== 'referrer' && g !== 'page_type' && g !== 'page_title') as AppDimension[];
  const valid: Array<AppDimension | 'referrer' | 'page_type' | 'page_title'> = [
    'date',
    'week',
    'month',
    'store',
    'territory',
    'source',
    'referrer',
    'page_type',
    'page_title',
  ];
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
          ...(groupBy.includes('source') ? {} : exclude),
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
  // App Store funnel per product page (type, or type and title for custom product pages and in-app events).
  const pageLevel = p.groupBy?.includes('page_title') ? 'title' : p.groupBy?.includes('page_type') ? 'type' : null;
  const pages =
    pageLevel && r.store !== 'play' && r.app.appleId
      ? (await ctx.store.queryAppPages({ appId: r.app.id, range: r.range, level: pageLevel, limit: r.limit })).map((x) => ({
          pageType: x.pageType,
          ...(pageLevel === 'title' ? { pageTitle: x.pageTitle } : {}),
          impressions: x.impressions,
          impressionsUnique: x.impressionsUnique,
          pageViews: x.pageViews,
          pageViewsUnique: x.pageViewsUnique,
          downloads: x.downloads,
          pageConversion: x.pageViewsUnique > 0 ? round(x.downloads / x.pageViewsUnique, 4) : null,
        }))
      : undefined;
  const charts = r.store !== 'play' && r.app.appleId ? await latestCharts(ctx, r.app, r.range) : [];
  const notes = [...r.notes, ...stores.map((s) => STORE_NOTES[s])];
  for (const s of perStore)
    if (s.volumePurchaseDownloads)
      notes.push(
        `App Store: ${s.volumePurchaseDownloads.toLocaleString('en-US')} first-time downloads from institutional purchases (licenses bought in bulk through Apple Business Manager or Apple School Manager) are left out of the totals and the trend; group by source to see them.`,
      );
  if (p.source && stores.includes('play') && p.territory)
    notes.push('Google Play reports sources and territories separately, so it has no rows for a territory and a source together.');
  for (const s of perStore)
    if (s.analyticsSharing?.rate)
      notes.push(
        `App Store: ${Math.round(s.analyticsSharing.rate * 1000) / 10}% of first-time downloaders in this range share analytics with developers (App Store Opt-in report). Installs, deletions, sessions and crashes count only them: divide those by ${s.analyticsSharing.rate} for a rough estimate of all users (an estimate, assuming people who share behave like those who do not; Apple's five-user thresholds still apply). Impressions, page views, downloads and purchases count everyone.`,
      );
  if (changes.length)
    notes.push(
      `Store changes: ${changes.length} change(s) to versions, listings or app info in this range are attached to the series days they were first seen (see app_changes for the values before and after).`,
    );
  if (pageLevel)
    notes.push(
      pageLevel === 'title'
        ? 'Pages (App Store only): per page type and title from the Detailed reports (custom product pages, in-app events, "Default Product Page"); Apple adds small noise and leaves out rows with fewer than five people, so they need not add up to the totals. Downloads are first-time downloads by the page they came from; page conversion is downloads ÷ unique page views of the same page. Product page optimization treatments are in no report Apple offers.'
        : 'Pages (App Store only): impressions, page views and first-time downloads per page type (product page, no page = list views, store sheet, in-app event, ...), from the Standard reports. Group by page_title for custom product pages. Product page optimization treatments are in no report Apple offers.',
    );
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
    ...(pages ? { pages } : {}),
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
  // Google Play's monthly crash files count crashes and ANRs even when the Reporting API has no rates.
  const files =
    r.store !== 'apple' && r.app.playPackage
      ? await ctx.store.queryAppBreakdowns({ appId: r.app.id, store: 'play', dimension: 'app_version', range: r.range, limit: 500 })
      : [];
  const fileCrashes = files.reduce((t, x) => t + x.crashes, 0);
  const fileAnrs = files.reduce((t, x) => t + x.anrs, 0);
  const summary = storesOf(r.app, r.store).map((store) => {
    const all = totals.find((x) => x.store === store && x.version === '');
    return {
      store,
      crashRate: all?.crashRate ?? null,
      userPerceivedCrashRate: all?.userPerceivedCrashRate ?? null,
      anrRate: all?.anrRate ?? null,
      userPerceivedAnrRate: all?.userPerceivedAnrRate ?? null,
      crashes: store === 'play' ? (files.length ? fileCrashes : null) : (all?.crashes ?? null),
      crashDevices: all?.crashDevices ?? null,
      ...(store === 'apple'
        ? { crashesExpanded: all?.crashesExpanded ?? null, crashDevicesExpanded: all?.crashDevicesExpanded ?? null }
        : {}),
      ...(store === 'play' ? { anrs: files.length ? fileAnrs : null } : {}),
    };
  });
  const notes = [
    "Google Play rates are shares of daily users (Play Developer Reporting API); Google flags apps above 1.09% user-perceived crash rate or 0.47% user-perceived ANR rate; Google Play crash and ANR counts come from the Play Console's monthly crash files (3-7 days late). App Store crashes are those that made a crash log (App Crashes); crashesExpanded counts every crash on device (App Crashes Expanded, iOS and iPadOS 17.4 and later, up to 8 days late). Both count only people who share analytics with developers; crashing devices are summed across device models and OS versions, an upper bound.",
  ];
  for (const s of summary) {
    if (s.store === 'apple' && s.crashes === null && (s.crashesExpanded ?? null) === null) {
      const read = await ctx.store.getMeta(syncKeys.ascInstance(r.app.id, 'crashes'));
      notes.push(
        read
          ? 'App Store: no crashes in this range among people who share analytics.'
          : "App Store: Apple has not generated an App Crashes report for this app. Apple makes it only for days when at least five people who share analytics with developers had events, so a small app often has none; nothing is missing on Searchkeep's side. Use your own crash reporting (Xcode Organizer, a crash SDK) for these apps.",
      );
    }
    if (s.store === 'play' && s.crashRate === null && s.anrRate === null) {
      const st = parseJson<{ checkedOn?: string; empty?: boolean }>(await ctx.store.getMeta(syncKeys.playVitals(r.app.id)));
      notes.push(
        st?.empty
          ? `Google Play: the Play Developer Reporting API answered without crash or ANR rates for this app: Google computes them only above a minimum number of daily users, so a small app has none.${files.length ? ' The crash and ANR counts above come from the monthly crash files.' : ''}`
          : st?.checkedOn
            ? 'Google Play: no crash or ANR rates in this range.'
            : 'Google Play: crash and ANR rates have not been read yet; see setup_status (probe.play_vitals) if this stays so.',
      );
    }
  }
  return {
    app: r.app.id,
    range: r.range,
    groupBy,
    summary,
    rows: groupBy === 'version' ? rows.filter((x) => x.version !== '') : rows,
    notes,
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
  // Every value, so App Store crash counts merge into their versions before the limit applies.
  const rows = await ctx.store.queryAppBreakdowns({
    appId: r.app.id,
    ...(r.store ? { store: r.store } : {}),
    dimension,
    range: r.range,
    limit: 500,
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
  const weight = (x: (typeof rows)[number]) => x.installs + x.sessions + x.crashes;
  rows.sort((a, b) => weight(b) - weight(a) || b.activeDevices - a.activeDevices || a.value.localeCompare(b.value));
  return {
    app: r.app.id,
    range: r.range,
    dimension,
    rows: rows.slice(0, r.limit).map((x) => ({
      ...x,
      averageSessionSeconds: x.sessions > 0 ? round(x.sessionSeconds / x.sessions, 1) : null,
      crashesPerSession: x.sessions > 0 && x.crashes > 0 ? round(x.crashes / x.sessions, 4) : null,
    })),
    notes: [
      `Per ${dimension.replace('_', ' ')}: Google Play installs, uninstalls, active devices (on the last day), ratings (the daily average averaged over days, and the last total average), crashes and ANRs from the Play Console's files; App Store sessions (people who share analytics, at least five per value) and crash counts. At most ${BREAKDOWN_VALUES_PER_DAY} values a day are kept; the rest are summed into "Other".`,
    ],
  };
}

export interface AppSubscriptionsParams extends AppParams {
  product?: string;
  territory?: string;
  /** App Store only: an offer type (`free_trial`, `pay_up_front`, `pay_as_you_go`, ...; empty string for none). */
  offerType?: string;
}

interface MetricMatch {
  metrics?: string[];
  groups?: string[];
  prefix?: string;
}

type AppleEventName =
  | 'trialStarts'
  | 'paidOfferStarts'
  | 'trialConversions'
  | 'paidOfferConversions'
  | 'paidStarts'
  | 'renewals'
  | 'voluntaryChurn'
  | 'involuntaryChurn'
  | 'refunds'
  | 'enteredBillingIssue'
  | 'recoveredFromBillingIssue';
type AppleStateName = 'activeSubscriptions' | 'freeTrials' | 'paidOffers' | 'paidPlans' | 'gracePeriod' | 'billingRetry' | 'suspended';

/** App Store subscription event sub types and groupings (slugs) summed into each summary figure. */
const APPLE_EVENTS: Record<AppleEventName, MetricMatch> = {
  trialStarts: { metrics: ['free_trial_starts'] },
  paidOfferStarts: { metrics: ['paid_offer_starts'] },
  trialConversions: { metrics: ['full_price_from_free_trial', 'contingent_price_from_free_trial'] },
  paidOfferConversions: { metrics: ['full_price_from_paid_offer', 'contingent_price_from_paid_offer'] },
  paidStarts: { metrics: ['full_price_subscription_starts', 'contingent_price_subscription_starts'] },
  renewals: { groups: ['renewals'] },
  voluntaryChurn: { groups: ['voluntary_churn'] },
  involuntaryChurn: { groups: ['involuntary_churn'] },
  refunds: { prefix: 'refunds_' },
  enteredBillingIssue: { groups: ['entered_billing_issue'] },
  recoveredFromBillingIssue: { groups: ['recoveries_from_billing_issue'] },
};
/** App Store subscription states (levels) per summary figure; churned states are 2-year totals and left out. */
const APPLE_STATES: Record<AppleStateName, MetricMatch> = {
  activeSubscriptions: { groups: ['subscription_offers', 'paid_plans'] },
  freeTrials: { metrics: ['free_trials'] },
  paidOffers: { metrics: ['paid_offers'] },
  paidPlans: { groups: ['paid_plans'] },
  gracePeriod: { metrics: ['grace_period'] },
  billingRetry: { metrics: ['billing_retry'] },
  suspended: { metrics: ['suspended'] },
};

interface MetricRow {
  metric?: string;
  metricGroup?: string;
  date?: string;
  product?: string;
  offerType?: string;
  territory?: string;
  source?: string;
  count: number;
}

const matches = (d: MetricMatch, r: MetricRow) =>
  Boolean(
    d.metrics?.includes(r.metric ?? '') || d.groups?.includes(r.metricGroup ?? '') || (d.prefix && (r.metric ?? '').startsWith(d.prefix)),
  );

function sumBy<K extends string>(defs: Record<K, MetricMatch>, rows: MetricRow[]): Record<K, number> {
  const out = {} as Record<K, number>;
  for (const name of Object.keys(defs) as K[]) {
    let total = 0;
    for (const r of rows) if (matches(defs[name], r)) total += r.count;
    out[name] = total;
  }
  return out;
}

type AppleSummary = Record<AppleEventName | AppleStateName | 'churn', number> & { trialConversionRate: number | null };

function appleSummary(events: MetricRow[], states: MetricRow[]): AppleSummary {
  const e = sumBy(APPLE_EVENTS, events);
  const st = sumBy(APPLE_STATES, states);
  return {
    ...st,
    ...e,
    churn: e.voluntaryChurn + e.involuntaryChurn,
    // Conversions ÷ trial starts in the same period: a rough rate, not a cohort.
    trialConversionRate: e.trialStarts > 0 ? round(e.trialConversions / e.trialStarts, 4) : null,
  };
}

type GroupKey = 'date' | 'product' | 'offerType' | 'territory' | 'source';

/** Rows grouped by a key (plus metric and grouping) → one summary per value of the key. */
function groupSummaries(key: GroupKey, events: MetricRow[], states: MetricRow[]): Array<AppleSummary & { value: string }> {
  const by = new Map<string, { events: MetricRow[]; states: MetricRow[] }>();
  const at = (v: string) => {
    let e = by.get(v);
    if (!e) by.set(v, (e = { events: [], states: [] }));
    return e;
  };
  for (const r of events) at(r[key] ?? '').events.push(r);
  for (const r of states) at(r[key] ?? '').states.push(r);
  return [...by].map(([value, x]) => ({ value, ...appleSummary(x.events, x.states) }));
}

const APPLE_SUBSCRIPTION_NOTE =
  "App Store (appStore): Apple's Subscription State report gives levels (activeSubscriptions = free trials, paid offers and paid plans; billing retry, grace period and suspended are listed apart; churned subscriptions are left out) on the last day with data; the Subscription Event report gives counts summed over the range (trialConversions = trials converted to full or contingent price; renewals = all renewals; churn = voluntary + involuntary; refunds = refunds requested). Sources are where the subscriber first downloaded the app (events only). Data is complete about 3 days after a day ends; history goes back to January 1, 2025 through the one-time snapshot.";

async function playSubscriptions(ctx: OpsContext, r: ResolvedApp, p: AppSubscriptionsParams, prev: DateRange) {
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
  // Google Play keeps the top-level fields it has always had.
  return {
    current: total(current[0]),
    previous: total(previous[0]),
    products: products.map((x) => ({ ...x, net: x.newSubscriptions - x.canceledSubscriptions })),
    territories: territories.map((x) => ({ ...x, net: x.newSubscriptions - x.canceledSubscriptions })),
    series,
  };
}

async function appleSubscriptions(ctx: OpsContext, r: ResolvedApp, p: AppSubscriptionsParams, prev: DateRange) {
  const q = {
    appId: r.app.id,
    ...(p.product ? { product: p.product.trim() } : {}),
    ...(p.territory ? { territory: p.territory.trim().toUpperCase() } : {}),
    ...(p.offerType !== undefined ? { offerType: p.offerType.trim().toLowerCase() } : {}),
  };
  const md = ['metric', 'metricGroup'] as const;
  const ev = (range: DateRange, extra: Array<'date' | 'product' | 'offerType' | 'territory' | 'source'> = []) =>
    ctx.store.queryAppSubscriptionMetrics({ ...q, kind: 'event', range, dimensions: [...extra, ...md], limit: 10000 });
  const st = (range: DateRange, extra: Array<'date' | 'product' | 'offerType' | 'territory'> = []) =>
    ctx.store.queryAppSubscriptionMetrics({ ...q, kind: 'state', range, dimensions: [...extra, ...md], limit: 10000 });
  const [evCur, evPrev, stCur, stPrev, evDays, stDays, evProd, stProd, evOffer, stOffer, evTerr, stTerr, evSrc] = await Promise.all([
    ev(r.range),
    ev(prev),
    st(r.range),
    st(prev),
    ev(r.range, ['date']),
    st(r.range, ['date']),
    ev(r.range, ['product']),
    st(r.range, ['product']),
    ev(r.range, ['offerType']),
    st(r.range, ['offerType']),
    ev(r.range, ['territory']),
    st(r.range, ['territory']),
    ev(r.range, ['source']),
  ]);
  const rank = (xs: Array<AppleSummary & { value: string }>) =>
    xs
      .sort((a, b) => b.activeSubscriptions - a.activeSubscriptions || b.trialStarts + b.paidStarts - (a.trialStarts + a.paidStarts))
      .slice(0, r.limit);
  const as = <K extends string>(k: K, xs: Array<AppleSummary & { value: string }>) =>
    xs.map(({ value, ...x }) => ({ [k]: value, ...x }) as AppleSummary & Record<K, string>);
  const hasData = evCur.length > 0 || stCur.length > 0;
  // Proceeds of first payments and renewals per currency, from Sales and Trends (when configured).
  const split = await ctx.store.queryAppSales({
    appId: r.app.id,
    range: r.range,
    dimensions: ['subscription', 'proceedsCurrency'],
    ...(p.territory ? { territory: p.territory.trim().toUpperCase() } : {}),
  });
  const proceeds = [...new Set(split.filter((x) => x.subscription).map((x) => x.proceedsCurrency!))].sort().map((currency) => {
    const of = (kind: string) => split.find((x) => x.subscription === kind && x.proceedsCurrency === currency);
    return {
      currency,
      newSubscriptions: round((of('new')?.proceedsCents ?? 0) / 100, 2),
      renewals: round((of('renewal')?.proceedsCents ?? 0) / 100, 2),
      newUnits: of('new')?.units ?? 0,
      renewalUnits: of('renewal')?.units ?? 0,
    };
  });
  const result = {
    proceeds: ctx.config.asc.vendorNumber || proceeds.length ? proceeds : null,
    current: appleSummary(evCur, stCur),
    previous: appleSummary(evPrev, stPrev),
    products: as('product', rank(groupSummaries('product', evProd, stProd))),
    offerTypes: as(
      'offerType',
      rank(groupSummaries('offerType', evOffer, stOffer)).map((x) => ({ ...x, value: x.value || 'none' })),
    ),
    territories: as('territory', rank(groupSummaries('territory', evTerr, stTerr))),
    sources: rank(groupSummaries('source', evSrc, [])).map((x) => ({
      source: x.value,
      trialStarts: x.trialStarts,
      paidOfferStarts: x.paidOfferStarts,
      paidStarts: x.paidStarts,
      trialConversions: x.trialConversions,
      renewals: x.renewals,
      churn: x.churn,
      refunds: x.refunds,
    })),
    series: as(
      'date',
      groupSummaries('date', evDays, stDays).sort((a, b) => a.value.localeCompare(b.value)),
    ),
    events: evCur
      .map((x) => ({ metric: x.metric, metricGroup: x.metricGroup, count: x.count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 100),
  };
  return { result, hasData };
}

/**
 * Subscriptions per store. Google Play (ADR 0010): new, canceled and active subscriptions per
 * product and country. App Store: subscription states (active, trials, offers, billing retry,
 * grace period) and lifecycle events (trial starts and conversions, paid starts, renewals,
 * voluntary and involuntary churn, refunds) per subscription, offer type, storefront and download
 * source. Both against the previous period of the same length, with the daily trend.
 */
export async function appSubscriptions(ctx: OpsContext, p: AppSubscriptionsParams) {
  const r = await resolveApp(ctx, p, { days: 28, limit: 50 });
  const stores = storesOf(r.app, r.store);
  const prev = previousPeriod(r.range);
  const notes: string[] = [...r.notes];
  let play: Awaited<ReturnType<typeof playSubscriptions>> | undefined;
  let appStore: Awaited<ReturnType<typeof appleSubscriptions>> | undefined;

  if (stores.includes('play')) {
    play = await playSubscriptions(ctx, r, p, prev);
    notes.push(
      'Google Play subscription statistics (top-level current, previous, products, territories, series): new and canceled subscriptions are summed over the range; active subscriptions are those on the last day with data. They need the service account to view financial data.',
    );
  }
  if (stores.includes('apple')) {
    appStore = await appleSubscriptions(ctx, r, p, prev);
    notes.push(APPLE_SUBSCRIPTION_NOTE);
    if (!appStore.hasData)
      notes.push(
        'App Store: no subscription data in this range yet. The reports come with the App Store reports already started for the app (no new permission); the first ones appear a day or two after this version syncs, history through the next monthly snapshot (Settings → Apps).',
      );
  }
  if (p.product) notes.push('Product filters by the Google Play product id and by the App Store subscription name.');
  if (appStore)
    notes.push(
      appStore.result.proceeds
        ? 'App Store proceeds (appStore.proceeds) split auto-renewable subscription payments into first payments and renewals per proceeds currency, from Sales and Trends; the product filter does not apply to them (see app_revenue per product).'
        : 'App Store proceeds split into first payments and renewals need Sales and Trends: set the ASC_VENDOR_NUMBER secret (see app_revenue).',
    );
  notes.push(
    'Install retention and subscriber cohorts are offered by neither store: use your own app analytics or a subscription platform for those.',
  );
  return {
    app: r.app.id,
    range: r.range,
    previousRange: prev,
    ...(play ?? {}),
    ...(appStore ? { appStore: appStore.result } : {}),
    notes,
  };
}

export interface AppRevenueParams extends Omit<AppParams, 'store'> {
  /** Group rows by these (default product). */
  groupBy?: Array<'date' | 'product' | 'territory' | 'type'>;
  /** Only this product: the App Store product name (Content Name) or Sales and Trends SKU or title. */
  product?: string;
  territory?: string;
}

const REVENUE_GROUPS = ['date', 'product', 'territory', 'type'] as const;
const money = (cents: number) => round(cents / 100, 2);

/**
 * App Store revenue per product. Always: Apple's estimate in USD per product (App Store Purchases),
 * with refunds kept apart. With Sales and Trends (ASC_VENDOR_NUMBER): the exact units, proceeds and
 * refunds per product in each proceeds currency, the customer price and whether a subscription
 * payment was new or a renewal. Amounts in different currencies are never added up.
 */
export async function appRevenue(ctx: OpsContext, p: AppRevenueParams) {
  const r = await resolveApp(ctx, { ...p, store: 'apple' }, { days: 28, limit: 50 });
  const groupBy = p.groupBy ?? ['product'];
  for (const g of groupBy)
    if (!(REVENUE_GROUPS as readonly string[]).includes(g))
      throw new SearchkeepError('bad_request', `groupBy must be any of ${REVENUE_GROUPS.join(', ')}.`);
  const prev = previousPeriod(r.range);
  const territory = p.territory?.trim().toUpperCase();
  const product = p.product?.trim();

  // Analytics Reports (USD estimate).
  const aq = { appId: r.app.id, ...(product ? { product } : {}), ...(territory ? { territory } : {}) };
  const aDims = groupBy.map((g) => (g === 'type' ? 'purchaseType' : g)) as Array<'date' | 'product' | 'territory' | 'purchaseType'>;
  const [aCur, aPrev, aRows, aRefunds] = await Promise.all([
    ctx.store.queryAppProducts({ ...aq, range: r.range, dimensions: [] }),
    ctx.store.queryAppProducts({ ...aq, range: prev, dimensions: [] }),
    ctx.store.queryAppProducts({ ...aq, range: r.range, dimensions: aDims, limit: groupBy.includes('date') ? 5000 : r.limit }),
    ctx.store.queryAppProducts({ ...aq, range: r.range, dimensions: ['date', 'product', 'territory'], limit: 5000 }),
  ]);
  const aOut = (x: (typeof aCur)[number] | undefined) => ({
    purchases: x?.purchases ?? 0,
    refunds: x?.refunds ?? 0,
    proceeds: money(x?.proceedsCents ?? 0),
    refundedProceeds: money(x?.refundProceedsCents ?? 0),
    sales: money(x?.salesCents ?? 0),
  });
  const analytics = {
    currency: 'USD',
    current: aOut(aCur[0]),
    previous: aOut(aPrev[0]),
    rows: aRows.map((x) => ({
      ...(x.date ? { date: x.date } : {}),
      ...(x.product !== undefined ? { product: x.product } : {}),
      ...(x.purchaseType !== undefined ? { type: x.purchaseType } : {}),
      ...(x.territory !== undefined ? { territory: x.territory } : {}),
      ...aOut(x),
    })),
  };

  // Sales and Trends (exact, per currency).
  const sq = { appId: r.app.id, ...(product ? { sku: product } : {}), ...(territory ? { territory } : {}) };
  const sDims = [
    ...groupBy.flatMap((g) => (g === 'product' ? (['sku', 'title'] as const) : g === 'type' ? (['productType'] as const) : ([g] as const))),
    'proceedsCurrency' as const,
  ];
  const [sCur, sPrev, sRows, sSubs, sRefunds] = await Promise.all([
    ctx.store.queryAppSales({ ...sq, range: r.range, dimensions: ['proceedsCurrency'] }),
    ctx.store.queryAppSales({ ...sq, range: prev, dimensions: ['proceedsCurrency'] }),
    ctx.store.queryAppSales({ ...sq, range: r.range, dimensions: sDims, limit: groupBy.includes('date') ? 5000 : r.limit }),
    ctx.store.queryAppSales({ ...sq, range: r.range, dimensions: ['subscription', 'proceedsCurrency'] }),
    ctx.store.queryAppSales({ ...sq, range: r.range, dimensions: ['date', 'sku', 'title', 'territory', 'proceedsCurrency'], limit: 5000 }),
  ]);
  const sOut = (x: (typeof sCur)[number] | undefined) => ({
    units: x?.units ?? 0,
    refundUnits: x?.refundUnits ?? 0,
    proceeds: money(x?.proceedsCents ?? 0),
    refundedProceeds: money(x?.refundProceedsCents ?? 0),
  });
  const configured = Boolean(ctx.config.asc.vendorNumber);
  const currencies = [...new Set([...sCur, ...sPrev].map((x) => x.proceedsCurrency!))].sort();
  const sales =
    configured || sCur.length || sRows.length
      ? {
          configured,
          currencies: currencies.map((currency) => {
            const sub = (kind: string) => sSubs.find((x) => x.subscription === kind && x.proceedsCurrency === currency)?.proceedsCents ?? 0;
            return {
              currency,
              current: sOut(sCur.find((x) => x.proceedsCurrency === currency)),
              previous: sOut(sPrev.find((x) => x.proceedsCurrency === currency)),
              newSubscriptionProceeds: money(sub('new')),
              renewalProceeds: money(sub('renewal')),
            };
          }),
          rows: sRows.map((x) => ({
            ...(x.date ? { date: x.date } : {}),
            ...(x.sku !== undefined ? { sku: x.sku, title: x.title ?? '' } : {}),
            ...(x.productType !== undefined ? { type: x.productType } : {}),
            ...(x.territory !== undefined ? { territory: x.territory } : {}),
            currency: x.proceedsCurrency!,
            ...sOut(x),
          })),
        }
      : null;

  // Refunds per day and product, newest first: answers "which product was refunded that day".
  const refunds = [
    ...aRefunds
      .filter((x) => x.refunds > 0 || x.refundProceedsCents > 0)
      .map((x) => ({
        source: 'analytics' as const,
        date: x.date!,
        product: x.product!,
        territory: x.territory!,
        refunds: x.refunds,
        refundedProceeds: money(x.refundProceedsCents),
        currency: 'USD',
      })),
    ...sRefunds
      .filter((x) => x.refundUnits > 0)
      .map((x) => ({
        source: 'sales' as const,
        date: x.date!,
        product: x.title || x.sku!,
        sku: x.sku!,
        territory: x.territory!,
        refunds: x.refundUnits,
        refundedProceeds: money(x.refundProceedsCents),
        currency: x.proceedsCurrency!,
      })),
  ]
    .sort((a, b) => b.date.localeCompare(a.date) || b.refundedProceeds - a.refundedProceeds)
    .slice(0, 100);

  const notes = [
    "analytics: Apple's App Store Purchases report per product (Content Name: the in-app purchase's reference name, or the app for paid apps), in USD estimated by Apple, attributed to the day of purchase or refund; refunds are kept apart (refunds, refundedProceeds) and proceeds are net of them.",
  ];
  if (sales)
    notes.push(
      'sales: Sales and Trends Summary Sales, exact units and proceeds per product (SKU) in each proceeds currency, never added across currencies; refunds are negative units on the day Apple processed them; newSubscriptionProceeds and renewalProceeds split auto-renewable subscription proceeds into first payments and renewals. Free downloads, updates and redownloads are left out.',
    );
  else
    notes.push(
      'sales: not configured. Set the ASC_VENDOR_NUMBER secret (App Store Connect → Payments and Financial Reports, the number next to your legal entity name) for exact revenue per product in local currencies, prices, and new versus renewal subscription proceeds; the existing Sales and Reports key can read it.',
    );
  if (!aCur.length && !sCur.length) notes.push('No App Store revenue in this range.');
  return { app: r.app.id, range: r.range, previousRange: prev, groupBy, analytics, sales, refunds, notes };
}

export interface AppChangesParams extends AppParams {
  /** Entity: `version`, `listing`, `app_info` (App Store) or `listing`, `track` (Google Play), or an exact one like `listing:IOS`. */
  entity?: string;
  field?: string;
  locale?: string;
}

const CHANGE_TEXT = 1500;
const clip = (v: string | null) => (v === null || v.length <= CHANGE_TEXT ? v : `${v.slice(0, CHANGE_TEXT)}…`);

/**
 * What changed on the app's store presence and when: versions going on sale or into review,
 * phased releases, names, subtitles, keywords, descriptions, promotional text, release notes, and
 * on Google Play titles, descriptions, track releases and rollouts. One change per field and day
 * it was first seen, with the value before and after, newest first.
 */
export async function appChanges(ctx: OpsContext, p: AppChangesParams) {
  // Snapshots are taken today, ahead of the store reports: the range ends today by default.
  const today = toIsoDate(ctx.now ? ctx.now() : new Date());
  const r = await resolveApp(ctx, { ...p, ...(p.end === undefined ? { end: today } : {}) }, { days: 90, limit: 100 });
  const rows = await ctx.store.queryAppChanges({
    appId: r.app.id,
    ...(r.store ? { store: r.store } : {}),
    range: r.range,
    ...(p.entity ? { entity: p.entity.trim() } : {}),
    ...(p.field ? { field: p.field.trim() } : {}),
    ...(p.locale ? { locale: p.locale.trim() } : {}),
    limit: 2000,
  });
  const days = new Map<string, number>();
  for (const x of rows) days.set(`${x.store}|${x.date}`, (days.get(`${x.store}|${x.date}`) ?? 0) + 1);
  const changes = rows.slice(0, r.limit).map((x) => ({
    ...x,
    kind: x.before === null ? 'added' : x.after === null ? 'removed' : 'changed',
    before: clip(x.before),
    after: clip(x.after),
  }));
  const notes = [
    'Changes are found by comparing daily snapshots, so a change is dated the day it was first seen (up to a day late) and changes before the first snapshot are not known. Long texts are cut at 1,500 characters. Version fields: live (the version on sale), live_phased_release, next, next_state, next_release_type, next_earliest_release.',
  ];
  const stores = storesOf(r.app, r.store);
  const status = await Promise.all(
    stores.map(
      async (s) =>
        [s, parseJson<{ day?: string; problem?: string }>(await ctx.store.getMeta(syncKeys.listingChecked(r.app.id, s)))] as const,
    ),
  );
  for (const [s, st] of status) {
    if (st?.problem)
      notes.push(
        s === 'apple'
          ? `App Store: the App Store Connect key may not read the app's versions and listings (${st.problem}); see setup_status.`
          : `Google Play: the service account may not read the store listing through the Android Publisher API (${st.problem}); see setup_status.`,
      );
    else if (!st?.day)
      notes.push(
        s === 'apple'
          ? 'App Store: no snapshot yet; the first one is taken with the next sync and is the baseline changes are measured against.'
          : ctx.config.play.metadata
            ? 'Google Play: no snapshot yet; the first one is taken with the next sync.'
            : 'Google Play: store listing snapshots are off. Set PLAY_METADATA=true to turn them on (see setup_status).',
      );
  }
  return {
    app: r.app.id,
    range: r.range,
    days: [...days].map(([k, n]) => ({ store: k.split('|')[0] as AppStore, date: k.split('|')[1]!, changes: n })),
    changes,
    notes,
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
