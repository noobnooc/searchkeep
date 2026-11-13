/**
 * Domain model shared by every Searchkeep package.
 *
 * Dates are ISO calendar dates (`YYYY-MM-DD`, UTC). Positions are stored as
 * impression-weighted sums so they can be re-aggregated exactly:
 * `avgPosition = positionSum / impressions`.
 */

export type IsoDate = string;

export type SearchSource = 'gsc' | 'bing';
/** App sources: App Store Connect, Google Play, and Apple's public App Store feeds (opt-in). */
export type AppSourceId = 'asc' | 'play' | 'appstore';
export type SourceId = SearchSource | 'cloudflare' | AppSourceId;

/**
 * Search Console search types. `web` is the default everywhere; the others are
 * synced as separate datasets (GSC_SEARCH_TYPES). Discover and Google News
 * have no queries and no positions.
 */
export type GscSearchType = 'web' | 'image' | 'video' | 'news' | 'discover' | 'googleNews';
export const GSC_SEARCH_TYPES: readonly GscSearchType[] = ['web', 'image', 'video', 'news', 'discover', 'googleNews'];
/** Search types that report pages only: no query dimension and no average position. */
export const PAGE_ONLY_SEARCH_TYPES: readonly GscSearchType[] = ['discover', 'googleNews'];

export interface SiteConfig {
  /** Short stable identifier, e.g. `acme`. Lowercase letters, digits, dashes. */
  id: string;
  /** Bare hostname, e.g. `acme.com`. */
  domain: string;
  /** GSC property: `sc-domain:acme.com` or `https://acme.com/`. */
  gscProperty?: string;
  /** Bing Webmaster Tools site URL, e.g. `https://acme.com/`. */
  bingSiteUrl?: string;
  /** Cloudflare zone id (AI crawler traffic). */
  cloudflareZoneId?: string;
  /** Cloudflare Web Analytics site tag (referrers, page views, Web Vitals). */
  webAnalyticsSiteTag?: string;
  /** Overrides the global brand regex for this site. */
  brandRegex?: string;
  /** Where the site is defined: the SITES secret (read-only) or the dashboard. */
  origin?: 'secret' | 'dashboard';
}

export interface DateRange {
  start: IsoDate;
  end: IsoDate;
}

/**
 * Row granularity in the unified search fact table.
 * - `total`: site-wide totals for a day (includes anonymized queries)
 * - `query_page`: query × page (GSC)
 * - `query`: query only (Bing query stats)
 * - `page`: page only (Bing page stats)
 */
export type FactKind = 'total' | 'query_page' | 'query' | 'page';

export interface SearchFactInput {
  date: IsoDate;
  kind: FactKind;
  /** Full URL or path; normalized by the store to a path. */
  page?: string | null;
  query?: string | null;
  clicks: number;
  impressions: number;
  /** Average position (1-based) for this row, if known. */
  position?: number | null;
}

export interface BreakdownInput {
  date: IsoDate;
  country: string;
  device: string;
  clicks: number;
  impressions: number;
  position?: number | null;
}

/** GSC search appearance totals for one day (`appearance` is e.g. `VIDEO`, `REVIEW_SNIPPET`). */
export interface AppearanceInput {
  date: IsoDate;
  appearance: string;
  clicks: number;
  impressions: number;
  position?: number | null;
}

/** One query (`kind: 'query'`) or one page (`kind: 'page'`) on one day, split by country and device. */
export interface SegmentInput {
  date: IsoDate;
  kind: 'query' | 'page';
  /** The query text, or the page (full URL or path, normalized by the store). */
  key: string;
  country: string;
  device: string;
  clicks: number;
  impressions: number;
  position?: number | null;
}

/** Crawler families recorded from Cloudflare: AI crawlers and assistants, or search engine crawlers. */
export type CrawlerKind = 'ai' | 'search';

