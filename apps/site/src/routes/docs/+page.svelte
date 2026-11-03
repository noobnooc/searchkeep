<script lang="ts">
  import Callout from '#lib/components/Callout.svelte';
  import { READ_ONLY_TOOLS } from '#lib/content.ts';
  import { GITHUB } from '#lib/site.ts';

  const cards = [
    { href: '/docs/deploy', title: 'Deploy', text: 'Fork, connect Workers Builds, add Access and credentials. About 30–45 minutes.' },
    { href: '/docs/mcp', title: 'Connect an AI client', text: 'Add your /mcp endpoint to Claude, Cursor or ChatGPT and browse the tools.' },
    { href: '/docs/configuration', title: 'Configuration', text: 'Every secret, the SITES format, brand regex and write access.' },
    { href: '/docs/architecture', title: 'Architecture', text: 'One Worker, three entrances, one core and one D1 database.' },
  ];
</script>

<h2 id="what-it-is">What Searchkeep is</h2>
<p>
  Searchkeep is open-source SEO and GEO (generative engine optimization) analytics that you run in your own Cloudflare
  account. It is one Cloudflare Worker and one D1 database. It keeps pulling first-party data from
  <strong>Google Search Console</strong>, <strong>Bing Webmaster Tools</strong> and <strong>Cloudflare</strong> (AI
  crawler traffic and Web Analytics) for the sites you own, and stores it in D1 so it is kept long after the source
  forgets it.
</p>
<p>
  On top of that data sit two front doors: an <strong>MCP server</strong> for asking questions from Claude, Claude
  Code, Cursor, ChatGPT or any other MCP client, and a <strong>dashboard</strong> for looking. Both call the same
  analysis code, so they always agree.
</p>

<figure class="shot">
  <img
    src="/screenshots/dashboard-geo-funnel.webp"
    width="1600"
    height="1398"
    loading="lazy"
    decoding="async"
    alt="The Searchkeep dashboard's GEO funnel view: totals for crawled, cited, AI visits and clicks, a funnel band, pages crawled but never cited, and a per-page table."
  />
  <figcaption>The GEO funnel view of the dashboard (demo data).</figcaption>
</figure>

<h2 id="how-it-works">How it works</h2>
<ol>
  <li>
    <strong>You fork the repository</strong> and connect the fork to Cloudflare Workers Builds. Every push to the fork
    that changes the Worker, its packages or its dependencies, including “Sync fork” from upstream, builds and deploys
    the Worker.
  </li>
  <li>
    <strong>Cloudflare Access protects the whole Worker.</strong> You sign in to the dashboard with Access; MCP clients
    authenticate through Access’s Managed OAuth. The Worker re-verifies the Access JWT on every request and refuses to
    serve data until Access is set up correctly.
  </li>
  <li>
    <strong>A cron syncs your sources into D1</strong> every 15 minutes, in small batches: each source is brought up to
    date once a day, then the 16 months of history Search Console keeps are backfilled one day at a time (days to weeks
    on the free plan). Nothing is ever deleted.
  </li>
  <li>
    <strong>You ask or look.</strong> MCP tools and dashboard views query D1 and return compact, aggregated results.
    Only live operations such as URL inspection call the source APIs directly.
  </li>
</ol>

<h2 id="what-you-get">What you get</h2>
<ul>
  <li>
    <strong>The GEO funnel, per page.</strong> Crawled by AI (Cloudflare AI crawler requests) → cited by AI (imported
    from Bing AI Performance CSV exports) → clicked from AI (Web Analytics referrers from AI assistants), next to
    classic GSC and Bing clicks.
  </li>
  <li><strong>History beyond 16 months.</strong> Year-over-year comparisons keep working long after Search Console drops the data.</li>
  <li>
    <strong>{READ_ONLY_TOOLS.length} read-only MCP tools</strong> (plus an opt-in sitemap submit), from general queries to
    opinionated finders: quick wins, cannibalization, CTR anomalies, content decay, AI crawler activity and more.
  </li>
  <li>
    <strong>A dashboard</strong> served by the same Worker: overview, GEO funnel, performance, period comparison,
    opportunities, AI crawlers and referrals, technical checks (Web Vitals, sitemaps, crawl issues, URL inspection) and
    a settings page with setup checks, sync runs and the AI citation import.
  </li>
  <li><strong>Brand vs non-brand</strong> splits on every query-level view, driven by one regex.</li>
</ul>

<h2 id="not-doing">What it does not do</h2>
<p>
  Searchkeep only analyzes <em>your own</em> sites with data <em>you</em> already have access to. That is a deliberate
  boundary, written into the project charter:
</p>
<ul>
  <li><strong>No backlinks.</strong> Backlink indexes require crawling the web at scale.</li>
  <li><strong>No competitor data.</strong> There is no first-party source for someone else’s site.</li>
  <li><strong>No rank tracking.</strong> Tracking positions means scraping search results, which Searchkeep will not do.</li>
  <li><strong>No telemetry and no hosted service.</strong> There is nothing to sign up for and nothing that phones home.</li>
</ul>

<h2 id="requirements">Requirements</h2>
<ul>
  <li>A <strong>GitHub</strong> account, to fork the repository.</li>
  <li>
    A <strong>Cloudflare</strong> account with Workers and D1 (the free plan is enough for typical sites), a Zero Trust
    organization for Access (also available on a free plan), and a read-only API token.
  </li>
  <li>A <strong>custom domain or subdomain</strong> on Cloudflare for the Worker, such as <code>searchkeep.example.com</code>.</li>
  <li>
    At least one data source: a Search Console property, a Bing Webmaster Tools site, or a Cloudflare zone. Sources are
    independent; connect the ones you have.
  </li>
</ul>
<Callout kind="note" title="Proxied zone for AI crawler data">
  <p>
    AI crawler data comes from Cloudflare’s view of your traffic, so the site you analyze must be proxied through
    Cloudflare (orange cloud). Search Console and Bing data work for any site.
  </p>
</Callout>

<h2 id="next-steps">Next steps</h2>
<ul class="cards">
  {#each cards as c (c.href)}
    <li>
      <a class="card-link" href={c.href}>
        <span class="t">{c.title}</span>
        <span class="d">{c.text}</span>
      </a>
    </li>
  {/each}
</ul>
<p>
  Prefer to read the source? Everything lives in <a href={GITHUB.repo}>the GitHub repository</a>, including the
  agent-oriented <a href={GITHUB.agents}>AGENTS.md</a>.
</p>

<style>
  .cards {
    list-style: none;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
  }
  .cards li + li {
    margin-top: 0;
  }
  .card-link {
    display: grid;
    gap: 4px;
    height: 100%;
    padding: 16px 18px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--bg-elev);
    transition: border-color 150ms, box-shadow 200ms;
  }
  .card-link:hover {
    border-color: var(--accent-line);
    box-shadow: 0 0 0 4px var(--accent-soft);
  }
  .t {
    font-weight: 600;
    color: var(--text);
    font-size: 0.9875rem;
  }
  .d {
    font-size: var(--fs-sm);
    color: var(--text-3);
    line-height: 1.5;
  }
  @media (max-width: 560px) {
    .cards {
      grid-template-columns: 1fr;
    }
  }
</style>
