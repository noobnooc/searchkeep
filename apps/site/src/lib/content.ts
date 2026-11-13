/**
 * Product facts shared by the landing page, the docs, JSON-LD and llms.txt.
 * Keep these in sync with packages/mcp (tool names, parameters, defaults),
 * packages/core/src/config.ts (secrets) and apps/cloudflare (routes, readiness).
 */

export interface ToolParam {
  name: string;
  type: string;
  required?: boolean;
  description: string;
}

export interface Tool {
  name: string;
  summary: string;
  description: string;
  readOnly: boolean;
  params: ToolParam[];
  example?: string;
}

const site: ToolParam = {
  name: 'site',
  type: 'string',
  description: 'Site `id` or domain (see `list_sites`). Optional when only one site is configured.',
};
const app: ToolParam = {
  name: 'app',
  type: 'string',
  description: 'App `id`, App Store Apple ID or Google Play package (see `list_apps`). Optional when only one app is configured.',
};
const appStore: ToolParam = {
  name: 'store',
  type: '"apple" | "play"',
  description: '`apple` (App Store) or `play` (Google Play). Both when omitted.',
};
const start: ToolParam = {
  name: 'start',
  type: 'YYYY-MM-DD',
  description: 'First day of the range (UTC). Defaults to `end` minus `days` plus one.',
};
const end: ToolParam = {
  name: 'end',
  type: 'YYYY-MM-DD',
  description: 'Last day of the range (UTC). Defaults to the latest day with data.',
};
const days = (def: number): ToolParam => ({
  name: 'days',
  type: 'number',
  description: `Window length in days when \`start\` is omitted (1–3660). Defaults to ${def}.`,
});
const source: ToolParam = {
  name: 'source',
  type: '"gsc" | "bing"',
  description:
    '`gsc` (Google Search Console, daily) or `bing` (Bing Webmaster Tools, weekly; ranges are aligned to whole Monday–Sunday weeks). Defaults to `gsc`.',
};
const searchType: ToolParam = {
  name: 'searchType',
  type: '"web" | "image" | "video" | "news" | "discover" | "googleNews"',
  description:
    'Search Console search type: `web` (default), `image`, `video`, `news` (the News tab in Search), `discover` or `googleNews`. Discover and Google News report pages only, without queries or positions. GSC only.',
};
const crawlerParams = (example: string): ToolParam[] => [
  site,
  start,
  end,
  days(7),
  {
    name: 'groupBy',
    type: 'Array<"crawler" | "operator" | "purpose" | "path" | "status" | "date">',
    description: 'Up to three group-by dimensions. Defaults to `["crawler"]`.',
  },
  { name: 'crawler', type: 'string', description: `Only this crawler, e.g. \`${example}\`.` },
  { name: 'pathContains', type: 'string', description: 'Case-insensitive substring filter on the path.' },
  limit(50),
];
const brand: ToolParam = {
  name: 'brand',
  type: '"all" | "brand" | "non_brand"',
  description: 'Split queries by the brand regex (the site’s `brandRegex` or `BRAND_REGEX`). Defaults to `all`.',
};
const limit = (def: number): ToolParam => ({
  name: 'limit',
  type: 'number',
  description: `Maximum rows returned (1–500). Defaults to ${def}.`,
});

