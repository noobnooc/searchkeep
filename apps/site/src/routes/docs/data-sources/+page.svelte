<script lang="ts">
  import Callout from '#lib/components/Callout.svelte';
  import CodeBlock from '#lib/components/CodeBlock.svelte';

  const importCsv = `# From a machine with cloudflared; it opens a browser to sign in through Access.
cloudflared access curl "https://searchkeep.example.com/api/import/ai-citations?site=acme&date=2026-11-01" \\
  -X POST --data-binary @ai-performance.csv
# {"site":"acme","imported":42,"skipped":0,"rowsWritten":42,"columns":{"page":"URL","citations":"Citations","date":null}}`;
</script>

<h2 id="overview">Overview</h2>
<p>
  Searchkeep reads three first-party sources through their official APIs. Each is optional and configured per site in
  <a href="/docs/configuration#sites"><code>SITES</code></a>. AI citations, which have no API yet, are imported from a
  CSV export.
</p>
<div class="table-wrap">
  <table>
    <thead><tr><th>Source</th><th>Credential</th><th>What Searchkeep pulls</th><th>Granularity</th></tr></thead>
    <tbody>
      <tr>
        <td>Google Search Console</td>
        <td>Service account (<code>webmasters.readonly</code>), Restricted user</td>
        <td>Search Analytics (web, image, video, News, Discover, Google News, search appearance), sitemaps, URL Inspection (index coverage)</td>
        <td>Daily</td>
      </tr>
      <tr>
        <td>Bing Webmaster Tools</td>
        <td>API key</td>
        <td>Traffic totals, query and page stats, crawl issues</td>
        <td>Weekly</td>
      </tr>
      <tr>
        <td>Cloudflare</td>
        <td>API token (read-only)</td>
        <td>AI and search engine crawler requests, Web Analytics page views and referrers, Web Vitals</td>
        <td>Daily</td>
      </tr>
      <tr>
        <td>Bing AI Performance</td>
        <td>None (CSV import)</td>
        <td>Citations of your pages in AI answers</td>
        <td>Per import</td>
      </tr>
    </tbody>
  </table>
</div>

<h2 id="sync">How syncing works</h2>
<p>
  A Cron Trigger runs <strong>every 15 minutes</strong>. Each pass does only the work that is due, within a budget of
  API calls (<code>SYNC_MAX_CALLS_PER_RUN</code>), time and D1 writes, stores its progress in D1 and stops; the next
  pass continues where it left off. A pass with nothing due exits immediately. The cron only syncs once the deployment
  has recorded <code>ready</code>, and every pass re-checks Access first. Analysis and MCP tools then read from D1, which
  is why answers are fast and do not consume API quotas. Live calls are reserved for operations that must be current,
  such as <code>inspect_url</code>.
</p>
<ul>
  <li>
    <strong>The latest days first, for every site.</strong> Every day each source is brought up to date before any
    history is backfilled: Search Console re-pulls the last 4 days and fills gaps of up to 30 days, the sitemap snapshot
    is refreshed, Bing is pulled in full, and Cloudflare adds each missing day of AI crawler requests and Web Analytics.
    This work goes round-robin over the sites, so with many sites each one gets its latest days early. The other
    datasets follow: Search Console’s other search types and search appearance, the opt-in country × device segments,
    and search engine crawler requests. Each keeps its own cursors, so a dataset added by an upgrade backfills on its
    own.
  </li>
  <li>
    <strong>Then history, for all sites at once.</strong> Search Console back 16 months
    (<code>GSC_BACKFILL_MONTHS</code>; 3 months for the segments), AI and search engine crawler requests back 30 days
    and Web Analytics back 90 days, newest day first across all sites. History stops for the day when it has written <code>SYNC_DAILY_WRITE_BUDGET</code> rows (80,000 by
    default, under D1 Free’s 100,000 rows written per day), so on the free plan sites with a lot of data take days.
  </li>
  <li>
    <strong>Index coverage with the calls left over.</strong> Once a day the URLs of the sitemaps Search Console knows
    are read from your site, then up to <code>GSC_INSPECTIONS_PER_DAY</code> of them (200 by default) are inspected,
    never-inspected URLs first, each again after about a week. This work only uses calls the other work left, so it never
    slows the sync down.
  </li>
  <li>
    <strong>Many days per request.</strong> Search Console and Cloudflare answer for a date range with one row per day,
    so one request covers up to 30 days of Search Console, 30 days of AI crawler requests or 90 days of Web Analytics.
    A range with more rows than one request returns, or one the API refuses, is split into shorter ranges, down to single
    days; <code>GSC_ROWS_PER_DAY</code> still applies per day.
  </li>
  <li>
    <strong>Rate limits pause one source.</strong> When an API rate-limits Searchkeep (Bing does this quickly), that
    source is paused for every site, from 30 minutes up to 8 hours, while the other sources keep syncing. Bing often
    refuses the shared egress IPs of Workers (<code>ThrottleIP</code>), sometimes for days; Searchkeep then sends its
    Bing calls through Cloudflare Browser Run, whose IPs Bing accepts. A task that
    fails is retried later with a growing delay instead of on every pass.
  </li>
  <li>
    <strong>Progress is visible.</strong> While a site’s latest days are still coming in, the dashboard shows a banner
    with each source’s progress and fills in the views as data arrives. <strong>Settings → Sync progress</strong> lists
    every site and dataset, and <code>setup_status</code> reports the same to an AI client.
  </li>
  <li>
    <strong>Small batches.</strong> Workers Free allows 10 ms of CPU per invocation, so work is split into small units.
    A unit that is interrupted three times in a row (for example by the CPU limit) is skipped, so the sync never gets
    stuck; if that keeps happening, lower <code>GSC_ROWS_PER_DAY</code> or move to Workers Paid.
  </li>
  <li>
    <strong>Upserts by date.</strong> Every row is keyed by its date (or week), so re-running a sync is safe and
    idempotent.
  </li>
  <li>
    <strong>Nothing is deleted.</strong> Data older than a source’s retention window stays in D1. That is the whole
    point.
  </li>
