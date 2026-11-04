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

- Manage sites in the dashboard: **Settings → Sites** adds, edits and removes the sites Searchkeep
  analyses. Sites are stored in D1 (`site_configs` table). **Auto-fill** looks the domain up in
  Search Console, Bing Webmaster Tools and Cloudflare with the configured credentials and fills in
  the identifiers it finds. New API: `GET`/`POST /api/site-configs`,
  `DELETE /api/site-configs/:id`, `GET /api/discover`.

### Changed

- New brand, "Horizon": the mark is a line that runs past a dashed 16-month horizon (what Search
  Console keeps) and ends in an orange dot (today). Lowercase `searchkeep` wordmark in Inter Tight,
  Inter Tight for website headings and IBM Plex Mono for labels, a cool Night/Fog palette with one
  Signal orange, no gradients or glows. The website hero, Open Graph image and closing call to action
  draw the same line at full width. New favicons, app icons (including a maskable icon), dashboard
  palette and Worker setup page. Brand files and usage notes are in `docs/brand/`. The dashboard
  still loads no web fonts: the wordmark is drawn as outlines.
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
