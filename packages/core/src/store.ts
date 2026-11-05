import type {
  AiCitationInput,
  AppearanceInput,
  BreakdownInput,
  CrawlerKind,
  CrawlIssueInput,
  CrawlerQuery,
  CrawlerRequestInput,
  CrawlerRow,
  DataCoverage,
  DateRange,
  GscSearchType,
  IndexCoverageQuery,
  IndexCoverageResult,
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
  IsoDate,
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
}
