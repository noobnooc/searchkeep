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

- App Store funnel per product page. The Discovery and Engagement and App Downloads reports are now
  also kept per page type (Standard: product page, list views, store sheet, in-app event, ...) and
  per page title (Detailed: custom product pages, in-app events, "Default Product Page"). New
  `app_performance` `groupBy` values `page_type` and `page_title` return `pages` with impressions,
  page views, first-time downloads and page conversion. Product page optimization treatments are in
  no report Apple offers. Nothing to set up; the next snapshot fills history.

- Store change timeline. Once a day the sync snapshots each app's App Store presence with the
  existing key (the version on sale and the one in the works with state, release type and phased
  release; the on-sale version's description, keywords, promotional text and release notes per
  locale; names and subtitles) and, with the opt-in `PLAY_METADATA=true`, Google Play listings
  and tracks through an edit that is deleted, never committed. Fields that changed are recorded with
  the value before and after. New MCP tool and API `app_changes` (`/api/app-changes`);
  `app_performance` lists each day's changes in its series (`includeChanges: false` leaves them
  out). `setup_status` gains `probe.asc_metadata`, `config.play_metadata` and
  `probe.play_metadata`.

  #### Upgrade notes
  - Nothing to do for the App Store. If `probe.asc_metadata` warns, the key's role may not read app
    information and only this feature stays empty.
  - Optional, for Google Play: set `PLAY_METADATA` to `true`, enable the Google Play Android
    Developer API in the service account's Google Cloud project and grant it **View app information
    (read-only)** in the Play Console. Use a service account your release tooling does not use:
    opening an edit closes that account's other open edits.

