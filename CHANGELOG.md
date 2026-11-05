# Changelog

All notable changes to Searchkeep are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Upgrade notes

Users upgrade by clicking **Sync fork** on GitHub; Workers Builds then rebuilds and deploys, and the
Worker applies any new database migrations itself on its first request. Most changes need nothing else. When a change needs the user to do
something by hand (add a secret, widen an API token's permissions, change an Access setting, re-run
a step from [docs/deploy.md](docs/deploy.md)), its entry gets an **Upgrade notes** subsection:

- Every pull request that needs user action includes the same notes in its description and adds
  them here under `Unreleased`.
- Each note says **what** to do, **where** (exact click path or command), **when** (before or after
  syncing), and **what happens if you skip it** (for example "the Bing source reports an error until
  the secret is set").
- Read the upgrade notes of every version since your last sync, oldest first, before syncing.

Because users sync `main` at any time, the `Unreleased` section is always accurate for what is on
`main`.

## [Unreleased]

### Added

- Bing data through Cloudflare Browser Run. Bing's Webmaster API refuses the egress IPs of Workers
  (`ThrottleIP`), often for days, so Bing never synced on many deployments. When a direct call gets
  `ThrottleIP`, the Bing calls of that run now go through Browser Run, whose IPs Bing accepts. One
  browser serves the whole run and is closed afterwards. Nothing to set up: the new `BROWSER`
  binding in `wrangler.jsonc` is all it needs, and it stays unused while Bing answers directly.
  New runtime dependency: `@cloudflare/puppeteer`, Cloudflare's client for Browser Run.

- Sync progress you can see. While a site's latest days are still coming in, every dashboard page
  shows a banner with each source's progress (how far back the data goes, what is paused or
  failing, and when it is retried), the sidebar shows the overall progress, and the views refresh
  on their own when a sync brings new rows. **Settings** → **Sync progress** lists every site and
  dataset. Overview shows no period-over-period deltas until the comparison period is synced. New
  API: `GET /api/sync-progress`; `setup_status` returns the same as `syncProgress` and adds a
  `sync.progress` check.
- Manage sites in the dashboard: **Settings → Sites** adds, edits and removes the sites Searchkeep
  analyses. Sites are stored in D1 (`site_configs` table). **Auto-fill** looks the domain up in
  Search Console, Bing Webmaster Tools and Cloudflare with the configured credentials and fills in
  the identifiers it finds. New API: `GET`/`POST /api/site-configs`,
  `DELETE /api/site-configs/:id`, `GET /api/discover`.
- The GEO funnel's page table can be sorted by impressions. `geo_funnel` and
  `GET /api/geo-funnel` accept `sortBy: "impressions"`, and an unknown `sortBy` now returns a
  `bad_request` error instead of an unsorted list.

### Changed

- Much faster first sync: one request now covers many days. Search Console and Cloudflare answer
  for a date range with one row per day, so a request covers up to 30 days of Search Console (totals,
  country × device, query × page), 30 days of AI crawler requests or 90 days of Web Analytics, where
  each used to cover one day. A small site's 16 months of Search Console history take about 50
  requests instead of about 1,500. A range with more rows than one request returns (or than a tenth
  of `SYNC_DAILY_WRITE_BUDGET`), or one the API refuses, is split into shorter ranges for the next
  pass, down to single days, so sites with a lot of data sync as before. So is a range that needs
  more calls than one pass allows. `GSC_ROWS_PER_DAY` still caps each day. Existing deployments
  continue from where they are.
- `SYNC_MAX_CALLS_PER_RUN` defaults to `35` instead of `20`: still within the Workers Free limit of
  50 outbound requests per invocation, with headroom for the Access check, the Search Console token
  and retries. Deployments that set it keep their value.
- Cloudflare GraphQL rate limits ("Rate limiter budget depleted", code `budget`) now pause
  Cloudflare like other rate limits instead of failing the task.
- Dashboard tables: a sorted column's label no longer moves when its arrow appears, and every
  header label sits on the same line. In the GEO funnel table, impressions get a neutral bar like
  the steps, so each row's values line up.
