/**
 * Product facts shared by the landing page, the docs, JSON-LD and llms.txt.
 * Keep these in sync with packages/mcp (tool names, parameters, defaults),
 * packages/core/src/config.ts (secrets) and apps/cloudflare (routes, readiness).
 */

export interface ToolParam {
  name: string;
  type: string;
  required?: boolean;
  description: string;
}

export interface Tool {
  name: string;
  summary: string;
  description: string;
  readOnly: boolean;
  params: ToolParam[];
  example?: string;
}

const site: ToolParam = {
  name: 'site',
  type: 'string',
  description: 'Site `id` or domain from `SITES`. Optional when only one site is configured; see `list_sites`.',
};
const start: ToolParam = {
  name: 'start',
  type: 'YYYY-MM-DD',
  description: 'First day of the range (UTC). Defaults to `end` minus `days` plus one.',
};
const end: ToolParam = {
  name: 'end',
  type: 'YYYY-MM-DD',
  description: 'Last day of the range (UTC). Defaults to the latest day with data.',
};
const days = (def: number): ToolParam => ({
  name: 'days',
  type: 'number',
  description: `Window length in days when \`start\` is omitted (1–3660). Defaults to ${def}.`,
});
const source: ToolParam = {
  name: 'source',
  type: '"gsc" | "bing"',
  description:
    '`gsc` (Google Search Console, daily) or `bing` (Bing Webmaster Tools, weekly; ranges are aligned to whole Monday–Sunday weeks). Defaults to `gsc`.',
};
const brand: ToolParam = {
  name: 'brand',
  type: '"all" | "brand" | "non_brand"',
  description: 'Split queries by the brand regex (the site’s `brandRegex` or `BRAND_REGEX`). Defaults to `all`.',
};
const limit = (def: number): ToolParam => ({
  name: 'limit',
  type: 'number',
  description: `Maximum rows returned (1–500). Defaults to ${def}.`,
});