export const TOOLS: Tool[] = [
  {
    name: 'list_sites',
    summary: 'Configured sites, their connected sources and stored date ranges.',
    description:
      'Lists every configured site (added in the dashboard or the `SITES` secret) with the sources connected for it (GSC, Bing, Cloudflare AI and search engine crawlers, Web Analytics, index coverage, country × device segments) and, for each dataset, the first and last date stored in D1. Start here.',
    readOnly: true,
    params: [],
    example: 'Which sites are connected, and how far back does each one’s data go?',
  },
  {
    name: 'query_performance',
    summary: 'Clicks, impressions, CTR and position by any dimension.',
    description:
      'The general-purpose search analytics query. Groups GSC or Bing data by up to three dimensions and filters by query, page, country, device or search appearance. It reads the history stored in D1, so ranges older than 16 months work once you have kept them. Besides web search, GSC data covers image, video, News, Discover and Google News (`searchType`). `country` and `device` combine with `query` or `page` (not both) only for sites in `GSC_SEGMENT_SITES`, which also syncs those rows; otherwise Search Console stores them separately. `appearance` (rich results, videos, AMP, ...) combines only with `date`, `week` and `month`, as Search Console reports it on its own. Bing has no country, device or appearance data and reports queries and pages separately; its site totals take the position of its query rows.',
    readOnly: true,
    params: [
      site,
      start,
      end,
      days(28),
      source,
      searchType,
      {
        name: 'dimensions',
        type: 'Array<"date" | "week" | "month" | "query" | "page" | "country" | "device" | "appearance">',
        description: 'Up to three group-by dimensions. Omit for totals over the range.',
      },
      {
        name: 'queryContains',
        type: 'string',
        description: 'Case-insensitive substring filter on the query text.',
      },
      {
        name: 'pageContains',
        type: 'string',
        description: 'Case-insensitive substring filter on the page path.',
      },
      { name: 'country', type: 'string', description: 'ISO 3166-1 alpha-3 country code, as GSC reports it (e.g. `usa`).' },
      { name: 'device', type: '"DESKTOP" | "MOBILE" | "TABLET"', description: 'Device filter.' },
      {
        name: 'appearance',
        type: 'string',
        description:
          'Only this search appearance, e.g. `VIDEO` or `REVIEW_SNIPPET` (group by `appearance` to list them). GSC web search only.',
      },
      brand,
      {
        name: 'orderBy',
        type: '"clicks" | "impressions" | "ctr" | "position" | "date"',
        description: 'Sort key. Defaults to `date` when grouping by a single time dimension, otherwise `clicks`.',
      },
      {
        name: 'order',
        type: '"asc" | "desc"',
        description: 'Sort direction. Defaults to `asc` for a single time dimension, otherwise `desc`.',
      },
      limit(50),
    ],
    example: 'Top non-brand queries for /pricing over the last 90 days, by week.',
  },
  {
    name: 'compare_periods',
    summary: 'What moved between two periods, and by how much.',
    description:
      'Compares a period with the equal-length period right before it, or with a custom comparison period, and returns totals for both, the change in clicks and impressions, and the queries or pages that gained and lost the most clicks, with impression and position deltas.',
    readOnly: true,
    params: [
      site,
      start,
      end,
      days(28),
      source,
      searchType,
      { name: 'dimension', type: '"query" | "page"', description: 'What to compare. Defaults to `query`.' },
      {
        name: 'compareStart',
        type: 'YYYY-MM-DD',
        description: 'Start of the comparison period. Set it together with `compareEnd`; otherwise the previous period is used.',
      },
      { name: 'compareEnd', type: 'YYYY-MM-DD', description: 'End of the comparison period.' },
      brand,
      limit(20),
    ],
    example: 'What dropped the most this month compared to the same month last year?',
  },
  {
    name: 'find_quick_wins',
    summary: 'High-impression queries ranking just off the top.',
    description:
      'Finds queries with an average position between `minPosition` and `maxPosition` and enough impressions to matter, together with the page that ranks for each (GSC), ranked by the extra clicks available if they reached position 3 at a benchmark CTR. These are usually the cheapest traffic to win.',
    readOnly: true,
    params: [
      site,
      start,
      end,
      days(28),
      source,
      searchType,
      { name: 'minPosition', type: 'number', description: 'Lower bound of average position. Defaults to 8.' },
      { name: 'maxPosition', type: 'number', description: 'Upper bound of average position. Defaults to 20.' },
      {
        name: 'minImpressions',
        type: 'number',
        description: 'Ignore queries below this. Defaults to twice the number of days in the range (at least 10).',
      },
      brand,
      limit(25),
    ],
  },
  {
    name: 'find_cannibalization',
    summary: 'Queries where several of your pages compete.',
    description:
      'Finds queries for which two or more of your pages each get a meaningful share of the impressions, with each page’s impressions, clicks, position and share, so you can consolidate or differentiate them. Search Console only, because it needs query × page data.',
    readOnly: true,
    params: [
      site,
      start,
      end,
      days(28),
      searchType,
      { name: 'minImpressions', type: 'number', description: 'Minimum impressions per query/page pair. Defaults to 10.' },
      {
        name: 'minShare',
        type: 'number',
        description: 'Minimum share of the query’s impressions a page needs to count (0.01–0.5). Defaults to 0.1.',
      },
      brand,
      limit(25),
    ],
  },
  {
    name: 'find_ctr_anomalies',
    summary: 'Queries with a CTR well below what their position predicts.',
    description:
      'Compares each query’s CTR with the median CTR of your own queries at the same rounded position (a benchmark curve when there are fewer than 8 samples) and returns the queries below `expected × threshold`, ranked by lost clicks. Only positions up to 20 count. Typical causes: a weak title or description, a rich result taking the click, or a mismatch with search intent.',
    readOnly: true,
    params: [
      site,
      start,
      end,
      days(28),
      source,
      searchType,
      {
        name: 'minImpressions',
        type: 'number',
        description: 'Minimum impressions per query. Defaults to five times the number of days in the range (at least 50).',
      },
      {
        name: 'threshold',
        type: 'number',
        description: 'Flag a query when its CTR is below the expected CTR times this (0.05–0.95). Defaults to 0.5.',
      },
      brand,
      limit(25),
    ],
  },
  {
    name: 'find_content_decay',
    summary: 'Pages whose clicks have been sliding for weeks.',
    description:
      'Compares each page’s last 4 weeks of clicks with its best earlier 4-week window and returns the pages that fell by at least `minDecline` and are still trending down (not a single bad week), with peak and recent weekly clicks and the full weekly series.',
    readOnly: true,
    params: [
      site,
      end,
      { name: 'weeks', type: 'number', description: 'Weeks of history to analyse (8–104). Defaults to 16.' },
      { name: 'minWeeklyClicks', type: 'number', description: 'Ignore pages below this many weekly clicks at their peak. Defaults to 5.' },
      { name: 'minDecline', type: 'number', description: 'Minimum decline from the peak (0.05–0.95). Defaults to 0.3.' },
      source,
      searchType,
      brand,
      limit(25),
    ],
  },
  {
    name: 'geo_funnel',
    summary: 'Crawled → Cited → Clicked, per page.',
    description:
      'Joins, for each page, AI crawler requests (Cloudflare), citations in AI answers (imported from Bing AI Performance CSV exports), visits referred by AI assistants (Web Analytics) and search clicks and impressions (GSC plus Bing). Returns totals, the pages, and the most-crawled pages that were never cited (once citation data exists). Notes say which step has no data and why.',
    readOnly: true,
    params: [
      site,
      start,
      end,
      days(28),
      { name: 'pageContains', type: 'string', description: 'Case-insensitive substring filter on the page path.' },
      {
        name: 'sortBy',
        type: '"crawled" | "cited" | "aiVisits" | "clicks" | "impressions"',
        description: 'Sort key, descending. Defaults to `crawled`.',
      },
      limit(50),
    ],
    example: 'Which pages do AI crawlers hit but never get cited?',
  },
  {
    name: 'ai_crawlers',
    summary: 'AI crawler requests by bot, operator, purpose, path and status.',
    description:
      'Summarises requests from known AI crawlers and assistants (GPTBot, ClaudeBot, PerplexityBot, OAI-SearchBot and others) recorded by Cloudflare, classified by operator and purpose (`training`, `search`, `user`). Includes HTTP status, so blocked or failing fetches stand out. Without dates, the window ends at the latest day of crawler data.',
    readOnly: true,
    params: [
      site,
      start,
      end,
      days(7),
      {
        name: 'groupBy',
        type: 'Array<"crawler" | "operator" | "purpose" | "path" | "status" | "date">',
        description: 'Up to three group-by dimensions. Defaults to `["crawler"]`.',
      },
      { name: 'crawler', type: 'string', description: 'Only this crawler, e.g. `GPTBot`.' },
      { name: 'pathContains', type: 'string', description: 'Case-insensitive substring filter on the path.' },
      limit(50),
    ],
    example: 'Are any AI crawlers getting 4xx or 5xx responses from us?',
  },
  {
    name: 'search_crawlers',
    summary: 'Search engine crawler requests: Crawl stats, kept.',
    description:
      "Summarises requests from search engine crawlers (Googlebot and its image, video and news crawlers, Bingbot, YandexBot, Baiduspider, DuckDuckBot, Applebot and others) recorded by Cloudflare, classified by operator and purpose (`search`, `media`, `ads`, `other`). It is the closest thing to Search Console's Crawl stats report, which has no API: crawl volume per day, response codes and the most crawled pages, for as long as you keep them. Crawlers are matched by user agent; up to 2,000 page × status rows are kept per day and the rest is summed under `(other pages)`.",
    readOnly: true,
    params: crawlerParams('Googlebot'),
    example: 'How often did Googlebot crawl us this week, and which pages returned 404?',
  },
  {
    name: 'index_coverage',
    summary: 'Indexed and not-indexed sitemap URLs, with reasons and rich results.',
    description:
      'Reads the index coverage snapshot the sync builds: the URLs of the sitemaps Search Console knows (up to 5,000 per site), inspected with the URL Inspection API in daily batches (`GSC_INSPECTIONS_PER_DAY`, default 200) and again about weekly. Returns how many are indexed, URL counts per coverage state (Crawled - currently not indexed, Soft 404, duplicates, ...), rich result (structured data) verdicts and issues, the URLs in a state, and coverage changes. It uses no quota itself.',
    readOnly: true,
    params: [
      site,
      {
        name: 'coverageState',
        type: 'string',
        description: 'Only URLs whose coverage state contains this text, e.g. `crawled - currently not indexed`.',
      },
      {
        name: 'verdict',
        type: '"PASS" | "NEUTRAL" | "FAIL" | "PENDING" | "ERROR"',
        description: '`PASS` = indexed, `NEUTRAL` = excluded, `FAIL` = error, `PENDING` = not inspected yet, `ERROR` = inspection failed.',
      },
      { name: 'richResultIssues', type: 'boolean', description: 'Only URLs with rich result issues.' },
      { name: 'changedDays', type: 'number', description: 'List coverage changes of the last N days (1–365). Defaults to 7.' },
      limit(50),
    ],
    example: 'Which of my pages are not indexed, and why?',
  },
  {
    name: 'inspect_url',
    summary: 'Live Google URL Inspection for one URL.',
    description:
      'Calls the Search Console URL Inspection API in real time: verdict, coverage and indexing state, robots.txt and fetch state, last crawl time, the canonical chosen by Google and the one you declared, mobile usability and rich results verdicts, and a link to the full report. Google allows about 2,000 inspections per property per day.',
    readOnly: true,
    params: [
      site,
      { name: 'url', type: 'string', required: true, description: 'Absolute URL, or a path on the site (resolved against its domain).' },
    ],
  },
  {
    name: 'list_sitemaps',
    summary: 'Sitemaps known to Search Console, with status.',
    description:
      'Lists the sitemaps Search Console knows for the property, with last submitted and downloaded times, pending state, errors, warnings and submitted URL counts. Google no longer reports indexed counts per sitemap; `index_coverage` counts the indexed URLs instead. By default it reads the snapshot the sync takes once a day.',
    readOnly: true,
    params: [site, { name: 'live', type: 'boolean', description: '`true` refreshes the list from the Search Console API first.' }],
  },
  {
    name: 'app_framework_report',
    summary: 'One of the app’s chosen App Store Framework Usage reports, grouped by any of its dimensions.',
    description:
      'Framework Usage reports from App Store Connect Analytics (for example Notification Summary Engagement, App Added to Focus, Mode Activity Notifications, Call Services and Call Performance) chosen per app in Settings → Apps. Their metric columns are summed by date and by any of the report’s dimensions; the answer lists both. Apple leaves out rows below five devices.',
    readOnly: true,
    params: [
      app,
      { name: 'report', type: 'string', description: 'Required. The report name as chosen for the app.' },
      start,
      end,
      days(28),
      { name: 'groupBy', type: 'string[]', description: 'Dimension columns of the report and/or `date`. Default: totals.' },
      { name: 'filters', type: 'Record<string, string>', description: 'Only rows whose dimension has this value.' },
      limit(50),
    ],
    example: 'How often do people tap our notifications in the notification summary?',
  },
  {
    name: 'reply_review',
    summary: 'Replies to an App Store or Google Play review, after a preview. Off by default.',
    description:
      'Writes to an external system: the reply is public and the reviewer is notified. Registered only with ENABLE_WRITES=true. The first call returns a preview and a confirmation token and posts nothing; the second call, with the same arguments and the token (valid 15 minutes), posts. App Store replies use their own Customer Support key (ASC_REPLY_*); Google Play replies need PLAY_REVIEWS_API and “Reply to reviews” (at most 350 characters).',
    readOnly: false,
    params: [
      app,
      { name: 'store', type: '"apple" | "play"', description: 'Required.' },
      { name: 'reviewId', type: 'string', description: 'Required. From app_reviews.' },
      { name: 'text', type: 'string', description: 'Required. The reply.' },
      { name: 'confirmToken', type: 'string', description: 'From the preview, after the user confirmed.' },
    ],
    example: 'Draft a reply to the newest one-star review and post it after I approve.',
  },
  {
    name: 'submit_sitemap',
    summary: 'Submit a sitemap to Search Console. Off by default.',
    description:
      'The only tool that writes to an external system. It is not registered unless `ENABLE_WRITES` is `true`, and it needs the service account to have Full (not Restricted) permission on the GSC property. It is annotated as a write so MCP clients ask before running it.',
    readOnly: false,
    params: [site, { name: 'sitemapUrl', type: 'string', required: true, description: 'Absolute `https` URL of the sitemap.' }],
  },
  {
    name: 'setup_status',
    summary: 'Readiness, configuration and sync health in one call.',
    description:
      'Reports the readiness state with one line per check: the Access checks, configuration errors, which secrets are present (never their values), live probes of the Cloudflare token, Search Console and Bing, and the most recent sync. It also returns each site’s connected sources, the date range stored per dataset and recent sync runs. Agents call it to verify a deployment. Like every tool it is served only once the deployment is `ready`; before that, `/mcp` returns a JSON-RPC error naming the state, and the dashboard’s status page (`/api/status`) shows the readiness checks.',
    readOnly: true,
    params: [{ name: 'probe', type: 'boolean', description: 'Call the source APIs to verify credentials. Defaults to `true`.' }],
    example: 'Run setup_status and tell me what is still missing.',
  },
  {
    name: 'list_apps',
    summary: 'Configured apps, their stores and stored date ranges.',
    description:
      'Lists every configured app (added in the dashboard or the `APPS` secret) with the stores connected for it (App Store Connect, Google Play, the opt-in App Store public feeds), whether App Store reports are started, and for each dataset the first and last date stored in D1. Start here for app questions.',
    readOnly: true,
    params: [],
  },
  {
    name: 'app_performance',
    summary: 'The store funnel, revenue and sessions of an app, per store, against the previous period.',
    description:
      'Impressions (App Store), page views (App Store product page views, Google Play store listing visitors), downloads (first-time downloads, store listing acquisitions), redownloads, installs, deletions, active devices and conversion rates per store, plus App Store revenue (purchases, proceeds and sales in USD, paying users, proceeds per download) and sessions (sessions, average length, sessions per device), compared with the previous period of the same length. `groupBy` adds rows by date, week, month, store, territory, source (search, browse, app_referrer, web_referrer, referral, ...) or referrer: the websites, apps and UTM sources that sent people to the store page, with your own site marked; `page_type` and `page_title` list the App Store funnel per product page type, custom product page and in-app event. Institutional purchases (App Store licenses bought in bulk through Apple Business Manager or Apple School Manager) are left out of the totals and trends and listed only by source. With the opt-in public feeds, it also returns your app’s App Store chart positions.',
    readOnly: true,
    params: [
      app,
      appStore,
      start,
      end,
      days(28),
      {
        name: 'groupBy',
        type: 'string[]',
        description:
          'Up to two of `date`, `week`, `month`, `store`, `territory`, `source`, `referrer`, `page_type`, `page_title`. Default: totals per store only.',
      },
      { name: 'territory', type: 'string', description: 'Only this territory, as the store reports it (e.g. `US`).' },
      {
        name: 'source',
        type: 'string',
        description: 'Only this source: `search`, `browse`, `app_referrer`, `web_referrer`, `referral`, ...',
      },
      { name: 'referrerKind', type: '"web" | "app" | "utm"', description: 'With `groupBy` referrer: only websites, apps or UTM sources.' },
      {
        name: 'includeChanges',
        type: 'boolean',
        description: 'List each day’s store changes in the series (see app_changes). Default `true`.',
      },
      limit(50),
    ],
    example: 'How did App Store search conversion change this month, by territory?',
  },
  {
    name: 'app_search_terms',
    summary: 'Google Play search terms with visitors, acquisitions and conversion.',
    description:
      'The Google Play search terms that brought store listing visitors, with acquisitions, conversion and the change in visitors against the previous period, plus `lowConverting`: well-visited terms that convert well below the app’s average. The App Store reports no search terms.',
    readOnly: true,
    params: [
      app,
      start,
      end,
      days(28),
      { name: 'termContains', type: 'string', description: 'Case-insensitive substring of the term.' },
      { name: 'sortBy', type: '"visitors" | "acquisitions" | "conversion" | "change"', description: 'Defaults to `visitors`.' },
      { name: 'minVisitors', type: 'number', description: 'Minimum visitors for `lowConverting`. Defaults to `20`.' },
      limit(50),
    ],
    example: 'Which Google Play searches bring visitors who rarely install?',
  },
  {
    name: 'app_reviews',
    summary: 'Ratings over time, star distribution and reviews.',
    description:
      'Per store: the average rating over time (Google Play from the Play Console; the App Store from the opt-in public feeds), the star distribution and average of the reviews written in the range, and the reviews themselves, newest first and without reviewer names. Filter by stars, territory, app version or text.',
    readOnly: true,
    params: [
      app,
      appStore,
      start,
      end,
      days(90),
      { name: 'ratings', type: 'number[]', description: 'Only these star ratings, e.g. `[1, 2]`.' },
      { name: 'territory', type: 'string', description: 'Only reviews from this territory.' },
      { name: 'version', type: 'string', description: 'Only reviews of this app version.' },
      { name: 'contains', type: 'string', description: 'Text in the title or body.' },
      limit(30),
    ],
    example: 'What do 1- and 2-star reviews of the latest version complain about?',
  },
  {
    name: 'app_stability',
    summary: 'Crash and ANR rates per day or app version.',
    description:
      'Google Play crash and ANR rates (shares of daily users, including the user-perceived rates behind Google’s bad-behavior thresholds of 1.09% and 0.47%) from the Play Developer Reporting API and crash and ANR counts from the monthly crash files, and App Store crash counts from the App Crashes and App Crashes Expanded reports, per day or per app version. The notes say why data is missing when it is (Apple’s and Google’s minimum numbers of users).',
    readOnly: true,
    params: [
      app,
      appStore,
      start,
      end,
      days(28),
      { name: 'groupBy', type: '"date" | "version"', description: 'Defaults to `date`.' },
      limit(100),
    ],
    example: 'Did the last Android release raise the crash rate?',
  },
  {
    name: 'app_subscriptions',
    summary: 'Subscriptions on both stores per product, offer and country, against the previous period.',
    description:
      'Google Play: new, canceled and active subscriptions per product and country (the Play Console’s subscription statistics; needs the service account to view financial data). App Store: active subscriptions, free trials, paid offers, billing retry and grace period, and trial starts, trial conversions, paid starts, renewals, churn and refunds per subscription, offer type, storefront and download source (Apple’s Subscription State and Event reports; nothing extra to set up). Both against the previous period, with the daily trend.',
    readOnly: true,
    params: [
      app,
      appStore,
      start,
      end,
      days(28),
      { name: 'product', type: 'string', description: 'Only this subscription: Google Play product id or App Store subscription name.' },
      { name: 'territory', type: 'string', description: 'Only this country, e.g. `US`.' },
      {
        name: 'offerType',
        type: 'string',
        description: 'App Store only: `free_trial`, `pay_up_front`, `pay_as_you_go`, or empty for none.',
      },
      limit(50),
    ],
    example: 'Which countries gained the most subscribers this month?',
  },
  {
    name: 'app_changes',
    summary: 'What changed on the app’s store presence and when, with the values before and after.',
    description:
      'Daily snapshots of the App Store version on sale and the one in the works (state, release type, phased release), the on-sale version’s description, keywords, promotional text and release notes per locale, and the app’s name and subtitle; with PLAY_METADATA=true also Google Play titles, descriptions, track releases, rollouts and release notes (read through an edit that is deleted, never committed). Each changed field is listed on the day it was first seen; app_performance’s series lists the same changes per day.',
    readOnly: true,
    params: [
      app,
      appStore,
      start,
      { name: 'end', type: 'YYYY-MM-DD', description: 'Defaults to today.' },
      days(90),
      {
        name: 'entity',
        type: 'string',
        description: '`version`, `listing`, `app_info`, `track`, or an exact entity such as `listing:IOS`.',
      },
      { name: 'field', type: 'string', description: 'e.g. `keywords`, `subtitle`, `promotional_text`, `live`.' },
      { name: 'locale', type: 'string', description: 'e.g. `en-US`.' },
      limit(100),
    ],
    example: 'What did we change on the store page the week downloads dropped?',
  },
  {
    name: 'app_revenue',
    summary: 'App Store revenue per product, with refunds, against the previous period.',
    description:
      'Apple’s USD estimate per product (in-app purchase or paid app) from the App Store Purchases report, with refunds kept apart; with the optional ASC_VENDOR_NUMBER secret also the exact units, proceeds and refunds per SKU in each proceeds currency from Sales and Trends (never added across currencies), and subscription proceeds split into first payments and renewals. Lists refunded products per day.',
    readOnly: true,
    params: [
      app,
      start,
      end,
      days(28),
      { name: 'groupBy', type: '("date" | "product" | "territory" | "type")[]', description: 'Defaults to `product`.' },
      { name: 'product', type: 'string', description: 'Only this product: its name in App Store Connect, or its SKU.' },
      { name: 'territory', type: 'string', description: 'Only this storefront, e.g. `US`.' },
      limit(50),
    ],
    example: 'Which product was refunded on the day revenue went negative?',
  },
  {
    name: 'app_breakdown',
    summary: 'An app’s numbers per app version, device or OS version.',
    description:
      'Google Play installs, uninstalls, active devices, ratings, crashes and ANRs from the Play Console’s per-version, per-device and per-OS files, and App Store sessions and crash counts per app version. Ties a release, a device or an OS version to its ratings and crashes. At most 50 values a day are kept; the rest are summed into “Other”.',
    readOnly: true,
    params: [
      app,
      appStore,
      start,
      end,
      days(28),
      { name: 'dimension', type: '"app_version" | "device" | "os_version"', description: 'Defaults to `app_version`.' },
      limit(50),
    ],
    example: 'Did version 3.2 bring more crashes or a lower rating than 3.1?',
  },
];

