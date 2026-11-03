/**
 * Product facts shared by the landing page, the docs, JSON-LD and llms.txt.
 * Keep these in sync with packages/mcp and apps/cloudflare.
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
  description: 'Site `id` from `SITES`. Optional when exactly one site is configured.',
};
const startDate: ToolParam = {
  name: 'start_date',
  type: 'YYYY-MM-DD',
  description: 'First day of the range (UTC). Defaults to 28 days before `end_date`.',
};
const endDate: ToolParam = {
  name: 'end_date',
  type: 'YYYY-MM-DD',
  description: 'Last day of the range (UTC). Defaults to the latest day with complete data.',
};
const source: ToolParam = {
  name: 'source',
  type: '"gsc" | "bing"',
  description: 'Search engine to read from. Defaults to `gsc`.',
};
const brand: ToolParam = {
  name: 'brand',
  type: '"all" | "brand" | "non_brand"',
  description: 'Split queries by the brand regex (`BRAND_REGEX` or the site’s `brandRegex`). Defaults to `all`.',
};
const limit = (def: number): ToolParam => ({
  name: 'limit',
  type: 'number',
  description: `Maximum rows returned. Defaults to ${def}.`,
});

export const TOOLS: Tool[] = [
  {
    name: 'list_sites',
    summary: 'Configured sites and the status of each data source.',
    description:
      'Lists every site in `SITES` with the sources connected for it (GSC, Bing, Cloudflare AI crawlers, Web Analytics), the date range of data stored in D1, and the time of the last successful sync per source.',
    readOnly: true,
    params: [],
    example: 'Which sites are connected, and when did each source last sync?',
  },
  {
    name: 'query_performance',
    summary: 'Clicks, impressions, CTR and position by any dimension.',
    description:
      'The general-purpose search analytics query. Groups by one or more dimensions and filters by query, page, country or device. Reads the history stored in D1, so ranges older than 16 months work once you have kept them.',
    readOnly: true,
    params: [
      site,
      startDate,
      endDate,
      source,
      {
        name: 'dimensions',
        type: 'Array<"date" | "week" | "month" | "query" | "page" | "country" | "device">',
        description: 'Group-by dimensions. Defaults to `["query"]`.',
      },
      {
        name: 'query_contains',
        type: 'string',
        description: 'Case-insensitive substring filter on the query text.',
      },
      {
        name: 'page_contains',
        type: 'string',
        description: 'Case-insensitive substring filter on the page path.',
      },
      { name: 'country', type: 'string', description: 'ISO 3166-1 alpha-3 country code, as GSC reports it (e.g. `usa`).' },
      { name: 'device', type: '"desktop" | "mobile" | "tablet"', description: 'Device filter.' },
      brand,
      {
        name: 'order_by',
        type: '"clicks" | "impressions" | "ctr" | "position"',
        description: 'Sort key, descending (ascending for position). Defaults to `clicks`.',
      },
      limit(50),
    ],
    example: 'Top non-brand queries for /pricing over the last 90 days, by week.',
  },
  {
    name: 'compare_periods',
    summary: 'What moved between two periods, and by how much.',
    description:
      'Compares two date ranges and returns the queries or pages with the largest gains and losses in clicks, with impressions, CTR and position deltas. The previous period defaults to the same length immediately before the current one.',
    readOnly: true,
    params: [
      site,
      { name: 'current_start', type: 'YYYY-MM-DD', required: true, description: 'Start of the current period.' },
      { name: 'current_end', type: 'YYYY-MM-DD', required: true, description: 'End of the current period.' },
      { name: 'previous_start', type: 'YYYY-MM-DD', description: 'Start of the comparison period.' },
      { name: 'previous_end', type: 'YYYY-MM-DD', description: 'End of the comparison period.' },
      { name: 'dimension', type: '"query" | "page"', description: 'What to compare. Defaults to `page`.' },
      source,
      brand,
      limit(25),
    ],
    example: 'What dropped the most this month compared to the same month last year?',
  },
  {
    name: 'find_quick_wins',
    summary: 'High-impression queries ranking just off page one.',
    description:
      'Finds queries with an average position between 8 and 20 and enough impressions to matter, together with the page that ranks for each. These are usually the cheapest traffic to win.',
    readOnly: true,
    params: [
      site,
      startDate,
      endDate,
      source,
      { name: 'min_position', type: 'number', description: 'Lower bound of average position. Defaults to 8.' },
      { name: 'max_position', type: 'number', description: 'Upper bound of average position. Defaults to 20.' },
      { name: 'min_impressions', type: 'number', description: 'Ignore queries below this. Defaults to 100.' },
      brand,
      limit(25),
    ],
  },
  {
    name: 'find_cannibalization',
    summary: 'Queries where several of your pages compete.',
    description:
      'Finds queries for which two or more of your pages receive meaningful impressions, with each page’s share of clicks and its average position, so you can consolidate or differentiate them.',
    readOnly: true,
    params: [
      site,
      startDate,
      endDate,
      source,
      { name: 'min_impressions', type: 'number', description: 'Minimum impressions per query. Defaults to 100.' },
      brand,
      limit(25),
    ],
  },
  {
    name: 'find_ctr_anomalies',
    summary: 'Queries with a CTR well below what their position predicts.',
    description:
      'Builds your site’s own CTR-by-position curve and returns the queries that sit furthest below it. Typical causes: a weak title or description, a rich result taking the click, or a mismatch with search intent.',
    readOnly: true,
    params: [
      site,
      startDate,
      endDate,
      source,
      { name: 'min_impressions', type: 'number', description: 'Minimum impressions per query. Defaults to 200.' },
      brand,
      limit(25),
    ],
  },
  {
    name: 'find_content_decay',
    summary: 'Pages whose clicks have been sliding for weeks.',
    description:
      'Fits a trend to each page’s weekly clicks and returns the pages with a sustained decline (not a single bad week), with peak clicks, current clicks and the queries that account for most of the loss.',
    readOnly: true,
    params: [
      site,
      { name: 'weeks', type: 'number', description: 'Trailing window to analyse. Defaults to 12.' },
      { name: 'min_clicks', type: 'number', description: 'Ignore pages below this many clicks at their peak. Defaults to 50.' },
      source,
      limit(25),
    ],
  },
  {
    name: 'geo_funnel',
    summary: 'Crawled → Cited → Clicked, per page.',
    description:
      'Joins AI crawler requests (Cloudflare), AI citations (Bing AI Performance, where available) and visits referred by AI assistants (Web Analytics), alongside GSC and Bing clicks, for each page. Use it to spot pages that AI crawlers read but never cite, or that get cited but never clicked.',
    readOnly: true,
    params: [
      site,
      startDate,
      endDate,
      { name: 'page_contains', type: 'string', description: 'Case-insensitive substring filter on the page path.' },
      {
        name: 'stage',
        type: '"all" | "crawled_not_cited" | "cited_not_clicked"',
        description: 'Return only pages that stall at a given step. Defaults to `all`.',
      },
      {
        name: 'order_by',
        type: '"crawled" | "cited" | "clicked"',
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
      'Summarises requests from known AI crawlers and assistants (GPTBot, ClaudeBot, PerplexityBot, OAI-SearchBot and others), classified by operator and purpose (`training`, `search`, `user`). Includes HTTP status, so blocked or failing fetches stand out.',
    readOnly: true,
    params: [
      site,
      startDate,
      endDate,
      {
        name: 'group_by',
        type: 'Array<"crawler" | "operator" | "purpose" | "path" | "status" | "date">',
        description: 'Group-by dimensions. Defaults to `["crawler"]`.',
      },
      { name: 'crawler', type: 'string', description: 'Only this crawler, e.g. `GPTBot`.' },
      { name: 'purpose', type: '"training" | "search" | "user" | "other"', description: 'Only crawlers with this purpose.' },
      { name: 'path_contains', type: 'string', description: 'Case-insensitive substring filter on the path.' },
      limit(50),
    ],
    example: 'Are any AI crawlers getting 4xx or 5xx responses from us?',
  },
  {
    name: 'inspect_url',
    summary: 'Live Google URL Inspection for one URL.',
    description:
      'Calls the Search Console URL Inspection API in real time: index status, coverage state, last crawl time, canonical chosen by Google, mobile usability and rich results. Google allows about 2,000 inspections per property per day.',
    readOnly: true,
    params: [site, { name: 'url', type: 'string', required: true, description: 'Absolute URL on the site to inspect.' }],
  },
  {
    name: 'list_sitemaps',
    summary: 'Sitemaps known to Search Console and Bing, with status.',
    description:
      'Lists submitted sitemaps with last submitted and downloaded times, pending state, errors, warnings and submitted vs indexed counts.',
    readOnly: true,
    params: [site, { name: 'source', type: '"gsc" | "bing"', description: 'Defaults to `gsc`.' }],
  },
  {
    name: 'submit_sitemap',
    summary: 'Submit a sitemap to Search Console. Off by default.',
    description:
      'The only tool that writes to an external system. It is not registered unless `ENABLE_WRITES` is `true`, and it needs the service account to have Full (not Restricted) permission on the GSC property. It is annotated as a write so MCP clients ask before running it.',
    readOnly: false,
    params: [site, { name: 'sitemap_url', type: 'string', required: true, description: 'Absolute URL of the sitemap.' }],
  },
  {
    name: 'setup_status',
    summary: 'Readiness, configuration and sync health in one call.',
    description:
      'Reports the readiness state (`no_access`, `oauth_disabled`, `policy_too_broad`, `ready`), which secrets are present (never their values), per-site source checks, the last sync per source and backfill progress. Agents call it to verify a deployment.',
    readOnly: true,
    params: [],
    example: 'Run setup_status and tell me what is still missing.',
  },
];

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
    description: 'Your Cloudflare Zero Trust team domain. Used to fetch the signing keys for Access JWTs.',
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
    description: 'The Cloudflare account that owns the Worker, the zones and the Web Analytics sites.',
    example: '023e105f4ecef8ad9ca31a8372d0c353',
  },
  {
    name: 'CLOUDFLARE_API_TOKEN',
    required: 'yes',
    description: 'API token with Account Analytics Read, Zone Analytics Read and Access: Apps and Policies Read. Read-only.',
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
    description: 'The `private_key` field of the same key, including the BEGIN/END lines.',
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
];

export const SITE_FIELDS: { name: string; required: boolean; description: string }[] = [
  { name: 'id', required: true, description: 'Short stable identifier used in tool calls and URLs. Lowercase letters, digits and dashes.' },
  { name: 'domain', required: true, description: 'Bare hostname, e.g. `acme.com`.' },
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
    description: 'Cloudflare Web Analytics site tag. Enables page views, AI referrers and Web Vitals.',
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
    dashboard: 'Only the public `/setup` guide.',
    api: '`/api` returns 403. `/mcp` returns an error that explains what to do.',
    cron: 'Does not sync.',
  },
  {
    id: 'oauth_disabled',
    label: 'Managed OAuth off',
    condition: 'The JWT is valid, but the Access application does not have Managed OAuth enabled.',
    dashboard: 'Only an “Enable Managed OAuth” prompt.',
    api: 'Refused.',
    cron: 'Does not sync.',
  },
  {
    id: 'policy_too_broad',
    label: 'Policy too broad',
    condition: 'An Allow policy admits everyone, or a public email domain such as gmail.com.',
    dashboard: 'Only a “Tighten your policy” prompt.',
    api: 'Refused.',
    cron: 'Does not sync.',
  },
  {
    id: 'ready',
    label: 'All checks pass',
    condition: 'All checks pass.',
    dashboard: 'Fully available.',
    api: 'Fully available.',
    cron: 'Syncs daily at 03:17 UTC.',
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
    body: 'One Worker, one D1 database and a daily cron. Sized to run comfortably on Cloudflare’s free plans for typical sites.',
  },
  {
    title: 'Upgrade = Sync fork',
    body: 'Click “Sync fork” on GitHub. Workers Builds rebuilds, applies migrations and deploys. Your config lives in Secrets, so nothing conflicts.',
  },
];

export interface Faq {
  q: string;
  a: string;
}

export const FAQS: Faq[] = [
  {
    q: 'What is Searchkeep?',
    a: 'Searchkeep is open-source SEO and GEO (generative engine optimization) analytics that you deploy to your own Cloudflare account. It syncs Google Search Console, Bing Webmaster Tools and Cloudflare data into a D1 database every day, then lets you explore it in a dashboard or ask about it from any MCP client such as Claude, Cursor or ChatGPT.',
  },
  {
    q: 'How much does it cost?',
    a: 'Searchkeep is free and MIT licensed. You pay only for the Cloudflare resources it uses: one Worker, one D1 database and a daily cron, which fit within Cloudflare’s free plans for typical sites. Cloudflare Access is part of Zero Trust, which has a free plan for small teams.',
  },
  {
    q: 'Does my data leave my Cloudflare account?',
    a: 'No. Searchkeep has no backend of its own and sends no telemetry. Data flows from Google, Bing and Cloudflare APIs into your D1 database and is served only to you, through Cloudflare Access. When you ask a question over MCP, the tool results go to the AI client you chose to connect, just like any other MCP server.',
  },
  {
    q: 'What is the GEO funnel?',
    a: 'It follows each page through three steps of AI visibility: Crawled (AI crawlers fetched it, from Cloudflare), Cited (an AI answer referenced it, from Bing AI Performance where the API makes it available) and Clicked (people arrived from an AI assistant, from Web Analytics referrers, alongside classic GSC and Bing clicks). Gaps between steps tell you what to fix.',
  },
  {
    q: 'How far back does the history go?',
    a: 'On first sync Searchkeep backfills as much as Google provides, which is 16 months. From then on it syncs daily and never deletes, so your history keeps growing past the point where Search Console forgets it. The earlier you deploy, the more you keep.',
  },
  {
    q: 'Why no backlinks, competitor data or rank tracking?',
    a: 'By design. Searchkeep only uses first-party data you already have access to for sites you own. Backlink indexes and rank trackers depend on large-scale crawling or SERP scraping, which needs a vendor and is outside the project’s charter. Pair Searchkeep with a dedicated tool if you need them.',
  },
  {
    q: 'Do I need a paid Cloudflare plan?',
    a: 'No. AI crawler data requires the site to be proxied through Cloudflare (orange-clouded), which works on the free plan. Cloudflare’s own AI referral reports are a paid feature, so Searchkeep derives AI referrals from Web Analytics referrer hosts instead.',
  },
  {
    q: 'Can an AI agent deploy it for me?',
    a: 'Yes. The deploy guide is written as an idempotent runbook with a verification for every step. An agent with GitHub and Cloudflare MCP access can fork the repo, create the Worker, configure Access and set Secrets. A few steps need a human once: authorizing the Cloudflare GitHub App, creating the Zero Trust organization and adding the service account in Search Console.',
  },
  {
    q: 'Which AI clients can connect?',
    a: 'Any MCP client that supports Streamable HTTP with OAuth, including Claude, Claude Code, Cursor and ChatGPT. Cloudflare Access acts as the OAuth server with dynamic client registration and PKCE, so there is no client ID to paste: the client opens a browser, you sign in, and it is connected.',
  },
  {
    q: 'How do I upgrade?',
    a: 'Open your fork on GitHub and click “Sync fork”. Workers Builds notices the new commit, builds, applies any new D1 migrations and deploys. Your configuration lives in Worker Secrets, never in the repo, so upstream changes do not conflict with it.',
  },
];