export const TOOLS: Tool[] = [
  {
    name: 'list_sites',
    summary: 'Configured sites, their connected sources and stored date ranges.',
    description:
      'Lists every site in `SITES` with the sources connected for it (GSC, Bing, Cloudflare AI crawlers, Web Analytics) and, for each dataset, the first and last date stored in D1. Start here.',
    readOnly: true,
    params: [],
    example: 'Which sites are connected, and how far back does each one’s data go?',
  },
  {
    name: 'query_performance',
    summary: 'Clicks, impressions, CTR and position by any dimension.',
    description:
      'The general-purpose search analytics query. Groups GSC or Bing data by up to three dimensions and filters by query, page, country or device. It reads the history stored in D1, so ranges older than 16 months work once you have kept them. `country` and `device` cannot be combined with `query`/`page` dimensions, their filters or a brand split, because Search Console stores them separately; Bing has no country or device data and reports queries and pages separately.',
    readOnly: true,
    params: [
      site,
      start,
      end,
      days(28),
      source,
      {
        name: 'dimensions',
        type: 'Array<"date" | "week" | "month" | "query" | "page" | "country" | "device">',
        description: 'Up to three group-by dimensions. Omit for totals over the range.',
      },
      {
        name: 'queryContains',
        type: 'string',
        description: 'Case-insensitive substring filter on the query text.',
      },
      {
        name: 'pageContains',
        type: 'string',
        description: 'Case-insensitive substring filter on the page path.',
      },
      { name: 'country', type: 'string', description: 'ISO 3166-1 alpha-3 country code, as GSC reports it (e.g. `usa`).' },
      { name: 'device', type: '"DESKTOP" | "MOBILE" | "TABLET"', description: 'Device filter.' },
      brand,
      {
        name: 'orderBy',
        type: '"clicks" | "impressions" | "ctr" | "position" | "date"',
        description: 'Sort key. Defaults to `date` when grouping by a single time dimension, otherwise `clicks`.',
      },
      {
        name: 'order',
        type: '"asc" | "desc"',
        description: 'Sort direction. Defaults to `asc` for a single time dimension, otherwise `desc`.',
      },
      limit(50),
    ],
    example: 'Top non-brand queries for /pricing over the last 90 days, by week.',
  },
  {
    name: 'compare_periods',
    summary: 'What moved between two periods, and by how much.',
    description:
      'Compares a period with the equal-length period right before it, or with a custom comparison period, and returns totals for both, the change in clicks and impressions, and the queries or pages that gained and lost the most clicks, with impression and position deltas.',
    readOnly: true,
    params: [
      site,
      start,
      end,
      days(28),
      source,
      { name: 'dimension', type: '"query" | "page"', description: 'What to compare. Defaults to `query`.' },
      {
        name: 'compareStart',
        type: 'YYYY-MM-DD',
        description: 'Start of the comparison period. Set it together with `compareEnd`; otherwise the previous period is used.',
      },
      { name: 'compareEnd', type: 'YYYY-MM-DD', description: 'End of the comparison period.' },
      brand,
      limit(20),
    ],
    example: 'What dropped the most this month compared to the same month last year?',
  },
  {
    name: 'find_quick_wins',
    summary: 'High-impression queries ranking just off the top.',
    description:
      'Finds queries with an average position between `minPosition` and `maxPosition` and enough impressions to matter, together with the page that ranks for each (GSC), ranked by the extra clicks available if they reached position 3 at a benchmark CTR. These are usually the cheapest traffic to win.',
    readOnly: true,
    params: [
      site,
      start,
      end,
      days(28),
      source,
      { name: 'minPosition', type: 'number', description: 'Lower bound of average position. Defaults to 8.' },
      { name: 'maxPosition', type: 'number', description: 'Upper bound of average position. Defaults to 20.' },
      {
        name: 'minImpressions',
        type: 'number',
        description: 'Ignore queries below this. Defaults to twice the number of days in the range (at least 10).',
      },
      brand,
      limit(25),
    ],
  },
  {
    name: 'find_cannibalization',
    summary: 'Queries where several of your pages compete.',
    description:
      'Finds queries for which two or more of your pages each get a meaningful share of the impressions, with each page’s impressions, clicks, position and share, so you can consolidate or differentiate them. Search Console only, because it needs query × page data.',
    readOnly: true,
    params: [
      site,
      start,
      end,
      days(28),
      { name: 'minImpressions', type: 'number', description: 'Minimum impressions per query/page pair. Defaults to 10.' },
      {
        name: 'minShare',
        type: 'number',
        description: 'Minimum share of the query’s impressions a page needs to count (0.01–0.5). Defaults to 0.1.',
      },
      brand,
      limit(25),
    ],
  },
  {
    name: 'find_ctr_anomalies',
    summary: 'Queries with a CTR well below what their position predicts.',
    description:
      'Compares each query’s CTR with the median CTR of your own queries at the same rounded position (a benchmark curve when there are fewer than 8 samples) and returns the queries below `expected × threshold`, ranked by lost clicks. Only positions up to 20 count. Typical causes: a weak title or description, a rich result taking the click, or a mismatch with search intent.',
    readOnly: true,
    params: [
      site,
      start,
      end,
      days(28),
      source,
      {
        name: 'minImpressions',
        type: 'number',
        description: 'Minimum impressions per query. Defaults to five times the number of days in the range (at least 50).',
      },
      {
        name: 'threshold',
        type: 'number',
        description: 'Flag a query when its CTR is below the expected CTR times this (0.05–0.95). Defaults to 0.5.',
      },
      brand,
      limit(25),
    ],
  },
  {
    name: 'find_content_decay',
    summary: 'Pages whose clicks have been sliding for weeks.',
    description:
      'Compares each page’s last 4 weeks of clicks with its best earlier 4-week window and returns the pages that fell by at least `minDecline` and are still trending down (not a single bad week), with peak and recent weekly clicks and the full weekly series.',
    readOnly: true,
    params: [
      site,
      end,
      { name: 'weeks', type: 'number', description: 'Weeks of history to analyse (8–104). Defaults to 16.' },
      { name: 'minWeeklyClicks', type: 'number', description: 'Ignore pages below this many weekly clicks at their peak. Defaults to 5.' },
      { name: 'minDecline', type: 'number', description: 'Minimum decline from the peak (0.05–0.95). Defaults to 0.3.' },
      source,
      brand,
      limit(25),
    ],
  },
  {
    name: 'geo_funnel',
    summary: 'Crawled → Cited → Clicked, per page.',
    description:
      'Joins, for each page, AI crawler requests (Cloudflare), citations in AI answers (imported from Bing AI Performance CSV exports), visits referred by AI assistants (Web Analytics) and search clicks and impressions (GSC plus Bing). Returns totals, the pages, and the most-crawled pages that were never cited (once citation data exists). Notes say which step has no data and why.',
    readOnly: true,
    params: [
      site,
      start,
      end,
      days(28),
      { name: 'pageContains', type: 'string', description: 'Case-insensitive substring filter on the page path.' },
      {
        name: 'sortBy',
        type: '"crawled" | "cited" | "aiVisits" | "clicks"',
        description: 'Sort key, descending. Defaults to `crawled`.',
      },
      limit(50),
    ],
    example: 'Which pages do AI crawlers hit but never get cited?',
  },
  {
    name: 'ai_crawlers',
    summary: 'AI crawler requests by bot, operator, purpose, path and status.',
    description:
      'Summarises requests from known AI crawlers and assistants (GPTBot, ClaudeBot, PerplexityBot, OAI-SearchBot and others) recorded by Cloudflare, classified by operator and purpose (`training`, `search`, `user`). Includes HTTP status, so blocked or failing fetches stand out. Without dates, the window ends at the latest day of crawler data.',
    readOnly: true,
    params: [
      site,
      start,
      end,
      days(7),
      {
        name: 'groupBy',
        type: 'Array<"crawler" | "operator" | "purpose" | "path" | "status" | "date">',
        description: 'Up to three group-by dimensions. Defaults to `["crawler"]`.',
      },
      { name: 'crawler', type: 'string', description: 'Only this crawler, e.g. `GPTBot`.' },
      { name: 'pathContains', type: 'string', description: 'Case-insensitive substring filter on the path.' },
      limit(50),
    ],
    example: 'Are any AI crawlers getting 4xx or 5xx responses from us?',
  },
  {
    name: 'inspect_url',
    summary: 'Live Google URL Inspection for one URL.',
    description:
      'Calls the Search Console URL Inspection API in real time: verdict, coverage and indexing state, robots.txt and fetch state, last crawl time, the canonical chosen by Google and the one you declared, mobile usability and rich results verdicts, and a link to the full report. Google allows about 2,000 inspections per property per day.',
    readOnly: true,
    params: [
      site,
      { name: 'url', type: 'string', required: true, description: 'Absolute URL, or a path on the site (resolved against its domain).' },
    ],
  },
  {
    name: 'list_sitemaps',
    summary: 'Sitemaps known to Search Console, with status.',
    description:
      'Lists the sitemaps Search Console knows for the property, with last submitted and downloaded times, pending state, errors, warnings and submitted vs indexed counts. By default it reads the snapshot the sync takes once a day.',
    readOnly: true,
    params: [site, { name: 'live', type: 'boolean', description: '`true` refreshes the list from the Search Console API first.' }],
  },
  {
    name: 'submit_sitemap',
    summary: 'Submit a sitemap to Search Console. Off by default.',
    description:
      'The only tool that writes to an external system. It is not registered unless `ENABLE_WRITES` is `true`, and it needs the service account to have Full (not Restricted) permission on the GSC property. It is annotated as a write so MCP clients ask before running it.',
    readOnly: false,
    params: [site, { name: 'sitemapUrl', type: 'string', required: true, description: 'Absolute `https` URL of the sitemap.' }],
  },
  {
    name: 'setup_status',
    summary: 'Readiness, configuration and sync health in one call.',
    description:
      'Reports the readiness state with one line per check: the Access checks, configuration errors, which secrets are present (never their values), live probes of the Cloudflare token, Search Console and Bing, and the most recent sync. It also returns each site’s connected sources, the date range stored per dataset and recent sync runs. Agents call it to verify a deployment. Like every tool it is served only once the deployment is `ready`; before that, `/mcp` returns a JSON-RPC error naming the state, and the dashboard’s status page (`/api/status`) shows the readiness checks.',
    readOnly: true,
    params: [{ name: 'probe', type: 'boolean', description: 'Call the source APIs to verify credentials. Defaults to `true`.' }],
    example: 'Run setup_status and tell me what is still missing.',
  },
];

