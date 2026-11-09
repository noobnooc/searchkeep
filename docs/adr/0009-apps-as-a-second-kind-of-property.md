# 0009. Apps as a second kind of property

- Status: Accepted
- Date: 2026-11-09
- Deciders: @noobnooc

## Context

Many Searchkeep users ship an iOS or Android app next to their site. How an app is found in the App
Store and on Google Play (store search, browse, referrers, conversion from the store page) is the
store-side twin of SEO, and the owners have first-party data for it in App Store Connect and the
Play Console. The maintainer asked for apps to be added, kept apart from sites, with the same
principles: the user's own data, in the user's own account, read-only by default, on the free tier.

Constraints that shaped the decision:

- **App Store Connect Analytics Reports** are files, not queries. Apple generates them only after an
  "analytics report request" exists for the app, and creating one needs an API key with the
  **Admin** role. Keys with the **Sales and Reports** role can then list and download the reports.
  Report instances are kept for 35 days; older data needs a `ONE_TIME_SNAPSHOT` request (one per
  month), which goes back to 2024-01-01. Standard reports carry no user-identifying fields; Detailed
  reports add the referring website or app (`Source Info`) with noise and thresholds.
- **Google Play** has no statistics API. The Play Console writes monthly CSV files (UTF-16) to a
  Cloud Storage bucket, readable by a service account the user invites. Store performance by
  traffic source includes the **search terms** that bring visitors from Google Play search. Crash
  and ANR rates come from the Play Developer Reporting API.
- Neither store offers official keyword rankings. Apple publishes official public feeds (top charts,
  app lookup with ratings); Google Play publishes nothing comparable.
- The Worker runs on Workers Free (10 ms CPU, 50 subrequests per invocation) and D1 Free (100,000
  rows written per day), shared with the sites.

## Options considered

1. **Apps as sites**: store app data in `search_facts` with an app pseudo-domain. Little new code,
   but the store funnel (impressions, page views, downloads, installs) has no clicks or positions,
   and every site analysis would have to learn to skip apps.
2. **A separate kind of property** with its own configuration, tables, sync units, analysis
   functions, MCP tools and dashboard area, sharing the Worker, the Store interface, the sync
   budgets and the readiness lock.
3. **A separate Worker for apps.** Contradicts ADR 0001 (one Worker) and doubles the setup.

For starting App Store reports:

- **A. Keep an Admin key in Worker Secrets** so the Worker can create report requests whenever it
  needs to. Simplest for the user, but an Admin key can manage team members, change app metadata
  and pricing and submit builds. Every fork deploys upstream `main` after "Sync fork", so a
  compromised commit or dependency would reach every user's Admin key.
- **B. A one-time, explicit action in the dashboard**: the user pastes a temporary Admin key, the
  Worker uses it in memory for that one request to create the report requests, stores only the
  request ids, and the user revokes the key. The sync reads with a Sales and Reports key.
- **C. A script the agent runs locally** with the Admin key, then stores the request id. More steps,
  and the key passes through the agent's environment.

## Decision

Option 2, with option B for App Store reports.

- **Configuration.** Apps are added in the dashboard (`app_configs`) or in the optional `APPS`
  secret, like sites (ADR 0008): an `id`, a `name`, the App Store Apple ID and/or the Google Play
  package name, optionally the id of one of the user's sites, and the territories for the public
  feeds. `validateApp` in core checks both sources.
- **Credentials.** App Store Connect: `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_PRIVATE_KEY`, a key with
  the **Sales and Reports** role (ES256 JWTs signed with WebCrypto, no dependency). Google Play: the
  Search Console service account by default (`PLAY_CLIENT_EMAIL` and `PLAY_PRIVATE_KEY` override
  it) and `PLAY_REPORTS_BUCKET`, the `pubsite_prod_…` bucket.
- **Starting App Store reports (B).** `POST /api/app-configs/:id/enable-app-store` takes a temporary
  Admin key in the request body, creates an `ONGOING` and a `ONE_TIME_SNAPSHOT` request (or finds
  the existing ones), stores their ids in D1, and never stores, logs or returns the key. It is a
  dashboard action only, never an MCP tool and never automatic. The same action restarts reports
  that Apple stopped for inactivity, and requests a new snapshot (at most once a month).
- **Reports read.** App Store Discovery and Engagement (Standard, and Detailed for referrers), App
  Downloads (Standard, and Detailed for referrers), App Store Installation and Deletion (Standard)
  and App Crashes; customer reviews. Google Play store performance (by country and by traffic source
  with search terms), installs, ratings and reviews from Cloud Storage; crash and ANR rates from the
  Reporting API. Counts come from Standard reports; Detailed reports are read only for referrers.
- **Sync.** The same units, budgets and backoff as the sites. App Store instances of one report are
  processed oldest first, so a newer instance always overwrites an older one for the same day, and
  a day's values are replaced as a whole. The snapshot only fills days older than the ones the
  ongoing reports cover. Play files are read again only when their Cloud Storage generation changes.
- **Storage.** New tables `app_configs`, `app_store_daily` (one row per app, store, day, territory
  and source: impressions, page views, downloads, redownloads, installs, deletions, active devices),
  `app_search_terms`, `app_referrers`, `app_ratings`, `app_reviews` (without reviewer names),
  `app_vitals` and `app_chart_ranks`. Play's two store performance breakdowns are kept as rows with
  territory `*` (by source) and source `*` (by territory); the Store chooses the right rows.
- **Public App Store data** is an opt-in plugin (`APP_STORE_PUBLIC_DATA=true`, off by default). It
  reads only Apple's official feeds (iTunes Lookup and the top chart feeds) and stores only the
  user's own app's rating and chart position. There is no Google Play counterpart.
- **Entrances.** Five read-only MCP tools (`list_apps`, `app_performance`, `app_search_terms`,
  `app_reviews`, `app_stability`), extending the list in ADR 0006, and an Apps area in the dashboard
  that uses the same functions.

## Consequences

- Sites keep working exactly as before; a deployment without app secrets syncs no app data.
- The App Store Admin key exists only for the seconds of one request. If Apple stops a request (no
  downloads for a long time), the dashboard and `setup_status` ask the user to start it again.
- Report columns are read by name, as Apple asks; a renamed column shows up as missing data, not as
  a crash. Numbers are not guaranteed to match the App Store Connect website, which Apple does not
  promise either; the views state what each metric counts.
- Large apps can exceed the Workers Free CPU limit while reading a report file. Interrupted units
  are skipped after three attempts like any other unit; such apps need Workers Paid.
- Revisit if Apple lets Sales and Reports keys create report requests, if Google Play adds a
  statistics API, or if app data outgrows D1 Free.
