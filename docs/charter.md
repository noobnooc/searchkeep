# Searchkeep charter

> **Maintainers only.** Only maintainers (the owners listed in `.github/CODEOWNERS` and repository
> admins) may change this file. AI agents and other contributors may propose changes only by opening
> an issue (use the "Agent proposal" or "Feature request" form). A pull request that edits this file
> without a maintainer-approved issue will be closed.

## Mission

Give every site and app owner a durable, private record of how their own sites perform in search
and in AI answers, and how their own apps are found in the app stores, running entirely inside
infrastructure they already own.

## Target users

- Independent site owners, indie hackers and small teams who run their own sites on Cloudflare.
- The same people when they also ship iOS or Android apps: an app is the store-side twin of a site.
- Developers and technical marketers who want to ask questions about their search data from an AI
  assistant (through MCP) instead of exporting spreadsheets.
- People who want long-term history beyond Google Search Console's 16 months without handing their
  data to a SaaS vendor.

Searchkeep is not built for agencies tracking competitors or for enterprise SEO suites.

## What we do

- Sync first-party data from Google Search Console, Bing Webmaster Tools and Cloudflare (AI crawler
  traffic and Web Analytics) into a database in the user's own Cloudflare account, every day.
- Sync first-party app data the same way: App Store Connect (analytics reports and customer
  reviews) and Google Play Console (bulk reports and the Play Developer Reporting API). Apps are kept
  apart from sites, and linked to them only through the user's own data (for example the web
  referrers that send people from the user's site to the app's store page).
- Connect the GEO funnel per page: crawled by AI crawlers, cited in AI answers, clicked by visitors.
- Provide task-shaped analysis (quick wins, cannibalization, CTR anomalies, content decay, period
  comparisons, brand vs. non-brand) through MCP tools and a dashboard that share the same functions.
- Keep history for as long as the user wants.
- Ship as a repository users fork and deploy themselves, with a runbook an AI agent can execute.

## What we explicitly do not do

- No backlink data, no competitor data, no rank tracking, no SERP or AI-answer scraping.
  Competitor and AI-answer monitoring may only ever exist as optional plugins that are off by
  default (see [roadmap](roadmap.md)).
- No app store keyword rankings and no scraping of App Store or Google Play pages. The one
  exception is an optional plugin, off by default, that reads Apple's official public App Store
  feeds (top charts and ratings) and keeps only the user's own app's chart position and rating,
  never other apps.
- No telemetry, analytics beacons, "phone home" checks or project-operated servers in the data path.
- No hosted or multi-tenant version run by the project.
- No writes to external systems unless the user explicitly enables them.
- No user-specific configuration in the repository.

## Principles

When principles conflict, **the one listed first wins**.

1. **User data stays in the user's own account.** Nothing is sent back to the project or to any
   third party: no telemetry, no tracking, no dependency on a server run by the project.
2. **First-party data only.** Use only data the site or app owner already has rights to through
   their own accounts. No backlinks, no competitor data, no rank scraping. Apple's official public
   feeds about the owner's own app are allowed only in the opt-in plugin above.
3. **Self-hosted with zero operations.** It must run on the Cloudflare free tier, and upgrading must
   only require "Sync fork". Any change that needs manual user action must ship with upgrade notes.
4. **Read-only by default.** Any operation that writes to an external system (for example submitting
   a sitemap, or asking App Store Connect to start generating reports) must be explicitly enabled or
   started by the user. Stored credentials are read-only wherever the source allows it.
5. **The core does not depend on any platform.** Platform capabilities live behind interfaces
   (Store, Auth, Source, scheduler, runtime entry). Platform-specific code lives only in
   `apps/cloudflare` and `packages/store-d1`.
6. **Docs are written for agents to execute.** Every documented step is idempotent and has a way to
   verify it. Steps that need a human are marked as such.
7. **Few dependencies.** If a Web standard API can do it, do not add a library.

## Decisions that require a human

The following always need an explicit decision by a maintainer, recorded in an issue or pull
request. Agents must open an issue (labelled `status:needs-human`) and wait:

- Any change to this charter, to `docs/roadmap.md`, or to an accepted ADR. Reversing an earlier
  decision requires a new ADR approved by a maintainer.
- Anything that conflicts with a principle above, even partially.
- Adding a new data source, a new runtime, a new store, or a new MCP tool.
- Adding any write operation to an external system, or changing what is enabled by default.
- Authentication, authorization and readiness-check changes; changes to `wrangler.jsonc`, to
  migrations, or to how secrets are handled.
- Adding a runtime dependency, or replacing a core dependency (Hono, Drizzle, the MCP SDK, Svelte).
- Breaking changes for existing deployments, including anything that requires users to take manual
  action after "Sync fork".
- Merging pull requests, creating tags and publishing releases or packages.
- Repository settings, branch protection, labels policy, CODEOWNERS and the agent's permissions.
- Closing issues as out of scope, and anything involving security reports.
