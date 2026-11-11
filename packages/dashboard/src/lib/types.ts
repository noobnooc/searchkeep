/**
 * Response shapes of the Worker's `/api/*` endpoints. They mirror the return
 * values of the analysis functions in `@searchkeep/core`; the dashboard does
 * not import core so that the SPA bundle stays free of server code.
 */

export type Source = 'gsc' | 'bing';
export type Brand = 'all' | 'brand' | 'non_brand';
export type ReadinessState = 'no_access' | 'oauth_disabled' | 'policy_too_broad' | 'ready';
export type Dimension = 'date' | 'week' | 'month' | 'query' | 'page' | 'country' | 'device' | 'appearance';
/** Search Console search types; discover and googleNews have pages only (no queries or positions). */
export type SearchType = 'web' | 'image' | 'video' | 'news' | 'discover' | 'googleNews';
/** AI crawlers: training, search, user, other. Search engine crawlers: search, media, ads, other. */
export type CrawlerPurpose = 'training' | 'search' | 'user' | 'media' | 'ads' | 'other';
export type CrawlerGroup = 'crawler' | 'operator' | 'purpose' | 'path' | 'status' | 'date';

export interface DateRange {
  start: string;
  end: string;
}

export interface ReadinessCheck {
  id: string;
  label: string;
  ok: boolean;
  detail?: string;
}

export interface StatusResponse {
  state: ReadinessState;
  checks: ReadinessCheck[];
  checkedAt: string;
  identity: { email: string } | null;
  configErrors: string[];
  dev: boolean;
}

export interface LockedBody {
  error: string;
  code: 'locked';
  state: ReadinessState;
  checks?: ReadinessCheck[];
}

export interface Coverage {
  source: string;
  dataset: string;
  firstDate: string | null;
  lastDate: string | null;
  days: number | null;
}

export interface SiteSources {
  gsc: boolean;
  bing: boolean;
  aiCrawlers: boolean;
  searchCrawlers?: boolean;
  webAnalytics: boolean;
  indexCoverage?: boolean;
  /** Query and page rows per country and device are synced (GSC_SEGMENT_SITES). */
  segments?: boolean;
}

export interface SiteInfo {
  id: string;
  domain: string;
  sources: SiteSources;
  data: Coverage[];
}

export interface SitesResponse {
  sites: SiteInfo[];
}

export interface Metrics {
  clicks: number;
  impressions: number;
  ctr: number;
  position: number | null;
}

export interface PerformanceRow extends Metrics {
  date?: string;
  week?: string;
  month?: string;
  query?: string;
  page?: string;
  country?: string;
  device?: string;
  appearance?: string;
}

export interface CrawlerRow {
  crawler?: string;
  operator?: string;
  purpose?: CrawlerPurpose;
  path?: string;
  status?: number;
  date?: string;
  requests: number;
}

export interface OverviewSource {
  source: Source;
  current: Metrics;
  previous: Metrics;
  series: PerformanceRow[];
}

export interface OverviewResponse {
  site: string;
  range: DateRange;
  previousRange: DateRange;
  brand: Brand;
  search: OverviewSource[];
  crawlers: { total: number; top: CrawlerRow[] };
  notes: string[];
}

export interface GeoPage {
  page: string;
  crawled: number;
  cited: number;
  aiVisits: number;
  clicks: number;
  impressions: number;
}

export interface GeoTotals {
  crawled: number;
  cited: number;
  aiVisits: number;
  clicks: number;
}

export interface GeoFunnelResponse {
  site: string;
  range: DateRange;
  totals: GeoTotals;
  pages: GeoPage[];
  insights: { crawledButNeverCited: string[] };
  notes: string[];
}

export interface PerformanceResponse {
  site: string;
  source: Source;
  range: DateRange;
  dimensions: Dimension[];
  brand: Brand;
  rows: PerformanceRow[];
  notes: string[];
}

export interface CompareChange {
  query?: string;
  page?: string;
  clicks: number;
  previousClicks: number;
  clicksDelta: number;
  impressions: number;
  previousImpressions: number;
  impressionsDelta: number;
  position: number | null;
  previousPosition: number | null;
  positionDelta: number | null;
  status: 'new' | 'lost' | 'changed';
}

export interface ComparePeriod extends Metrics {
  range: DateRange;
}

export interface CompareResponse {
  site: string;
  source: Source;
  dimension: 'query' | 'page';
  current: ComparePeriod;
  previous: ComparePeriod;
  change: { clicksPct: number | null; impressionsPct: number | null };
  gainers: CompareChange[];
  losers: CompareChange[];
  notes: string[];
}

export interface QuickWin {
  query?: string;
  page?: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number | null;
  potentialExtraClicks: number;
}

