<script lang="ts">
  import Seo from '#lib/components/Seo.svelte';
  import { READ_ONLY_TOOLS } from '#lib/content.ts';
  import { GITHUB, SITE } from '#lib/site.ts';
  import { breadcrumbs } from '#lib/schema.ts';
</script>

<Seo
  title="Changelog"
  description="Every Searchkeep release, with what changed and any upgrade steps. v0.1.0 is the first release."
  path="/changelog"
  jsonld={[breadcrumbs([{ name: 'Home', path: '/' }, { name: 'Changelog', path: '/changelog' }])]}
/>

<div class="container page">
  <header class="page-head">
    <span class="eyebrow">Changelog</span>
    <h1>What’s new in Searchkeep</h1>
    <p class="lead">
      Releases, newest first. Upgrade by syncing your fork; anything that needs a manual step is listed under
      <em>Upgrade notes</em>.
    </p>
  </header>

  <ol class="releases">
    <li class="release" id="v0.1.0">
      <div class="when">
        <time datetime={SITE.releaseDate}>November 3, 2026</time>
        <a class="ver" href="#v0.1.0">v0.1.0</a>
      </div>
      <article class="prose body">
        <h2>First release</h2>
        <p>
          The first public version of Searchkeep: self-hosted SEO and GEO analytics that runs as one Worker and one D1
          database in your own Cloudflare account.
        </p>
        <h3>Highlights</h3>
        <ul>
          <li><strong>GEO funnel per page</strong>: AI crawler requests (Cloudflare), AI citations (imported from Bing AI Performance CSV exports) and AI referral visits (Web Analytics), next to GSC and Bing clicks.</li>
          <li><strong>Long-term history</strong>: a sync every 15 minutes in small batches, with daily increments first and a 16-month Search Console backfill paced to D1’s free write quota, and nothing ever deleted.</li>
          <li><strong>MCP server</strong> at <code>/mcp</code> (Streamable HTTP, stateless) with {READ_ONLY_TOOLS.length} read-only tools: {READ_ONLY_TOOLS.map((t) => t.name).join(', ')}; plus <code>submit_sitemap</code>, registered only with <code>ENABLE_WRITES=true</code>.</li>
          <li><strong>Dashboard</strong> served from the same Worker, using the same analysis functions as the MCP tools, with <strong>Sync now</strong> and an AI citation CSV import.</li>
          <li><strong>Brand vs non-brand</strong> filtering on every query-level view via <code>BRAND_REGEX</code> or a per-site <code>brandRegex</code>.</li>
        </ul>
        <h3>Data sources</h3>
        <ul>
          <li>Google Search Console: Search Analytics, sitemaps, URL Inspection.</li>
          <li>Bing Webmaster Tools: traffic, query and page stats, crawl issues.</li>
          <li>Bing AI Performance: citations imported from its CSV export (it has no API).</li>
          <li>Cloudflare: AI crawler requests by crawler, path and status; Web Analytics page views, referrers and Core Web Vitals.</li>
        </ul>
        <h3>Security</h3>
        <ul>
          <li>Cloudflare Access in front of the dashboard and MCP, with Managed OAuth for MCP clients (dynamic client registration, PKCE).</li>
          <li>Access JWT re-verified in the Worker on every request against <code>ACCESS_TEAM_DOMAIN</code> and <code>ACCESS_AUD</code>.</li>
          <li>Readiness states <code>no_access</code>, <code>oauth_disabled</code>, <code>policy_too_broad</code> and <code>ready</code>; data, MCP and sync stay locked until ready.</li>
          <li>Read-only by default; <code>submit_sitemap</code> only with <code>ENABLE_WRITES=true</code>.</li>
        </ul>
        <h3>Deploy</h3>
        <ul>
          <li>Fork and Workers Builds, with D1 auto-provisioned on first deploy; the Worker applies pending migrations itself, so the default build token needs no D1 permission.</li>
          <li>Local development with <code>pnpm dev</code> and demo data.</li>
          <li>Agent-ready runbook in <code>docs/deploy.md</code> and <code>AGENTS.md</code>.</li>
        </ul>
        <h3>Upgrade notes</h3>
        <p>None. This is the first release; follow the <a href="/docs/deploy">deploy guide</a>.</p>
        <h3>Known limitations</h3>
        <ul>
          <li>Bing AI Performance has no API, so the Cited step stays empty until you import its CSV export.</li>
          <li>Web Analytics data is unavailable for accounts using the EU data localization boundary.</li>
          <li>Cloudflare Workers + D1 is the only supported runtime in this release.</li>
        </ul>
      </article>
    </li>
  </ol>

  <p class="foot">Release history also lives on <a href={GITHUB.releases}>GitHub releases</a>.</p>
</div>

<style>
  .page {
    padding-top: clamp(3rem, 2rem + 4vw, 5.5rem);
    padding-bottom: 96px;
    max-width: calc(980px + var(--gutter) * 2);
  }
  .page-head {
    padding-bottom: 40px;
    border-bottom: 1px solid var(--line);
  }
  .page-head h1 {
    margin-top: 14px;
    font-size: var(--fs-3xl);
    letter-spacing: -0.028em;
  }
  .page-head .lead {
    margin-top: 14px;
    max-width: 620px;
  }
  .releases {
    list-style: none;
    padding: 0;
  }
  .release {
    display: grid;
    grid-template-columns: 180px minmax(0, 1fr);
    gap: 40px;
    padding-top: 48px;
  }
  .when {
    position: sticky;
    top: calc(var(--header-h) + 32px);
    align-self: start;
    display: grid;
    gap: 8px;
    font-size: var(--fs-sm);
    color: var(--text-3);
  }
  .ver {
    justify-self: start;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 3px 10px;
    border-radius: 999px;
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
    font-weight: 500;
    color: var(--text);
    background: var(--surface-2);
    border: 1px solid var(--line-2);
  }
  /* The latest release carries today's dot. */
  .release:first-child .ver::before {
    content: '';
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--signal);
  }
  .body h2 {
    margin-top: 0;
    font-size: 1.75rem;
  }
  .foot {
    margin-top: 64px;
    padding-top: 24px;
    border-top: 1px solid var(--line);
    font-size: var(--fs-sm);
    color: var(--text-3);
  }
  .foot a {
    color: var(--text);
    text-decoration: underline;
    text-decoration-color: var(--accent-line);
    text-underline-offset: 3px;
  }
  @media (max-width: 760px) {
    .release {
      grid-template-columns: minmax(0, 1fr);
      gap: 16px;
    }
    .when {
      position: static;
      display: flex;
      align-items: center;
      gap: 12px;
    }
  }
</style>
