import { FAQS, PRINCIPLES, READINESS, SECRETS, SITE_FIELDS, SITES_EXAMPLE, TOOLS } from './content';
import { DOCS } from './docs';
import { GITHUB, SITE, absolute } from './site';

const plain = (s: string) => s.replace(/\s+/g, ' ').trim();

export function llmsTxt(): string {
  const sections = DOCS.map(
    (s) => `## ${s.title}\n\n` + s.pages.map((p) => `- [${p.title}](${absolute(p.path)}): ${p.description}`).join('\n'),
  ).join('\n\n');

  return `# ${SITE.name}

> ${SITE.description}

Searchkeep is open source (MIT) and self-hosted: one Cloudflare Worker plus one D1 database in the user's own Cloudflare account. It analyzes only the user's own sites using first-party data (Google Search Console, Bing Webmaster Tools, Cloudflare AI crawler traffic and Web Analytics). It exposes an MCP server at \`https://<your-domain>/mcp\` with ${TOOLS.length} tools and a dashboard. It does not do backlinks, competitor research or rank tracking, by design. There is no hosted version and no telemetry.

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

Searchkeep is open-source SEO and GEO (generative engine optimization) analytics that you run in your own Cloudflare account, as one Worker and one D1 database. A daily cron (03:17 UTC) syncs first-party data from Google Search Console, Bing Webmaster Tools and Cloudflare (AI crawler requests and Web Analytics) into D1. Two front doors share one data layer: an MCP server for asking (Claude, Claude Code, Cursor, ChatGPT and other MCP clients) and a dashboard for looking.

Core features:

- The GEO funnel, per page: Crawled (Cloudflare AI crawler requests) → Cited (Bing AI Performance, where its API makes data available) → Clicked (Web Analytics referrals from AI assistants, alongside GSC and Bing clicks).
- Long-term history: the first sync backfills the 16 months Search Console keeps; data is never deleted afterwards.
- Read-only by default; the only write (\`submit_sitemap\`) requires \`ENABLE_WRITES=true\` and Full GSC permission.
- Secure by default: Cloudflare Access in front, Managed OAuth for MCP clients, Access JWT re-verified on every request, locked until ready.
- Agent-friendly: the deploy guide is an idempotent runbook with verification steps.

Not doing, by design: backlinks, competitor data, rank tracking or SERP scraping.

Principles:

${principles}

## Deploy

Deployment is fork + Cloudflare Workers Builds (no Deploy button). Steps:

1. Fork ${GITHUB.repo} (an agent can use the GitHub MCP server).
2. Human, once: authorize the Cloudflare GitHub App for the fork (Workers & Pages → Create → Import a repository).
3. Create the Worker with Workers Builds: project name \`searchkeep\`, root directory \`apps/cloudflare\`, build command \`pnpm run build\`, deploy command \`pnpm run deploy\` (runs \`wrangler d1 migrations apply DB --remote && wrangler deploy\`), build watch paths \`apps/cloudflare/**\` and \`packages/**\`.
4. The first build auto-provisions the D1 database \`searchkeep\` (binding \`DB\`; no database_id in the repo).
5. Add a custom domain (e.g. \`searchkeep.example.com\`) and disable the workers.dev route and Preview URLs.
6. Cloudflare Zero Trust: create the Zero Trust organization (human, first time only); create a self-hosted Access application for the custom domain with an Allow policy for specific emails only; enable Managed OAuth; save the team domain and the application's AUD tag as secrets.
7. Credentials: create a GSC service account (human in Google Cloud, or an agent with gcloud), add its email as a Restricted user in each Search Console property (human); create a Bing Webmaster Tools API key; create a read-only Cloudflare API token. Store everything with \`npx wrangler secret put NAME --name searchkeep\`.
8. Verify: call \`setup_status\` via MCP or open the dashboard; it must report \`ready\`. Then start the first sync (or wait for 03:17 UTC). The GSC backfill continues in batches across several runs.

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

Common parameters: \`site\`, \`start_date\`, \`end_date\` (YYYY-MM-DD, UTC; default last 28 days), \`source\` ("gsc" | "bing"), \`brand\` ("all" | "brand" | "non_brand"), \`limit\`.

${tools}

## Data sources

- Google Search Console: service account with the webmasters.readonly scope, added as a Restricted user. Pulls Search Analytics (date, query, page, country, device), sitemaps and live URL Inspection. Limitations: only 16 months of history; anonymized (rare) queries are omitted, so query rows sum to less than site totals; at most 25,000 rows per request; data is delayed by a few days, so each sync re-pulls the last 4 days; URL Inspection is limited to about 2,000 calls per property per day. Domain properties are written \`sc-domain:example.com\`.
- Bing Webmaster Tools: API key (one per user; it can also submit URLs and remove sites, so treat it as a password). Pulls query and page stats, crawl issues and keyword data. Limitations: no date parameter, every call returns all data aggregated by week, so Searchkeep upserts by week and aligns GSC to weeks for comparisons. Whether Bing AI Performance is available through the API is unconfirmed; the Cited step of the GEO funnel depends on it.
- Cloudflare: read-only API token. Pulls AI crawler requests by crawler, path and status code (crawlers classified by operator and purpose: training, search, user) and Web Analytics page views, referrer hosts and Core Web Vitals. Limitations: AI crawler data requires the zone to be proxied through Cloudflare; Cloudflare's own AI referral reports are paid-only, so Searchkeep uses Web Analytics refererHost instead; GraphQL retention is limited, hence the daily sync; accounts using the EU data localization boundary cannot query the Web Analytics RUM dataset.

## Security

- A self-hosted Cloudflare Access application protects the whole hostname; the policy should allow only specific emails.
- Managed OAuth makes Access a full OAuth 2.1 server for MCP clients.
- The Worker verifies the \`Cf-Access-Jwt-Assertion\` JWT on every request (signature via the team domain's JWKS, iss, aud, exp). The team domain and AUD come only from Secrets and are never learned from traffic.
- Public endpoints: \`/setup\` (generic guide, no data) and \`/healthz\` (returns only {"ok":true}).
- The cron syncs only after a \`ready\` flag has been recorded in D1; the flag is cleared whenever a check fails.

Readiness states:

${readiness}

## Architecture

One Worker (\`searchkeep\`, Hono) with three entrances: MCP (/mcp), Dashboard (/ and /api/*) and Cron (scheduled → core.runSync()). All call @searchkeep/core, which uses the Store interface (implemented by @searchkeep/store-d1 with Drizzle and D1) and Source adapters (@searchkeep/source-gsc, @searchkeep/source-bing, @searchkeep/source-cloudflare). Core uses only Web-standard APIs. No Durable Objects. Extension points: Store (future Postgres), Auth (any OIDC proxy), scheduler, runtime entry (future Node/Docker, Vercel), sources, configuration.

## Upgrading

Click "Sync fork" on GitHub (or \`gh repo sync <you>/searchkeep --source noobnooc/searchkeep\`). Workers Builds rebuilds, applies D1 migrations and deploys. Configuration lives in Secrets, so there are no merge conflicts. Migrations are forward-only. Releases that need manual steps list them under "Upgrade notes" in the changelog.

## FAQ

${faqs}
`;
}