export interface CrawlerRequestInput {
  date: IsoDate;
  /** Normalized crawler name, e.g. `GPTBot`. */
  crawler: string;
  /** Operator, e.g. `OpenAI`. */
  operator: string;
  /** Purpose bucket: training, search, user (assistant fetching on behalf of a user), other. */
  purpose: CrawlerPurpose;
  path: string;
  status: number;
  requests: number;
}

/**
 * AI crawlers: `training`, `search` (AI search indexes), `user` (fetches for a user's question), `other`.
 * Search engine crawlers: `search` (web search index), `media` (image and video indexes), `ads`
 * (ad landing page checks), `other` (previews, verification and tool fetches).
 */
export type CrawlerPurpose = 'training' | 'search' | 'user' | 'media' | 'ads' | 'other';

export interface WebAnalyticsInput {
  date: IsoDate;
  path: string;
  /** Referrer hostname, empty string for direct/none. */
  refererHost: string;
  visits: number;
  pageViews: number;
}

export interface WebVitalsInput {
  date: IsoDate;
  path: string;
  /** p75 values. Milliseconds for LCP/INP/FCP/TTFB, unitless for CLS. */
  lcpP75?: number | null;
  inpP75?: number | null;
  clsP75?: number | null;
  samples: number;
}

export interface AiCitationInput {
  date: IsoDate;
  page: string;
  /** AI surface, e.g. `bing_copilot`. */
  surface: string;
  citations: number;
}

export interface CrawlIssueInput {
  url: string;
  issue: string;
  httpCode?: number | null;
  detectedAt?: IsoDate | null;
}

export interface RichResultIssue {
  /** Rich result type, e.g. `Breadcrumbs`, `FAQ`, `Product snippets`. */
  type: string;
  severity: string;
  message: string;
}

/** One URL Inspection result as stored in the index coverage snapshot. */
export interface UrlInspectionInput {
  /** Absolute URL as listed in the sitemap. */
  url: string;
  /** ISO timestamp of the inspection. */
  inspectedAt: string;
  verdict: string | null;
  coverageState: string | null;
  indexingState: string | null;
  pageFetchState: string | null;
  robotsTxtState: string | null;
  lastCrawlTime: string | null;
  googleCanonical: string | null;
  userCanonical: string | null;
  crawledAs: string | null;
  richResultsVerdict: string | null;
  /** Rich result types detected on the page (with or without issues). */
  richResultTypes: string[];
  richResultIssues: RichResultIssue[];
  /** Why the URL could not be inspected (e.g. not part of the property); the other fields are null then. */
  error?: string | null;
}

export interface IndexStatusRow extends Omit<UrlInspectionInput, 'inspectedAt'> {
  inspectedAt: string | null;
  firstSeen: IsoDate;
  /** Last day a sitemap listed the URL (refreshed about weekly). */
  lastSeen: IsoDate;
  previousCoverageState: string | null;
  changedAt: string | null;
}

export interface IndexCoverageQuery {
  siteId: string;
  /** Only URLs with this coverage state (case-insensitive substring, e.g. "crawled"). */
  coverageState?: string;
  /** Only URLs with this verdict (PASS, NEUTRAL, FAIL); `PENDING` = not inspected yet. */
  verdict?: string;
  /** Only URLs with rich result issues. */
  richResultIssues?: boolean;
  /** Coverage changes at or after this ISO timestamp are listed under `changes`. */
  changedSince: string;
  limit: number;
}

export interface IndexCoverageResult {
  totals: {
    urls: number;
    inspected: number;
    /** URLs whose inspection failed (see `error`). */
    errors: number;
    oldestInspectedAt: string | null;
    newestInspectedAt: string | null;
  };
  /** URL counts per verdict and coverage state; verdict `PENDING` = not inspected yet, `ERROR` = inspection failed. */
  states: Array<{ verdict: string; coverageState: string | null; urls: number }>;
  richResults: {
    verdicts: Array<{ verdict: string; urls: number }>;
    types: Array<{ type: string; urls: number; urlsWithIssues: number }>;
    issues: Array<RichResultIssue & { urls: number }>;
  };
  /** URLs matching the filters; without filters, URLs that are not indexed (or not inspected) first. */
  urls: IndexStatusRow[];
  changes: Array<{ url: string; from: string | null; to: string | null; changedAt: string }>;
}