- App Store revenue per product. The App Store Purchases report's Content Name is now kept per
  product, purchase type and storefront (Apple's USD estimate, refunds kept apart), and with the
  optional `ASC_VENDOR_NUMBER` secret the sync reads the daily Sales and Trends Summary Sales report
  of the account with the existing Sales and Reports key (one call a day, history back a year): units,
  proceeds and refunds per SKU, country, price and currency, and whether a subscription payment was
  new or a renewal. Free downloads, updates and redownloads are left out; amounts in different
  currencies are never added up. New MCP tool and API `app_revenue` (`/api/app-revenue`) with a
  `refunds` list per day and product; `app_subscriptions` returns `appStore.proceeds` split into
  first payments and renewals. `setup_status` gains `config.asc_vendor` and `probe.asc_sales`.

  #### Upgrade notes
  - Optional, any time after syncing: for exact revenue per product, copy the vendor number from App
    Store Connect → **Payments and Financial Reports** (next to your legal entity name) and run
    `npx wrangler secret put ASC_VENDOR_NUMBER` (or add it under the Worker's **Settings** →
    **Variables and Secrets**). Skipping it keeps the USD estimate per product;
    `setup_status` shows `config.asc_vendor` as `warn` until it is set.

- App Store subscriptions. The sync reads Apple's App Store Subscription State and Subscription
  Event reports (Standard), which the App Store report requests already produce: active
  subscriptions, free trials, paid offers, billing retry, grace period and suspended
  subscriptions per day, and trial starts, trial conversions, paid starts, renewals, voluntary and
  involuntary churn and refunds per subscription, offer type, storefront and (for events) the
  source the subscriber first downloaded the app from. History goes back to January 1, 2025 through
  the one-time snapshot. `app_subscriptions` (MCP and `/api/app-subscriptions`) takes a `store`
  and an `offerType` parameter and returns the App Store under `appStore`; Google Play keeps its
  top-level fields. Nothing to set up.

- App numbers per app version, device and OS version
  ([ADR 0010](docs/adr/0010-app-revenue-and-engagement.md)): Google Play installs, uninstalls,
  active devices, ratings, crashes and ANRs from the Play Console's per-version, per-device and
  per-OS files (now also `stats/crashes/`), and App Store sessions per app version and device. The
  new `app_breakdown` MCP tool and API, and a **Versions, devices and OS versions** card on an app's
  **Stability** page (also shown when there are no crash rates) tie a release, a device or an OS
  version to its ratings and crashes. At most 50 values a day are kept; the rest are summed into
  "Other". Nothing to set up.

- Google Play revenue and subscriptions ([ADR 0010](docs/adr/0010-app-revenue-and-engagement.md)).
  With the service account allowed to view financial data, the sync reads the account's monthly
  earnings files (ZIP) and keeps only each app's sums per day and buyer country in the payout
  currency: proceeds net of Google's fees, taxes and refunds, sales and purchases. Order numbers,
  postcodes and other per-order fields are never stored. It also reads the subscription statistics
  (new, canceled and active per product, base plan and country) into a new table, shown by the new
  `app_subscriptions` MCP tool and API and a **Google Play subscriptions** card on an app's overview.
  Without the permission everything else syncs as before, and `setup_status` warns
  (`probe.play_finance`).

- App revenue and sessions, attributed to acquisition
  ([ADR 0010](docs/adr/0010-app-revenue-and-engagement.md)). The App Store sync also reads the
  **App Store Purchases** and **App Sessions** reports (Standard), which the existing report requests
  already produce: purchases net of refunds, proceeds and sales in USD (Apple's estimates), paying
  users, sessions, session length and devices, per day, storefront and source. `app_performance`
  and an app's overview show them with proceeds per download, average session length and sessions
  per device; the acquisition page adds proceeds per source and storefront. Nothing to set up; a
  report kind added in a new version is looked for on the next sync. The charter now covers app
  engagement and revenue that the stores attribute to acquisition, and never stores per-order or
  per-person financial data.

- Apps, kept apart from sites ([ADR 0009](docs/adr/0009-apps-as-a-second-kind-of-property.md)).
  Add your iOS and Android apps in the dashboard (**Settings** → **Apps**) or the new `APPS` secret,
  with the App Store Apple ID, the Google Play package name, or both, and optionally one of your
  sites. The sync reads, on the same budgets as the sites:
  - **App Store Connect** (`ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_PRIVATE_KEY`, a key with the **Sales
    and Reports** role): the App Store Discovery and Engagement, App Downloads and App Store
    Installation and Deletion reports (Standard for counts, Detailed only for referring websites and
    apps), App Crashes, and customer reviews (stored without reviewer names). Report instances are
    read oldest first so the newest always wins for a day; a one-time snapshot fills history back to
    January 2024, only for the days before the ongoing reports.
  - **Google Play** (`PLAY_REPORTS_BUCKET`, and the Search Console service account or
    `PLAY_CLIENT_EMAIL` / `PLAY_PRIVATE_KEY`): the Play Console's monthly report files in Cloud
    Storage (store performance by country and by traffic source with search terms, installs,
    ratings, reviews), read again only when they change, and crash and ANR rates from the Play
    Developer Reporting API.
  - **App Store public feeds**, an opt-in plugin that is off by default (`APP_STORE_PUBLIC_DATA=true`):
    your own app's average rating and top chart position from Apple's official feeds, nothing about
    other apps.

  App Store reports are started once per app from **Settings** → **Apps** → **Start App Store
  reports** with a temporary **Admin** key, which the Worker sends only to Apple for that request
  and never stores, logs or returns (`POST /api/app-configs/<id>/enable-app-store`). New MCP tools
  `list_apps`, `app_performance` (store funnel per store against the previous period, by date,
  territory, source or referrer, with your own site marked), `app_search_terms`, `app_reviews` and
  `app_stability`, with `GET /api/apps`, `/api/app-performance`, `/api/app-search-terms`,
  `/api/app-reviews` and `/api/app-stability`. The dashboard gets an **Apps** area (a Sites | Apps
  switch in the sidebar): Overview, Acquisition, Ratings & reviews and Stability. `setup_status`
  checks the app credentials and probes both stores, and the sync progress lists apps. New tables
  `app_configs`, `app_store_daily`, `app_search_terms`, `app_referrers`, `app_ratings`,
  `app_reviews`, `app_vitals` and `app_chart_ranks` (migration `0003_apps`). The charter and roadmap
  now include apps.

- App icons in the app switcher, like the site icons. The new `GET /api/app-icon?app=<id>` reads the
  icon of the app's newest uploaded build from App Store Connect (`Build.iconAssetToken`, with the
  stored read-only key) and downloads it only from Apple's image CDN (`*.mzstatic.com`); when that
  gives nothing (a Google Play app, no build yet, or a key that cannot read builds), it uses the
  icon of the app's linked site. Google Play has no read-only API for the icon and store pages are
  never read, so such an app without a linked site keeps its first letter. The icons also show in
  **Settings** → **Sites** and **Apps** and in the sync progress tables.
- Site icons in the site switcher. Each site now shows its own icon instead of the first letter of
  its domain. The new `GET /api/site-icon?site=<id>` reads it from the site itself, as
  `Searchkeep icon reader`: the `apple-touch-icon` links on the home page, then
  `/apple-touch-icon.png`, then the `icon` links, then `/favicon.ico`. Only URLs on the site's own
  domain and its subdomains are read (redirects included), a response counts only if its bytes are an image, and no
  third-party icon service is used. The letter remains when no icon loads.
- Index coverage, kept (#24). Once a day the sync reads the URLs of the sitemaps Search Console
  knows (up to 5,000 per site, only URLs inside the property; URLs no sitemap lists for a week are
  dropped; large sitemap indexes are read over several passes) and inspects them with the URL
  Inspection API in batches, never-inspected URLs first and each again after about a week, up to
  `GSC_INSPECTIONS_PER_DAY` per site and day (default `200`; Google allows 2,000 per property and
  day, shared with `inspect_url`). It uses only the calls a pass has left over, never makes a pass
  `partial`, and reaching the quota stops it for the day without pausing Search Console. The new
  `index_coverage` tool (and `GET /api/index-coverage`, the **Index coverage** card on **Technical**)
  reports how many URLs are indexed, the URL counts per coverage state (Crawled - currently not
  indexed, Soft 404, duplicates, ...), rich result (structured data) verdicts and issues, the URLs
  in a state, and coverage changes. New table `index_status`.
- Search engine crawlers (#24). Cloudflare's HTTP request analytics now also give Googlebot (and its
  image, video and news crawlers), Bingbot, YandexBot, Baiduspider, DuckDuckBot, Applebot and other
  search engine crawlers by day, crawler, path and status: the closest thing to Search Console's
  Crawl stats report, which has no API. New tool `search_crawlers` (same parameters as
  `ai_crawlers`), `GET /api/search-crawlers`, the **Search engine crawlers** card on **Technical**
  and a `search_crawlers` dataset in the sync progress. Up to 2,000 path × status rows are kept per
  site and day; requests to the other pages are summed under `(other pages)`. Uses the existing
  Zone Analytics permission. New table `search_crawler_requests`.
- Search Console search types and search appearance (#24). Image and video search, the News tab,
  Discover and Google News are synced besides web search (`GSC_SEARCH_TYPES`, all by default;
  Discover and Google News have pages only, without queries or positions), and so is web search's
  search appearance (`GSC_SEARCH_APPEARANCE`, on by default), in two steps as Search Console
  requires: the appearances of a range, then one daily series each. `query_performance`,
  `compare_periods`, `find_quick_wins`, `find_cannibalization`, `find_ctr_anomalies` and
  `find_content_decay` take a `searchType` parameter; `query_performance` groups and filters by
  `appearance`. The dashboard's **Performance** page has a search type menu and an **Appearance**
  breakdown. Each of these datasets keeps its own cursors, so existing deployments backfill them
  without re-pulling web search; a search type without traffic costs one call per 30 days. New table
  `search_appearances`.
- Queries and pages by country and device, opt-in (#24). For the sites in `GSC_SEGMENT_SITES` (site
  ids or `all`; off by default because of the extra D1 writes) the top 1,000 queries and pages per
  day are also synced per country and device, for the last 3 months, so `query_performance` can
  combine `country`/`device` with `query` or `page` ("top queries in the US"). The **Performance**
  page shows country and device filters for those sites. New table `search_segments`.

- Bing data through Cloudflare Browser Run. Bing's Webmaster API refuses the egress IPs of Workers
  (`ThrottleIP`), often for days, so Bing never synced on many deployments. When a direct call gets
  `ThrottleIP`, the Bing calls of that run now go through Browser Run, whose IPs Bing accepts. One
  browser serves the whole run and is closed afterwards. Nothing to set up: the new `BROWSER`
  binding in `wrangler.jsonc` is all it needs, and it stays unused while Bing answers directly.
  New runtime dependency: `@cloudflare/puppeteer`, Cloudflare's client for Browser Run.

- Sync progress you can see. While a site's latest days are still coming in, every dashboard page
  shows a banner with each source's progress (how far back the data goes, what is paused or
  failing, and when it is retried), the sidebar shows the overall progress, and the views refresh
  on their own when a sync brings new rows. **Settings** → **Sync** lists every site and
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

- An app's **Territories** table shows installs instead of conversion when Google Play is in view,
  with the full country name on hover. Google groups the store listing visitors and acquisitions of
  countries with few users into **Other (grouped)**; the card says so, and installs by country
  (not grouped) are what is sorted for Google Play.

- The opt-in App Store public feeds check the storefronts that matter to each app: the ones set on
  the app, or else (new default, instead of only `us`) its own biggest App Store storefronts by
  downloads, filled up with the largest storefronts (US, China, Japan, UK, Germany), up to 5.
  Storefronts where the app is not sold are skipped, and a free app is checked only in the free
  charts, a paid app only in the paid ones. Each storefront is saved as soon as it is read, so a run
  that runs out of calls (`SYNC_MAX_CALLS_PER_RUN`) continues with the next one. The **App Store charts** card on an app's overview is
  now a table of storefronts (most important first) by chart, with the category's name and the
  change since the previous check; charts no longer checked drop out.

- **Settings** is split into sections with their own addresses (`#/settings/<section>`), grouped
  in a side menu (a scrolling row on phones): **Sites** and **Apps** (what Searchkeep tracks),
  **Sync** (progress, **Sync now** and recent runs in one place), **Stored data** (data coverage per
  site, now without empty rows, and **Import AI citations**), **Setup checks** (in columns, with a
  "to fix or check" filter and the problem count in the menu), **AI clients** (the MCP endpoint and
  each client's setup) and **Appearance** (theme, the signed-in account and **Sign out**). The
  separate "Sites and data coverage" card, which repeated the site list, is gone. Old links such as
  `#/settings/progress` and `#/settings/import` still open the right section. Editing a site or an
  app opens the form under its row instead of at the top of the list.

- Bing site totals have an average position (#24). Bing reports none for them, so they now take the
  impression-weighted position of Bing's query rows (by day, week and month too); query and page
  rows keep their own positions.
- `list_sitemaps` returns `indexed: null` instead of `0`: Google's Sitemaps API no longer fills it
  ("Deprecated; do not use"). Use `index_coverage` instead. The dashboard's sitemap table drops the
  Indexed column.

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
- [docs/deploy.md step 8](docs/deploy.md#8-enable-managed-oauth) now sets the Managed OAuth grant
  (a 15-minute access token, a two-week grant session) and the Zero Trust global session duration,
  so the dashboard and MCP clients no longer ask you to sign in again every day. A new
  troubleshooting entry, "Asked to sign in again every day", points to it.
- Working on the repository (`pnpm install`, `pnpm test` and the other commands) now needs Node.js
  22.12 or later, the minimum of the test runner Vitest 5. The root `package.json` `engines` field
  says so, and `pnpm install` warns on older versions. Deploying is not affected: Workers Builds
  reads `apps/cloudflare/.node-version` (`22`), which gives the latest Node.js 22.

### Fixed

- App Store history (downloads, purchases, download referrers) of an app stayed empty while Apple
  had made no daily instance of that report since the reports were started, which for a small app
  with no downloads or purchases on those days can take weeks or never happen. History waited for
  the daily report's first day to know where to stop; it is now written right away, and the daily
  report's days replace the ones they cover when they come.

- A volume purchase through Apple Business Manager or Apple School Manager (an "institutional
  purchase": an organization can take 100,000 licenses of a free app at once) counted as
  first-time downloads, so one such day swamped the downloads trend, the conversion rates and the
  storefronts the public feeds check. The funnel totals, trend and rows by date or territory now
  leave institutional purchases out, `app_performance` names how many in a note (and as
  `volumePurchaseDownloads`), and rows by source still list them.

- Google Play stopped syncing when the service account could list the financial files but not read
  them (no **View financial data**): the first earnings or subscriptions file answered 403 and failed
  the whole Google Play sync. Such a file is now passed over with the other financial files until the
  next day, the rest of Google Play syncs, and `probe.play_finance` tries reading a financial file
  instead of only listing them, so it warns in this case too. A new version that finds more kinds of
  Play files also lists the bucket again on its first sync, instead of the next day.

- Google Play uninstalls were 0 for apps whose installs files leave "Daily Device Uninstalls" at 0
  and report them as "Uninstall events"; such a file now uses the uninstall events. Installs files
  already read are read once more, so past months are corrected too.

- On phones, short dashboard pages no longer show a large empty space under the top bar.
- Monospace identifiers in **Settings** → **Sites** and **Apps** use the dashboard's mono font
  (undefined CSS variables made them fall back to the system font).

- Apple's public App Store feeds (the opt-in `APP_STORE_PUBLIC_DATA` plugin) refuse the egress IP
  addresses of Workers with HTTP 403, so the plugin wrote nothing. When a direct call is refused,
  the calls of that run now go through Cloudflare Browser Run, like Bing's `ThrottleIP` fallback.
  Nothing to set up.

- Through Browser Run, the App Store lookup still failed with "appstore: network error": Apple sends
  the lookup API's answer as a download (`Content-Disposition: attachment`), and the browser stops
  such a navigation. Browser Run now reads a download with `fetch()` from a page on the same site,
  so ratings and chart positions arrive.

- Apple's current chart feeds (`rss.marketingtools.apple.com`) often time out with HTTP 504 after 30
  seconds (China's top paid chart, for example). One such chart failed the app's whole App Store
  public task, and the waits used up the run's time before the other apps. Now a chart that times
  out is read from the older iTunes feed, without a retry, and each chart is fetched once per sync
  run instead of once per app.

- An App Store storefront without ratings showed an average of 0 (Apple's lookup reports 0 when
  there are none); it now has no rating, and the rating shown for an app is the first storefront
  that has ratings. A paid app was looked up in the free category chart; it is now checked in the
  paid charts.

- The faster first sync no longer overloads D1. Requests that cover many days write their rows in
  bursts, and D1 answered "D1 DB is overloaded. Too many resources consumed within a 10 second
  window"; the run then failed and stayed `running` in the sync history. Now a pass pauses briefly
  after large writes, history stops for the pass at 20,000 rows, one request returns at most 10,000
  rows (larger ranges are split), and brand classification does at most 4,000 queries per pass. A
  busy database stops the pass without failing a task; the next pass continues. The final writes of
  a pass retry while the database is busy, and a run left as `running` for 20 minutes is marked as
  interrupted.
- Brand classification no longer resets D1 ("D1 DB exceeded its CPU time limit and was reset"),
  which failed every sync pass once a site had many queries. Writing the brand flags joined the
  queries table to the batch, and without planner statistics SQLite scanned all of a site's queries
  once per query in the batch (1.5 million rows read for 500 flags on a site with 3,000 queries). It
  now looks each query up by its id. A failure while writing brand flags no longer fails the pass:
  the synced data and the daily write count are kept, and the next pass continues the flags.

### Upgrade notes

- Optional, for Google Play revenue and subscriptions: Play Console → **Users and permissions** → the
  service account → **Account permissions** → turn on **View financial data, orders and
  cancellation survey responses** → **Save**, at any time after syncing. Skipping it only leaves
  Google Play revenue and subscriptions empty; `setup_status` reports `probe.play_finance` as `warn`.

- Nothing is required. The new tables are created automatically on the first request after syncing.
  A deployment without app secrets keeps working as before and syncs no app data.
- Optional, to add apps: follow [docs/deploy.md step 14a](docs/deploy.md#14a-apps-app-store-and-google-play-optional)
  after syncing. In short: set `ASC_KEY_ID`, `ASC_ISSUER_ID` and `ASC_PRIVATE_KEY` (a **Sales and
  Reports** key), invite the service account in the Play Console with **View app information and
  download bulk reports**, set `PLAY_REPORTS_BUCKET`, enable the Google Play Developer Reporting API,
  add the app in **Settings** → **Apps**, and start App Store reports there with a temporary Admin key
  (then revoke it). Skipping any of these only leaves that store's data empty; `setup_status` says
  which step is missing.
- Optional: to pick Cloudflare zones and Web Analytics sites from a list when adding a site, edit the
  API token in `CLOUDFLARE_API_TOKEN` (Cloudflare dashboard → **My Profile** or **Account** →
  **API Tokens** → your token → **Edit**) and add **Zone: Read** and **Account Settings: Read**.
  Without them you type the zone ID and site tag yourself.
- Optional, to stop signing in again every day: at any time, in Zero Trust → **Access controls** →
  **Applications** → `Searchkeep` → **Edit** → **Advanced settings**, set **Access token lifetime**
  to `15m` and **Grant session duration** to `336h`; then in **Access controls** → **Access
  settings**, set the global session duration to two weeks or longer (it applies to every Access
  application in your Zero Trust organization). See
  [docs/deploy.md step 8](docs/deploy.md#8-enable-managed-oauth). If you skip it, nothing breaks;
  you keep signing in about once a day.

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