/** Tools registered by default; `submit_sitemap` appears only with `ENABLE_WRITES=true`. */
export const READ_ONLY_TOOLS = TOOLS.filter((t) => t.readOnly);

export interface Secret {
  name: string;
  required: 'yes' | 'for GSC' | 'for Bing' | 'optional';
  description: string;
  example?: string;
}

export const SECRETS: Secret[] = [
  {
    name: 'ACCESS_TEAM_DOMAIN',
    required: 'yes',
    description: 'Your Cloudflare Zero Trust team domain, hostname only. Used to fetch the signing keys for Access JWTs.',
    example: 'myteam.cloudflareaccess.com',
  },
  {
    name: 'ACCESS_AUD',
    required: 'yes',
    description: 'The Application Audience (AUD) tag of the Access application that protects Searchkeep.',
    example: '4714c1358e65fe4b408ad6d432a5f878f08194bdb4752441fd56faefa9b2b6f2',
  },
  {
    name: 'CLOUDFLARE_ACCOUNT_ID',
    required: 'yes',
    description: 'The Cloudflare account that owns the Worker, the Access application, the zones and the Web Analytics sites.',
    example: '023e105f4ecef8ad9ca31a8372d0c353',
  },
  {
    name: 'CLOUDFLARE_API_TOKEN',
    required: 'yes',
    description:
      'Read-only API token with Account Analytics Read, Zone Analytics Read and Access: Apps and Policies Read. Required even without Cloudflare data: Searchkeep uses it to check your Access setup.',
  },
  {
    name: 'SITES',
    required: 'yes',
    description: 'JSON array describing each site and the identifiers it has in every source.',
  },
  {
    name: 'GSC_CLIENT_EMAIL',
    required: 'for GSC',
    description: 'The `client_email` field of a Google Cloud service-account key.',
    example: 'searchkeep@my-project.iam.gserviceaccount.com',
  },
  {
    name: 'GSC_PRIVATE_KEY',
    required: 'for GSC',
    description: 'The `private_key` field of the same key, including the BEGIN/END lines. Real line breaks and literal `\\n` both work.',
  },
  {
    name: 'BING_API_KEY',
    required: 'for Bing',
    description: 'Bing Webmaster Tools API key. It can also submit URLs and remove sites, so treat it like a password.',
  },
  {
    name: 'BRAND_REGEX',
    required: 'optional',
    description: 'Default brand regex (JavaScript regex source, matched case-insensitively). A site’s `brandRegex` overrides it.',
    example: 'acme|acme\\s?corp',
  },
  {
    name: 'ENABLE_WRITES',
    required: 'optional',
    description: 'Set to `true` to register `submit_sitemap`. Requires Full permission in GSC.',
    example: 'true',
  },
  {
    name: 'GSC_ROWS_PER_DAY',
    required: 'optional',
    description:
      'Maximum query × page rows stored per day from Search Console (100–100,000). Defaults to `2500`. Higher values keep more of the long tail but cost more D1 writes and Worker CPU per sync.',
    example: '2500',
  },
  {
    name: 'GSC_BACKFILL_MONTHS',
    required: 'optional',
    description: 'How many months of Search Console history to backfill (0–16). Defaults to `16`.',
    example: '16',
  },
  {
    name: 'SYNC_DAILY_WRITE_BUDGET',
    required: 'optional',
    description:
      'Maximum rows the history backfill may write per UTC day; daily increments always run. Defaults to `80000`, below the D1 Free limit of 100,000 rows written per day.',
    example: '80000',
  },
  {
    name: 'SYNC_MAX_CALLS_PER_RUN',
    required: 'optional',
    description: 'Maximum outbound API calls per sync pass (5–900). Defaults to `20`, well within the Workers Free subrequest limit.',
    example: '20',
  },
];

