/**
 * Contracts for the first-party data source adapters in `packages/sources/*`.
 * Adapters are thin API clients built on `fetch`; all scheduling, budgeting and
 * normalization lives in core.
 */
import type { DelimitedRow } from './delimited.js';
import type { AppListingValue, DateRange, GscSearchType, IsoDate, RichResultIssue, SitemapRecord } from './types.js';

/**
 * Rows of a query over several days. `complete` is false when the result hit
 * the API's page limit: the caller then asks again for a shorter range.
 */
export interface RangeResult<T> {
  rows: T[];
  complete: boolean;
}

export interface GscRow {
  keys: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export type GscDimension = 'date' | 'query' | 'page' | 'country' | 'device' | 'searchAppearance';

export interface GscSearchAnalyticsRequest {
  property: string;
  startDate: IsoDate;
  endDate: IsoDate;
  /** `searchAppearance` can only be requested on its own; filter by it to get a series. */
  dimensions: GscDimension[];
  rowLimit: number;
  startRow?: number;
  /** `final` (default) or `all` (includes fresh, not-yet-final data). */
  dataState?: 'final' | 'all';
  /** Default `web`. */
  type?: GscSearchType;
  /** Only rows with this search appearance. */
  searchAppearance?: string;
}

export interface GscUrlInspection {
  url: string;
  verdict: string | null;
  coverageState: string | null;
  indexingState: string | null;
  robotsTxtState: string | null;
  pageFetchState: string | null;
  lastCrawlTime: string | null;
  googleCanonical: string | null;
  userCanonical: string | null;
  crawledAs: string | null;
  mobileUsabilityVerdict: string | null;
  richResultsVerdict: string | null;
  /** Rich result types detected on the page. */
  richResultTypes: string[];
  richResultIssues: RichResultIssue[];
  inspectionResultLink: string | null;
}

export interface GscClient {
  searchAnalytics(req: GscSearchAnalyticsRequest): Promise<GscRow[]>;
  listSitemaps(property: string): Promise<SitemapRecord[]>;
  submitSitemap(property: string, sitemapUrl: string): Promise<void>;
  inspectUrl(property: string, url: string): Promise<GscUrlInspection>;
  /** Properties visible to the service account with their permission level. */
  listProperties(): Promise<Array<{ siteUrl: string; permissionLevel: string }>>;
}

export interface BingQueryStat {
  date: IsoDate;
  query: string;
  clicks: number;
  impressions: number;
  avgImpressionPosition: number | null;
}

export interface BingPageStat {
  date: IsoDate;
  page: string;
  clicks: number;
  impressions: number;
  avgImpressionPosition: number | null;
}

export interface BingTrafficStat {
  date: IsoDate;
  clicks: number;
  impressions: number;
}

export interface BingCrawlIssue {
  url: string;
  issue: string;
  httpCode: number | null;
}

export interface BingClient {
  getQueryStats(siteUrl: string): Promise<BingQueryStat[]>;
  getPageStats(siteUrl: string): Promise<BingPageStat[]>;
  getRankAndTrafficStats(siteUrl: string): Promise<BingTrafficStat[]>;
  getCrawlIssues(siteUrl: string): Promise<BingCrawlIssue[]>;
  getUserSites(): Promise<Array<{ url: string; verified: boolean }>>;
}

export interface CloudflareCrawlerRow {
  date: IsoDate;
  userAgent: string;
  host: string;
  path: string;
  status: number;
  requests: number;
}

export interface CloudflareRumRow {
  date: IsoDate;
  host: string;
  path: string;
  refererHost: string;
  visits: number;
  pageViews: number;
}

export interface CloudflareVitalsRow {
  date: IsoDate;
  host: string;
  path: string;
  lcpP75: number | null;
  inpP75: number | null;
  clsP75: number | null;
  samples: number;
}

export interface CloudflareAnalyticsClient {
  /**
   * Requests on a zone whose user agent contains one of `userAgentPatterns` (case-sensitive),
   * per day, for the days of `range` (both ends included). Used for AI and search engine crawlers.
   */
  crawlerRequests(zoneId: string, range: DateRange, userAgentPatterns: string[]): Promise<RangeResult<CloudflareCrawlerRow>>;
  /** Web Analytics (RUM) page loads per day, path and referrer host for the days of `range`. */
  webAnalytics(accountId: string, siteTag: string, range: DateRange): Promise<RangeResult<CloudflareRumRow>>;
  /** Web Vitals p75 per day and path for the days of `range`. */
  webVitals(accountId: string, siteTag: string, range: DateRange): Promise<RangeResult<CloudflareVitalsRow>>;
  /** Verifies the API token; returns its status. */
  verifyToken(): Promise<{ active: boolean; message?: string }>;
  /** Zones in the account (needs Zone: Read). Used to suggest settings in the dashboard. */
  listZones?(accountId: string): Promise<Array<{ id: string; name: string }>>;
  /** Web Analytics sites in the account (needs Account Settings: Read). */
  listWebAnalyticsSites?(accountId: string): Promise<Array<{ siteTag: string; host: string | null }>>;
}

/** One sitemap file: page URLs (`urlset`) or further sitemaps (`sitemapindex`). */
export interface SitemapContents {
  urls: string[];
  sitemaps: string[];
  /** The file was larger than the reader reads; `urls` holds what it read. */
  truncated?: boolean;
}

/** Reads the site's own sitemaps (plain HTTPS GET), for the index coverage snapshot. */
export interface SitemapReader {
  read(url: string): Promise<SitemapContents>;
}

// ----------------------------------------------------------------- apps (ADR 0009)

export type AscAccessType = 'ONGOING' | 'ONE_TIME_SNAPSHOT';

/** An App Store Connect analytics report request: Apple generates reports only while one exists. */
export interface AscReportRequest {
  id: string;
  accessType: AscAccessType;
  /** Apple stopped generating reports because none were downloaded for a long time. */
  stoppedDueToInactivity: boolean;
}

export interface AscReport {
  id: string;
  /** E.g. `App Store Discovery and Engagement Standard`. */
  name: string;
  category: string;
}

export interface AscReportInstance {
  id: string;
  granularity: string;
  processingDate: IsoDate;
}

/** One file of a report instance. Its URL is valid for a few minutes only. */
export interface AscSegment {
  id: string;
  url: string;
  sizeInBytes: number | null;
}

export interface AscReview {
  id: string;
  rating: number;
  title: string | null;
  body: string | null;
  /** ISO timestamp. */
  createdDate: string;
  /** App Store territory code (three letters, e.g. `USA`). */
  territory: string | null;
  /** The developer has responded (when the response was asked for). */
  replied?: boolean;
}

/** A Google Play review from the Android Publisher reviews API (the last week only); no author name. */
export interface PlayReview {
  id: string;
  /** ISO timestamp of the review's last change. */
  modifiedAt: string;
  rating: number;
  text: string | null;
  language: string | null;
  version: string | null;
  replied: boolean;
}

/**
 * An image App Store Connect serves from Apple's image CDN. `templateUrl` holds `{w}`, `{h}` and
 * `{f}` placeholders for the width, height and format (e.g. `png`).
 */
export interface AscImageAsset {
  templateUrl: string;
  width: number;
  height: number;
}

export interface AscClient {
  /** Apps the key can see (for suggestions in the dashboard). */
  listApps(): Promise<Array<{ id: string; name: string; bundleId: string; sku?: string }>>;
  /** The app icon of the newest uploaded build that has one, or null when no build has an icon. */
  latestBuildIcon(appleId: string): Promise<AscImageAsset | null>;
  listReportRequests(appleId: string): Promise<AscReportRequest[]>;
  /** Needs an Admin key: used only by the one-time "start reports" action, never by the sync. */
  createReportRequest(appleId: string, accessType: AscAccessType): Promise<AscReportRequest>;
  /** Needs an Admin key: removes a request Apple stopped, so a new one can be made. */
  deleteReportRequest(requestId: string): Promise<void>;
  getReportRequest(requestId: string): Promise<AscReportRequest>;
  listReports(requestId: string): Promise<AscReport[]>;
  listInstances(reportId: string, granularity: 'DAILY' | 'WEEKLY' | 'MONTHLY'): Promise<AscReportInstance[]>;
  listSegments(instanceId: string): Promise<AscSegment[]>;
  /** Downloads one segment (gzip, tab separated) row by row; returns the number of rows. */
  readSegment(segment: AscSegment, onRow: (row: DelimitedRow) => void): Promise<number>;
  /** Newest reviews first. */
  listReviews(appleId: string, opts: { limit: number; cursor?: string | null }): Promise<{ reviews: AscReview[]; next: string | null }>;
  /**
   * Sales and Trends Summary Sales of one day for the whole vendor account, row by row (gzip, tab
   * separated). Returns null when Apple has no report for that day (no sales, or not out yet).
   */
  salesReport?(vendorNumber: string, date: IsoDate, onRow: (row: DelimitedRow) => void): Promise<number | null>;
  /**
   * Today's store presence (read-only): per platform the version on sale and the newest one in the
   * works with their state, release type and phased release; the on-sale version's localizations
   * (description, keywords, promotional text, what's new); the live app info's names and subtitles.
   * `scopes` lists the entity prefixes it could read completely.
   */
  listingSnapshot?(appleId: string): Promise<{ scopes: string[]; values: AppListingValue[]; calls: number }>;
  /** Posts a response to a customer review (needs a key with the Customer Support, App Manager or Admin role). */
  replyToReview?(reviewId: string, text: string): Promise<void>;
}

/** A Cloud Storage object of the Play Console reports bucket. */
export interface PlayObject {
  name: string;
  /** Changes whenever the Play Console rewrites the file. */
  generation: string;
  size: number;
  updated: string;
}

export interface PlayVitalsRow {
  date: IsoDate;
  /** Version code, or empty for all versions. */
  version: string;
  rate: number | null;
  userPerceivedRate: number | null;
  distinctUsers: number | null;
}

/** A Google Play listing snapshot read through an edit that is never committed. */
export interface PlayListingSnapshot {
  scopes: string[];
  values: AppListingValue[];
  calls: number;
}

export interface PlayClient {
  /** Objects whose name starts with `prefix`. */
  listObjects(bucket: string, prefix: string): Promise<PlayObject[]>;
  /** Reads a report file (CSV, usually UTF-16) row by row; returns the number of rows. */
  readCsv(bucket: string, name: string, onRow: (row: DelimitedRow) => void): Promise<number>;
  /** Whether the service account may read a file: fetches its first byte; false on 401 or 403. */
  canRead(bucket: string, name: string): Promise<boolean>;
  /** Daily crash or ANR rates per version code from the Play Developer Reporting API. */
  vitals(packageName: string, metric: 'crash' | 'anr', range: DateRange): Promise<PlayVitalsRow[]>;
  /** Apps the service account can see (for suggestions in the dashboard). */
  listApps(): Promise<Array<{ packageName: string; name: string }>>;
  /**
   * Store listings (title, short and full description per language) and tracks (releases, rollout,
   * release notes), read through an edit that is deleted right after and never committed. Needs the
   * Android Publisher scope (PLAY_METADATA=true).
   */
  listingSnapshot?(packageName: string): Promise<PlayListingSnapshot>;
  /** Reviews with text written or changed in the last week, newest first (Android Publisher API, "Reply to reviews"). */
  listReviews?(packageName: string, token?: string | null): Promise<{ reviews: PlayReview[]; next: string | null }>;
  /** Replies to a review (replaces an earlier reply). */
  replyToReview?(packageName: string, reviewId: string, text: string): Promise<void>;
}

export interface AppStoreLookup {
  appleId: string;
  name: string | null;
  /** Null while the app has no ratings in the storefront (Apple then reports an average of 0). */
  averageUserRating: number | null;
  userRatingCount: number | null;
  version: string | null;
  primaryGenreId: string | null;
  /** Price in the storefront's currency: 0 for a free app, null when unknown. */
  price: number | null;
}

export type AppStoreChart = 'top-free' | 'top-paid' | 'top-grossing';

/** Apple's official public App Store feeds (opt-in plugin, APP_STORE_PUBLIC_DATA). */
/** An Apple Ads search term of the user's own campaign, per day (Apple Ads Platform API). */
export interface AppleAdsSearchTermRow {
  date: IsoDate;
  campaignId: string;
  /** The user's query; Apple leaves out terms with few impressions. */
  term: string;
  /** The keyword that matched it, or empty (Search Match). */
  keyword: string;
  impressions: number;
  taps: number;
  installs: number;
  newDownloads: number;
  /** Spend in cents of `currency` (the ad account's reporting currency). */
  spendCents: number;
  currency: string;
}

/** The app's impression share for a search term in a storefront, per day, with Apple's popularity score. */
export interface AppleAdsImpressionShareRow {
  date: IsoDate;
  territory: string;
  term: string;
  /** 0-1; Apple gives a 10% bucket (above 90%: 0.91-1.0). */
  lowShare: number | null;
  highShare: number | null;
  /** 1 = the app had the highest share for this term and storefront. */
  rank: number | null;
  /** 1-5, 5 = most searched. */
  popularity: number | null;
}

/** Apple Ads Platform API, read-only. */
export interface AppleAdsClient {
  /** The ad accounts the credentials can see, with the user's roles on each. */
  accounts(): Promise<Array<{ id: string; name: string; roles: string[] }>>;
  /** App Store campaigns of an ad account that promote this app. */
  campaigns(accountId: string, appleId: string): Promise<Array<{ id: string; name: string }>>;
  /** Search terms of one campaign per day (at most 90 days per call). */
  searchTerms(accountId: string, campaignId: string, range: DateRange): Promise<AppleAdsSearchTermRow[]>;
  /** The app's impression share per day, storefront and search term (at most 30 days per call). */
  impressionShare(accountId: string, appleId: string, range: DateRange): Promise<AppleAdsImpressionShareRow[]>;
}

export interface AppStorePublicClient {
  lookup(appleId: string, country: string): Promise<AppStoreLookup | null>;
  /** Apple IDs of a top chart in rank order (at most 100), optionally for one genre. */
  topChart(country: string, chart: AppStoreChart, genreId?: string | null): Promise<string[]>;
}

export interface SourceClients {
  gsc?: GscClient;
  bing?: BingClient;
  cloudflare?: CloudflareAnalyticsClient;
  sitemaps?: SitemapReader;
  /** App Store Connect (Sales and Reports key). */
  asc?: AscClient;
  /** App Store Connect key for review responses only (ASC_REPLY_*), when writes are on. */
  ascReplies?: AscClient;
  /** Google Play Console reports and the Play Developer Reporting API. */
  play?: PlayClient;
  /** Apple's public App Store feeds, only when APP_STORE_PUBLIC_DATA is true. */
  appStore?: AppStorePublicClient;
  /** Apple Ads Platform API, only when its credentials are set. */
  appleAds?: AppleAdsClient;
}
