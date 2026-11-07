import {
  AGENT_PREREQS,
  AGENT_PROMPT,
  FAQS,
  PRINCIPLES,
  READ_ONLY_TOOLS,
  READINESS,
  SECRETS,
  SITE_FIELDS,
  SITES_EXAMPLE,
  TOOLS,
} from './content';
import { DOCS } from './docs';
import { GITHUB, SITE, absolute } from './site';

const plain = (s: string) => s.replace(/\s+/g, ' ').trim();

export function llmsTxt(): string {
  const sections = DOCS.map(
    (s) => `## ${s.title}\n\n` + s.pages.map((p) => `- [${p.title}](${absolute(p.path)}): ${p.description}`).join('\n'),
  ).join('\n\n');

  return `# ${SITE.name}

> ${SITE.description}

Searchkeep is open source (MIT) and self-hosted: one Cloudflare Worker plus one D1 database in the user's own Cloudflare account. It analyzes only the user's own sites using first-party data (Google Search Console, Bing Webmaster Tools, Cloudflare AI and search engine crawler traffic and Web Analytics). It exposes an MCP server at \`https://<your-domain>/mcp\` with ${READ_ONLY_TOOLS.length} read-only tools (plus \`submit_sitemap\`, registered only when writes are enabled) and a dashboard. It does not do backlinks, competitor research or rank tracking, by design. There is no hosted version and no telemetry.

- Website: ${SITE.origin}/
- Source code: ${GITHUB.repo}
- Current version: v${SITE.version} (released ${SITE.releaseDate})
- Full documentation in one file: ${SITE.origin}/llms-full.txt

${sections}

## Optional

- [Changelog](${absolute('/changelog')}): Release notes and upgrade notes.
- [Privacy](${absolute('/privacy')}): The website sets no cookies and uses no trackers; the product sends no telemetry.
- [GitHub repository](${GITHUB.repo}): Source, issues, AGENTS.md and docs/deploy.md (the agent-executable deploy runbook).
`;
}