export const SITE_FIELDS: { name: string; required: boolean; description: string }[] = [
  {
    name: 'id',
    required: false,
    description:
      'Short stable identifier used in tool calls and API URLs: lowercase letters, digits and dashes. Derived from the domain when omitted (`www.acme.com` becomes `acme-com`).',
  },
  { name: 'domain', required: true, description: 'Bare hostname, e.g. `acme.com` (no scheme, no path).' },
  {
    name: 'gscProperty',
    required: false,
    description: 'Search Console property: `sc-domain:acme.com` for a domain property, or `https://acme.com/` for a URL-prefix property.',
  },
  {
    name: 'bingSiteUrl',
    required: false,
    description: 'Site URL exactly as registered in Bing Webmaster Tools, e.g. `https://acme.com/`.',
  },
  { name: 'cloudflareZoneId', required: false, description: 'Zone ID of the proxied zone. Enables AI crawler data.' },
  {
    name: 'webAnalyticsSiteTag',
    required: false,
    description: 'Cloudflare Web Analytics site tag (not the snippet token). Enables AI referral visits and Web Vitals.',
  },
  { name: 'brandRegex', required: false, description: 'Brand regex for this site; overrides `BRAND_REGEX`.' },
];

export const SITES_EXAMPLE = `[
  {
    "id": "acme",
    "domain": "acme.com",
    "gscProperty": "sc-domain:acme.com",
    "bingSiteUrl": "https://acme.com/",
    "cloudflareZoneId": "023e105f4ecef8ad9ca31a8372d0c353",
    "webAnalyticsSiteTag": "abc123",
    "brandRegex": "acme"
  }
]`;

