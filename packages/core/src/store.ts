import type {
  AiCitationInput,
  BreakdownInput,
  CrawlIssueInput,
  CrawlerQuery,
  CrawlerRequestInput,
  CrawlerRow,
  DataCoverage,
  DateRange,
  PageCount,
  PerformanceQuery,
  PerformanceRow,
  ReferralQuery,
  ReferralRow,
  SearchFactInput,
  SearchSource,
  SiteConfig,
  SitemapRecord,
  SyncRunRecord,
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
  // ---- key/value metadata -------------------------------------------------
  getMeta(key: string): Promise<string | null>;
  setMeta(key: string, value: string): Promise<void>;
  deleteMeta(key: string): Promise<void>;

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
  writeSearchFacts(siteId: string, source: SearchSource, rows: SearchFactInput[]): Promise<number>;
  writeBreakdowns(siteId: string, source: SearchSource, rows: BreakdownInput[]): Promise<number>;
  writeCrawlerRequests(siteId: string, rows: CrawlerRequestInput[]): Promise<number>;
  writeWebAnalytics(siteId: string, rows: WebAnalyticsInput[]): Promise<number>;
  writeWebVitals(siteId: string, rows: WebVitalsInput[]): Promise<number>;
  writeAiCitations(siteId: string, rows: AiCitationInput[]): Promise<number>;
  /** Replaces the current crawl-issue snapshot for a site and source. */
  replaceCrawlIssues(siteId: string, source: SearchSource, rows: CrawlIssueInput[]): Promise<number>;
  /** Replaces the sitemap snapshot for a site and source. */
  replaceSitemaps(siteId: string, source: SearchSource, rows: SitemapRecord[]): Promise<number>;

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
