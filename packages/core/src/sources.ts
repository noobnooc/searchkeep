/**
 * Contracts for the first-party data source adapters in `packages/sources/*`.
 * Adapters are thin API clients built on `fetch`; all scheduling, budgeting and
 * normalization lives in core.
 */
import type { IsoDate, SitemapRecord } from './types.js';

export interface GscRow {
  keys: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface GscSearchAnalyticsRequest {
  property: string;
  startDate: IsoDate;
  endDate: IsoDate;
  dimensions: Array<'date' | 'query' | 'page' | 'country' | 'device'>;
  rowLimit: number;
  startRow?: number;
  /** `final` (default) or `all` (includes fresh, not-yet-final data). */
  dataState?: 'final' | 'all';
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
  /** Requests from known AI crawlers on a zone for one day. */
  aiCrawlerRequests(zoneId: string, date: IsoDate, userAgentPatterns: string[]): Promise<CloudflareCrawlerRow[]>;
  /** Web Analytics (RUM) page loads grouped by path and referrer host for one day. */
  webAnalytics(accountId: string, siteTag: string, date: IsoDate): Promise<CloudflareRumRow[]>;
  /** Web Vitals p75 per path for one day. */
  webVitals(accountId: string, siteTag: string, date: IsoDate): Promise<CloudflareVitalsRow[]>;
  /** Verifies the API token; returns its status. */
  verifyToken(): Promise<{ active: boolean; message?: string }>;
}

export interface SourceClients {
  gsc?: GscClient;
  bing?: BingClient;
  cloudflare?: CloudflareAnalyticsClient;
}