export interface ReadinessState {
  id: string;
  label: string;
  condition: string;
  dashboard: string;
  api: string;
  cron: string;
}

export const READINESS: ReadinessState[] = [
  {
    id: 'no_access',
    label: 'Not protected by Access',
    condition: 'The request has no valid `Cf-Access-Jwt-Assertion`, or `ACCESS_TEAM_DOMAIN` / `ACCESS_AUD` are not set.',
    dashboard: 'Every page shows the public setup guide.',
    api: '`/api/*` returns 403 with `"code":"locked","state":"no_access"`. `/mcp` returns a JSON-RPC error that explains the lock.',
    cron: 'Does not sync.',
  },
  {
    id: 'oauth_disabled',
    label: 'Managed OAuth off',
    condition:
      'The JWT is valid, but the Access application does not have Managed OAuth enabled, or Searchkeep cannot read the application with `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`.',
    dashboard: 'Status and setup checks only.',
    api: 'Refused with 403 (`/api/status` still answers). `/mcp` returns a JSON-RPC error.',
    cron: 'Does not sync.',
  },
  {
    id: 'policy_too_broad',
    label: 'Policy too broad',
    condition:
      'A policy lets in more than specific people: Everyone, a public email domain such as gmail.com, any identity-provider login, every IP, a whole country, Bypass or Service Auth.',
    dashboard: 'Status and setup checks only.',
    api: 'Refused with 403 (`/api/status` still answers). `/mcp` returns a JSON-RPC error.',
    cron: 'Does not sync.',
  },
  {
    id: 'ready',
    label: 'All checks pass',
    condition: 'All checks pass.',
    dashboard: 'Fully available.',
    api: 'Fully available.',
    cron: 'Syncs every 15 minutes, in small batches.',
  },
];

export const PRINCIPLES = [
  {
    title: 'Your data never leaves your account',
    body: 'Searchkeep runs as one Worker and one D1 database in your Cloudflare account. No telemetry, no vendor server, nothing phones home.',
  },
  {
    title: 'Read-only by default',
    body: 'Every tool reads. The single write, submitting a sitemap, stays unregistered until you set ENABLE_WRITES and grant Full permission.',
  },
  {
    title: 'Free-tier friendly',
    body: 'One Worker, one D1 database and a cron that syncs in small batches, paced to stay within Cloudflare’s free plans for typical sites.',
  },
  {
    title: 'Upgrade = Sync fork',
    body: 'Click “Sync fork” on GitHub. Workers Builds rebuilds and deploys, and the Worker applies new migrations itself. Your config lives in Secrets, so nothing conflicts.',
  },
];