</ul>
<p>
  To run a pass right away, use <strong>Sync now</strong> in the dashboard’s Settings, or <code>POST /api/sync</code>
  from an authenticated session. The dashboard also lists recent sync runs and what each one did.
</p>

<h2 id="gsc">Google Search Console</h2>
<h3 id="gsc-access">Access</h3>
<ul>
  <li>A Google Cloud service account with the <strong>Google Search Console API</strong> enabled in its project.</li>
  <li>Its key’s <code>client_email</code> and <code>private_key</code> in <code>GSC_CLIENT_EMAIL</code> and <code>GSC_PRIVATE_KEY</code>.</li>
  <li>
    The service account’s email added to each property as a <strong>Restricted</strong> user. It uses the
    <code>webmasters.readonly</code> scope. Grant <strong>Full</strong> only if you enable
    <code>submit_sitemap</code>.
  </li>
  <li>
    <code>gscProperty</code> must match the property exactly: <code>sc-domain:example.com</code> for domain properties,
    <code>https://example.com/</code> for URL-prefix properties.
  </li>
</ul>
<h3 id="gsc-data">Data</h3>
<ul>
  <li>
    Search Analytics per day: site totals, totals by country and device, and query × page rows with clicks,
    impressions, CTR and position.
  </li>
  <li>
    The other search types (<code>GSC_SEARCH_TYPES</code>, all by default): image and video search and the News tab
    (totals and query × page), Discover and Google News (totals and pages; they have no queries or positions).
  </li>
  <li>Search appearance per day (rich results, videos, AMP, ...), unless <code>GSC_SEARCH_APPEARANCE</code> is <code>false</code>.</li>
  <li>
    Opt-in (<code>GSC_SEGMENT_SITES</code>): the top 1,000 queries and pages per day by country and device, for the last
    3 months, so queries and pages can be combined with country and device.
  </li>
  <li>Sitemaps: submission and download times, errors, warnings and submitted URL counts (snapshot once a day).</li>
  <li>
    <strong>Index coverage</strong>: the URLs in your sitemaps (up to 5,000 per site), inspected in daily batches with
    the URL Inspection API: verdict, coverage state, Google’s and your canonical, last crawl and rich result issues, and
    the last change of each URL’s state (<code>index_coverage</code>). URLs no sitemap lists for a week are dropped.
  </li>
  <li>URL Inspection, live, through <code>inspect_url</code>.</li>
