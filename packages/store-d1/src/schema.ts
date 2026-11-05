/**
 * D1 schema. Generate a migration after changing it:
 *   pnpm --filter @searchkeep/store-d1 run db:generate
 * Migrations are forward-only and must apply cleanly on the previous release's
 * database (CI checks this).
 */
import { sql } from 'drizzle-orm';
import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;

export const meta = sqliteTable('meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: text('updated_at').notNull().default(now),
});

export const sites = sqliteTable('sites', {
  id: text('id').primaryKey(),
  domain: text('domain').notNull(),
  createdAt: text('created_at').notNull().default(now),
});

/** Normalized page keys (see core `normalizePage`). */
export const pages = sqliteTable(
  'pages',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    siteId: text('site_id').notNull(),
    path: text('path').notNull(),
  },
  (t) => [uniqueIndex('pages_site_path').on(t.siteId, t.path)],
);

export const queries = sqliteTable(
  'queries',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    siteId: text('site_id').notNull(),
    text: text('text').notNull(),
    isBrand: integer('is_brand').notNull().default(0),
    /** Brand regex the flag was computed with; null = never classified. */
    brandVersion: text('brand_version'),
  },
  (t) => [uniqueIndex('queries_site_text').on(t.siteId, t.text), index('queries_site_version').on(t.siteId, t.brandVersion)],
);

/**
 * Unified search fact table (GSC daily, Bing weekly). `page_id` / `query_id`
 * are 0 when the row has no such dimension. Positions are impression-weighted
 * sums: avg = position_sum / impressions. `source` is `gsc` (web search),
 * `bing`, or `gsc:<type>` for the other Search Console search types
 * (`gsc:image`, `gsc:video`, `gsc:news`, `gsc:discover`, `gsc:googleNews`).
 */
export const searchFacts = sqliteTable(
  'search_facts',
  {
    siteId: text('site_id').notNull(),
    source: text('source').notNull(),
    kind: text('kind').notNull(),
    date: text('date').notNull(),
    pageId: integer('page_id').notNull().default(0),
    queryId: integer('query_id').notNull().default(0),
    clicks: integer('clicks').notNull(),
    impressions: integer('impressions').notNull(),
    positionSum: real('position_sum'),
  },
  (t) => [
    primaryKey({ columns: [t.siteId, t.source, t.kind, t.date, t.pageId, t.queryId] }),
    index('search_facts_page').on(t.siteId, t.source, t.pageId),
    index('search_facts_query').on(t.siteId, t.source, t.queryId),
  ],
);

/** Raw GSC country × device rows. */
export const searchBreakdowns = sqliteTable(
  'search_breakdowns',
  {
    siteId: text('site_id').notNull(),
    source: text('source').notNull(),
    date: text('date').notNull(),
    country: text('country').notNull(),
    device: text('device').notNull(),
    clicks: integer('clicks').notNull(),
    impressions: integer('impressions').notNull(),
    positionSum: real('position_sum'),
  },
  (t) => [primaryKey({ columns: [t.siteId, t.source, t.date, t.country, t.device] })],
);

/** Raw Cloudflare AI crawler requests per day, crawler, page and status. */
export const aiCrawlerRequests = sqliteTable(
  'ai_crawler_requests',
  {
    siteId: text('site_id').notNull(),
    date: text('date').notNull(),
    crawler: text('crawler').notNull(),
    operator: text('operator').notNull(),
    purpose: text('purpose').notNull(),
    pageId: integer('page_id').notNull(),
    status: integer('status').notNull(),
    requests: integer('requests').notNull(),
  },
  (t) => [primaryKey({ columns: [t.siteId, t.date, t.crawler, t.pageId, t.status] }), index('ai_crawler_page').on(t.siteId, t.pageId)],
);

/** Raw Cloudflare search engine crawler requests (Googlebot, Bingbot, ...), shaped like `ai_crawler_requests`. */
export const searchCrawlerRequests = sqliteTable(
  'search_crawler_requests',
  {
    siteId: text('site_id').notNull(),
    date: text('date').notNull(),
    crawler: text('crawler').notNull(),
    operator: text('operator').notNull(),
    purpose: text('purpose').notNull(),
    pageId: integer('page_id').notNull(),
    status: integer('status').notNull(),
    requests: integer('requests').notNull(),
  },
  (t) => [primaryKey({ columns: [t.siteId, t.date, t.crawler, t.pageId, t.status] }), index('search_crawler_page').on(t.siteId, t.pageId)],
);

/**
 * GSC search appearance per day (rich results, videos, AMP, ...). Search Console
 * reports it on its own, never together with query, page, country or device.
 * `source` follows `search_facts` (`gsc` = web search).
 */
export const searchAppearances = sqliteTable(
  'search_appearances',
  {
    siteId: text('site_id').notNull(),
    source: text('source').notNull(),
    date: text('date').notNull(),
    appearance: text('appearance').notNull(),
    clicks: integer('clicks').notNull(),
    impressions: integer('impressions').notNull(),
    positionSum: real('position_sum'),
  },
  (t) => [primaryKey({ columns: [t.siteId, t.source, t.date, t.appearance] })],
);

/**
 * Opt-in (GSC_SEGMENT_SITES) GSC rows of one query or one page split by country
 * and device. `kind` is `query` (item_id = queries.id) or `page` (item_id = pages.id).
 */
