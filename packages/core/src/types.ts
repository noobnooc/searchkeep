/**
 * Domain model shared by every Searchkeep package.
 *
 * Dates are ISO calendar dates (`YYYY-MM-DD`, UTC). Positions are stored as
 * impression-weighted sums so they can be re-aggregated exactly:
 * `avgPosition = positionSum / impressions`.
 */

export type IsoDate = string;

export type SearchSource = 'gsc' | 'bing';
export type SourceId = SearchSource | 'cloudflare';

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