</ul>
<h3 id="gsc-limits">Limitations</h3>
<ul>
  <li>
    <strong>16 months of history.</strong> Google keeps only the last 16 months. Searchkeep can backfill exactly that
    much and no more, so history before your deploy date minus 16 months is unavailable. Deploy early.
  </li>
  <li>
    <strong>Anonymized queries.</strong> Google hides rare queries to protect user privacy. Totals by query therefore
    add up to less than the site total. Searchkeep stores site-level totals separately so overall numbers stay correct,
    and labels query-level results accordingly.
  </li>
  <li>
    <strong>Rows per day.</strong> The API returns at most 25,000 rows per request. Searchkeep stores up to
    <code>GSC_ROWS_PER_DAY</code> query × page rows per day (2,500 by default), paging 25,000 at a time when you
    raise it. Raising it keeps more of the long tail at the cost of D1 writes and CPU.
  </li>
  <li><strong>Delay.</strong> Data arrives two to three days late, and the most recent days can change.</li>
  <li>
    <strong>URL Inspection quota.</strong> About 2,000 inspections per property per day, shared by the index coverage
    snapshot (<code>GSC_INSPECTIONS_PER_DAY</code>) and <code>inspect_url</code>.
  </li>
  <li>
    <strong>No indexed count per sitemap.</strong> The Sitemaps API no longer fills <code>indexed</code>; the index
    coverage snapshot counts indexed URLs instead.
  </li>
  <li>
    <strong>Search appearance on its own.</strong> Search Console reports it only by itself (with a date), never
    together with query, page, country or device.
  </li>
</ul>

<h2 id="bing">Bing Webmaster Tools</h2>
<h3 id="bing-access">Access</h3>
<ul>
  <li>An API key from <strong>Settings → API access</strong> in Bing Webmaster Tools, in <code>BING_API_KEY</code>.</li>
  <li>Each user has one key that covers all their verified sites. Set <code>bingSiteUrl</code> to the site URL as registered.</li>
  <li>
    The key can also submit URLs and remove sites. Searchkeep never calls those endpoints, but anyone holding the key
    could. Store it only as a secret.
  </li>
</ul>
<h3 id="bing-data">Data</h3>
<ul>
  <li>
    Traffic totals, query statistics and page statistics: clicks, impressions, average position. Traffic totals carry
    no position; Searchkeep gives them the impression-weighted position of the query rows.
  </li>
  <li>Crawl issues (URL, issue and HTTP code), refreshed once a day.</li>
</ul>
<h3 id="bing-limits">Limitations</h3>
<ul>
  <li>
    <strong>Weekly granularity, no date filter.</strong> The Bing API returns all of its data on every call, aggregated
    by week. Searchkeep pulls it in full once a day and upserts by week. Queries against Bing data align the date range
    to whole Monday–Sunday weeks.
  </li>
  <li><strong>Queries and pages separately.</strong> Bing has no query × page data and no country or device breakdown.</li>
  <li>
    <strong>No API for AI Performance.</strong> Bing’s AI Performance report (citations in Copilot and Bing AI
    answers) has been in public preview since February 2026 without an API; Microsoft says an API is on its backlog. Searchkeep
    imports its CSV export instead, see <a href="#ai-citations">Importing AI citations</a>.
  </li>
</ul>

<h2 id="cloudflare">Cloudflare</h2>
<h3 id="cf-access">Access</h3>
<p>One API token with three read permissions:</p>
<ul>
  <li><strong>Zone · Analytics · Read</strong> for AI and search engine crawler traffic on each zone.</li>
  <li><strong>Account · Account Analytics · Read</strong> for Web Analytics.</li>
  <li><strong>Account · Access: Apps and Policies · Read</strong> for the security checks (not a data source, but the same token).</li>
</ul>
<h3 id="cf-data">Data</h3>
<ul>
  <li>
    <strong>AI crawler requests</strong> from Cloudflare’s HTTP request analytics: requests per day by crawler, path and
    status code. Searchkeep matches the user agent against a list of known AI crawlers and assistants and classifies
    them by operator (OpenAI, Anthropic, Perplexity, Google, and many more) and by purpose: <code>training</code>,
    <code>search</code>, or <code>user</code> (an assistant fetching a page because someone asked).
  </li>
  <li>
    <strong>Search engine crawler requests</strong> from the same analytics: Googlebot (and its image, video and news
    crawlers), Bingbot, YandexBot, Baiduspider, DuckDuckBot, Applebot and others, by day, path and status code, with
    purpose <code>search</code>, <code>media</code>, <code>ads</code> or <code>other</code>. This is the closest
    substitute for Search Console’s Crawl stats report, which has no API. Up to 2,000 path × status rows are kept per day;
    the rest is summed under <code>(other pages)</code>.
  </li>
  <li>
    <strong>Web Analytics</strong>: page views and visits by path and referrer host, used for the <em>Clicked from
    AI</em> step (referrers such as chatgpt.com, perplexity.ai, claude.ai, copilot.microsoft.com, gemini.google.com).
  </li>
  <li><strong>Core Web Vitals</strong>: p75 LCP, INP and CLS by path.</li>