export function llmsFullTxt(): string {
  const tools = TOOLS.map((t) => {
    const params = t.params.length
      ? t.params.map((p) => `  - \`${p.name}\` (${p.type}${p.required ? ', required' : ''}): ${plain(p.description)}`).join('\n')
      : '  - No parameters.';
    return `### ${t.name}${t.readOnly ? '' : ' (write, off by default)'}\n\n${plain(t.description)}\n\nParameters:\n${params}`;
  }).join('\n\n');

  const secrets = SECRETS.map(
    (s) => `| \`${s.name}\` | ${s.required} | ${plain(s.description)}${s.example ? ` Example: \`${s.example}\`.` : ''} |`,
  ).join('\n');

  const fields = SITE_FIELDS.map((f) => `| \`${f.name}\` | ${f.required ? 'yes' : 'no'} | ${plain(f.description)} |`).join('\n');

  const readiness = READINESS.map(
    (r, i) =>
      `${i + 1}. \`${r.id}\` (${r.label}): ${plain(r.condition)} Dashboard: ${plain(r.dashboard)} MCP and /api: ${plain(r.api)} Cron: ${r.cron}`,
  ).join('\n');

  const faqs = FAQS.map((f) => `### ${f.q}\n\n${f.a}`).join('\n\n');
  const principles = PRINCIPLES.map((p) => `- **${p.title}.** ${p.body}`).join('\n');

  return `# ${SITE.name}: full documentation

> ${SITE.description}

Source: ${GITHUB.repo} · Website: ${SITE.origin}/ · License: MIT · Version: v${SITE.version} (${SITE.releaseDate})

## Introduction

Searchkeep is open-source SEO and GEO (generative engine optimization) analytics that you run in your own Cloudflare account, as one Worker and one D1 database. A cron trigger runs every 15 minutes; each pass does only the sync work that is due, within call, time and write budgets, and resumes on the next pass. It brings first-party data from Google Search Console, Bing Webmaster Tools and Cloudflare (AI crawler requests, Web Analytics and Web Vitals) up to date once a day and backfills Search Console history. Two front doors share one data layer: an MCP server for asking (Claude, Claude Code, Cursor, ChatGPT and other MCP clients) and a dashboard for looking.

Core features:

- The GEO funnel, per page: Crawled (Cloudflare AI crawler requests) → Cited (Bing AI Performance citations, imported from its CSV export because it has no API) → Clicked (Web Analytics referrals from AI assistants, alongside GSC and Bing clicks).
- Long-term history: after deploying, Searchkeep backfills the 16 months Search Console keeps, up to 30 days per request (hours for a small site, days for sites with a lot of data on the free D1 write quota); data is never deleted.
- Read-only by default; the only write (\`submit_sitemap\`) requires \`ENABLE_WRITES=true\` and Full GSC permission.
- Secure by default: Cloudflare Access in front, Managed OAuth for MCP clients, Access JWT re-verified on every request, locked until ready.
- Agent-friendly: the deploy guide is an idempotent runbook with verification steps.

Not doing, by design: backlinks, competitor data, rank tracking or SERP scraping.

Principles:

${principles}

## Deploy

Deploying with an AI agent requires ${AGENT_PREREQS.map((p) => `${p.title} (${p.text.charAt(0).toLowerCase()}${p.text.slice(1).replace(/\.$/, '')})`).join(' and ')}. The prompt a person pastes into their agent:

\`\`\`text
${AGENT_PROMPT}
\`\`\`

Deployment is fork + Cloudflare Workers Builds (no Deploy button). The agent-executable runbook with every click path, API call and verification is ${GITHUB.deployRunbook}. Steps:

1. Fork ${GITHUB.repo} (an agent can use the GitHub MCP server). Verify: \`gh repo view <you>/searchkeep --json parent --jq .parent.nameWithOwner\` prints \`noobnooc/searchkeep\`.
2. Human, once: authorize the Cloudflare GitHub App for the fork (Workers & Pages → Create application → Import a repository).
3. Create the Worker with Workers Builds: project name \`searchkeep\`, root directory \`apps/cloudflare\`, build command \`pnpm run build\`, deploy command \`pnpm run deploy\`, build watch paths \`apps/cloudflare/*\`, \`packages/*\` and \`pnpm-lock.yaml\`. The deploy command tries remote D1 migrations, deploys, retries the migrations and never fails on them. The default build token has no D1 permission, so remote migrations are normally skipped and the Worker applies pending migrations itself on its first request (same \`d1_migrations\` table). Adding "D1 Edit" to the build token is optional.
4. The first build auto-provisions the D1 database \`searchkeep\` (binding \`DB\`; no database_id in the repo).
5. Add a custom domain (e.g. \`searchkeep.example.com\`) and make sure the workers.dev route and Preview URLs are off (\`wrangler.jsonc\` sets \`workers_dev: false\` and \`preview_urls: false\` and declares no routes). Verify: \`GET /healthz\` returns \`{"ok":true}\`; without Access, \`/\` shows the public "Searchkeep is locked" setup page, \`/api/*\` returns 403 \`{"code":"locked","state":"no_access",...}\` and \`/mcp\` returns a JSON-RPC error (code -32001) explaining the lock.
6. Cloudflare Zero Trust: create the Zero Trust organization (human, first time only); create a self-hosted Access application for the whole custom domain with one Allow policy that includes only specific emails; enable Managed OAuth (dynamic client registration, allow localhost and loopback clients); save the team domain (hostname only) and the application's AUD tag as the secrets \`ACCESS_TEAM_DOMAIN\` and \`ACCESS_AUD\`. Verify: \`/healthz\` now answers 302 or 401 (never 200), and \`/mcp\` answers 401 with a \`www-authenticate\` header.
7. Credentials: create a read-only Cloudflare API token (human recommended) and set \`CLOUDFLARE_ACCOUNT_ID\` and \`CLOUDFLARE_API_TOKEN\` (required: Searchkeep uses the token to check the Access setup); add sites in the dashboard (or set the optional \`SITES\` secret); create a GSC service account (human in Google Cloud, or an agent with gcloud) and add its email as a Restricted user in each Search Console property (always human); generate a Bing Webmaster Tools API key (human). Store everything with \`npx wrangler secret put NAME --name searchkeep\`.
8. Verify: connect an MCP client (it lists ${READ_ONLY_TOOLS.length} tools, ${TOOLS.length} with \`ENABLE_WRITES=true\`) and call \`setup_status\`, or open the dashboard; it must report \`ready\`. The first authenticated request that sees \`ready\` records a ready flag in D1; from then on the cron (every 15 minutes) syncs, re-checking Access on each pass. Start the first sync right away with "Sync now" in the dashboard's Settings or \`POST /api/sync\`. Daily increments come first; the 16-month GSC backfill then takes a few hours for a small site, and days for sites with a lot of data on the free D1 write quota.

Example commands:

\`\`\`bash
npx wrangler secret put ACCESS_TEAM_DOMAIN --name searchkeep
npx wrangler secret put ACCESS_AUD --name searchkeep
npx wrangler secret put CLOUDFLARE_ACCOUNT_ID --name searchkeep
npx wrangler secret put CLOUDFLARE_API_TOKEN --name searchkeep
jq -r .client_email searchkeep-key.json | npx wrangler secret put GSC_CLIENT_EMAIL --name searchkeep
jq -r .private_key searchkeep-key.json | npx wrangler secret put GSC_PRIVATE_KEY --name searchkeep
npx wrangler secret put BING_API_KEY --name searchkeep
npx wrangler secret put SITES --name searchkeep < sites.json
\`\`\`

Cloudflare API token permissions: Account Analytics Read, Zone Analytics Read, Access: Apps and Policies Read.

Local development (contributors): \`cp apps/cloudflare/.dev.vars.example apps/cloudflare/.dev.vars && pnpm dev\`, then \`curl -X POST localhost:8787/api/dev/seed\` for demo data. Dev mode skips Access only for requests to localhost.

## Configuration

All configuration is stored as Worker Secrets; nothing is in the repository. \`keep_vars: true\` keeps dashboard variables across deploys.

| Name | Required | Description |
|---|---|---|
${secrets}

\`SITES\` is a JSON array:

\`\`\`json
${SITES_EXAMPLE}
\`\`\`

| Field | Required | Description |
|---|---|---|
${fields}

## MCP server

Endpoint: \`https://<your-domain>/mcp\`, Streamable HTTP, stateless. Authentication is OAuth 2.1 via Cloudflare Access Managed OAuth (discovery, dynamic client registration, PKCE); no client ID needs to be pasted.

- Claude: Settings → Connectors → Add custom connector → enter the /mcp URL → Connect and sign in to Access.
- Claude Code: \`claude mcp add --transport http searchkeep https://searchkeep.example.com/mcp\`, then \`/mcp\` to authenticate.
- Cursor: add \`{"mcpServers":{"searchkeep":{"url":"https://searchkeep.example.com/mcp"}}}\` to \`~/.cursor/mcp.json\`.
- ChatGPT: enable developer mode for connectors and create a connector with the /mcp URL and OAuth.
- stdio-only clients: \`npx -y mcp-remote https://searchkeep.example.com/mcp\`.

Common parameters (camelCase): \`site\` (site id or domain; optional with one site), \`start\` and \`end\` (YYYY-MM-DD, UTC; \`end\` defaults to the latest day with data), \`days\` (window length when \`start\` is omitted; default 28, 7 for ai_crawlers), \`source\` ("gsc" | "bing"; default "gsc"), \`brand\` ("all" | "brand" | "non_brand"; default "all"), \`limit\` (at most 500). \`submit_sitemap\` is registered only when \`ENABLE_WRITES\` is \`true\`. Errors are returned as \`{"error": "..."}\`.

${tools}

## Data sources

Sync: the cron runs every 15 minutes. Each pass does only what is due within its budgets (\`SYNC_MAX_CALLS_PER_RUN\`, default 35 API calls, within Workers Free's 50 outbound requests per invocation; a time budget; \`SYNC_DAILY_WRITE_BUDGET\`, default 80,000 backfill rows per UTC day, under D1 Free's 100,000 rows written per day) and resumes on the next pass. One request covers many days: up to 30 days of Search Console, 30 days of AI crawler requests or 90 days of Web Analytics, with one row per day; a range with too many rows, or one the API refuses, is split into shorter ranges down to single days. The latest days run first, round-robin over sites: GSC re-pulls the last 4 days and fills gaps up to 30 days; Bing is pulled in full daily; Cloudflare adds each missing day (a new site starts with yesterday). Then history runs for all sites at once, newest day first: GSC back 16 months (\`GSC_BACKFILL_MONTHS\`), Cloudflare AI crawler data back 30 days and Web Analytics back 90 days; hours for a small site, days for sites with a lot of data on the free D1 write quota. A source that rate-limits Searchkeep is paused for every site with a growing backoff (30 minutes to 8 hours) while the other sources continue; Bing often answers Workers with ThrottleIP (code 17), a throttle on the shared egress IPs of Workers that can last days and that a new API key does not fix, so Searchkeep then sends that run's Bing calls through Cloudflare Browser Run (the BROWSER binding), whose IPs Bing accepts; "Sync now" retries a paused source once; Bing calls are spaced out and capped at 8 per pass. A failed task is retried after 10 minutes, doubling up to 6 hours; "Sync now" retries right away. Progress per site and dataset: the dashboard (a banner and Settings → Sync progress), \`GET /api/sync-progress\`, and \`setup_status\` → \`syncProgress\`. A unit interrupted 3 times (for example by the 10 ms CPU limit of Workers Free) is skipped; if that keeps happening, lower \`GSC_ROWS_PER_DAY\` or use Workers Paid. Manual pass: "Sync now" in the dashboard or \`POST /api/sync\`.

- Google Search Console: service account with the webmasters.readonly scope, added as a Restricted user. Pulls Search Analytics per day (site totals, country × device totals, and up to \`GSC_ROWS_PER_DAY\` query × page rows, default 2,500), a daily sitemap snapshot and live URL Inspection. Limitations: only 16 months of history; anonymized (rare) queries are hidden, so query rows sum to less than site totals; at most 25,000 rows per request; data lags 2–3 days, so each sync re-pulls the last 4 days; URL Inspection is limited to about 2,000 calls per property per day. Domain properties are written \`sc-domain:example.com\`.
- Bing Webmaster Tools: API key (one per user; it can also submit URLs and remove sites, so treat it as a password). Pulls traffic totals, query stats, page stats and crawl issues. Limitations: no date parameter, every call returns all data aggregated by week, so Searchkeep pulls it in full and upserts by week; queries against Bing data align date ranges to whole Monday–Sunday weeks; no query × page, country or device data.
- Bing AI Performance (the Cited step): it has no API (public preview since February 2026; Microsoft says an API is on its backlog). Import its CSV export from the dashboard (Settings → Import AI citations) or with \`POST /api/import/ai-citations?site=<id>&date=<YYYY-MM-DD>\` and the CSV as the body. Columns are detected by name (URL or page, citations, optional date).
- Cloudflare: read-only API token. Pulls AI crawler requests by crawler, path and status code (crawlers identified by user agent and classified by operator and purpose: training, search, user) and Web Analytics page views, referrer hosts and Core Web Vitals. Limitations: AI crawler data requires the zone to be proxied through Cloudflare; GraphQL keeps at least 31 days of HTTP request data and about 6 months of Web Analytics, so days that expired before you deployed cannot be recovered; accounts using the EU data localization boundary get no Web Analytics (RUM) data through the API.

## Security

- A self-hosted Cloudflare Access application protects the whole hostname; the policy should allow only specific emails.
- Managed OAuth makes Access a full OAuth 2.1 server for MCP clients.
- The Worker verifies the \`Cf-Access-Jwt-Assertion\` JWT on every request (signature via the team domain's JWKS, iss, aud, exp). The team domain and AUD come only from Secrets and are never learned from traffic.
- Public endpoints: \`/setup\` (generic guide, no data), \`/healthz\` (returns only {"ok":true}) and \`/robots.txt\`. Without a valid JWT, every other page shows the setup guide, \`/api/*\` returns 403 and \`/mcp\` returns a JSON-RPC error.
- The cron syncs only after a \`ready\` flag has been recorded in D1 by an authenticated request; an authenticated request that sees a failing check clears it, and every cron pass re-reads the Access application through the API and clears the flag if Access was turned off or loosened.

Readiness states:

${readiness}

## Architecture

One Worker (\`searchkeep\`, Hono) with three entrances: MCP (/mcp), Dashboard (/ and /api/*) and Cron (scheduled every 15 minutes → core runSync()). JSON API routes: /api/status, /api/sites, /api/site-icon (the site's own icon, read from the site itself), /api/overview, /api/performance, /api/compare, /api/quick-wins, /api/cannibalization, /api/ctr-anomalies, /api/content-decay, /api/geo-funnel, /api/ai-crawlers, /api/ai-referrals, /api/web-vitals, /api/crawl-issues, /api/sitemaps, POST /api/inspect, /api/setup-status, /api/sync-progress, /api/sync-runs, POST /api/sync and POST /api/import/ai-citations. All call @searchkeep/core, which uses the Store interface (implemented by @searchkeep/store-d1 with Drizzle and D1) and Source adapters (@searchkeep/source-gsc, @searchkeep/source-bing, @searchkeep/source-cloudflare). Core uses only Web-standard APIs. No Durable Objects. Extension points: Store (future Postgres), Auth (any OIDC proxy), scheduler, runtime entry (future Node/Docker, Vercel), sources, configuration.

## Upgrading

Click "Sync fork" on GitHub (or \`gh repo sync <you>/searchkeep --source noobnooc/searchkeep --branch main\`). Workers Builds rebuilds and deploys when the watch paths changed, and the Worker applies new D1 migrations itself on its first request. Configuration lives in Secrets, so there are no merge conflicts. Migrations are forward-only. Releases that need manual steps list them under "Upgrade notes" in the changelog.

## FAQ

${faqs}
`;
}
