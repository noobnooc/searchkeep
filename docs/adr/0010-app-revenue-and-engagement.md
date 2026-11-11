# 0010. App revenue and engagement, attributed to acquisition

- Status: Accepted
- Date: 2026-11-11
- Deciders: @noobnooc
- Issue: #44
- Extends: [ADR 0009](0009-apps-as-a-second-kind-of-property.md)

## Context

ADR 0009 brought apps in as the store-side twin of a site: impressions, page views, downloads,
installs, ratings, reviews and crashes. That says which store source and storefront bring
downloads, but not which bring people who open the app or pay, so a source with many downloads that
never pay, or a storefront worth localizing, looks the same as any other. App Store Connect and the
Play Console show those numbers; Searchkeep did not. The maintainer decided (#44) that they belong
in Searchkeep because they change ASO and SEO decisions, and the charter now says so.

What the sources offer (Apple's and Google's documentation, November 2026):

- **App Store Connect Analytics Reports.** The report requests Searchkeep already creates (ADR 0009) also produce **App Store Purchases** and **App Sessions**. Their Standard reports carry no
  user-identifying fields:
  - Purchases: Purchases (negative for refunds), Proceeds in USD, Sales in USD and Paying Users
    (not summable across rows), by Date, Purchase Type, Content Name, Source Type, Page Type,
    Territory, Device, Platform Version and App Download Date. Amounts are Apple's estimates in USD.
  - Sessions: Sessions, Total Session Duration and Unique Devices, by the same kind of dimensions.
    Only people who share analytics count, and only where at least five people have events.
- **Google Play bulk reports.** `financial-stats/subscriptions/` holds new, canceled and active
  subscriptions per day, product and country: aggregated, no personal data. Revenue exists only in
  per-order files (`earnings/`, `sales/`) with order IDs and buyer postcodes, readable only with the
  **View financial data** permission.
- **Install retention** is offered by neither store (Google stopped its retained-installers export
  in 2021; Apple's report catalog has none).

## Options considered

1. **New tables** for revenue and engagement (`app_revenue_daily`, `app_engagement_daily`), as #44
   first proposed.
2. **New columns on `app_store_daily`.** Apple attributes purchases and sessions to the same keys as
   the store funnel (date, territory, source type), so the existing collector, whole-day
   replacement, queries, period comparison and dashboard metrics work unchanged.
3. **A finance dashboard** mirroring App Store Connect's and the Play Console's: per product, per
   order, payouts. Outside the charter's purpose (acquisition decisions) and the per-order data is
   personal.

## Decision

Option 2 for the App Store, within these rules:

- **Scope.** Revenue and engagement the stores attribute to acquisition (store source, page type,
  storefront), so acquisition can be judged by what it brings. No per-order or per-person data is
  stored: financial files are aggregated while they are read, and order IDs, postcodes and
  per-order rows are never stored or logged.
- **App Store.** The sync reads App Store Purchases (Standard) and App Sessions (Standard) through
  the same report requests, into seven new `app_store_daily` columns: `purchases`, `proceeds_cents`,
  `sales_cents`, `paying_users`, `sessions`, `session_seconds`, `session_devices`. Amounts are
  stored in integer cents of the store's currency (App Store: USD). Paying users and devices are
  summed across rows and documented as upper bounds. Report ids remember which report kinds were
  looked for, so a kind added by a new version is looked for on the next sync, not a week later.
- **Analysis.** `app_performance` returns, per store and per row, proceeds and sales in the store's
  currency, purchases, paying users, sessions, and the ratios proceeds per download, average
  session length and sessions per device. Each store states its `currency`. Amounts of different
  currencies are never added up: the dashboard shows a proceeds column only when the rows in view
  share one currency.
- **Google Play** (a later pull request, same ADR): subscription statistics into a table of their
  own (new, canceled, active per day, country, product and base plan); revenue from the earnings
  files only when the service account has View financial data, aggregated while streaming to day,
  buyer country and product type in the account's payout currency, written to the same
  `app_store_daily` columns with source `*`. The sync reports a missing permission instead of
  failing.
- **On by default.** Nothing is opt-in beyond the access the user grants: the App Store data comes
  with the existing key, and Google Play revenue appears once the permission is granted. The data
  never leaves the user's account and sits behind Cloudflare Access like the rest.

## Consequences

- Existing deployments get the App Store data after one migration (seven `ALTER TABLE ... ADD
COLUMN`), with nothing to do by hand.
- `app_store_daily` rows carry more columns; the number of rows does not grow for the App Store.
- Small apps may see few sessions (Apple's five-person threshold, analytics-sharing users only);
  the notes and the dashboard say so rather than implying zero use.
- Proceeds per download divides the proceeds of a period by its downloads: a rough value of a
  download, not a per-user lifetime value.
- Retention cannot be added from these sources. Revisit if either store publishes it, or if a
  per-product view is needed (Apple's `Content Name` is read but not kept).
