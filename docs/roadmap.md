# Roadmap

Maintainers own this file. Agents may propose changes through an `agent-proposal` issue. Anything
listed under "Later" needs a maintainer decision (and usually an ADR) before work starts.

## v0.1 (current)

### In scope

| Area           | v0.1                                                                                                                       |
| -------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Runtime        | Cloudflare Workers: one Worker (`apps/cloudflare`) serving dashboard, API, MCP and cron                                    |
| Database       | Cloudflare D1 via Drizzle (`packages/store-d1`), behind the Store interface                                                |
| Data sources   | Google Search Console, Bing Webmaster Tools, Cloudflare (AI crawler requests, Web Analytics)                               |
| Entrances      | MCP (Streamable HTTP, stateless, 13 tools) and the dashboard (Svelte + Vite SPA)                                           |
| Authentication | Cloudflare Access self-hosted application with Managed OAuth; JWT re-verified in the Worker                                |
| Deployment     | Fork plus Workers Builds; upgrade with "Sync fork"                                                                         |
| Sync           | Daily cron; GSC re-pulls the last 4 days; batched 16-month GSC backfill; weekly Bing upserts                               |
| Analysis       | Quick wins, cannibalization, CTR anomalies, content decay, period comparison, GEO funnel, AI crawlers, brand vs. non-brand |
| Live calls     | GSC URL inspection, sitemap listing; sitemap submission (off by default)                                                   |
| Operations     | `setup_status`, readiness lock, the maintain skill, CI guardrails                                                          |

### Out of scope for v0.1

- Runtimes other than Cloudflare Workers; databases other than D1.
- Authentication other than Cloudflare Access.
- Data sources other than the three above.
- Backlinks, competitor data, rank tracking, SERP or AI-answer scraping (never in the core; see the
  [charter](charter.md)).
- Durable Objects and KV ([ADR 0002](adr/0002-no-durable-objects.md)).
- A Deploy to Cloudflare button ([ADR 0005](adr/0005-fork-and-workers-builds-deployment.md)).
- Code Mode and free-form SQL tools ([ADR 0006](adr/0006-discrete-mcp-tools-not-code-mode.md)).
- Any hosted or multi-tenant service operated by the project.

### Open questions for v0.1

- Whether Bing AI Performance data is available through the API. The "Cited" stage of the GEO
  funnel depends on it.
- Whether the Workers Builds build token can apply D1 migrations remotely. If not, the Worker
  applies pending migrations itself at startup.

## Later

Listed for direction only; none of these is committed.

- **Node runtime (`apps/node`)** for Docker and Vercel, reusing `packages/mcp` and
  `packages/dashboard`, with Vercel Cron or node-cron calling the same sync function.
- **Postgres store (`packages/store-pg`)**: copy the schema to `pgTable` and pass the shared Store
  interface tests.
- **Generic OIDC proxies** (oauth2-proxy, Pomerium) in front of non-Cloudflare runtimes, plus an
  authorization server for MCP OAuth.
- **More first-party data sources**, for example other webmaster tools or analytics the site owner
  controls.
- **Optional plugins**, off by default and outside the core, for competitor monitoring and AI answer
  monitoring.
- **Optional read-only SQL tools** `describe_schema` and `run_query`: a single `SELECT` only, row
  and time limits, stable views only.
- **Optional Code Mode wrapper** around the existing tools (via `@cloudflare/codemode`'s
  `codeMcpServer`) for users on paid plans or if the tool count grows.
- Docker image and other deployment options for non-Cloudflare runtimes.