- Dashboard pages no longer shift when their data arrives. Each page header keeps the line for its
  date range and shows a skeleton there while loading, so the title and the filters stay put. Card
  subtitles that come from the data do the same.
- A faster first sync for many sites. The latest days now go round-robin over all sites, so every
  site gets data early instead of waiting for the sites before it; history (16 months of Search
  Console, 30 days of AI crawler requests, 90 days of Web Analytics) then fills in for all sites at
  once, newest day first. The Cloudflare lookback now counts towards `SYNC_DAILY_WRITE_BUDGET`, like
  the Search Console backfill. Deployments that already synced Cloudflare keep their data and are
  not re-pulled.
- Rate limits no longer stall the sync. Bing answers throttling with HTTP 400 `ThrottleUser`, which
  used to fail every Bing task of every site on every pass and use up the API call budget, so the
  other sources barely progressed. Now a rate-limited source is paused for every site for 30
  minutes, doubling up to 8 hours, while the other sources keep syncing; Bing calls are spaced out
  and capped at 8 per pass. HTTP 429 with `Retry-After` from any source is handled the same way.
- Failed tasks are retried after 10 minutes, doubling up to 6 hours, instead of on every pass, so a
  misconfigured site no longer uses up the budget of the others. **Sync now** retries them right
  away.
- Bing's `ThrottleIP` (code 17) is recognized. Bing throttles Cloudflare's shared egress IPs, so
  Workers often get it from the first call, for days. The dashboard says so instead of reporting a
  rate limit, and **Sync now** retries a paused source once, since a manual sync runs from a
  different location than the cron. A paused or failing dataset no longer keeps a site in the
  "latest days" phase while its other datasets are in.
- A day without Search Console data (the 2–3 days GSC lags, and days without impressions on small
  sites) costs 1 API call instead of 3, so the latest days and history of small sites sync about
  three times faster.
- New brand, "Horizon": the mark is a line that runs past a dashed 16-month horizon (what Search
  Console keeps) and ends in an orange dot (today). Lowercase `searchkeep` wordmark in Inter Tight,
  Inter Tight for website headings and IBM Plex Mono for labels, a cool Night/Fog palette with one
  Signal orange, no gradients or glows. The website hero, Open Graph image and closing call to action
  draw the same line at full width. New favicons, app icons (including a maskable icon), dashboard
  palette and Worker setup page. Brand files and usage notes are in `docs/brand/`.
- The website's "Built on data you already own" strip shows each source's and client's mark
  (monochrome, brand color on hover), and the agent panel uses the Cloudflare logo. Marks come from
  Simple Icons (the Microsoft Bing and OpenAI marks from its earlier releases).
- The docs sidebar marks the current page with a Signal dot instead of an accent bar.
- Dashboard: the GEO funnel draws its own rounded ends instead of being clipped at the corners,
  and the Overview icon is an even grid of rounded squares.
- The website's GEO funnel section is now a ribbon that narrows from crawled to cited to clicked.
  Dots stand for pages: stalled ones fade where they drop off, and clicked ones turn Signal. Each
  step shows its icon and its sources' marks. Motion is off for reduced-motion users.