/** Tools registered by default; `submit_sitemap` and `reply_review` appear only with `ENABLE_WRITES=true`. */
export const READ_ONLY_TOOLS = TOOLS.filter((t) => t.readOnly);

export interface Secret {
  name: string;
  required: 'yes' | 'for GSC' | 'for Bing' | 'for apps' | 'optional';
  description: string;
  example?: string;
}

export const SECRETS: Secret[] = [
  {
    name: 'ACCESS_TEAM_DOMAIN',
    required: 'yes',
    description: 'Your Cloudflare Zero Trust team domain, hostname only. Used to fetch the signing keys for Access JWTs.',
    example: 'myteam.cloudflareaccess.com',
  },
  {
    name: 'ACCESS_AUD',
    required: 'yes',
    description: 'The Application Audience (AUD) tag of the Access application that protects Searchkeep.',
    example: '4714c1358e65fe4b408ad6d432a5f878f08194bdb4752441fd56faefa9b2b6f2',
  },
  {
    name: 'CLOUDFLARE_ACCOUNT_ID',
    required: 'yes',
    description: 'The Cloudflare account that owns the Worker, the Access application, the zones and the Web Analytics sites.',
    example: '023e105f4ecef8ad9ca31a8372d0c353',
  },
  {
    name: 'CLOUDFLARE_API_TOKEN',
    required: 'yes',
    description:
      'Read-only API token with Account Analytics Read, Zone Analytics Read and Access: Apps and Policies Read. Required even without Cloudflare data: Searchkeep uses it to check your Access setup.',
  },
  {
    name: 'SITES',
    required: 'optional',
    description:
      'Optional JSON array describing each site and its identifiers in every source. Easier: add sites in the dashboard (Settings → Sites), which auto-fills the identifiers it can find.',
  },
  {
    name: 'GSC_CLIENT_EMAIL',
    required: 'for GSC',
    description: 'The `client_email` field of a Google Cloud service-account key.',
    example: 'searchkeep@my-project.iam.gserviceaccount.com',
  },
  {
    name: 'GSC_PRIVATE_KEY',
    required: 'for GSC',
    description: 'The `private_key` field of the same key, including the BEGIN/END lines. Real line breaks and literal `\\n` both work.',
  },
  {
    name: 'BING_API_KEY',
    required: 'for Bing',
    description: 'Bing Webmaster Tools API key. It can also submit URLs and remove sites, so treat it like a password.',
  },
  {
    name: 'BRAND_REGEX',
    required: 'optional',
    description: 'Default brand regex (JavaScript regex source, matched case-insensitively). A site’s `brandRegex` overrides it.',
    example: 'acme|acme\\s?corp',
  },
  {
    name: 'ENABLE_WRITES',
    required: 'optional',
    description:
      'Set to `true` to register `submit_sitemap` (requires Full permission in GSC) and `reply_review` (needs ASC_REPLY_KEY_ID and ASC_REPLY_PRIVATE_KEY, or PLAY_REVIEWS_API).',
    example: 'true',
  },
  {
    name: 'GSC_ROWS_PER_DAY',
    required: 'optional',
    description:
      'Maximum query × page rows stored per day from Search Console (100–100,000). Defaults to `2500`. Higher values keep more of the long tail but cost more D1 writes and Worker CPU per sync.',
    example: '2500',
  },
  {
    name: 'GSC_BACKFILL_MONTHS',
    required: 'optional',
    description: 'How many months of Search Console history to backfill (0–16). Defaults to `16`.',
    example: '16',
  },
  {
    name: 'SYNC_DAILY_WRITE_BUDGET',
    required: 'optional',
    description:
      'Maximum rows history (the Search Console backfill and the Cloudflare lookback) may write per UTC day; the latest days always sync. Defaults to `80000`, below the D1 Free limit of 100,000 rows written per day.',
    example: '80000',
  },
  {
    name: 'SYNC_MAX_CALLS_PER_RUN',
    required: 'optional',
    description:
      'Maximum outbound API calls per sync pass (5–900). Defaults to `35`, within the Workers Free limit of 50 outbound requests per invocation. On Workers Paid, `100` or more makes the first sync of many sites faster.',
    example: '100',
  },
  {
    name: 'GSC_SEARCH_TYPES',
    required: 'optional',
    description:
      'Search Console search types synced besides web search, comma-separated: `image`, `video`, `news` (the News tab), `discover`, `googleNews`. Defaults to all five; `none` for none. A search type without traffic costs one call per 30 days.',
    example: 'image,video,discover',
  },
  {
    name: 'GSC_SEARCH_APPEARANCE',
    required: 'optional',
    description: 'Set to `false` to stop syncing search appearance (rich results, videos, AMP, ...). Defaults to `true`.',
    example: 'false',
  },
  {
    name: 'GSC_SEGMENT_SITES',
    required: 'optional',
    description:
      'Site ids (comma-separated) or `all` whose top 1,000 queries and pages per day are also synced per country and device, for the last 3 months, so `query_performance` can combine them. Off by default because of the extra D1 writes.',
    example: 'acme,docs',
  },
  {
    name: 'GSC_INSPECTIONS_PER_DAY',
    required: 'optional',
    description:
      'URL inspections per site and day for the index coverage snapshot (0–2,000; Google allows 2,000 per property and day, shared with `inspect_url`). Defaults to `200`; `0` turns index coverage off.',
    example: '200',
  },
];

