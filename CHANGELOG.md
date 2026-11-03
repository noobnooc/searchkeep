# Changelog

All notable changes to Searchkeep are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Upgrade notes

Users upgrade by clicking **Sync fork** on GitHub; Workers Builds then rebuilds, applies database
migrations and deploys. Most changes need nothing else. When a change needs the user to do
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

## [0.1.0] - 2026-11-03

First release.

### Added

- One Cloudflare Worker (`apps/cloudflare`) serving the dashboard, its JSON API, the MCP endpoint
  and a daily cron sync, backed by one D1 database.
- Data sources: Google Search Console (Search Analytics, sitemaps, URL inspection), Bing Webmaster
  Tools (query and page statistics), and Cloudflare (AI crawler requests and Web Analytics).
- Daily sync with a GSC re-pull of the last 4 days, a batched 16-month GSC backfill that resumes
  across cron runs, and weekly Bing upserts. History is kept beyond GSC's 16-month limit.
- MCP tools: `list_sites`, `query_performance`, `compare_periods`, `find_quick_wins`,
  `find_cannibalization`, `find_ctr_anomalies`, `find_content_decay`, `geo_funnel`, `ai_crawlers`,
  `inspect_url`, `list_sitemaps`, `submit_sitemap` (off by default) and `setup_status`.
- Dashboard (Svelte + Vite) using the same analysis functions as the MCP tools.
- Brand vs. non-brand filtering with `BRAND_REGEX` or a per-site `brandRegex`.
- Authentication by Cloudflare Access with Managed OAuth for MCP clients; the Worker re-verifies the
  Access JWT on every request and stays locked (`no_access`, `oauth_disabled`, `policy_too_broad`)
  until Access is configured correctly.
- Deployment by fork and Workers Builds, with an agent-executable runbook in `docs/deploy.md`.
- Project governance: charter, ADRs 0001–0007, roadmap, `AGENTS.md`, the maintain skill, issue and
  PR templates, labels, CODEOWNERS and CI.

[Unreleased]: https://github.com/noobnooc/searchkeep/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/noobnooc/searchkeep/releases/tag/v0.1.0
