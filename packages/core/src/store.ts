import type {
  AppBreakdownDimension,
  AppBreakdownQuery,
  AppBreakdownRow,
  AppBreakdownWrite,
  AppEarningsInput,
  AiCitationInput,
  AppChartRankInput,
  AppConfig,
  AppDataCoverage,
  AppRatingInput,
  AppRatingQuery,
  AppRatingRow,
  AppReferrerQuery,
  AppReferrerRow,
  AppReferrerWrite,
  AppReviewInput,
  AppReviewQuery,
  AppReviewRow,
  AppReviewStat,
  AppSearchTermInput,
  AppSearchTermQuery,
  AppSearchTermRow,
  AppStore,
  AppStoreQuery,
  AppStoreRow,
  AppStoreWrite,
  AppSubscriptionInput,
  AppFrameworkInput,
  AppFrameworkRow,
  AppOptInInput,
  AppPageLevel,
  AppPageRow,
  AppPageWrite,
  AppChangeQuery,
  AppChangeRow,
  AppListingValue,
  AppProductInput,
  AppProductQuery,
  AppProductRow,
  AppSalesInput,
  AppSalesQuery,
  AppSalesRow,
  AppSubscriptionMetricQuery,
  AppSubscriptionMetricRow,
  AppSubscriptionMetricWrite,
  AppSubscriptionQuery,
  AppSubscriptionRow,
  AppVitalsQuery,
  AppVitalsRow,
  AppVitalsWrite,
  AppearanceInput,
  BreakdownInput,
  CrawlIssueInput,
  CrawlerKind,
  CrawlerQuery,
  CrawlerRequestInput,
  CrawlerRow,
  DataCoverage,
  DateRange,
  GscSearchType,
  IndexCoverageQuery,
  IndexCoverageResult,
  IsoDate,
  PageCount,
  PerformanceQuery,
  PerformanceRow,
  ReferralQuery,
  ReferralRow,
  SearchFactInput,
  SearchSource,
  SegmentInput,
  SiteConfig,
  SitemapRecord,
  SyncRunRecord,
  UrlInspectionInput,
  WebAnalyticsInput,
  WebVitalsInput,
} from './types.js';

/**
 * Persistence and analytical queries. All SQL lives in `store-*` packages;
 * core only calls these methods. Every implementation must pass the shared
 * contract tests exported from `@searchkeep/core/testing`.
 *
 * Write methods are idempotent upserts and return the number of rows that were
 * actually inserted or changed (unchanged rows are not rewritten, which keeps
 * D1's daily write quota intact).
 */
export interface Store {
  /**
   * True for errors that mean the database is busy right now (retry later), not that the
   * request is wrong. The sync then stops for this run instead of failing a task.
   */
  isBusy?(err: unknown): boolean;

  // ---- key/value metadata -------------------------------------------------
  getMeta(key: string): Promise<string | null>;
  setMeta(key: string, value: string): Promise<void>;
  deleteMeta(key: string): Promise<void>;
  /** Every metadata entry whose key starts with `prefix` (sync cursors, for progress reports). */
  listMeta(prefix: string): Promise<Record<string, string>>;

  // ---- sites --------------------------------------------------------------
  /** Make sure every configured site exists (by id). Existing data is kept. */
  syncSites(sites: SiteConfig[]): Promise<void>;
  /** Sites managed in the dashboard (the SITES secret is not stored). */
  listSiteConfigs(): Promise<SiteConfig[]>;
  /** Creates or replaces a dashboard-managed site. */
  saveSiteConfig(site: SiteConfig): Promise<void>;
  /** Removes a dashboard-managed site's configuration; its data is kept. */
  deleteSiteConfig(id: string): Promise<boolean>;