export interface QuickWinsResponse {
  site: string;
  source: Source;
  range: DateRange;
  criteria: { minPosition: number; maxPosition: number; minImpressions: number };
  quickWins: QuickWin[];
  notes: string[];
}

export interface CannibalizationPage {
  page?: string;
  impressions: number;
  clicks: number;
  position: number | null;
  share: number;
}

export interface CannibalizationIssue {
  query: string;
  impressions: number;
  clicks: number;
  pages: CannibalizationPage[];
}

export interface CannibalizationResponse {
  site: string;
  source: Source;
  range: DateRange;
  criteria: { minImpressions: number; minShare: number };
  issues: CannibalizationIssue[];
  notes: string[];
}

export interface CtrAnomaly {
  query?: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number | null;
  expectedCtr: number;
  expectedBasis: 'site' | 'benchmark';
  lostClicks: number;
}

export interface CtrAnomaliesResponse {
  site: string;
  source: Source;
  range: DateRange;
  criteria: { minImpressions: number; threshold: number };
  anomalies: CtrAnomaly[];
  notes: string[];
}

export interface DecayPage {
  page: string;
  peakWeeklyClicks: number;
  peakWeekOf?: string;
  recentWeeklyClicks: number;
  declinePct: number;
  lostClicksPerWeek: number;
  weekly: number[];
}

export interface ContentDecayResponse {
  site: string;
  source: Source;
  range: DateRange;
  weeks: string[];
  criteria: { minWeeklyClicks: number; minDecline: number };
  decaying: DecayPage[];
  notes: string[];
}

export interface AiCrawlersResponse {
  site: string;
  range: DateRange;
  groupBy: CrawlerGroup[];
  totalRequests: number;
  rows: CrawlerRow[];
  notes: string[];
}

export interface ReferralRow {
  path?: string;
  refererHost?: string;
  date?: string;
  visits: number;
  pageViews: number;
  assistant?: string;
}

export interface AiReferralsResponse {
  site: string;
  range: DateRange;
  rows: ReferralRow[];
  notes: string[];
}

export interface WebVitalsPage {
  page: string;
  path?: string;
  date?: string;
  lcpP75?: number | null;
  inpP75?: number | null;
  clsP75?: number | null;
  samples: number;
}

export interface WebVitalsResponse {
  site: string;
  range: DateRange;
  pages: WebVitalsPage[];
}

export interface Sitemap {
  path: string;
  lastSubmitted?: string | null;
  lastDownloaded?: string | null;
  isPending?: boolean;
  errors?: number;
  warnings?: number;
  submitted?: number | null;
  indexed?: number | null;
}

export interface SitemapsResponse {
  site: string;
  live: boolean;
  sitemaps: Sitemap[];
  notes?: string[];
}

export interface IndexStatusRow {
  url: string;
  firstSeen?: string;
  lastSeen?: string;
  inspectedAt?: string;
  verdict?: string;
  coverageState?: string;
  indexingState?: string;
  pageFetchState?: string;
  lastCrawlTime?: string;
  googleCanonical?: string;
  userCanonical?: string;
  richResultsVerdict?: string;
  richResultTypes?: string[];
  richResultIssues?: Array<{ type: string; severity: string; message: string }>;
  error?: string;
  previousCoverageState?: string;
  changedAt?: string;
}

export interface IndexCoverageResponse {
  site: string;
  totals: {
    urls: number;
    inspected: number;
    indexed: number;
    notIndexed: number;
    pending: number;
    errors: number;
    oldestInspectedAt: string | null;
    newestInspectedAt: string | null;
  };
  /** verdict: PASS, NEUTRAL, FAIL, PENDING (not inspected yet) or ERROR (inspection failed). */
  states: Array<{ verdict: string; coverageState: string | null; urls: number }>;
  richResults: {
    verdicts: Array<{ verdict: string; urls: number }>;
    types: Array<{ type: string; urls: number; urlsWithIssues: number }>;
    issues: Array<{ type: string; severity: string; message: string; urls: number }>;
  };
  urls: IndexStatusRow[];
  changes: Array<{ url: string; from: string | null; to: string | null; changedAt: string }>;
  notes: string[];
}

export interface CrawlIssue {
  url: string;
  issue: string;
  httpCode?: number | null;
  detectedAt?: string | null;
}

export interface CrawlIssuesResponse {
  site: string;
  source: 'bing';
  issues: CrawlIssue[];
}

export interface InspectResponse {
  site: string;
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
  inspectionResultLink: string | null;
  notes: string[];
}

export type CheckStatus = 'ok' | 'warn' | 'error' | 'skipped';

export interface SetupCheck {
  id: string;
  label: string;
  status: CheckStatus;
  detail?: string;
}

