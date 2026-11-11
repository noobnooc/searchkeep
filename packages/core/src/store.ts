import type {
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
  /** Replaces a subscription product's rows on the days in `dates` (Google Play, ADR 0010). */
  writeAppSubscriptions(appId: string, product: string, dates: IsoDate[], rows: AppSubscriptionInput[]): Promise<number>;

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
  /** Per app, store and dataset: first and last date. */
  appCoverage(appId?: string): Promise<AppDataCoverage[]>;
  /** Latest day with store funnel data for an app (and store). */
  latestAppDate(appId: string, store?: AppStore): Promise<IsoDate | null>;
}
