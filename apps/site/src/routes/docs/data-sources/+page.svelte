<script lang="ts">
  import Callout from '#lib/components/Callout.svelte';
</script>

<h2 id="overview">Overview</h2>
<p>
  Searchkeep reads three first-party sources through their official APIs. Each is optional and configured per site in
  <a href="/docs/configuration#sites"><code>SITES</code></a>.
</p>
<div class="table-wrap">
  <table>
    <thead><tr><th>Source</th><th>Credential</th><th>What Searchkeep pulls</th><th>Granularity</th></tr></thead>
    <tbody>
      <tr>
        <td>Google Search Console</td>
        <td>Service account (<code>webmasters.readonly</code>), Restricted user</td>
        <td>Search Analytics, sitemaps, URL Inspection</td>
        <td>Daily</td>
      </tr>
      <tr>
        <td>Bing Webmaster Tools</td>
        <td>API key</td>
        <td>Query and page stats, crawl issues, keyword data, AI Performance where available</td>
        <td>Weekly</td>
      </tr>
      <tr>
        <td>Cloudflare</td>
        <td>API token (read-only)</td>
        <td>AI crawler requests, Web Analytics page views, referrers, Web Vitals</td>
        <td>Daily</td>
      </tr>
    </tbody>
  </table>
</div>

<h2 id="sync">How syncing works</h2>
<p>
  A Cron Trigger runs once a day at <strong>03:17 UTC</strong> and syncs every configured source for every site into
  D1. It only runs once the deployment has been confirmed <code>ready</code>. Analysis and MCP tools then read from D1,
  which is why answers are fast and do not consume API quotas. Live calls are reserved for operations that must be
  current, such as <code>inspect_url</code>.
</p>
<ul>
  <li>
    <strong>Upserts by date.</strong> Every row is keyed by its date (or week), so re-running a sync is safe and
    idempotent.
  </li>
  <li>
    <strong>Late data is re-fetched.</strong> Search Console finalizes data with a delay of a few days, so each daily
    run re-pulls the most recent 4 days and overwrites them.
  </li>
  <li>
    <strong>Backfill in batches.</strong> On first run, Searchkeep backfills the full 16 months Search Console offers.
    A single Worker invocation has limited subrequests and CPU time, so the backfill proceeds in batches across several
    runs, with a progress cursor stored in D1. <code>setup_status</code> shows how far it has got.
  </li>
  <li>
    <strong>Nothing is deleted.</strong> Data older than a source’s retention window stays in D1. That is the whole
    point.
  </li>
</ul>

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
  <li>Search Analytics by date, query, page, country and device: clicks, impressions, CTR and position.</li>
  <li>Sitemaps: submission and download times, errors, warnings, submitted vs indexed counts.</li>
  <li>URL Inspection, live, through <code>inspect_url</code>.</li>
</ul>
<h3 id="gsc-limits">Limitations</h3>
<ul>
  <li>
    <strong>16 months of history.</strong> Google keeps only the last 16 months. Searchkeep can backfill exactly that
    much and no more, so history before your deploy date minus 16 months is unavailable. Deploy early.
  </li>
  <li>
    <strong>Anonymized queries.</strong> Google omits rare queries to protect user privacy. Totals by query therefore
    add up to less than the site total. Searchkeep stores site-level totals separately so overall numbers stay correct,
    and labels query-level views accordingly.
  </li>
  <li>
    <strong>25,000 rows per request.</strong> The API returns at most 25,000 rows per call. Searchkeep paginates, but
    very large sites may still see the long tail truncated by Google’s own limits.
  </li>
  <li><strong>Delay.</strong> Data arrives two to three days late, and the most recent days can change.</li>
  <li><strong>URL Inspection quota.</strong> About 2,000 inspections per property per day.</li>
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
  <li>Query statistics and page statistics: clicks, impressions, average position.</li>
  <li>Crawl issues and keyword data.</li>
  <li>AI Performance (citations of your pages in Copilot and Bing AI answers), where the API exposes it.</li>
