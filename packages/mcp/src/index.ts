/**
 * Searchkeep MCP server. Discrete, task-shaped tools (see ADR 0006): each one
 * aggregates on the server and returns a compact, capped result. Tools only
 * call core; they never touch the database or external APIs directly.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { CfWorkerJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/cfworker';
import {
  aiCrawlers,
  comparePeriods,
  findCannibalization,
  findContentDecay,
  findCtrAnomalies,
  findQuickWins,
  geoFunnel,
  inspectUrl,
  listSitemaps,
  listSites,
  queryPerformance,
  safeMessage,
  SearchkeepError,
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
  'inspect_url',
  'list_sitemaps',
  'submit_sitemap',
  'setup_status',
] as const;

export function createSearchkeepMcpServer(deps: McpDeps): McpServer {
  const { ctx } = deps;
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      jsonSchemaValidator: new CfWorkerJsonSchemaValidator(),
      instructions:
        "Searchkeep answers SEO and GEO questions about the owner's own sites from first-party data (Google Search Console, Bing Webmaster Tools, Cloudflare AI crawler traffic and Web Analytics) kept in their own Cloudflare D1. Start with list_sites. Data is synced daily; GSC lags 2-3 days and Bing is weekly. Results are aggregated and capped; use filters and limit to narrow down.",
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
        'Clicks, impressions, CTR and average position from GSC or Bing, grouped by any of date/week/month/query/page/country/device, with filters. country/device cannot be combined with query/page.',
      inputSchema: {
        ...common,
        source,
        dimensions: z
          .array(z.enum(['date', 'week', 'month', 'query', 'page', 'country', 'device']))
          .max(3)
          .optional()
          .describe('Group-by dimensions. Empty = totals.'),
        queryContains: z.string().optional().describe('Case-insensitive substring filter on the query.'),
        pageContains: z.string().optional().describe('Case-insensitive substring filter on the page path.'),
        country: z.string().optional().describe('ISO 3166-1 alpha-3 country code, e.g. usa.'),
        device: z.enum(['DESKTOP', 'MOBILE', 'TABLET']).optional(),
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
        dimension: z.enum(['query', 'page']).optional().describe('Default query.'),
        compareStart: date.optional().describe('Start of the comparison period. Default: the equal-length period right before.'),
        compareEnd: date.optional(),
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
        sortBy: z.enum(['crawled', 'cited', 'aiVisits', 'clicks']).optional().describe('Default crawled.'),
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
        crawler: z.string().optional().describe('Only this crawler, e.g. GPTBot.'),
        pathContains: z.string().optional(),
      },
      annotations: READ_ONLY,
    },
    async (args) => run(() => aiCrawlers(ctx, clean(args))),
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
        'Checks the deployment: Access protection, credentials, live API probes, last sync and data coverage. Never returns secret values. Use after deploying.',
      inputSchema: { probe: z.boolean().optional().describe('Call the source APIs to verify credentials. Default true.') },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (args) =>
      run(async () => setupStatus(ctx, { readiness: await deps.readiness(), ...(args.probe === undefined ? {} : { probe: args.probe }) })),
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