// Apps (ADR 0009): appended to SECRETS below.
const APP_SECRETS: Secret[] = [
  {
    name: 'APPS',
    required: 'optional',
    description:
      'Optional JSON array of your apps: `id`, `name`, `appleId` (App Store Apple ID), `playPackage`, `siteId`, `territories`. Easier: add apps in the dashboard (Settings → Apps).',
  },
  {
    name: 'ASC_KEY_ID',
    required: 'for apps',
    description:
      'Key ID of an App Store Connect API key with the Sales and Reports role. Never an Admin key: Admin keys are used once, from the dashboard, and never stored.',
    example: '2X9R4HXF34',
  },
  { name: 'ASC_ISSUER_ID', required: 'for apps', description: 'The Issuer ID shown above the App Store Connect API keys.' },
  { name: 'ASC_PRIVATE_KEY', required: 'for apps', description: 'Contents of the key’s `AuthKey_<KEY ID>.p8` file.' },
  {
    name: 'PLAY_REVIEWS_API',
    required: 'optional',
    description:
      '`true` to read Google Play reviews of the last week every 4 hours through the Android Publisher API. Needs the “Reply to reviews” permission (Google offers no read-only one).',
  },
  {
    name: 'ASC_REPLY_KEY_ID',
    required: 'optional',
    description:
      'Key ID of a second App Store Connect API key with the Customer Support role, used only by reply_review (with ENABLE_WRITES).',
  },
  { name: 'ASC_REPLY_PRIVATE_KEY', required: 'optional', description: 'Contents of that key’s `.p8` file.' },
  {
    name: 'PLAY_METADATA',
    required: 'optional',
    description:
      '`true` to snapshot Google Play store listings and tracks daily for app_changes. Needs the Android Publisher API and View app information (read-only); the edit used is deleted, never committed.',
  },
  {
    name: 'ASC_VENDOR_NUMBER',
    required: 'optional',
    description:
      'Vendor number from App Store Connect → Payments and Financial Reports. Turns on exact App Store revenue per product from the daily Sales and Trends report (read with the same Sales and Reports key).',
  },
  {
    name: 'PLAY_REPORTS_BUCKET',
    required: 'for apps',
    description:
      'Cloud Storage bucket of your Play Console reports (Download reports → Copy Cloud Storage URI). The full `gs://` URI is accepted.',
    example: 'pubsite_prod_rev_01234567890123456789',
  },
  {
    name: 'PLAY_CLIENT_EMAIL',
    required: 'optional',
    description:
      'Service account for Google Play when it is not the Search Console one; with `PLAY_PRIVATE_KEY`. Defaults to `GSC_CLIENT_EMAIL`.',
  },
  { name: 'PLAY_PRIVATE_KEY', required: 'optional', description: 'Private key of `PLAY_CLIENT_EMAIL`. Defaults to `GSC_PRIVATE_KEY`.' },
  {
    name: 'APP_STORE_PUBLIC_DATA',
    required: 'optional',
    description:
      'Set to `true` to turn on the opt-in plugin that reads Apple’s public App Store feeds once a day and keeps only your own app’s rating and chart position. Off by default.',
    example: 'true',
  },
];
SECRETS.push(...APP_SECRETS);

