<script lang="ts">
  import Callout from '#lib/components/Callout.svelte';
  import { READ_ONLY_TOOLS } from '#lib/content.ts';
  import { GITHUB } from '#lib/site.ts';

  const cards = [
    { href: '/docs/deploy', title: 'Deploy', text: '30–45 minutes, step by step.' },
    { href: '/docs/mcp', title: 'Connect an AI client', text: 'Claude, Cursor, ChatGPT.' },
    { href: '/docs/configuration', title: 'Configuration', text: 'Secrets, sites, brand regex.' },
    { href: '/docs/architecture', title: 'Architecture', text: 'One Worker, one core, one D1.' },
  ];
</script>

<h2 id="what-it-is">What Searchkeep is</h2>
<p>
  Open-source SEO and GEO analytics in your own Cloudflare account: one Worker and one D1 database that keep
  <strong>Google Search Console</strong>, <strong>Bing Webmaster Tools</strong> and <strong>Cloudflare</strong> data
  for your sites, long after the sources forget it. Ask about it over <strong>MCP</strong>, or look at it in the
  <strong>dashboard</strong>; both run the same analysis code.
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
  <figcaption>The GEO funnel view (demo data).</figcaption>
</figure>

<h2 id="how-it-works">How it works</h2>
<ol>
  <li><strong>Fork and connect Workers Builds.</strong> Every push, including “Sync fork”, deploys your Worker.</li>
  <li><strong>Cloudflare Access protects it.</strong> The Worker re-verifies the Access JWT on every request.</li>
  <li><strong>A cron syncs into D1</strong> every 15 minutes, backfills 16 months, and never deletes.</li>
  <li><strong>You ask or look.</strong> MCP tools and the dashboard read D1; only URL inspection is live.</li>
</ol>

<h2 id="what-you-get">What you get</h2>
<ul>
  <li><strong>The GEO funnel, per page:</strong> crawled by AI → cited by AI → clicked from AI.</li>
  <li><strong>History beyond 16 months</strong>, so year-over-year keeps working.</li>
  <li><strong>{READ_ONLY_TOOLS.length} read-only MCP tools</strong>, plus an opt-in sitemap submit.</li>
  <li><strong>A dashboard</strong> with overview, funnel, performance, opportunities, AI crawlers and technical checks.</li>
  <li><strong>Brand vs non-brand</strong> on every query view, from one regex.</li>
</ul>

<h2 id="not-doing">What it does not do</h2>
<p>Only <em>your</em> sites, only data <em>you</em> already have, by charter:</p>
<ul>
  <li><strong>No backlinks</strong>, <strong>no competitor data</strong>, <strong>no rank tracking</strong> (no scraping).</li>
  <li><strong>No telemetry</strong> and no hosted service.</li>
</ul>

<h2 id="requirements">Requirements</h2>
<ul>
  <li>A <strong>GitHub</strong> account.</li>
  <li>A <strong>Cloudflare</strong> account: Workers, D1 and Zero Trust (free plans are enough).</li>
  <li>A <strong>custom domain or subdomain</strong> on Cloudflare, such as <code>searchkeep.example.com</code>.</li>
  <li>At least one source: a Search Console property, a Bing site or a Cloudflare zone.</li>
</ul>
<Callout kind="note" title="Proxied zone for AI crawler data">
  <p>AI crawler data needs the site proxied through Cloudflare (orange cloud). Search Console and Bing work for any site.</p>
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
<p>Or read the source: <a href={GITHUB.repo}>GitHub</a> · <a href={GITHUB.agents}>AGENTS.md</a>.</p>

<style>
  .shot {
    margin: 28px 0;
  }
  .shot img {
    width: 100%;
    border: 1px solid var(--line-2);
    border-radius: var(--radius-lg);
    background: #0b0c0e;
  }
  .shot figcaption {
    margin-top: 10px;
    font-family: var(--font-mono);
    font-size: 0.6875rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-3);
  }
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