export interface Faq {
  q: string;
  a: string;
}

export const FAQS: Faq[] = [
  {
    q: 'What is Searchkeep?',
    a: 'Searchkeep is open-source SEO and GEO (generative engine optimization) analytics that you deploy to your own Cloudflare account. It keeps syncing Google Search Console, Bing Webmaster Tools and Cloudflare data into a D1 database, then lets you explore it in a dashboard or ask about it from any MCP client such as Claude, Cursor or ChatGPT.',
  },
  {
    q: 'How much does it cost?',
    a: 'Searchkeep is free and MIT licensed. You pay only for the Cloudflare resources it uses: one Worker, one D1 database and a cron trigger, which fit within Cloudflare’s free plans for typical sites. The history backfill is paced to stay under D1’s free limit of 100,000 rows written per day. Cloudflare Access is part of Zero Trust, which has a free plan for small teams.',
  },
  {
    q: 'Does my data leave my Cloudflare account?',
    a: 'No. Searchkeep has no backend of its own and sends no telemetry. Data flows from Google, Bing and Cloudflare APIs into your D1 database and is served only to you, through Cloudflare Access. When you ask a question over MCP, the tool results go to the AI client you chose to connect, just like any other MCP server.',
  },
  {
    q: 'What is the GEO funnel?',
    a: 'It follows each page through three steps of AI visibility: Crawled (AI crawlers fetched it, from Cloudflare), Cited (an AI answer referenced it, from the Bing AI Performance report, which has no API yet, so you import its CSV export from the dashboard) and Clicked (people arrived from an AI assistant, from Web Analytics referrers, alongside classic GSC and Bing clicks). Gaps between steps tell you what to fix.',
  },
  {
    q: 'How far back does the history go?',
    a: 'After you deploy, Searchkeep backfills as much as Google provides, which is 16 months, one day at a time. On the free D1 write quota the full backfill takes days to weeks. It never deletes anything, so your history keeps growing past the point where Search Console forgets it. The earlier you deploy, the more you keep.',
  },
  {
    q: 'Why no backlinks, competitor data or rank tracking?',
    a: 'By design. Searchkeep only uses first-party data you already have access to for sites you own. Backlink indexes and rank trackers depend on large-scale crawling or SERP scraping, which needs a vendor and is outside the project’s charter. Pair Searchkeep with a dedicated tool if you need them.',
  },
  {
    q: 'Do I need a paid Cloudflare plan?',
    a: 'No. AI crawler data requires the site to be proxied through Cloudflare (orange-clouded), which works on the free plan; Searchkeep identifies crawlers by user agent. AI referrals come from Web Analytics referrer hosts. Workers Free allows 10 ms of CPU per invocation, so the sync works in small batches; if sync units keep getting skipped, lower GSC_ROWS_PER_DAY or move to Workers Paid.',
  },
  {
    q: 'Can an AI agent deploy it for me?',
    a: 'Yes. The deploy guide is written as an idempotent runbook with a verification for every step. An agent with GitHub and Cloudflare MCP access can fork the repo, create the Worker, configure Access and set Secrets. A few steps need a human: authorizing the Cloudflare GitHub App, creating the Zero Trust organization, adding the service account in Search Console, generating the Bing API key and signing in through Access.',
  },
  {
    q: 'Which AI clients can connect?',
    a: 'Any MCP client that supports Streamable HTTP with OAuth, including Claude, Claude Code, Cursor and ChatGPT. Cloudflare Access acts as the OAuth server with dynamic client registration and PKCE, so there is no client ID to paste: the client opens a browser, you sign in, and it is connected.',
  },
  {
    q: 'How do I upgrade?',
    a: 'Open your fork on GitHub and click “Sync fork”. Workers Builds notices the new commit, builds and deploys, and the Worker applies any new D1 migrations itself on its next request. Your configuration lives in Worker Secrets, never in the repo, so upstream changes do not conflict with it.',
  },
];