export const SITE_FIELDS: { name: string; required: boolean; description: string }[] = [
  {
    name: 'id',
    required: false,
    description:
      'Short stable identifier used in tool calls and API URLs: lowercase letters, digits and dashes. Derived from the domain when omitted (`www.acme.com` becomes `acme-com`).',
  },
  { name: 'domain', required: true, description: 'Bare hostname, e.g. `acme.com` (no scheme, no path).' },
  {
    name: 'gscProperty',
    required: false,
    description: 'Search Console property: `sc-domain:acme.com` for a domain property, or `https://acme.com/` for a URL-prefix property.',
  },
  {
    name: 'bingSiteUrl',
    required: false,
    description: 'Site URL exactly as registered in Bing Webmaster Tools, e.g. `https://acme.com/`.',
  },
  { name: 'cloudflareZoneId', required: false, description: 'Zone ID of the proxied zone. Enables AI and search engine crawler data.' },
  {
    name: 'webAnalyticsSiteTag',
    required: false,
    description: 'Cloudflare Web Analytics site tag (not the snippet token). Enables AI referral visits and Web Vitals.',
  },
  { name: 'brandRegex', required: false, description: 'Brand regex for this site; overrides `BRAND_REGEX`.' },
];

export const SITES_EXAMPLE = `[
  {
    "id": "acme",
    "domain": "acme.com",
    "gscProperty": "sc-domain:acme.com",
    "bingSiteUrl": "https://acme.com/",
    "cloudflareZoneId": "023e105f4ecef8ad9ca31a8372d0c353",
    "webAnalyticsSiteTag": "abc123",
    "brandRegex": "acme"
  }
]`;