</ul>
<h3 id="bing-limits">Limitations</h3>
<ul>
  <li>
    <strong>Weekly granularity, no date filter.</strong> The Bing API returns its full history on every call, aggregated
    by week. Searchkeep pulls it in full and upserts by week. When you compare Bing with GSC, Searchkeep aligns GSC to
    weeks first.
  </li>
  <li>
    <strong>AI Performance via API is unconfirmed.</strong> Bing shows AI Performance in its web interface; whether the
    same data is available through the public API is not yet confirmed. The <em>Cited</em> step of the GEO funnel depends
    on it. Without it, the Cited step stays empty and the funnel still connects Crawled to Clicked.
  </li>
</ul>

<h2 id="cloudflare">Cloudflare</h2>
<h3 id="cf-access">Access</h3>
<p>One API token with three read permissions:</p>
<ul>
  <li><strong>Zone · Analytics · Read</strong> for AI crawler traffic on each zone.</li>
  <li><strong>Account · Account Analytics · Read</strong> for Web Analytics.</li>
  <li><strong>Account · Access: Apps and Policies · Read</strong> for the security checks (not a data source, but the same token).</li>
</ul>
<h3 id="cf-data">Data</h3>
<ul>
  <li>
    <strong>AI crawler requests</strong>, from the same data that powers AI Crawl Control: requests per day by crawler,
    path and status code. Searchkeep classifies crawlers by operator (OpenAI, Anthropic, Perplexity, Google, and many
    more) and by purpose: <code>training</code>, <code>search</code>, or <code>user</code> (an assistant fetching a page
    because someone asked).
  </li>
  <li>
    <strong>Web Analytics</strong>: page views and visits by path and referrer host, used for the <em>Clicked from
    AI</em> step (referrers such as chatgpt.com, perplexity.ai, copilot.microsoft.com, gemini.google.com).
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
    <strong>AI referral reports are a paid feature.</strong> Cloudflare’s own AI referral statistics are only on paid
    plans. Searchkeep does not use them; it derives AI referrals from Web Analytics <code>refererHost</code> instead, which
    works on every plan.
  </li>
  <li>
    <strong>Limited retention.</strong> Cloudflare’s GraphQL analytics keep data for a limited time, which is why
    Searchkeep syncs daily: a missed window is not recoverable.
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

<h2 id="geo-funnel">How the GEO funnel is built</h2>
<p>For each page, <code>geo_funnel</code> joins three steps on the normalized path:</p>
<div class="table-wrap">
  <table>
    <thead><tr><th>Step</th><th>Metric</th><th>Source</th></tr></thead>
    <tbody>
      <tr><td>Crawled</td><td>Requests from AI crawlers, by purpose</td><td>Cloudflare zone analytics</td></tr>
      <tr><td>Cited</td><td>Citations in AI answers</td><td>Bing AI Performance, where available</td></tr>
      <tr><td>Clicked</td><td>Visits referred by AI assistants, plus GSC and Bing clicks for context</td><td>Web Analytics, GSC, Bing</td></tr>
    </tbody>
  </table>
</div>
<p>
  The interesting rows are the gaps: pages that are <strong>crawled but not cited</strong> (AI reads them and moves
  on) and pages that are <strong>cited but not clicked</strong> (AI answers the question without sending anyone). Use
  the <code>stage</code> parameter to list only those.
</p>

<h2 id="caveats">Reading the numbers</h2>
<ul>
  <li>Sum of query rows ≠ site total, because of anonymized queries in GSC.</li>
  <li>Bing figures are weekly; daily charts show Bing only at weekly resolution.</li>
  <li>Positions are impression-weighted averages, so they can be re-aggregated exactly across days and pages.</li>
  <li>The latest two or three days of GSC data are provisional and will be revised by the next sync.</li>
  <li>Crawler requests count fetches, not unique pages: one page fetched 50 times counts 50.</li>
</ul>
