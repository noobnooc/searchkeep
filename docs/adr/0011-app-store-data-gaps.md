# 0011. Closing the app data gaps: subscriptions, products, changes, reviews and more

- Status: Accepted
- Date: 2026-11-13
- Deciders: @noobnooc
- Extends: [ADR 0009](0009-apps-as-a-second-kind-of-property.md),
  [ADR 0010](0010-app-revenue-and-engagement.md)

## Context

Analysing a real subscription app on both stores showed data that App Store Connect, Google Play
and Apple Ads offer through their official APIs but Searchkeep did not read or did not show: App
Store subscriptions, revenue per product, what changed on the store page and when, product page
types, analytics sharing rates, near real-time reviews and replies, framework usage reports and
Apple Ads search terms. Some numbers were also misleading (a 100,000-license institutional purchase
on one day) or empty without explanation (crash data of a small app).

What the sources offer (Apple's and Google's documentation, November 2026):

- **Analytics Reports.** The report requests Searchkeep already creates (ADR 0009) also produce
  **App Store Subscription State** and **App Store Subscription Event** (Standard: subscription,
  offer type, territory, download source and page type; counts only, no amounts; history from
  2025-01-01), **App Store Opt-in** (first-time downloaders and how many share analytics), **App
  Crashes Expanded**, and the Framework Usage reports. No new role or request is needed. Page Title
  (custom product pages) exists only in Detailed reports, with noise and a five-user threshold;
  product page optimization treatments are in no report.
- **Sales and Trends** (`GET /v1/salesReports`) is readable with the Sales and Reports role, but
  needs the account's vendor number, which no API returns. SUMMARY SALES has units (refunds
  negative), developer proceeds per unit in the proceeds currency, customer price and currency,
  country, SKU and whether a subscription is new or a renewal. Daily reports are kept for a year.
  The SUBSCRIBER report has one row per subscriber and is not read.
- **App metadata.** `appStoreVersions`, their localizations and `appInfoLocalizations` are read
  with the existing key where Apple allows it. The Android Publisher API reads listings and tracks
  only through an edit, and has only the `androidpublisher` scope (no read-only variant).
- **Reviews.** The Android Publisher reviews API needs the "Reply to reviews" permission even to
  read, and returns only the last week. Replying on the App Store needs a key with the Customer
  Support, App Manager or Admin role.
- **Apple Ads** Campaign Management API: OAuth client credentials signed with ES256, an "API
  Account Read Only" role, search term and impression share reports for the user's own campaigns.

## Decision

The maintainer approved, item by item (#P0-1 to #P2-3 of the request):

1. **App Store subscriptions** from the Subscription State and Event reports (Standard), into
   `app_subscription_metrics_daily` (kind, metric, grouping, subscription, offer type, territory,
   download source for events). `app_subscriptions` gains a `store` parameter; Google Play keeps
   its top-level fields, the App Store is under `appStore`. On by default.
2. **Revenue per product**: App Store Purchases' Content Name is now kept per product (USD
   estimate, no setup), and with the optional `ASC_VENDOR_NUMBER` secret the daily SUMMARY SALES
   report is read and aggregated per day, SKU, country, currency, price and new/renewal. Amounts in
   different currencies are never added up. A new read-only tool `app_revenue`.
3. **Store changes**: a daily snapshot of the App Store version, its localizations and app info,
   and (opt-in, `PLAY_METADATA=true`, because it creates and deletes an edit) Google Play listings
   and tracks. Only changed fields are stored. A new read-only tool `app_changes`, and changes
   attached to `app_performance`'s series.
4. **Product page types and titles** as a breakdown of the funnel; **analytics sharing rate** from
   the Opt-in report; **App Crashes Expanded**; Play crash counts from the monthly files when the
   Reporting API has no rows; **anomaly detection** and an explicit switch for volume purchases.
5. **Reviews**: App Store reviews are read every few hours; Google Play reviews through the API
   only when `PLAY_REVIEWS_API=true` (the permission also allows replies). A write tool
   `reply_review`, registered only with `ENABLE_WRITES=true`, two-step (preview, then confirm with
   a short-lived token). App Store replies use a separate optional key (`ASC_REPLY_KEY_ID`,
   `ASC_REPLY_PRIVATE_KEY`, Customer Support role), never the Sales and Reports key and never an
   Admin key.
6. **Framework usage reports** chosen per app (`frameworkReports` in the app config), stored as
   dimension values and counts, read with one generic tool `app_framework_report`.
7. **Apple Ads** as an optional source with its own read-only credentials (`APPLE_ADS_*`); every
   Apple Ads answer says "not configured" when they are missing.

Every source that needs a permission or a setting has a `setup_status` probe that warns with the
exact steps instead of failing. Store keyword rankings, retention cohorts and category benchmarks
stay out: no official API offers them.

## Consequences

- New tables and migrations; nothing to do by hand for items 1, 2 (without Sales), 4 and 6. Sales
  and Trends, Google Play metadata and reviews, review replies and Apple Ads each need an optional
  secret; their upgrade notes say so.
- The roadmap's "App revenue" and "Apple Ads search terms" move from Later into the current version.
- More rows per day: subscription and framework reports aggregate to a few keys and cap values per
  day, and history stays within the daily write budget.
- The tool list grows by `app_revenue`, `app_changes`, `app_framework_report` and the opt-in
  `reply_review`.