export interface SitemapRecord {
  path: string;
  lastSubmitted?: string | null;
  lastDownloaded?: string | null;
  isPending?: boolean;
  errors?: number;
  warnings?: number;
  submitted?: number | null;
  /** Google no longer fills this ("Deprecated; do not use"), so it is null; see index coverage instead. */
  indexed?: number | null;
}

export interface Metrics {
  clicks: number;
  impressions: number;
  /** clicks / impressions, 0..1 */
  ctr: number;
  /** Impression-weighted average position, null when unknown. */
  position: number | null;
}

export type BrandFilter = 'all' | 'brand' | 'non_brand';
export type PerformanceDimension = 'date' | 'week' | 'month' | 'query' | 'page' | 'country' | 'device' | 'appearance';

export interface PerformanceFilters {
  /** Case-insensitive substring match on the query text. */
  queryContains?: string;
  /** Case-insensitive substring match on the page path. */
  pageContains?: string;
  country?: string;
  device?: string;
  /** Exact search appearance, e.g. `VIDEO` (GSC only; not with query, page, country or device). */
  appearance?: string;
  brand?: BrandFilter;
}

/**
 * Which stored rows answer a query:
 * - query/page dimensions and filters: `search_facts` (query × page, or Bing's query and page rows);
 * - country/device alone: the country × device breakdown;
 * - country/device with query or page (not both): the opt-in segments (GSC_SEGMENT_SITES);
 * - appearance: the search appearance series (alone or with a time dimension).
 */
export interface PerformanceQuery {
  siteId: string;
  source: SearchSource;
  /** GSC only. Default `web`. */
  searchType?: GscSearchType;
  range: DateRange;
  dimensions: PerformanceDimension[];
  filters?: PerformanceFilters;
  having?: {
    minImpressions?: number;
    minClicks?: number;
    minPosition?: number;
    maxPosition?: number;
  };
  orderBy?: 'clicks' | 'impressions' | 'ctr' | 'position' | 'date';
  order?: 'asc' | 'desc';
  limit?: number;
}

export interface PerformanceRow extends Metrics {
  date?: IsoDate;
  week?: IsoDate;
  month?: string;
  query?: string;
  page?: string;
  country?: string;
  device?: string;
  appearance?: string;
}

export interface CrawlerQuery {
  siteId: string;
  /** Default `ai`. */
  kind?: CrawlerKind;
  range: DateRange;
  groupBy: Array<'crawler' | 'operator' | 'purpose' | 'path' | 'status' | 'date'>;
  crawler?: string;
  pathContains?: string;
  limit?: number;
}

export interface CrawlerRow {
  crawler?: string;
  operator?: string;
  purpose?: CrawlerPurpose;
  path?: string;
  status?: number;
  date?: IsoDate;
  requests: number;
}

export interface ReferralQuery {
  siteId: string;
  range: DateRange;
  /** Restrict to these referrer hostnames. */
  refererHosts?: string[];
  groupBy: Array<'path' | 'refererHost' | 'date'>;
  limit?: number;
}

export interface ReferralRow {
  path?: string;
  refererHost?: string;
  date?: IsoDate;
  visits: number;
  pageViews: number;
}

export interface PageCount {
  page: string;
  value: number;
}

export interface SyncRunRecord {
  id?: number;
  startedAt: string;
  finishedAt?: string | null;
  trigger: 'cron' | 'manual';
  status: 'running' | 'ok' | 'partial' | 'error' | 'skipped';
  rowsWritten: number;
  message?: string | null;
  details?: SyncTaskResult[];
}