- More of the website explains with visuals instead of lists:
  - Data sources: the three sources, with their marks and what each pulls, wired into the D1
    database in your account.
  - Security: a request passes Cloudflare Access, the JWT check and the setup checks on its way to
    your data, while another is refused at Access. The readiness states follow as a short stepper.
  - Ownership: each principle is a small picture (your account and no vendor server, the write
    switch that is off, usage under the free plan, GitHub's Sync fork). The full architecture
    diagram stays in the docs.
  - MCP: the tools are grouped by what they answer, and the two the chat calls are marked.
- Install with an AI agent: a two-line prompt to copy into Claude Code, Cursor, Codex or another
  agent, pointing it at `docs/deploy.md` in the repository (read with the agent's GitHub access), which now opens with the rules for agents (check GitHub and
  Cloudflare access, ask for the names, stop at [Human] steps, keep secrets out of chat). Shown as a
  compact panel with the required GitHub and Cloudflare access on the website, and in the README.
  The site build checks that the README and the website show the same prompt.
- Less copy, more layout: the website's sections now say it with one headline, one short lead line
  (kept for search engines) and a visual (tool chips, a real dashboard screenshot, the timeline, the
  diagram, the comparison table); the docs
  introduction is shorter; the dashboard drops page descriptions and restating subtitles, folds data
  notes into one line and keeps empty states to a sentence.
- Every docs page, the changelog and the privacy page now have their own Open Graph image, each with
  its own line; plus `favicon.ico`, a Safari pinned-tab icon and a GitHub social preview image
  (`docs/assets/social-preview.png`).
- The dashboard uses the brand type: Inter Tight for titles and figures, IBM Plex Mono for labels
  and chart axes, bundled with the dashboard and served by your Worker (no third-party requests).
  The locked screen and the public setup page show the horizon line, paused until every check
  passes.
- The `SITES` secret is now optional. Sites defined there keep working and appear read-only in the
  dashboard; when both define the same `id`, the secret wins. Site definitions are validated more
  strictly: a site with an invalid `brandRegex` (or other invalid field) is now skipped and reported
  by `setup_status` instead of being loaded without the field.

### Upgrade notes

- Nothing is required. The new table is created automatically on the first request after syncing.
- Optional: to pick Cloudflare zones and Web Analytics sites from a list when adding a site, edit the
  API token in `CLOUDFLARE_API_TOKEN` (Cloudflare dashboard → **My Profile** or **Account** →
  **API Tokens** → your token → **Edit**) and add **Zone: Read** and **Account Settings: Read**.
  Without them you type the zone ID and site tag yourself.

## [0.1.0] - 2026-11-03

First release.

### Added

- One Cloudflare Worker (`apps/cloudflare`) serving the dashboard, its JSON API, the MCP endpoint
  and a cron sync every 15 minutes, backed by one D1 database.
- Data sources: Google Search Console (Search Analytics, sitemaps, URL inspection), Bing Webmaster
  Tools (traffic, query and page statistics, crawl issues), and Cloudflare (AI crawler requests, Web
  Analytics and Web Vitals).
- AI citations (the "Cited" step of the GEO funnel) imported from Bing AI Performance CSV exports,
  from the dashboard or with `POST /api/import/ai-citations`; the report has no API.
- Sync in small batches within call, time and D1 write budgets, resuming on the next pass: daily
  increments first (GSC re-pulls the last 4 days and fills gaps of up to 30 days, Bing is pulled in
  full, Cloudflare goes back 30 days for AI crawlers and 90 days for Web Analytics on the first run),
  then a 16-month GSC backfill one day at a time. History is kept beyond GSC's 16-month limit.
- MCP tools: `list_sites`, `query_performance`, `compare_periods`, `find_quick_wins`,
  `find_cannibalization`, `find_ctr_anomalies`, `find_content_decay`, `geo_funnel`, `ai_crawlers`,
  `inspect_url`, `list_sitemaps`, `setup_status`, and `submit_sitemap` (registered only with
  `ENABLE_WRITES=true`).
- Dashboard (Svelte + Vite) using the same analysis functions as the MCP tools, with **Sync now**.
- Configurable sync budgets: `GSC_ROWS_PER_DAY`, `GSC_BACKFILL_MONTHS`, `SYNC_DAILY_WRITE_BUDGET`
  and `SYNC_MAX_CALLS_PER_RUN`, with defaults sized for the free plans.
- Brand vs. non-brand filtering with `BRAND_REGEX` or a per-site `brandRegex`.
- Authentication by Cloudflare Access with Managed OAuth for MCP clients; the Worker re-verifies the
  Access JWT on every request and stays locked (`no_access`, `oauth_disabled`, `policy_too_broad`)
  until Access is configured correctly.
- Deployment by fork and Workers Builds, with an agent-executable runbook in `docs/deploy.md`. The
  Worker applies pending D1 migrations itself, so the default build token needs no D1 permission.
- Local development with `pnpm dev` and demo data (`POST /api/dev/seed`, localhost only).
- Project governance: charter, ADRs 0001–0007, roadmap, `AGENTS.md`, the maintain skill, issue and
  PR templates, labels, CODEOWNERS and CI.

[Unreleased]: https://github.com/noobnooc/searchkeep/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/noobnooc/searchkeep/releases/tag/v0.1.0