export interface ReadinessState {
  id: string;
  label: string;
  condition: string;
  dashboard: string;
  api: string;
  cron: string;
}

export const READINESS: ReadinessState[] = [
  {
    id: 'no_access',
    label: 'Not protected by Access',
    condition: 'The request has no valid `Cf-Access-Jwt-Assertion`, or `ACCESS_TEAM_DOMAIN` / `ACCESS_AUD` are not set.',
    dashboard: 'Every page shows the public setup guide.',
    api: '`/api/*` returns 403 with `"code":"locked","state":"no_access"`. `/mcp` returns a JSON-RPC error that explains the lock.',
    cron: 'Does not sync.',
  },
  {
    id: 'oauth_disabled',
    label: 'Managed OAuth off',
    condition:
      'The JWT is valid, but the Access application does not have Managed OAuth enabled, or Searchkeep cannot read the application with `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`.',
    dashboard: 'Status and setup checks only.',
    api: 'Refused with 403 (`/api/status` still answers). `/mcp` returns a JSON-RPC error.',
    cron: 'Does not sync.',
  },
  {
    id: 'policy_too_broad',
    label: 'Policy too broad',
    condition:
      'A policy lets in more than specific people: Everyone, a public email domain such as gmail.com, any identity-provider login, every IP, a whole country, Bypass or Service Auth.',
    dashboard: 'Status and setup checks only.',
    api: 'Refused with 403 (`/api/status` still answers). `/mcp` returns a JSON-RPC error.',
    cron: 'Does not sync.',
  },
  {
    id: 'ready',
    label: 'All checks pass',
    condition: 'All checks pass.',
    dashboard: 'Fully available.',
    api: 'Fully available.',
    cron: 'Syncs every 15 minutes, in small batches.',
  },
];