export interface SyncSummary {
  startedAt: string;
  finishedAt?: string | null;
  trigger: 'cron' | 'manual';
  status: SyncRun['status'];
  rowsWritten: number;
  message?: string | null;
}

export interface SetupStatusResponse {
  state: ReadinessState;
  ok: boolean;
  summary: string;
  checks: SetupCheck[];
  sites: Array<{ id: string; domain: string; sources: SiteSources }>;
  coverage: Array<Coverage & { siteId: string }>;
  syncProgress: SyncProgressResponse;
  recentSyncs: SyncSummary[];
}

/** waiting: nothing synced yet · recent: latest days coming in · history: older days coming in · done. */
export type SyncPhase = 'waiting' | 'recent' | 'history' | 'done';
export type SyncDataset =
  'gsc' | 'bing' | 'ai_crawlers' | 'search_crawlers' | 'web_analytics' | 'app_store' | 'google_play' | 'app_store_public';
export type SyncSource = 'gsc' | 'bing' | 'cloudflare' | 'asc' | 'play' | 'appstore';

export interface DatasetProgress {
  dataset: SyncDataset;
  source: SyncSource;
  state: 'waiting' | 'syncing' | 'paused' | 'error' | 'done';
  recent: boolean;
  complete: boolean;
  /** 0–100 */
  percent: number;
  from: string | null;
  target: string | null;
  message?: string;
  retryAt?: string;
}

export interface SiteSyncProgress {
  siteId: string;
  domain: string;
  phase: SyncPhase;
  datasets: DatasetProgress[];
}

export interface AppSyncProgress {
  appId: string;
  name: string;
  phase: SyncPhase;
  datasets: DatasetProgress[];
}

export interface SyncProgressResponse {
  checkedAt: string;
  phase: SyncPhase;
  summary: {
    sites: number;
    sitesWithRecentData: number;
    apps?: number;
    appsWithRecentData?: number;
    historyPercent: number;
    issues: number;
  };
  paused: Array<{ source: SyncSource; until: string; reason: string }>;
  apps?: AppSyncProgress[];
  writeBudget: { used: number; limit: number; reached: boolean };
  lastRun: { at: string; status: SyncRun['status']; rowsWritten: number; message?: string | null } | null;
  sites: SiteSyncProgress[];
}

export interface SyncTaskResult {
  task: string;
  siteId: string;
  source: string;
  status: 'ok' | 'error' | 'skipped';
  rowsWritten: number;
  message?: string;
}

export interface SyncRun {
  id?: number;
  startedAt: string;
  finishedAt?: string | null;
  trigger: 'cron' | 'manual';
  status: 'running' | 'ok' | 'partial' | 'error' | 'skipped';
  rowsWritten: number;
  message?: string | null;
  details?: SyncTaskResult[];
}

export interface SyncRunsResponse {
  runs: SyncRun[];
}

export interface ImportResponse {
  site: string;
  imported: number;
  skipped: number;
  rowsWritten: number;
  columns: { page: string; citations: string; date: string | null };
}

export interface SiteConfig {
  id: string;
  domain: string;
  gscProperty?: string;
  bingSiteUrl?: string;
  cloudflareZoneId?: string;
  webAnalyticsSiteTag?: string;
  brandRegex?: string;
  origin: 'secret' | 'dashboard';
}

export interface SiteConfigsResponse {
  sites: SiteConfig[];
}

export type Discovery<T> = { ok: true; items: T[] } | { ok: false; reason: string };

export interface DiscoverResponse {
  gscProperties: Discovery<{ siteUrl: string; permissionLevel: string }>;
  bingSites: Discovery<{ url: string; verified: boolean }>;
  zones: Discovery<{ id: string; name: string }>;
  webAnalytics: Discovery<{ siteTag: string; host: string | null }>;
}

// ------------------------------------------------------------------------ apps

export type AppStore = 'apple' | 'play';

export interface AppStores {
  appStore: boolean;
  googlePlay: boolean;
  appStorePublic: boolean;
}

export interface AppInfo {
  id: string;
  name: string;
  appleId?: string;
  playPackage?: string;
  siteId?: string;
  territories?: string[];
  origin: 'secret' | 'dashboard';
  stores: AppStores;
  appStoreReports?: { started: boolean; stopped: boolean; snapshot: boolean; snapshotRequestedOn?: string; problem?: string };
  data: Array<{ store: AppStore; dataset: string; firstDate: string | null; lastDate: string | null }>;
}

export interface AppsResponse {
  apps: AppInfo[];
}