  // ---- writes -------------------------------------------------------------
  /** `searchType` (GSC only, default `web`) keeps the other search types apart from web search. */
  writeSearchFacts(siteId: string, source: SearchSource, rows: SearchFactInput[], searchType?: GscSearchType): Promise<number>;
  writeBreakdowns(siteId: string, source: SearchSource, rows: BreakdownInput[]): Promise<number>;
  /** GSC search appearance per day. */
  writeSearchAppearances(siteId: string, searchType: GscSearchType, rows: AppearanceInput[]): Promise<number>;
  /** GSC web search rows of one query or page per country and device (opt-in). */
  writeSearchSegments(siteId: string, rows: SegmentInput[]): Promise<number>;
  /** `kind` (default `ai`) keeps search engine crawlers apart from AI crawlers. */
  writeCrawlerRequests(siteId: string, rows: CrawlerRequestInput[], kind?: CrawlerKind): Promise<number>;
  writeWebAnalytics(siteId: string, rows: WebAnalyticsInput[]): Promise<number>;
  writeWebVitals(siteId: string, rows: WebVitalsInput[]): Promise<number>;
  writeAiCitations(siteId: string, rows: AiCitationInput[]): Promise<number>;
  /** Replaces the current crawl-issue snapshot for a site and source. */
  replaceCrawlIssues(siteId: string, source: SearchSource, rows: CrawlIssueInput[]): Promise<number>;
  /** Replaces the sitemap snapshot for a site and source. */
  replaceSitemaps(siteId: string, source: SearchSource, rows: SitemapRecord[]): Promise<number>;

  // ---- index coverage -----------------------------------------------------
  /**
   * Records `urls` as listed in a sitemap on `day`: tracked URLs whose last sighting is a week old or
   * more get `day` (so a URL costs about one write a week), new URLs are tracked while the site has
   * fewer than `maxUrls`. Returns rows changed.
   */
  addIndexUrls(siteId: string, urls: string[], day: IsoDate, maxUrls: number): Promise<number>;
  /** Stops tracking URLs last seen in a sitemap before `seenBefore`; returns how many. */
  pruneIndexUrls(siteId: string, seenBefore: IsoDate): Promise<number>;
  /** Tracked URLs due for inspection: never inspected first, then inspected before `inspectedBefore` (oldest first). */
  listUrlsToInspect(siteId: string, inspectedBefore: string, limit: number): Promise<string[]>;
  /** Stores inspection results of tracked URLs; a changed coverage state is remembered with its time. */
  writeUrlInspections(siteId: string, rows: UrlInspectionInput[]): Promise<number>;
  indexCoverage(q: IndexCoverageQuery): Promise<IndexCoverageResult>;

  // ---- brand classification ----------------------------------------------
  /** Queries whose brand flag was computed with a different regex version (or never). */
  listQueriesForBrandClassification(siteId: string, version: string, limit: number): Promise<Array<{ id: number; text: string }>>;
  setBrandFlags(siteId: string, version: string, flags: Array<{ id: number; isBrand: boolean }>): Promise<void>;

  // ---- sync bookkeeping ---------------------------------------------------
  startSyncRun(run: SyncRunRecord): Promise<number>;
  finishSyncRun(id: number, patch: Partial<SyncRunRecord>): Promise<void>;
  listSyncRuns(limit: number): Promise<SyncRunRecord[]>;

  // ---- reads --------------------------------------------------------------
  queryPerformance(q: PerformanceQuery): Promise<PerformanceRow[]>;
  queryCrawlers(q: CrawlerQuery): Promise<CrawlerRow[]>;
  queryReferrals(q: ReferralQuery): Promise<ReferralRow[]>;
  /** Total AI citations per page in the range. */
  queryAiCitations(siteId: string, range: DateRange, limit: number): Promise<PageCount[]>;
  queryWebVitals(siteId: string, range: DateRange, limit: number): Promise<Array<WebVitalsInput & { page: string }>>;
  listCrawlIssues(siteId: string, source: SearchSource, limit: number): Promise<CrawlIssueInput[]>;
  listSitemaps(siteId: string, source: SearchSource): Promise<SitemapRecord[]>;
  /** Per site, source and dataset: first/last date and row count. */
  coverage(siteId?: string): Promise<DataCoverage[]>;
  /** Latest date with search data for a site and source. */
  latestDate(siteId: string, source: SearchSource): Promise<IsoDate | null>;