export interface SyncTaskResult {
  task: string;
  siteId: string;
  source: SourceId;
  status: 'ok' | 'error' | 'skipped';
  rowsWritten: number;
  message?: string;
}

export interface DataCoverage {
  siteId: string;
  source: string;
  dataset: string;
  firstDate: IsoDate | null;
  lastDate: IsoDate | null;
  /** Days with data, when cheap to compute (search totals); otherwise null. */
  days: number | null;
}

// ------------------------------------------------------------------------ apps

/** The two app stores. */
export type AppStore = 'apple' | 'play';
export const APP_STORES: readonly AppStore[] = ['apple', 'play'];

export interface AppConfig {
  /** Short stable identifier, e.g. `acme-ios`. Lowercase letters, digits, dashes. */
  id: string;
  /** Display name, e.g. `Acme`. */
  name: string;
  /** App Store Apple ID (numeric), e.g. `1476097583`. */
  appleId?: string;
  /** Google Play package name, e.g. `com.acme.app`. */
  playPackage?: string;
  /** One of the user's sites: web referrers from its domain are marked as the user's own. */
  siteId?: string;
  /**
   * Storefronts (ISO 3166 alpha-2, lower case) for the opt-in public App Store feeds, most important
   * first. Default: the app's biggest App Store storefronts by downloads, then the largest ones.
   */
  territories?: string[];
  /** Where the app is defined: the APPS secret (read-only) or the dashboard. */
  origin?: 'secret' | 'dashboard';
}

/** Territory or source of a row that covers all of them (Google Play reports its two breakdowns separately). */
export const ALL_KEY = '*';

/**
 * Where people found the app, normalized from Apple's "Source Type" and Google Play's traffic
 * source: `search` (App Store search, Google Play search), `browse` (App Store browse, Google Play
 * explore), `app_referrer`, `web_referrer`, `referral` (Google Play third-party referrals),
 * `app_clip`, `notification`, `institutional`, `unavailable`, `other`.
 */
export type AppSourceType =
  | 'search'
  | 'browse'
  | 'app_referrer'
  | 'web_referrer'
  | 'referral'
  | 'app_clip'
  | 'notification'
  | 'institutional'
  | 'unavailable'
  | 'other';

/**
 * Sources whose downloads are licenses bought in bulk, not people finding the app: `institutional`,
 * volume purchases through Apple Business Manager or Apple School Manager (an organization can take
 * 100,000 licenses of a free app at once). Funnel totals and trends leave them out; rows by source
 * list them.
 */
export const VOLUME_PURCHASE_SOURCES: readonly AppSourceType[] = ['institutional'];

/**
 * Store funnel metrics per app, store, day, territory and source.
 * - `impressions`, `impressionsUnique`: the app was shown in a list (App Store only).
 * - `pageViews`, `pageViewsUnique`: product page views (App Store), store listing visitors (Google
 *   Play, unique only).
 * - `downloads`: first-time downloads (App Store), store listing acquisitions (Google Play).
 * - `redownloads`: App Store only.
 * - `installs`, `deletions`: App Store (users who share analytics only), Google Play device installs
 *   and uninstalls.
 * - `activeDevices`: devices with the app installed (Google Play), a level, not a daily count.
 * - `purchases`, `proceedsCents`, `salesCents`, `payingUsers`: App Store Purchases (paid app and
 *   in-app purchases, net of refunds); amounts in cents of the store's currency (App Store: USD,
 *   Apple's estimate). Paying users are summed across rows, so they are an upper bound.
 * - `sessions`, `sessionSeconds`, `sessionDevices`: App Sessions (users who share analytics only,
 *   and only where Apple has at least five users); devices are summed across rows, an upper bound.
 */
export type AppStoreMetric =
  | 'impressions'
  | 'impressionsUnique'
  | 'pageViews'
  | 'pageViewsUnique'
  | 'downloads'
  | 'redownloads'
  | 'installs'
  | 'deletions'
  | 'activeDevices'
  | 'purchases'
  | 'proceedsCents'
  | 'salesCents'
  | 'payingUsers'
  | 'sessions'
  | 'sessionSeconds'
  | 'sessionDevices';