export interface AppMetrics {
  impressions: number;
  impressionsUnique: number;
  pageViews: number;
  pageViewsUnique: number;
  downloads: number;
  redownloads: number;
  installs: number;
  deletions: number;
  activeDevices: number;
  pageConversion: number | null;
  impressionConversion: number | null;
  purchases: number;
  proceedsCents: number;
  salesCents: number;
  payingUsers: number;
  sessions: number;
  sessionSeconds: number;
  sessionDevices: number;
  /** In the store's currency (`currency` of the store). */
  proceeds: number;
  sales: number;
  proceedsPerDownload: number | null;
  averageSessionSeconds: number | null;
  sessionsPerDevice: number | null;
}

export interface AppRow extends AppMetrics {
  date?: string;
  week?: string;
  month?: string;
  store?: AppStore;
  territory?: string;
  source?: string;
}

export interface AppReferrerRow {
  store: AppStore;
  kind: 'web' | 'app' | 'utm';
  referrer: string;
  pageViews: number;
  downloads: number;
  ownSite: boolean;
}

export interface AppChartRank {
  date: string;
  territory: string;
  chart: string;
  genre: string;
  /** Category name, for a category chart. */
  genreName?: string | null;
  rank: number | null;
  /** The check before the latest one. */
  previous?: { date: string; rank: number | null };
}

export interface AppPerformanceResponse {
  app: string;
  name: string;
  range: DateRange;
  previousRange: DateRange;
  stores: Array<{
    store: AppStore;
    /** Currency of the store's amounts (App Store: USD); null while the store reports none. */
    currency: string | null;
    current: AppMetrics;
    previous: AppMetrics;
    series: Array<AppMetrics & { date: string }>;
  }>;
  rows?: AppRow[];
  referrers?: AppReferrerRow[];
  charts?: AppChartRank[];
  notes: string[];
}

export interface AppSearchTerm {
  term: string;
  visitors: number;
  acquisitions: number;
  conversion: number | null;
  previousVisitors: number;
  visitorsChange: number;
}

export interface AppSearchTermsResponse {
  app: string;
  range: DateRange;
  previousRange: DateRange;
  totals: { terms: number; visitors: number; acquisitions: number; conversion: number | null };
  terms: AppSearchTerm[];
  lowConverting: AppSearchTerm[];
  notes: string[];
}

export interface AppReview {
  store: AppStore;
  id: string;
  createdAt: string;
  rating: number;
  title: string | null;
  body: string | null;
  territory: string | null;
  language: string | null;
  version: string | null;
  replied: boolean;
}

export interface AppReviewsResponse {
  app: string;
  range: DateRange;
  summary: Array<{
    store: AppStore;
    reviews: number;
    reviewAverage: number | null;
    distribution: Record<string, number>;
    rating: { date: string; territory: string; average: number | null; count: number | null } | null;
    ratingSeries: Array<{ date: string; average: number | null; dailyAverage: number | null; count: number | null }>;
  }>;
  reviews: AppReview[];
  notes: string[];
}

export interface AppVitalsRow {
  store: AppStore;
  date?: string;
  version?: string;
  crashRate: number | null;
  userPerceivedCrashRate: number | null;
  anrRate: number | null;
  userPerceivedAnrRate: number | null;
  distinctUsers: number | null;
  crashes: number | null;
  crashDevices: number | null;
}

export interface AppStabilityResponse {
  app: string;
  range: DateRange;
  groupBy: 'date' | 'version';
  summary: Array<Omit<AppVitalsRow, 'date' | 'version' | 'distinctUsers'>>;
  rows: AppVitalsRow[];
  notes: string[];
}

export interface AppConfig {
  id: string;
  name: string;
  appleId?: string;
  playPackage?: string;
  siteId?: string;
  territories?: string[];
  origin?: 'secret' | 'dashboard';
}

export interface AppConfigsResponse {
  apps: AppConfig[];
}

type Found<T> = { ok: true; items: T[] } | { ok: false; reason: string };

export interface AppDiscoverResponse {
  appStore: Found<{ id: string; name: string; bundleId: string }>;
  googlePlay: Found<{ packageName: string; name: string }>;
  sites: Array<{ id: string; domain: string }>;
}

export interface EnableAppStoreResponse {
  app: string;
  ongoing: { id: string; created: boolean };
  snapshot: { id: string; created: boolean } | null;
  notes: string[];
}

export interface AppSubscriptionTotals {
  newSubscriptions: number;
  canceledSubscriptions: number;
  /** On the last day with data (a level). */
  activeSubscriptions: number;
  net: number;
}

export interface AppSubscriptionsResponse {
  app: string;
  range: DateRange;
  previousRange: DateRange;
  current: AppSubscriptionTotals;
  previous: AppSubscriptionTotals;
  products: Array<AppSubscriptionTotals & { product: string }>;
  territories: Array<AppSubscriptionTotals & { territory: string }>;
  series: Array<{ date: string; newSubscriptions: number; canceledSubscriptions: number; activeSubscriptions: number }>;
  notes: string[];
}