  // ---- apps (ADR 0009) ----------------------------------------------------
  /** Apps managed in the dashboard (the APPS secret is not stored). */
  listAppConfigs(): Promise<AppConfig[]>;
  saveAppConfig(app: AppConfig): Promise<void>;
  /** Removes a dashboard-managed app's configuration; its data is kept. */
  deleteAppConfig(id: string): Promise<boolean>;

  /**
   * Sets `w.metrics` of the given rows. For the days in `w.dates`, rows of the same shape that the
   * write does not mention get 0 for those metrics (a newer report replaces a day as a whole).
   */
  writeAppStoreDaily(appId: string, store: AppStore, w: AppStoreWrite): Promise<number>;
  /** Replaces the search terms of the days in `dates` (Google Play). */
  writeAppSearchTerms(appId: string, rows: AppSearchTermInput[], dates: IsoDate[]): Promise<number>;
  /** Sets `w.metrics` of the referrers; for the days in `w.dates`, referrers not mentioned get 0. */
  writeAppReferrers(appId: string, store: AppStore, w: AppReferrerWrite): Promise<number>;
  writeAppRatings(appId: string, store: AppStore, rows: AppRatingInput[]): Promise<number>;
  /** Upserts reviews by id (an edited review replaces the earlier text). */
  writeAppReviews(appId: string, store: AppStore, rows: AppReviewInput[]): Promise<number>;
  writeAppVitals(appId: string, store: AppStore, w: AppVitalsWrite): Promise<number>;
  writeAppChartRanks(appId: string, rows: AppChartRankInput[]): Promise<number>;
  /**
   * Replaces one Google Play earnings file's sums (ADR 0010) and returns the days it covered before
   * or covers now, whose totals then need recomputing.
   */
  writeAppEarningsFile(appId: string, file: string, rows: AppEarningsInput[]): Promise<IsoDate[]>;
  /** Every earnings file's sums per day and buyer country, for those days. */
  sumAppEarnings(appId: string, dates: IsoDate[]): Promise<AppEarningsInput[]>;
  /**
   * Sets `w.metrics` per day and value of one dimension (ADR 0010); for the days in `w.dates`,
   * values the write does not mention get those metrics cleared.
   */
  writeAppBreakdowns(appId: string, store: AppStore, w: AppBreakdownWrite): Promise<number>;
  /** The values kept by installs (installs or active devices set) per day of a dimension, `Other` left out. */
  appBreakdownValues(
    appId: string,
    store: AppStore,
    dimension: AppBreakdownDimension,
    dates: IsoDate[],
  ): Promise<Array<{ date: IsoDate; value: string }>>;
  /**
   * Per value of a dimension over the range: counts summed, active devices and the total rating on
   * the last day with data, the daily rating averaged over days.
   */
  queryAppBreakdowns(q: AppBreakdownQuery): Promise<AppBreakdownRow[]>;
  /** Replaces a subscription product's rows on the days in `dates` (Google Play, ADR 0010). */
  writeAppSubscriptions(appId: string, product: string, dates: IsoDate[], rows: AppSubscriptionInput[]): Promise<number>;
  /** Replaces App Store subscription states or events (one kind) on the days in `w.dates`. */
  writeAppSubscriptionMetrics(appId: string, w: AppSubscriptionMetricWrite): Promise<number>;
  /** Replaces the App Store purchases per product (Analytics Reports) on the days in `dates`. */
  writeAppProducts(appId: string, dates: IsoDate[], rows: AppProductInput[]): Promise<number>;
  /** Replaces a Framework Usage report's rows (report: its slug) on the days in `dates`. */
  writeAppFramework(appId: string, report: string, dates: IsoDate[], rows: AppFrameworkInput[]): Promise<number>;
  /** A Framework Usage report's rows in the range, oldest first. */
  queryAppFramework(appId: string, report: string, range: DateRange, limit?: number): Promise<AppFrameworkRow[]>;
  /** Replaces the App Store opt-in counts of the days in `dates`. */
  writeAppOptIn(appId: string, dates: IsoDate[], rows: AppOptInInput[]): Promise<number>;
  /** First-time downloaders and those sharing analytics, summed over the range (with the days that had data). */
  queryAppOptIn(appId: string, range: DateRange): Promise<{ downloadingUsers: number; optingInUsers: number; days: number }>;
  /** Sets `w.metrics` of the App Store funnel per page; for the days in `w.dates`, pages not mentioned get 0. */
  writeAppPages(appId: string, w: AppPageWrite): Promise<number>;
  /**
   * Compares today's snapshot of a store's fields (only entities starting with one of `scopes`)
   * with the stored one, records a change per field that differs (added, changed or removed) on
   * `date`, and keeps the snapshot. The first snapshot of a scope records no changes. Returns the
   * number of changes.
   */
  snapshotAppListing(appId: string, store: AppStore, date: IsoDate, scopes: string[], values: AppListingValue[]): Promise<number>;
  /** Replaces the Sales and Trends rows of the days in `dates`. */
  writeAppSales(appId: string, dates: IsoDate[], rows: AppSalesInput[]): Promise<number>;

