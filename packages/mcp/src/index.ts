/**
 * Searchkeep MCP server. Discrete, task-shaped tools (see ADR 0006): each one
 * aggregates on the server and returns a compact, capped result. Tools only
 * call core; they never touch the database or external APIs directly.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { CfWorkerJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/cfworker';
import {
  GEO_SORT_KEYS,
  aiCrawlers,
  appPerformance,
  appReviews,
  appSearchTerms,
  appBreakdown,
  appStability,
  appSubscriptions,
  listApps,
  comparePeriods,
  findCannibalization,
  findContentDecay,
  findCtrAnomalies,
  findQuickWins,
  geoFunnel,
  indexCoverage,
  inspectUrl,
  listSitemaps,
  listSites,
  queryPerformance,
  safeMessage,
  SearchkeepError,
  searchCrawlers,
  setupStatus,
  submitSitemap,
  type OpsContext,
  type ReadinessReport,
} from '@searchkeep/core';
import { z } from 'zod';

export const SERVER_NAME = 'searchkeep';
export const SERVER_VERSION = '0.1.0';

export interface McpDeps {
  ctx: OpsContext;
  /** Readiness of the deployment for the current request. */
  readiness: () => Promise<ReadinessReport>;
}

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');

/** Filters shared by most tools. */
const common = {
  site: z.string().optional().describe('Site id or domain. Optional when only one site is configured; see list_sites.'),
  start: date.optional().describe('Start date (YYYY-MM-DD). Defaults to end minus `days` + 1.'),
  end: date.optional().describe('End date (YYYY-MM-DD). Defaults to the latest date with data.'),
  days: z.number().int().min(1).max(3660).optional().describe('Window length in days when start is omitted. Default 28.'),
  brand: z.enum(['all', 'brand', 'non_brand']).optional().describe('Split by the configured brand regex. Default all.'),
  limit: z.number().int().min(1).max(500).optional().describe('Maximum rows returned.'),
};
const source = z
  .enum(['gsc', 'bing'])
  .optional()
  .describe('gsc = Google Search Console (daily), bing = Bing Webmaster Tools (weekly). Default gsc.');
const searchType = z
  .enum(['web', 'image', 'video', 'news', 'discover', 'googleNews'])
  .optional()
  .describe(
    'Search Console search type: web (default), image, video, news (the News tab), discover, googleNews. discover and googleNews have pages only (no queries or positions).',
  );
const crawlerInput = {
  site: common.site,
  start: common.start,
  end: common.end,
  days: common.days.describe('Window length in days. Default 7.'),
  limit: common.limit,
  groupBy: z
    .array(z.enum(['crawler', 'operator', 'purpose', 'path', 'status', 'date']))
    .max(3)
    .optional()
    .describe('Default [crawler].'),
  pathContains: z.string().optional(),
};

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

type ToolResult = { content: Array<{ type: 'text'; text: string }>; isError?: boolean };

function ok(value: unknown): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value) }] };
}

function fail(err: unknown): ToolResult {
  const message = err instanceof SearchkeepError ? err.message : safeMessage(err);
  return { content: [{ type: 'text', text: JSON.stringify({ error: message }) }], isError: true };
}

async function run(fn: () => Promise<unknown>): Promise<ToolResult> {
  try {
    return ok(await fn());
  } catch (err) {
    return fail(err);
  }
}

/** Strip undefined values so optional zod fields don't override defaults. */
function clean<T extends Record<string, unknown>>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}

export const TOOL_NAMES = [
  'list_sites',
  'query_performance',
  'compare_periods',
  'find_quick_wins',
  'find_cannibalization',
  'find_ctr_anomalies',
  'find_content_decay',
  'geo_funnel',
  'ai_crawlers',
  'search_crawlers',
  'index_coverage',
  'inspect_url',
  'list_sitemaps',
  'submit_sitemap',
  'setup_status',
  'list_apps',
  'app_performance',
  'app_search_terms',
  'app_reviews',
  'app_stability',
  'app_subscriptions',
  'app_breakdown',
] as const;

/** Parameters shared by the app tools (ADR 0009). */
const appCommon = {
  app: z
    .string()
    .optional()
    .describe('App id, App Store Apple ID or Google Play package. Optional when only one app is configured; see list_apps.'),
  start: common.start,
  end: date.optional().describe('End date (YYYY-MM-DD). Defaults to the latest date with store data.'),
  days: common.days,
  limit: common.limit,
};
const appStore = z.enum(['apple', 'play']).optional().describe('apple = App Store, play = Google Play. Both when omitted.');