</ul>
<h3 id="cf-limits">Limitations</h3>
<ul>
  <li>
    <strong>Proxied zone required for AI crawler data.</strong> Cloudflare only sees requests that pass through it, so
    the zone must be proxied (orange cloud). DNS-only records produce no crawler data.
  </li>
  <li>
    <strong>User agents only.</strong> On Free plans, crawlers are identified by their user agent, so a bot that
    pretends to be a browser is not counted, and one that spoofs a crawler’s user agent is.
  </li>
  <li>
    <strong>Limited retention.</strong> Cloudflare’s GraphQL analytics keep HTTP request data for at least 31 days and
    Web Analytics for about six months. Searchkeep backfills 30 and 90 days after you add a site and then adds every day,
    so a window that expired before you deployed cannot be recovered.
  </li>
  <li>
    <strong>Referrers are lossy.</strong> Some AI apps strip the referrer, so AI referral visits are a lower bound.
  </li>
</ul>
<Callout kind="warning" title="EU data boundary">
  <p>
    If your Cloudflare account uses the EU data localization boundary (Customer Metadata Boundary), the Web Analytics
    RUM dataset cannot be queried through the API. Page views, AI referrers and Web Vitals will be empty; AI crawler data
    and the other sources are not affected.
  </p>
</Callout>

<h2 id="ai-citations">Importing AI citations</h2>
<p>
  The <em>Cited</em> step of the GEO funnel comes from Bing Webmaster Tools’ <strong>AI Performance</strong> report.
  Because it has no API, you export it as CSV in Bing Webmaster Tools and import the file into Searchkeep:
</p>
<ul>
  <li>
    In the dashboard: <strong>Settings → Import AI citations</strong>.
  </li>
  <li>
    Or from a terminal: <code>POST /api/import/ai-citations?site=&lt;id&gt;&amp;date=&lt;YYYY-MM-DD&gt;</code> with the CSV
    as the request body.
  </li>
</ul>
<CodeBlock lang="bash" code={importCsv} />
<p>
  Columns are detected by name: a URL or page column, a citations column, and an optional date column. Without a date
  column, every row gets the <code>date</code> parameter (today by default). Rows without a URL or a number are skipped
  and counted. Re-importing the same file overwrites the same rows, so it is safe. The CSV can be up to 5 MB.
</p>

<h2 id="geo-funnel">How the GEO funnel is built</h2>
<p>For each page, <code>geo_funnel</code> joins these steps on the normalized path:</p>
<div class="table-wrap">
  <table>
    <thead><tr><th>Step</th><th>Metric</th><th>Source</th></tr></thead>
    <tbody>
      <tr><td>Crawled</td><td>Requests from AI crawlers</td><td>Cloudflare zone analytics</td></tr>
      <tr><td>Cited</td><td>Citations in AI answers</td><td>Imported Bing AI Performance CSV</td></tr>
      <tr><td>Clicked</td><td>Visits referred by AI assistants, plus GSC and Bing clicks for context</td><td>Web Analytics, GSC, Bing</td></tr>
    </tbody>
  </table>
</div>
<p>
  The interesting rows are the gaps: pages that are <strong>crawled but not cited</strong> (AI reads them and moves
  on) and pages that are <strong>cited but not clicked</strong> (AI answers the question without sending anyone). Sort
  with <code>sortBy</code> (<code>crawled</code>, <code>cited</code>, <code>aiVisits</code> or <code>clicks</code>);
  once citation data exists, the result also lists the most-crawled pages that were never cited. When a step has no
  data, the result’s notes say which setting or import is missing.
</p>

<h2 id="caveats">Reading the numbers</h2>
<ul>
  <li>Sum of query rows ≠ site total, because of anonymized queries in GSC and the per-day row limit.</li>
  <li>Bing figures are weekly; daily charts show Bing only at weekly resolution.</li>
  <li>Positions are impression-weighted averages, so they can be re-aggregated exactly across days and pages.</li>
  <li>The latest two or three days of GSC data are provisional and will be revised by the next sync.</li>
  <li>Crawler requests count fetches, not unique pages: one page fetched 50 times counts 50.</li>
</ul>