  /**
   * Store funnel metrics grouped by the dimensions. Rows are chosen so nothing is counted twice:
   * with `source` (dimension or filter) the per-source rows, otherwise the per-territory rows.
   */
  queryAppStore(q: AppStoreQuery): Promise<AppStoreRow[]>;
  queryAppSearchTerms(q: AppSearchTermQuery): Promise<AppSearchTermRow[]>;
  queryAppReferrers(q: AppReferrerQuery): Promise<AppReferrerRow[]>;
  /** Rating rows per store, day and territory, oldest first. */
  queryAppRatings(q: AppRatingQuery): Promise<AppRatingRow[]>;
  /** Reviews written in the range, newest first. */
  listAppReviews(q: AppReviewQuery): Promise<AppReviewRow[]>;
  /** Reviews per store and star rating in the range. */
  appReviewStats(appId: string, range: DateRange, store?: AppStore): Promise<AppReviewStat[]>;
  /** Rates are weighted by distinct users when versions or days are combined. */
  queryAppVitals(q: AppVitalsQuery): Promise<AppVitalsRow[]>;
  queryAppChartRanks(appId: string, range: DateRange): Promise<AppChartRankInput[]>;
  /** New and canceled subscriptions summed, active subscriptions as a level (see the row type). */
  queryAppSubscriptions(q: AppSubscriptionQuery): Promise<AppSubscriptionRow[]>;
  /** App Store subscription states (levels, see the row type) or events (summed). */
  queryAppSubscriptionMetrics(q: AppSubscriptionMetricQuery): Promise<AppSubscriptionMetricRow[]>;
  /** Purchases per product summed over the range. */
  queryAppProducts(q: AppProductQuery): Promise<AppProductRow[]>;
  /** The App Store funnel per page type (or page type and title) summed over the range. */
  queryAppPages(q: { appId: string; range: DateRange; level: AppPageLevel; limit?: number }): Promise<AppPageRow[]>;
  /** Store changes in the range, newest first. */
  queryAppChanges(q: AppChangeQuery): Promise<AppChangeRow[]>;
  /** Sales and Trends rows summed over the range. */
  queryAppSales(q: AppSalesQuery): Promise<AppSalesRow[]>;
  /** Per app, store and dataset: first and last date. */
  appCoverage(appId?: string): Promise<AppDataCoverage[]>;
  /** Latest day with store funnel data for an app (and store). */
  latestAppDate(appId: string, store?: AppStore): Promise<IsoDate | null>;
}
