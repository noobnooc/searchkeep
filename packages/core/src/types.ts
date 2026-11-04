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

export type CrawlerPurpose = 'training' | 'search' | 'user' | 'other';

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

export interface SitemapRecord {
  path: string;
  lastSubmitted?: string | null;
  lastDownloaded?: string | null;
  isPending?: boolean;
  errors?: number;
  warnings?: number;
  submitted?: number | null;
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
export type PerformanceDimension = 'date' | 'week' | 'month' | 'query' | 'page' | 'country' | 'device';

export interface PerformanceFilters {
  /** Case-insensitive substring match on the query text. */
  queryContains?: string;
  /** Case-insensitive substring match on the page path. */
  pageContains?: string;
  country?: string;
  device?: string;
  brand?: BrandFilter;
}

export interface PerformanceQuery {
  siteId: string;
  source: SearchSource;
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
}

export interface CrawlerQuery {
  siteId: string;
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