export const PRINCIPLES = [
  {
    title: 'Your data never leaves your account',
    body: 'Searchkeep runs as one Worker and one D1 database in your Cloudflare account. No telemetry, no vendor server, nothing phones home.',
  },
  {
    title: 'Read-only by default',
    body: 'Every tool reads. The single write, submitting a sitemap, stays unregistered until you set ENABLE_WRITES and grant Full permission.',
  },
  {
    title: 'Free-tier friendly',
    body: 'One Worker, one D1 database and a cron that syncs in small batches, paced to stay within Cloudflare’s free plans for typical sites.',
  },
  {
    title: 'Upgrade = Sync fork',
    body: 'Click “Sync fork” on GitHub. Workers Builds rebuilds and deploys, and the Worker applies new migrations itself. Your config lives in Secrets, so nothing conflicts.',
  },
];

export interface Faq {
  q: string;
  a: string;
}

export const FAQS: Faq[] = [
  {
    q: 'Does Searchkeep work for apps?',
    a: 'Yes. Besides sites, you can add your own iOS and Android apps. Searchkeep keeps their store data from App Store Connect (analytics reports and reviews) and the Google Play Console (bulk reports, search terms and crash rates) apart from your sites, and shows where people find each app, how the store page converts and which websites, including your own, send them. It reads with read-only keys; App Store reports are started once from the dashboard with a temporary Admin key that is never stored.',
  },
  {
    q: 'What is Searchkeep?',
    a: 'Searchkeep is open-source SEO and GEO (generative engine optimization) analytics that you deploy to your own Cloudflare account. It keeps syncing Google Search Console, Bing Webmaster Tools and Cloudflare data into a D1 database, then lets you explore it in a dashboard or ask about it from any MCP client such as Claude, Cursor or ChatGPT.',
  },
  {
    q: 'How much does it cost?',
    a: 'Searchkeep is free and MIT licensed. You pay only for the Cloudflare resources it uses: one Worker, one D1 database and a cron trigger, which fit within Cloudflare’s free plans for typical sites. The history backfill is paced to stay under D1’s free limit of 100,000 rows written per day. Cloudflare Access is part of Zero Trust, which has a free plan for small teams.',
  },
  {
    q: 'Does my data leave my Cloudflare account?',
    a: 'No. Searchkeep has no backend of its own and sends no telemetry. Data flows from Google, Bing and Cloudflare APIs into your D1 database and is served only to you, through Cloudflare Access. When you ask a question over MCP, the tool results go to the AI client you chose to connect, just like any other MCP server.',
  },
  {
    q: 'What is the GEO funnel?',
    a: 'It follows each page through three steps of AI visibility: Crawled (AI crawlers fetched it, from Cloudflare), Cited (an AI answer referenced it, from the Bing AI Performance report, which has no API yet, so you import its CSV export from the dashboard) and Clicked (people arrived from an AI assistant, from Web Analytics referrers, alongside classic GSC and Bing clicks). Gaps between steps tell you what to fix.',
  },
  {
    q: 'How far back does the history go?',
    a: 'After you deploy, Searchkeep backfills as much as Google provides, which is 16 months, up to 30 days per request. For a small site that takes a few hours; sites with a lot of data take days on the free D1 write quota. It never deletes anything, so your history keeps growing past the point where Search Console forgets it. The earlier you deploy, the more you keep.',
  },
  {
    q: 'Why no backlinks, competitor data or rank tracking?',
    a: 'By design. Searchkeep only uses first-party data you already have access to for sites you own. Backlink indexes and rank trackers depend on large-scale crawling or SERP scraping, which needs a vendor and is outside the project’s charter. Pair Searchkeep with a dedicated tool if you need them.',
  },
  {
    q: 'Do I need a paid Cloudflare plan?',
    a: 'No. AI crawler data requires the site to be proxied through Cloudflare (orange-clouded), which works on the free plan; Searchkeep identifies crawlers by user agent. AI referrals come from Web Analytics referrer hosts. Workers Free allows 10 ms of CPU per invocation, so the sync works in small batches; if sync units keep getting skipped, lower GSC_ROWS_PER_DAY or move to Workers Paid.',
  },
  {
    q: 'Can an AI agent deploy it for me?',
    a: 'Yes. The deploy guide is written as an idempotent runbook with a verification for every step. An agent with GitHub and Cloudflare MCP access can fork the repo, create the Worker, configure Access and set Secrets. A few steps need a human: authorizing the Cloudflare GitHub App, creating the Zero Trust organization, adding the service account in Search Console, generating the Bing API key and signing in through Access.',
  },
  {
    q: 'Which AI clients can connect?',
    a: 'Any MCP client that supports Streamable HTTP with OAuth, including Claude, Claude Code, Cursor and ChatGPT. Cloudflare Access acts as the OAuth server with dynamic client registration and PKCE, so there is no client ID to paste: the client opens a browser, you sign in, and it is connected.',
  },
  {
    q: 'How do I upgrade?',
    a: 'Open your fork on GitHub and click “Sync fork”. Workers Builds notices the new commit, builds and deploys, and the Worker applies any new D1 migrations itself on its next request. Your configuration lives in Worker Secrets, never in the repo, so upstream changes do not conflict with it.',
  },
];

/**
 * Deploying with an AI agent: what the agent must be able to reach, and the two-line prompt to paste.
 * The rules (ask for names, stop at [Human] steps, keep secrets out of chat) live at the top of
 * docs/deploy.md, which the prompt points to. README.md carries the same prompt; scripts/embed-build.mjs
 * fails the build if they differ in anything but whitespace.
 */
export const AGENT_PREREQS: { icon: 'github' | 'cloudflare'; title: string; text: string }[] = [
  {
    icon: 'github',
    title: 'GitHub access',
    text: 'The GitHub MCP server or the gh CLI, signed in as you, so the agent can fork the repository.',
  },
  {
    icon: 'cloudflare',
    title: 'Cloudflare access',
    text: 'The Cloudflare MCP server signed in as you, or a short-lived API token that can edit Workers Scripts, Workers Builds and Access apps and read your zones.',
  },
];

// A repository path, not a URL: the agent reads it with its GitHub access, so it works while the
// repository is private as well as once it is public.
export const AGENT_PROMPT = `Deploy Searchkeep to my Cloudflare account by following docs/deploy.md
in the GitHub repository noobnooc/searchkeep.`;