export const APP_STORE_METRICS: readonly AppStoreMetric[] = [
  'impressions',
  'impressionsUnique',
  'pageViews',
  'pageViewsUnique',
  'downloads',
  'redownloads',
  'installs',
  'deletions',
  'activeDevices',
  'purchases',
  'proceedsCents',
  'salesCents',
  'payingUsers',
  'sessions',
  'sessionSeconds',
  'sessionDevices',
];

export type AppStoreMetrics = Record<AppStoreMetric, number>;

export interface AppStoreDailyInput extends Partial<AppStoreMetrics> {
  date: IsoDate;
  /** Upper-case territory code as the store reports it, or `*`. */
  territory: string;
  /** An `AppSourceType` (or another slug), or `*`. */
  source: string;
}

/**
 * Which rows a write replaces: `cross` (territory × source, App Store), `territory` (per territory,
 * all sources) or `source` (per source, all territories). Google Play sends the last two separately.
 */
export type AppRowShape = 'cross' | 'territory' | 'source';

export interface AppStoreWrite {
  /** The metrics this write sets; other metrics of the same rows are left alone. */
  metrics: AppStoreMetric[];
  shape: AppRowShape;
  /** Days the write covers completely: rows of these days it does not mention get 0 for `metrics`. */
  dates: IsoDate[];
  rows: AppStoreDailyInput[];
}

export type AppDimension = 'date' | 'week' | 'month' | 'store' | 'territory' | 'source';

export interface AppStoreQuery {
  appId: string;
  /** Both stores when omitted. */
  store?: AppStore;
  range: DateRange;
  dimensions: AppDimension[];
  territory?: string;
  source?: string;
  /** Leave out the rows of these source types. */
  excludeSources?: readonly string[];
  orderBy?: AppStoreMetric | 'date';
  order?: 'asc' | 'desc';
  limit?: number;
}

export interface AppStoreRow extends AppStoreMetrics {
  date?: IsoDate;
  week?: IsoDate;
  month?: string;
  store?: AppStore;
  territory?: string;
  source?: string;
}

/** Google Play search terms that brought store listing visitors. */
export interface AppSearchTermInput {
  date: IsoDate;
  term: string;
  visitors: number;
  acquisitions: number;
}

export interface AppSearchTermQuery {
  appId: string;
  range: DateRange;
  termContains?: string;
  orderBy?: 'visitors' | 'acquisitions';
  limit?: number;
}

export interface AppSearchTermRow {
  term: string;
  visitors: number;
  acquisitions: number;
}

/** `web`: a website (App Store web referrer), `app`: another app, `utm`: a Google Play UTM source. */
export type AppReferrerKind = 'web' | 'app' | 'utm';

export interface AppReferrerInput {
  date: IsoDate;
  kind: AppReferrerKind;
  referrer: string;
  pageViews?: number;
  downloads?: number;
}

export interface AppReferrerWrite {
  metrics: Array<'pageViews' | 'downloads'>;
  dates: IsoDate[];
  rows: AppReferrerInput[];
}

export interface AppReferrerQuery {
  appId: string;
  store?: AppStore;
  range: DateRange;
  kind?: AppReferrerKind;
  limit?: number;
}

export interface AppReferrerRow {
  store: AppStore;
  kind: AppReferrerKind;
  referrer: string;
  pageViews: number;
  downloads: number;
}

export interface AppRatingInput {
  date: IsoDate;
  /** Upper-case territory code, or `*`. */
  territory: string;
  /** Average rating of all time (or of the current version, as the store reports it). */
  average: number | null;
  /** Number of ratings, when the store reports it. */
  count?: number | null;
  /** Average of the ratings given that day (Google Play). */
  dailyAverage?: number | null;
}

export interface AppRatingQuery {
  appId: string;
  store?: AppStore;
  range: DateRange;
  territory?: string;
}