export const searchSegments = sqliteTable(
  'search_segments',
  {
    siteId: text('site_id').notNull(),
    source: text('source').notNull(),
    kind: text('kind').notNull(),
    date: text('date').notNull(),
    itemId: integer('item_id').notNull(),
    country: text('country').notNull(),
    device: text('device').notNull(),
    clicks: integer('clicks').notNull(),
    impressions: integer('impressions').notNull(),
    positionSum: real('position_sum'),
  },
  (t) => [
    primaryKey({ columns: [t.siteId, t.source, t.kind, t.date, t.itemId, t.country, t.device] }),
    index('search_segments_item').on(t.siteId, t.source, t.kind, t.itemId),
  ],
);

/**
 * Index coverage snapshot: the latest URL Inspection result per URL listed in the
 * site's sitemaps. URLs are inspected in batches over days; `previous_coverage_state`
 * and `changed_at` keep the last change. `rich_results` is JSON:
 * `[{"t": type, "i": [{"s": severity, "m": message}]}]`.
 */
export const indexStatus = sqliteTable(
  'index_status',
  {
    siteId: text('site_id').notNull(),
    url: text('url').notNull(),
    firstSeen: text('first_seen').notNull(),
    inspectedAt: text('inspected_at'),
    verdict: text('verdict'),
    coverageState: text('coverage_state'),
    indexingState: text('indexing_state'),
    pageFetchState: text('page_fetch_state'),
    robotsTxtState: text('robots_txt_state'),
    lastCrawlTime: text('last_crawl_time'),
    googleCanonical: text('google_canonical'),
    userCanonical: text('user_canonical'),
    crawledAs: text('crawled_as'),
    richResultsVerdict: text('rich_results_verdict'),
    richResults: text('rich_results'),
    error: text('error'),
    previousCoverageState: text('previous_coverage_state'),
    changedAt: text('changed_at'),
  },
  (t) => [primaryKey({ columns: [t.siteId, t.url] }), index('index_status_inspected').on(t.siteId, t.inspectedAt)],
);

/** Raw Cloudflare Web Analytics page loads per day, page and referrer host. */
export const webAnalytics = sqliteTable(
  'web_analytics',
  {
    siteId: text('site_id').notNull(),
    date: text('date').notNull(),
    pageId: integer('page_id').notNull(),
    refererHost: text('referer_host').notNull(),
    visits: integer('visits').notNull(),
    pageViews: integer('page_views').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.siteId, t.date, t.pageId, t.refererHost] }),
    index('web_analytics_referer').on(t.siteId, t.refererHost, t.date),
  ],
);

export const webVitals = sqliteTable(
  'web_vitals',
  {
    siteId: text('site_id').notNull(),
    date: text('date').notNull(),
    pageId: integer('page_id').notNull(),
    lcpP75: real('lcp_p75'),
    inpP75: real('inp_p75'),
    clsP75: real('cls_p75'),
    samples: integer('samples').notNull(),
  },
  (t) => [primaryKey({ columns: [t.siteId, t.date, t.pageId] })],
);

/** AI answer citations (e.g. Bing AI Performance CSV imports). */
export const aiCitations = sqliteTable(
  'ai_citations',
  {
    siteId: text('site_id').notNull(),
    date: text('date').notNull(),
    pageId: integer('page_id').notNull(),
    surface: text('surface').notNull(),
    citations: integer('citations').notNull(),
  },
  (t) => [primaryKey({ columns: [t.siteId, t.date, t.pageId, t.surface] })],
);

export const crawlIssues = sqliteTable(
  'crawl_issues',
  {
    siteId: text('site_id').notNull(),
    source: text('source').notNull(),
    url: text('url').notNull(),
    issue: text('issue').notNull(),
    httpCode: integer('http_code'),
    detectedAt: text('detected_at'),
  },
  (t) => [primaryKey({ columns: [t.siteId, t.source, t.url, t.issue] })],
);

export const sitemaps = sqliteTable(
  'sitemaps',
  {
    siteId: text('site_id').notNull(),
    source: text('source').notNull(),
    path: text('path').notNull(),
    lastSubmitted: text('last_submitted'),
    lastDownloaded: text('last_downloaded'),
    isPending: integer('is_pending').notNull().default(0),
    errors: integer('errors').notNull().default(0),
    warnings: integer('warnings').notNull().default(0),
    submitted: integer('submitted'),
    indexed: integer('indexed'),
  },
  (t) => [primaryKey({ columns: [t.siteId, t.source, t.path] })],
);

export const syncRuns = sqliteTable(
  'sync_runs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    startedAt: text('started_at').notNull(),
    finishedAt: text('finished_at'),
    trigger: text('trigger').notNull(),
    status: text('status').notNull(),
    rowsWritten: integer('rows_written').notNull().default(0),
    message: text('message'),
    details: text('details'),
  },
  (t) => [index('sync_runs_started').on(t.startedAt)],
);

/** Sites managed in the dashboard. Sites from the SITES secret are not stored here. */
export const siteConfigs = sqliteTable('site_configs', {
  id: text('id').primaryKey(),
  domain: text('domain').notNull(),
  gscProperty: text('gsc_property'),
  bingSiteUrl: text('bing_site_url'),
  cloudflareZoneId: text('cloudflare_zone_id'),
  webAnalyticsSiteTag: text('web_analytics_site_tag'),
  brandRegex: text('brand_regex'),
  createdAt: text('created_at').notNull().default(now),
  updatedAt: text('updated_at').notNull().default(now),
});