export function createSearchkeepMcpServer(deps: McpDeps): McpServer {
  const { ctx } = deps;
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      jsonSchemaValidator: new CfWorkerJsonSchemaValidator(),
      instructions:
        "Searchkeep answers SEO and GEO questions about the owner's own sites from first-party data (Google Search Console, Bing Webmaster Tools, Cloudflare AI and search engine crawler traffic and Web Analytics) kept in their own Cloudflare D1. Start with list_sites. Data is synced daily; GSC lags 2-3 days and Bing is weekly. index_coverage answers indexing questions from a stored snapshot; use inspect_url only for spot checks. It also answers app store (ASO) questions about the owner's own apps from App Store Connect and Google Play Console data: start with list_apps, then app_performance (store funnel), app_search_terms (Google Play search terms), app_reviews and app_stability; App Store data lags 2-5 days and Google Play 3-7 days. Right after deploying, history is still being backfilled: if data looks incomplete, setup_status reports the sync progress. Results are aggregated and capped; use filters and limit to narrow down.",
    },
  );

  server.registerTool(
    'list_sites',
    {
      title: 'List sites',
      description: 'Configured sites, which data sources are connected for each, and the date range of stored data.',
      inputSchema: {},
      annotations: READ_ONLY,
    },
    async () => run(() => listSites(ctx)),
  );

  server.registerTool(
    'query_performance',
    {
      title: 'Query search performance',
      description:
        'Clicks, impressions, CTR and average position from GSC or Bing, grouped by any of date/week/month/query/page/country/device/appearance, with filters. GSC also covers image, video, News, Discover and Google News (searchType). country/device combine with query or page (not both) only for sites in GSC_SEGMENT_SITES. appearance (rich results, videos, ...) combines only with date/week/month.',
      inputSchema: {
        ...common,
        source,
        searchType,
        dimensions: z
          .array(z.enum(['date', 'week', 'month', 'query', 'page', 'country', 'device', 'appearance']))
          .max(3)
          .optional()
          .describe('Group-by dimensions. Empty = totals.'),
        queryContains: z.string().optional().describe('Case-insensitive substring filter on the query.'),
        pageContains: z.string().optional().describe('Case-insensitive substring filter on the page path.'),
        country: z.string().optional().describe('ISO 3166-1 alpha-3 country code, e.g. usa.'),
        device: z.enum(['DESKTOP', 'MOBILE', 'TABLET']).optional(),
        appearance: z
          .string()
          .optional()
          .describe('Only this search appearance, e.g. VIDEO or REVIEW_SNIPPET (group by appearance to list them). GSC web search only.'),
        orderBy: z.enum(['clicks', 'impressions', 'ctr', 'position', 'date']).optional(),
        order: z.enum(['asc', 'desc']).optional(),
      },
      annotations: READ_ONLY,
    },
    async (args) => run(() => queryPerformance(ctx, clean(args))),
  );

  server.registerTool(
    'compare_periods',
    {
      title: 'Compare two periods',
      description:
        'Compares a period with the previous one (or a custom one) and returns totals plus the queries or pages that gained and lost the most clicks.',
      inputSchema: {
        ...common,
        source,
        searchType,
        dimension: z.enum(['query', 'page']).optional().describe('Default query.'),
        compareStart: date
          .optional()
          .describe(
            'Start of the comparison period. Default: the equal-length period right before. Give one end and the other is derived.',
          ),
        compareEnd: date.optional().describe('End of the comparison period.'),
      },
      annotations: READ_ONLY,
    },
    async (args) => run(() => comparePeriods(ctx, clean(args))),
  );

  server.registerTool(
    'find_quick_wins',
    {
      title: 'Find quick wins',
      description:
        'Queries ranking just off the top (default positions 8-20) with high impressions, ranked by extra clicks available if they reached the top 3.',
      inputSchema: {
        ...common,
        source,
        searchType,
        minPosition: z.number().min(1).max(100).optional(),
        maxPosition: z.number().min(1).max(100).optional(),
        minImpressions: z.number().int().min(1).optional(),
      },
      annotations: READ_ONLY,
    },
    async (args) => run(() => findQuickWins(ctx, clean(args))),
  );

  server.registerTool(
    'find_cannibalization',
    {
      title: 'Find keyword cannibalization',
      description: 'Queries where two or more of your pages compete for impressions (GSC only, needs query × page data).',
      inputSchema: {
        ...common,
        searchType,
        minImpressions: z.number().int().min(1).optional().describe('Minimum impressions per query/page pair. Default 10.'),
        minShare: z.number().min(0.01).max(0.5).optional().describe("Minimum share of the query's impressions per page. Default 0.1."),
      },
      annotations: READ_ONLY,
    },
    async (args) => run(() => findCannibalization(ctx, clean(args))),
  );

  server.registerTool(
    'find_ctr_anomalies',
    {
      title: 'Find CTR anomalies',
      description:
        'Queries whose CTR is far below what this site normally gets at the same position — usually a title/snippet or SERP-feature problem.',
      inputSchema: {
        ...common,
        source,
        searchType,
        minImpressions: z.number().int().min(1).optional(),
        threshold: z.number().min(0.05).max(0.95).optional().describe('Flag when CTR < expected × threshold. Default 0.5.'),
      },
      annotations: READ_ONLY,
    },
    async (args) => run(() => findCtrAnomalies(ctx, clean(args))),
  );

  server.registerTool(
    'find_content_decay',
    {
      title: 'Find content decay',
      description: 'Pages whose weekly clicks keep falling from an earlier peak. Returns the weekly series per page.',
      inputSchema: {
        site: common.site,
        source,
        searchType,
        brand: common.brand,
        limit: common.limit,
        end: common.end,
        weeks: z.number().int().min(8).max(104).optional().describe('Weeks of history. Default 16.'),
        minWeeklyClicks: z.number().min(1).optional().describe('Minimum weekly clicks at the peak. Default 5.'),
        minDecline: z.number().min(0.05).max(0.95).optional().describe('Minimum decline from peak (0-1). Default 0.3.'),
      },
      annotations: READ_ONLY,
    },
    async (args) => run(() => findContentDecay(ctx, clean(args))),
  );

  server.registerTool(
    'geo_funnel',
    {
      title: 'GEO funnel per page',
      description:
        'Per page: requests from AI crawlers (Cloudflare) → citations in AI answers (Bing AI Performance import) → visits referred by AI assistants (Web Analytics) → search clicks (GSC + Bing). Use it to find pages AI reads but never cites or sends traffic to.',
      inputSchema: {
        site: common.site,
        start: common.start,
        end: common.end,
        days: common.days,
        limit: common.limit,
        pageContains: z.string().optional(),
        sortBy: z.enum(GEO_SORT_KEYS).optional().describe('Default crawled.'),
      },
      annotations: READ_ONLY,
    },
    async (args) => run(() => geoFunnel(ctx, clean(args))),
  );

  server.registerTool(
    'ai_crawlers',
    {
      title: 'AI crawler traffic',
      description:
        'Requests from AI crawlers and assistants (GPTBot, ClaudeBot, PerplexityBot, …) recorded by Cloudflare, grouped by crawler, operator, purpose, path, status or date.',
      inputSchema: {
        ...crawlerInput,
        crawler: z.string().optional().describe('Only this crawler, e.g. GPTBot.'),
      },
      annotations: READ_ONLY,
    },
    async (args) => run(() => aiCrawlers(ctx, clean(args))),
  );

  server.registerTool(
    'search_crawlers',
    {
      title: 'Search engine crawler traffic',
      description:
        "Requests from search engine crawlers (Googlebot, Bingbot, YandexBot, Applebot, …) recorded by Cloudflare, grouped by crawler, operator, purpose (search, media, ads, other), path, status or date. The closest thing to Search Console's Crawl stats report: crawl volume, response codes and the most crawled pages.",
      inputSchema: {
        ...crawlerInput,
        crawler: z.string().optional().describe('Only this crawler, e.g. Googlebot or Bingbot.'),
      },
      annotations: READ_ONLY,
    },
    async (args) => run(() => searchCrawlers(ctx, clean(args))),
  );

  server.registerTool(
    'index_coverage',
    {
      title: 'Index coverage',
      description:
        "Index status of the sitemaps' URLs from a stored URL Inspection snapshot (inspected in daily batches): how many are indexed, counts per coverage state (Crawled - currently not indexed, Soft 404, duplicates, ...), rich result (structured data) problems, the URLs in a state and recent changes. No quota is used.",
      inputSchema: {
        site: common.site,
        coverageState: z
          .string()
          .optional()
          .describe('Only URLs whose coverage state contains this text, e.g. "crawled - currently not indexed".'),
        verdict: z
          .enum(['PASS', 'NEUTRAL', 'FAIL', 'PENDING', 'ERROR'])
          .optional()
          .describe('PASS = indexed, NEUTRAL = excluded, FAIL = error, PENDING = not inspected yet, ERROR = inspection failed.'),
        richResultIssues: z.boolean().optional().describe('Only URLs with rich result issues.'),
        changedDays: z.number().int().min(1).max(365).optional().describe('List coverage changes of the last N days. Default 7.'),
        limit: common.limit,
      },
      annotations: READ_ONLY,
    },
    async (args) => run(() => indexCoverage(ctx, clean(args))),
  );

  server.registerTool(
    'inspect_url',
    {
      title: 'Inspect URL (live)',
      description:
        'Live Google URL Inspection: index status, coverage, canonical, last crawl. Counts against the ~2,000/day per-property quota.',
      inputSchema: { site: common.site, url: z.string().min(1).describe('Absolute URL or path on the site.') },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (args) => run(() => inspectUrl(ctx, clean(args))),
  );

  server.registerTool(
    'list_sitemaps',
    {
      title: 'List sitemaps',
      description: 'Sitemaps known to Search Console with errors, warnings and submitted/indexed counts. live=true refreshes from the API.',
      inputSchema: { site: common.site, live: z.boolean().optional() },
      annotations: READ_ONLY,
    },
    async (args) => run(() => listSitemaps(ctx, clean(args))),
  );

  if (ctx.config.enableWrites) {
    server.registerTool(
      'submit_sitemap',
      {
        title: 'Submit sitemap',
        description:
          'Submits a sitemap to Google Search Console. Writes to an external system; requires ENABLE_WRITES and Full permission for the service account.',
        inputSchema: { site: common.site, sitemapUrl: z.string().url().describe('Absolute https URL of the sitemap.') },
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      },
      async (args) => run(() => submitSitemap(ctx, clean(args))),
    );
  }

  server.registerTool(
    'setup_status',
    {
      title: 'Setup status',
      description:
        'Checks the deployment: Access protection, credentials, live API probes, last sync, sync progress (latest days and history per site and dataset, rate-limit pauses, failed tasks waiting to be retried) and data coverage. Never returns secret values. Use after deploying, and when data looks incomplete.',
      inputSchema: { probe: z.boolean().optional().describe('Call the source APIs to verify credentials. Default true.') },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (args) =>
      run(async () => setupStatus(ctx, { readiness: await deps.readiness(), ...(args.probe === undefined ? {} : { probe: args.probe }) })),
  );

  // ---- apps (ADR 0009) --------------------------------------------------------

  server.registerTool(
    'list_apps',
    {
      title: 'List apps',
      description:
        'Configured apps, which stores are connected (App Store Connect, Google Play, opt-in App Store public feeds), whether App Store reports are started, and the date range of stored data.',
      inputSchema: {},
      annotations: READ_ONLY,
    },
    async () => run(() => listApps(ctx)),
  );

  server.registerTool(
    'app_performance',
    {
      title: 'App store performance',
      description:
        "An app's store funnel per store: impressions (App Store), page views (App Store product page views, Google Play store listing visitors), downloads (first-time downloads, store listing acquisitions), redownloads, installs, deletions, active devices and conversion rates, plus App Store revenue (purchases, proceeds and sales in USD, paying users, proceeds per download) and sessions (sessions, average length, sessions per device), compared with the previous period. groupBy adds rows by date, week, month, store, territory, source (search, browse, app_referrer, web_referrer, referral, ...) or referrer (websites, apps and UTM sources that sent people to the store page; ownSite marks the owner's own site). Institutional purchases (App Store licenses bought in bulk through Apple Business Manager or Apple School Manager) are left out of the totals and trends and listed only by source. Includes the App Store chart position when the opt-in public feeds are on.",
      inputSchema: {
        ...appCommon,
        store: appStore,
        groupBy: z
          .array(z.enum(['date', 'week', 'month', 'store', 'territory', 'source', 'referrer']))
          .max(2)
          .optional()
          .describe('Default: totals per store only.'),
        territory: z.string().optional().describe('Only this territory, as the store reports it (e.g. US).'),
        source: z
          .string()
          .optional()
          .describe('Only this source: search, browse, app_referrer, web_referrer, referral, app_clip, notification, other.'),
        referrerKind: z.enum(['web', 'app', 'utm']).optional().describe('With groupBy referrer: only websites, apps or UTM sources.'),
      },
      annotations: READ_ONLY,
    },
    async (args) => run(() => appPerformance(ctx, clean(args))),
  );

  server.registerTool(
    'app_search_terms',
    {
      title: 'App search terms (Google Play)',
      description:
        'Google Play search terms that brought store listing visitors: visitors, acquisitions, conversion and change against the previous period, plus well-visited terms that convert poorly (lowConverting). The App Store reports no search terms.',
      inputSchema: {
        ...appCommon,
        termContains: z.string().optional(),
        sortBy: z.enum(['visitors', 'acquisitions', 'conversion', 'change']).optional().describe('Default visitors.'),
        minVisitors: z.number().int().min(1).optional().describe('Minimum visitors for lowConverting. Default 20.'),
      },
      annotations: READ_ONLY,
    },
    async (args) => run(() => appSearchTerms(ctx, clean(args))),
  );

  server.registerTool(
    'app_reviews',
    {
      title: 'App ratings and reviews',
      description:
        "Ratings and reviews of an app per store: star distribution and average of the reviews in the range, the store's average rating over time, and the reviews themselves (newest first, without reviewer names). Filter by stars, territory, app version or text.",
      inputSchema: {
        ...appCommon,
        days: common.days.describe('Window length in days. Default 90.'),
        store: appStore,
        ratings: z.array(z.number().int().min(1).max(5)).max(5).optional().describe('Only these star ratings, e.g. [1, 2].'),
        territory: z.string().optional(),
        version: z.string().optional(),
        contains: z.string().optional().describe('Text in the title or body.'),
      },
      annotations: READ_ONLY,
    },
    async (args) => run(() => appReviews(ctx, clean(args))),
  );

  server.registerTool(
    'app_stability',
    {
      title: 'App stability',
      description:
        'Crash and ANR rates (Google Play, shares of daily users, with the user-perceived rates Google uses for its bad-behavior thresholds) and crash counts (App Store), per day or per app version.',
      inputSchema: {
        ...appCommon,
        store: appStore,
        groupBy: z.enum(['date', 'version']).optional().describe('Default date.'),
      },
      annotations: READ_ONLY,
    },
    async (args) => run(() => appStability(ctx, clean(args))),
  );

  server.registerTool(
    'app_subscriptions',
    {
      title: 'App subscriptions',
      description:
        'Google Play subscriptions: new, canceled and active subscriptions per product and country over the period, against the previous period, with the daily trend. Needs the service account to view financial data.',
      inputSchema: {
        ...appCommon,
        product: z.string().optional().describe('Only this subscription product id.'),
        territory: z.string().optional().describe('Only this country (e.g. US).'),
      },
      annotations: READ_ONLY,
    },
    async (args) => run(() => appSubscriptions(ctx, clean(args))),
  );

  server.registerTool(
    'app_breakdown',
    {
      title: 'App breakdown',
      description:
        "An app's numbers per app version, device model or OS version: Google Play installs, uninstalls, active devices, daily and total ratings, crashes and ANRs; App Store sessions and crash counts per app version. Use it to tie a release, a device or an OS version to its ratings and crashes.",
      inputSchema: {
        ...appCommon,
        store: appStore,
        dimension: z.enum(['app_version', 'device', 'os_version']).optional().describe('Default app_version.'),
      },
      annotations: READ_ONLY,
    },
    async (args) => run(() => appBreakdown(ctx, clean(args))),
  );

  return server;
}

/**
 * Handles one MCP Streamable HTTP request statelessly: a fresh server and
 * transport per request, JSON responses (no SSE sessions to keep alive).
 */
export async function handleMcpRequest(request: Request, deps: McpDeps): Promise<Response> {
  const server = createSearchkeepMcpServer(deps);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  return transport.handleRequest(request);
}

/** JSON-RPC error response used when the deployment is locked. */
export function mcpLockedResponse(message: string, status = 403): Response {
  return new Response(JSON.stringify({ jsonrpc: '2.0', error: { code: -32001, message }, id: null }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