export interface AppRatingRow extends AppRatingInput {
  store: AppStore;
}

/** One store review. Reviewer names are not stored. */
export interface AppReviewInput {
  id: string;
  /** ISO timestamp the review was written (or last edited). */
  createdAt: string;
  rating: number;
  title: string | null;
  body: string | null;
  territory: string | null;
  language: string | null;
  version: string | null;
  /** The developer replied. */
  replied: boolean;
}

export interface AppReviewQuery {
  appId: string;
  store?: AppStore;
  range: DateRange;
  ratings?: number[];
  territory?: string;
  version?: string;
  /** Case-insensitive substring of the title or body. */
  contains?: string;
  limit?: number;
}

export interface AppReviewRow extends AppReviewInput {
  store: AppStore;
}

export interface AppReviewStat {
  store: AppStore;
  rating: number;
  reviews: number;
}

/**
 * Stability per day and app version (`version` is empty for all versions). Rates are shares of
 * distinct users (Google Play); `crashes` and `crashDevices` are counts (App Store).
 */
export interface AppVitalsInput {
  date: IsoDate;
  version: string;
  crashRate?: number | null;
  userPerceivedCrashRate?: number | null;
  anrRate?: number | null;
  userPerceivedAnrRate?: number | null;
  distinctUsers?: number | null;
  crashes?: number | null;
  crashDevices?: number | null;
}

export type AppVitalsMetric = Exclude<keyof AppVitalsInput, 'date' | 'version'>;

export interface AppVitalsWrite {
  metrics: AppVitalsMetric[];
  rows: AppVitalsInput[];
}

export interface AppVitalsQuery {
  appId: string;
  store?: AppStore;
  range: DateRange;
  groupBy: 'date' | 'version';
  limit?: number;
}

export interface AppVitalsRow {
  store: AppStore;
  date?: IsoDate;
  version?: string;
  crashRate: number | null;
  userPerceivedCrashRate: number | null;
  anrRate: number | null;
  userPerceivedAnrRate: number | null;
  distinctUsers: number | null;
  crashes: number | null;
  crashDevices: number | null;
}

/** The user's own app's position in an App Store top chart (opt-in public feeds). */
export interface AppChartRankInput {
  date: IsoDate;
  territory: string;
  /** `top-free`, `top-paid` or `top-grossing`. */
  chart: string;
  /** Genre id, or empty for all apps. */
  genre: string;
  /** 1-based position, or null when the app is not in the chart. */
  rank: number | null;
}

/** Google Play subscription statistics (ADR 0010): per day, country, product and base plan. */
export interface AppSubscriptionInput {
  date: IsoDate;
  /** Upper-case country code as Google reports it. */
  territory: string;
  /** Subscription product id. */
  product: string;
  /** Base plan id, or empty. */
  basePlan: string;
  newSubscriptions: number;
  canceledSubscriptions: number;
  /** Active subscriptions that day: a level, not a daily count. */
  activeSubscriptions: number;
}

/** What an app's numbers are broken down by (ADR 0010): app version, device model or OS version. */
export type AppBreakdownDimension = 'app_version' | 'device' | 'os_version';
export const APP_BREAKDOWN_DIMENSIONS: readonly AppBreakdownDimension[] = ['app_version', 'device', 'os_version'];

/**
 * Per day and value of a dimension: Google Play installs, uninstalls, active devices (a level),
 * ratings (averages, not summable), crashes and ANRs; App Store sessions.
 */
export interface AppBreakdownMetrics {
  installs: number;
  deletions: number;
  activeDevices: number;
  crashes: number;
  anrs: number;
  dailyRating: number | null;
  totalRating: number | null;
  sessions: number;
  sessionSeconds: number;
  sessionDevices: number;
}
export type AppBreakdownMetric = keyof AppBreakdownMetrics;
export const APP_BREAKDOWN_METRICS: readonly AppBreakdownMetric[] = [
  'installs',
  'deletions',
  'activeDevices',
  'crashes',
  'anrs',
  'dailyRating',
  'totalRating',
  'sessions',
  'sessionSeconds',
  'sessionDevices',
];

export interface AppBreakdownInput extends Partial<AppBreakdownMetrics> {
  date: IsoDate;
  /** The app version, device model or OS version as the store reports it; `Other` for the rest. */
  value: string;
}

export interface AppBreakdownWrite {
  dimension: AppBreakdownDimension;
  /** Metrics set by this write; for the days in `dates`, values not mentioned get them cleared. */
  metrics: AppBreakdownMetric[];
  dates: IsoDate[];
  rows: AppBreakdownInput[];
}

export interface AppBreakdownQuery {
  appId: string;
  store?: AppStore;
  dimension: AppBreakdownDimension;
  range: DateRange;
  limit?: number;
}

export interface AppBreakdownRow extends AppBreakdownMetrics {
  store: AppStore;
  value: string;
  /** Days with data for the value in the range. */
  days: number;
}

/** Google Play earnings summed per day and buyer country (ADR 0010); amounts in cents of the payout currency. */
export interface AppEarningsInput {
  date: IsoDate;
  territory: string;
  purchases: number;
  proceedsCents: number;
  salesCents: number;
}

export type AppSubscriptionDimension = 'date' | 'product' | 'territory';

export interface AppSubscriptionQuery {
  appId: string;
  range: DateRange;
  /** Group by these; none gives the totals. */
  dimensions: AppSubscriptionDimension[];
  product?: string;
  territory?: string;
  limit?: number;
}

export interface AppSubscriptionRow {
  date?: IsoDate;
  product?: string;
  territory?: string;
  newSubscriptions: number;
  canceledSubscriptions: number;
  /** Per date: that day's; otherwise on the range's last day with data. */
  activeSubscriptions: number;
}

/**
 * App Store subscription states (levels per day) and events (counts per day) from the Analytics
 * Reports "App Store Subscription State" and "App Store Subscription Event" (Standard).
 */
export type AppSubscriptionMetricKind = 'state' | 'event';

export interface AppSubscriptionMetricInput {
  date: IsoDate;
  /** Apple's State Metric or Event Sub Type as a slug, e.g. `free_trial_starts`, `billing_retry`. */
  metric: string;
  /** Apple's State Metric Grouping or Event Grouping as a slug, e.g. `subscription_offers`, `voluntary_churn`. */
  metricGroup: string;
  /** Subscription name as set in App Store Connect. */
  product: string;
  /** Offer type slug (`free_trial`, `pay_up_front`, ...), or empty for no offer. */
  offerType: string;
  /** Upper-case territory code. */
  territory: string;
  /** App download source type (events only; `*` for states). */
  source: string;
  count: number;
}

export interface AppSubscriptionMetricWrite {
  kind: AppSubscriptionMetricKind;
  /** Days replaced as a whole. */
  dates: IsoDate[];
  rows: AppSubscriptionMetricInput[];
}

export type AppSubscriptionMetricDimension = 'date' | 'metric' | 'metricGroup' | 'product' | 'offerType' | 'territory' | 'source';

export interface AppSubscriptionMetricQuery {
  appId: string;
  kind: AppSubscriptionMetricKind;
  range: DateRange;
  dimensions: AppSubscriptionMetricDimension[];
  product?: string;
  territory?: string;
  offerType?: string;
  source?: string;
  limit?: number;
}

export interface AppSubscriptionMetricRow {
  date?: IsoDate;
  metric?: string;
  metricGroup?: string;
  product?: string;
  offerType?: string;
  territory?: string;
  source?: string;
  /** Events: summed over the range. States: per date that day's level, otherwise the level on the range's last day with data. */
  count: number;
}

export interface AppDataCoverage {
  appId: string;
  store: AppStore;
  dataset: string;
  firstDate: IsoDate | null;
  lastDate: IsoDate | null;
}
