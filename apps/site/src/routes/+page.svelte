<script lang="ts">
  import Seo from '#lib/components/Seo.svelte';
  import Icon, { type IconName } from '#lib/components/Icon.svelte';
  import DashboardMock from '#lib/components/visuals/DashboardMock.svelte';
  import ChatMock from '#lib/components/visuals/ChatMock.svelte';
  import HistoryTimeline from '#lib/components/visuals/HistoryTimeline.svelte';
  import ArchitectureDiagram from '#lib/components/visuals/ArchitectureDiagram.svelte';
  import AgentTranscript from '#lib/components/visuals/AgentTranscript.svelte';
  import HorizonLine from '#lib/components/visuals/HorizonLine.svelte';
  import { SITE, GITHUB } from '#lib/site.ts';
  import { TOOLS, PRINCIPLES, FAQS, READINESS } from '#lib/content.ts';
  import { organization, website, softwareApplication, faqPage } from '#lib/schema.ts';

  const funnel = [
    { step: 'Crawled', source: 'Cloudflare AI crawlers', value: 412 },
    { step: 'Cited', source: 'Bing AI Performance', value: 96 },
    { step: 'Clicked', source: 'Web Analytics · GSC · Bing', value: 38 },
  ];

  const dashboardViews: { icon: IconName; title: string }[] = [
    { icon: 'chart', title: 'Overview' },
    { icon: 'sparkle', title: 'GEO funnel' },
    { icon: 'eye', title: 'AI crawlers & referrals' },
    { icon: 'globe', title: 'Performance & compare' },
    { icon: 'zap', title: 'Opportunities' },
    { icon: 'shield', title: 'Technical' },
  ];

  const sources = [
    { name: 'Google Search Console', pulls: ['Search Analytics', 'Sitemaps', 'URL Inspection'] },
    { name: 'Bing Webmaster Tools', pulls: ['Search traffic', 'Crawl issues', 'AI citations (CSV)'] },
    { name: 'Cloudflare', pulls: ['AI crawler requests', 'Web Analytics', 'Core Web Vitals'] },
  ];

  const security: { icon: IconName; title: string }[] = [
    { icon: 'lock', title: 'Cloudflare Access in front' },
    { icon: 'key', title: 'Managed OAuth for MCP' },
    { icon: 'shield', title: 'JWT re-verified per request' },
    { icon: 'eye', title: 'Locks again if a check breaks' },
  ];

  type Cell = { v: string; good?: boolean; no?: boolean };
  const comparison: { row: string; sk: Cell; saas: Cell }[] = [
    { row: 'Where your data lives', sk: { v: 'Your Cloudflare account', good: true }, saas: { v: 'The vendor’s servers' } },
    { row: 'Price', sk: { v: 'Free, MIT licensed', good: true }, saas: { v: 'Monthly subscription' } },
    { row: 'History past GSC’s 16 months', sk: { v: 'Kept in D1, forever', good: true }, saas: { v: 'Varies; often only while subscribed' } },
    { row: 'AI crawled → cited → clicked, per page', sk: { v: 'Built in', good: true }, saas: { v: 'Rare' } },
    { row: 'Ask from Claude, Cursor, ChatGPT', sk: { v: '12 read-only MCP tools', good: true }, saas: { v: 'Sometimes' } },
    { row: 'Telemetry', sk: { v: 'None', good: true }, saas: { v: 'Usually' } },
    { row: 'Backlink index', sk: { v: 'No, by design', no: true }, saas: { v: 'Yes', good: true } },
    { row: 'Competitor research', sk: { v: 'No, by design', no: true }, saas: { v: 'Yes', good: true } },
    { row: 'Rank tracking (SERP scraping)', sk: { v: 'No, by design', no: true }, saas: { v: 'Yes', good: true } },
  ];

  // The home page shows the first six questions; the docs FAQ has them all.
  const faqs = FAQS.slice(0, 6);
  const jsonld = [organization, website, softwareApplication, faqPage(faqs, '/')];
</script>

<Seo
  title={SITE.name}
  description="Self-hosted SEO & GEO analytics in your own Cloudflare account. See which pages AI crawlers read, cite and send clicks to, keep your search history forever, and ask about it over MCP."
  path="/"
  {jsonld}
/>

<!-- Hero -->
<section class="hero">
  <div class="container hero-inner">
    <a class="announce" href="/changelog">
      <span class="pill pill-accent">v{SITE.version}</span>
      <span>First release · open source</span>
      <Icon name="arrow" size={14} />
    </a>
    <h1 class="hero-title">
      Your search data,<br />kept<span class="signal">.</span>
    </h1>
    <p class="hero-sub">SEO &amp; GEO analytics in your own Cloudflare account.</p>
    <div class="cta-row">
      <a class="btn btn-primary btn-lg" href="/docs/deploy">
        Deploy to your Cloudflare <Icon name="arrow" />
      </a>
      <a class="btn btn-secondary btn-lg" href={GITHUB.repo}>
        <Icon name="github" /> Star on GitHub
      </a>
    </div>
    <ul class="meta">
      <li><Icon name="database" size={14} /> One Worker + D1</li>
      <li><Icon name="eye" size={14} /> No telemetry</li>
      <li><Icon name="lock" size={14} /> Behind Cloudflare Access</li>
      <li><Icon name="gift" size={14} /> MIT licensed</li>
    </ul>
  </div>

  <div class="container hero-line">
    <HorizonLine />
  </div>

  <div class="container hero-visual">
    <DashboardMock />
  </div>
</section>

<!-- Works with -->
<section class="strip" aria-labelledby="works-with">
  <div class="container strip-inner">
    <h2 id="works-with" class="strip-title">Built on data you already own</h2>
    <ul>
      <li>Google Search Console</li>
      <li>Bing Webmaster Tools</li>
      <li>Cloudflare AI crawler traffic</li>
      <li>Cloudflare Web Analytics</li>
      <li class="sep" aria-hidden="true"></li>
      <li>Claude</li>
      <li>Cursor</li>
      <li>ChatGPT</li>
    </ul>
  </div>
</section>

<!-- GEO funnel -->
<section class="section" id="funnel" aria-labelledby="funnel-title">
  <div class="container">
    <div class="section-head">
      <span class="eyebrow">The GEO funnel</span>
      <h2 id="funnel-title">Crawled. Cited. Clicked<span class="signal">.</span></h2>
    </div>

    <div class="funnel-grid">
      <ol class="funnel">
        {#each funnel as f, i (f.step)}
          <li class="stage card" style="--w: {(f.value / funnel[0]!.value) * 100}%; --i: {i}">
            <div class="stage-top">
              <span class="stage-n">0{i + 1}</span>
              <h3>{f.step}</h3>
              <span class="stage-src">{f.source}</span>
            </div>
            <div class="stage-bar" aria-hidden="true">
              <div class="track"><div class="fill s{i}"></div></div>
              <span class="stage-val">{f.value} pages</span>
            </div>
            {#if i < funnel.length - 1}
              <span class="conv" aria-hidden="true">
                {Math.round((funnel[i + 1]!.value / f.value) * 100)}%
              </span>
            {/if}
          </li>
        {/each}
      </ol>

      <div class="stalls">
        <div class="stall card">
          <span class="pill">Crawled, not cited</span>
          <h3>AI reads it, then ignores it.</h3>
        </div>
        <div class="stall card">
          <span class="pill">Cited, not clicked</span>
          <h3>You’re the source, not the destination.</h3>
        </div>
        <p class="fineprint">Cited: Bing AI Performance, imported as CSV. Figures are illustrative.</p>
      </div>
    </div>
  </div>
</section>

<!-- MCP -->
<section class="section alt" id="mcp" aria-labelledby="mcp-title">
  <div class="container">
    <div class="section-head">
      <span class="eyebrow">MCP server</span>
      <h2 id="mcp-title">Ask, don’t dig.</h2>
      <p class="endpoint"><code>https://your-domain/mcp</code><span>Claude · Cursor · ChatGPT</span></p>
    </div>
    <div class="mcp-grid">
      <ChatMock />
      <div class="tools card">
        <div class="tools-head">
          <span>13 tools</span>
          <span class="muted">12 read-only · 1 opt-in write</span>
        </div>
        <ul>
          {#each TOOLS as t (t.name)}
            <li title={t.summary} class:write={!t.readOnly}>
              <code class="tname">{t.name}</code>
              {#if !t.readOnly}<span class="wtag">write · off</span>{/if}
            </li>
          {/each}
        </ul>
        <a class="tools-link" href="/docs/mcp">Tool reference <Icon name="arrow" size={14} /></a>
      </div>
    </div>
  </div>
</section>

<!-- Dashboard -->
<section class="section" id="dashboard" aria-labelledby="dash-title">
  <div class="container">
    <div class="section-head">
      <span class="eyebrow">Dashboard</span>
      <h2 id="dash-title">Or just look.</h2>
    </div>
    <ul class="views">
      {#each dashboardViews as v (v.title)}
        <li class="view"><span class="view-icon"><Icon name={v.icon} size={16} /></span>{v.title}</li>
      {/each}
    </ul>
    <figure class="shot">
      <img
        src="/screenshots/dashboard-overview.webp"
        width="1600"
        height="1398"
        loading="lazy"
        decoding="async"
        alt="The Searchkeep dashboard overview: Search Console and Bing totals, daily search performance, the GEO funnel and AI crawlers."
      />
    </figure>
  </div>
</section>

<!-- History -->
<section class="section alt" id="history" aria-labelledby="history-title">
  <div class="container">
    <div class="history-grid">
      <div class="section-head">
        <span class="eyebrow">Long-term history</span>
        <h2 id="history-title">Keep your history forever.</h2>
        <dl class="stats">
          <div><dt>Search Console</dt><dd>16 <span>months</span></dd></div>
          <div><dt>Searchkeep, two years in</dt><dd class="accent">40 <span>months, and counting</span></dd></div>
        </dl>
      </div>
      <HistoryTimeline />
    </div>
  </div>
</section>

<!-- Sources -->
<section class="section" id="sources" aria-labelledby="sources-title">
  <div class="container">
    <div class="section-head">
      <span class="eyebrow">Data sources</span>
      <h2 id="sources-title">First-party data only.</h2>
    </div>
    <ul class="sources">
      {#each sources as s (s.name)}
        <li class="source card">
          <h3>{s.name}</h3>
          <ul class="pulls">
            {#each s.pulls as p (p)}
              <li><Icon name="check" size={14} />{p}</li>
            {/each}
          </ul>
        </li>
      {/each}
    </ul>
    <a class="more" href="/docs/data-sources">Data sources <Icon name="arrow" size={14} /></a>
  </div>
</section>

<!-- Principles + architecture -->
<section class="section alt" id="ownership" aria-labelledby="own-title">
  <div class="container">
    <div class="section-head">
      <span class="eyebrow">Ownership</span>
      <h2 id="own-title">One Worker. Your account.</h2>
    </div>
    <div class="own-grid">
      <ArchitectureDiagram />
      <ul class="principles">
        {#each PRINCIPLES as p (p.title)}
          <li><Icon name="check" size={16} /><h3>{p.title}</h3></li>
        {/each}
      </ul>
    </div>
  </div>
</section>

<!-- Security -->
<section class="section" id="security" aria-labelledby="sec-title">
  <div class="container">
    <div class="section-head">
      <span class="eyebrow">Security</span>
      <h2 id="sec-title">Locked until it’s safe.</h2>
    </div>
    <div class="sec-grid">
      <ul class="sec-list">
        {#each security as s (s.title)}
          <li>
            <span class="sec-icon"><Icon name={s.icon} size={18} /></span>
            <h3>{s.title}</h3>
          </li>
        {/each}
      </ul>
      <ol class="states card" aria-label="Readiness states">
        {#each READINESS as r, i (r.id)}
          <li class:ready={r.id === 'ready'}>
            <span class="st-n">{i + 1}</span>
            <div>
              <code>{r.id}</code>
              <span class="st-label">{r.label}</span>
            </div>
            <span class="st-badge">{r.id === 'ready' ? 'Serving' : 'Locked'}</span>
          </li>
        {/each}
        <li class="st-foot">Sync runs only once <code>ready</code>.</li>
      </ol>
    </div>
  </div>
</section>

<!-- Deploy with an agent -->
<section class="section alt" id="agent" aria-labelledby="agent-title">
  <div class="container">
    <div class="agent-grid">
      <div class="section-head">
        <span class="eyebrow">Deploy with an agent</span>
        <h2 id="agent-title">Hand the runbook to your agent.</h2>
        <ul class="human-steps">
          <li><span class="hs">You, once</span> Authorize the Cloudflare GitHub App</li>
          <li><span class="hs">You, once</span> Create your Zero Trust organization</li>
          <li><span class="hs">You, once</span> Create the read-only Cloudflare API token</li>
          <li><span class="hs">You, once</span> Add the service account in Search Console</li>
          <li><span class="hs">You, once</span> Generate the Bing API key</li>
          <li><span class="hs">You</span> Sign in through Access</li>
        </ul>
        <div class="cta-row left">
          <a class="btn btn-secondary" href="/docs/deploy#with-an-agent">Read the runbook <Icon name="arrow" /></a>
        </div>
      </div>
      <AgentTranscript />
    </div>
  </div>
</section>

<!-- Comparison -->
<section class="section" id="compare" aria-labelledby="compare-title">
  <div class="container">
    <div class="section-head">
      <span class="eyebrow">Comparison</span>
      <h2 id="compare-title">Honest about what it isn’t.</h2>

    </div>
    <div class="table-wrap compare">
      <table>
        <caption class="visually-hidden">Searchkeep compared with typical SaaS SEO tools</caption>
        <thead>
          <tr><th scope="col">Capability</th><th scope="col">Searchkeep</th><th scope="col">Typical SaaS SEO tool</th></tr>
        </thead>
        <tbody>
          {#each comparison as c (c.row)}
            <tr>
              <th scope="row">{c.row}</th>
              <td class:good={c.sk.good} class:no={c.sk.no}>
                <span class="mark"><Icon name={c.sk.good ? 'check' : c.sk.no ? 'minus' : 'minus'} size={14} /></span>{c.sk.v}
              </td>
              <td class:good={c.saas.good}>
                <span class="mark"><Icon name={c.saas.good ? 'check' : 'minus'} size={14} /></span>{c.saas.v}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </div>
</section>

<!-- FAQ -->
<section class="section alt" id="faq" aria-labelledby="faq-title">
  <div class="container faq-grid">
    <div class="section-head">
      <span class="eyebrow">FAQ</span>
      <h2 id="faq-title">Questions, answered.</h2>
      <a class="more" href="/docs/faq">All questions <Icon name="arrow" size={14} /></a>
    </div>
    <div class="faq">
      {#each faqs as f, i (f.q)}
        <details open={i === 0}>
          <summary><h3>{f.q}</h3><span class="plus" aria-hidden="true"></span></summary>
          <p>{f.a}</p>
        </details>
      {/each}
    </div>
  </div>
</section>

<!-- Final CTA -->
<section class="final" aria-labelledby="final-title">
  <div class="container final-inner">
    <h2 id="final-title">Start keeping your search data today<span class="signal">.</span></h2>
    <p>Deploys in 30–45 minutes.</p>
    <div class="cta-row">
      <a class="btn btn-primary btn-lg" href="/docs/deploy">Deploy to your Cloudflare <Icon name="arrow" /></a>
      <a class="btn btn-secondary btn-lg" href={GITHUB.repo}><Icon name="github" /> Star on GitHub</a>
    </div>
    <div class="final-line"><HorizonLine labels={false} /></div>
  </div>
</section>

<style>
  /* ---------- Hero ---------- */
  .hero {
    position: relative;
    padding-top: clamp(3.5rem, 2rem + 6vw, 7rem);
    overflow: hidden;
  }
  .hero-line {
    margin-top: clamp(2.5rem, 1.5rem + 3vw, 4rem);
  }
  .hero-inner {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
  }
  .announce {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    padding: 4px 12px 4px 4px;
    border: 1px solid var(--line-2);
    border-radius: 999px;
    background: var(--overlay);
    font-size: var(--fs-sm);
    color: var(--text-2);
    transition: border-color 150ms, color 150ms;
  }
  .announce:hover {
    color: var(--text);
    border-color: var(--line-3);
  }
  .hero-title {
    margin-top: 28px;
    font-size: var(--fs-display);
    line-height: 1;
    letter-spacing: -0.022em;
    font-weight: 620;
  }
  .hero-sub {
    margin-top: 24px;
    max-width: 680px;
    font-size: clamp(1.0625rem, 0.95rem + 0.5vw, 1.25rem);
    line-height: 1.55;
    color: var(--text-2);
  }
  .cta-row {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 12px;
    margin-top: 36px;
  }
  .cta-row.left {
    justify-content: flex-start;
    margin-top: 28px;
  }
  .meta {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 10px 22px;
    margin-top: 28px;
    padding: 0;
    list-style: none;
    font-size: var(--fs-sm);
    color: var(--text-3);
  }
  .meta li {
    display: inline-flex;
    align-items: center;
    gap: 7px;
  }
  .hero-visual {
    position: relative;
    margin-top: 28px;
    max-width: calc(1120px + var(--gutter) * 2);
    mask-image: linear-gradient(180deg, #000 70%, transparent);
  }

  /* ---------- Strip ---------- */
  .strip {
    border-block: 1px solid var(--line);
    padding-block: 22px;
  }
  .strip-inner {
    display: flex;
    align-items: center;
    gap: 16px 32px;
    flex-wrap: wrap;
    justify-content: center;
  }
  .strip-title {
    font-size: var(--fs-sm);
    font-weight: 500;
    color: var(--text-3);
    letter-spacing: 0;
  }
  .strip ul {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    align-items: center;
    gap: 8px 26px;
    list-style: none;
    padding: 0;
    font-size: 0.9375rem;
    font-weight: 600;
    letter-spacing: -0.02em;
    color: var(--text-2);
  }
  .strip .sep {
    width: 1px;
    height: 16px;
    background: var(--line-3);
  }

  .alt {
    background: light-dark(rgb(11 12 14 / 0.018), rgb(255 255 255 / 0.012));
    border-block: 1px solid var(--line);
  }
  .section :global(:not(pre) > code) {
    font-size: 0.82em;
  }

  /* ---------- Card hover glow ---------- */
  .card {
    transition: border-color 200ms var(--ease), box-shadow 300ms var(--ease), transform 300ms var(--ease);
  }
  .card:hover {
    border-color: var(--line-3);
    box-shadow: 0 20px 48px -28px var(--accent-glow);
  }

  /* ---------- Funnel ---------- */
  .funnel-grid {
    display: grid;
    grid-template-columns: minmax(0, 1.5fr) minmax(0, 1fr);
    gap: 24px;
    align-items: start;
  }
  .funnel {
    list-style: none;
    padding: 0;
    display: grid;
    gap: 14px;
  }
  .stage {
    padding: 22px 24px;
  }
  .stage-top {
    display: flex;
    align-items: baseline;
    gap: 12px;
    flex-wrap: wrap;
  }
  .stage-n {
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
    color: var(--text-4);
  }
  .stage h3 {
    font-size: 1.375rem;
    letter-spacing: -0.025em;
  }
  .stage-src {
    margin-left: auto;
    font-size: var(--fs-xs);
    color: var(--text-3);
    padding: 2px 8px;
    border: 1px solid var(--line-2);
    border-radius: 999px;
  }
  .stage-bar {
    display: flex;
    align-items: center;
    gap: 14px;
    margin-top: 16px;
  }
  .track {
    flex: 1;
    height: 10px;
    border-radius: 5px;
    background: var(--surface-2);
    overflow: hidden;
  }
  .fill {
    width: var(--w);
    height: 100%;
    border-radius: 5px;
    transform-origin: left;
  }
  @media (prefers-reduced-motion: no-preference) {
    .fill {
      animation: grow linear both;
      animation-timeline: view();
      animation-range: entry 10% cover 40%;
    }
  }
  @keyframes grow {
    from {
      transform: scaleX(0);
    }
  }
  .s0 {
    background: color-mix(in oklch, var(--accent-fill) 45%, var(--surface-3));
  }
  .s1 {
    background: color-mix(in oklch, var(--accent-fill) 72%, var(--surface-3));
  }
  /* The click: where the funnel pays off, in Signal. */
  .s2 {
    background: var(--signal);
  }
  .stage-val {
    min-width: 76px;
    text-align: right;
    font-size: var(--fs-sm);
    font-weight: 600;
    color: var(--text);
    font-variant-numeric: tabular-nums;
  }
  .conv {
    position: absolute;
    left: 50%;
    bottom: -14px;
    z-index: 2;
    transform: translateX(-50%);
    padding: 2px 9px;
    border-radius: 999px;
    border: 1px solid var(--line-2);
    background: var(--bg);
    font-size: 11px;
    font-weight: 600;
    color: var(--text-3);
    font-variant-numeric: tabular-nums;
  }
  .stalls {
    display: grid;
    gap: 14px;
  }
  .stall {
    padding: 22px 24px;
  }
  .stall h3 {
    margin-top: 14px;
    font-size: 1.25rem;
    letter-spacing: -0.015em;
  }
  .fineprint {
    font-size: var(--fs-xs);
    color: var(--text-4);
    padding-inline: 4px;
  }

  /* ---------- MCP ---------- */
  .mcp-grid {
    display: grid;
    grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr);
    gap: 24px;
    align-items: start;
  }
  .tools {
    padding: 8px;
  }
  .tools-head {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    padding: 12px 12px 10px;
    font-size: var(--fs-sm);
    font-weight: 600;
    color: var(--text);
  }
  .tools-head .muted {
    font-weight: 400;
    font-size: var(--fs-xs);
  }
  .tools ul {
    list-style: none;
    padding: 4px 12px 8px;
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .tools li {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    border: 1px solid var(--line-2);
    border-radius: 8px;
    background: var(--surface);
    cursor: default;
    transition: border-color 150ms;
  }
  .tools li:hover {
    border-color: var(--line-3);
  }
  .tools li.write {
    border-style: dashed;
  }
  .tools .tname {
    font-size: 0.8125rem;
    padding: 0;
    border: 0;
    background: none;
    color: var(--text);
    font-weight: 500;
  }
  .wtag {
    font-family: var(--font-mono);
    font-size: 10.5px;
    color: var(--warn);
  }
  .endpoint {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px 14px;
  }
  .endpoint code {
    font-size: 0.9375rem;
    padding: 6px 10px;
  }
  .endpoint span {
    font-family: var(--font-mono);
    font-size: 0.75rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-3);
  }
  .tools-link,
  .more {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: var(--fs-sm);
    font-weight: 550;
    color: var(--accent);
  }
  .tools-link {
    margin: 8px 12px 10px;
  }
  .more {
    margin-top: 24px;
  }
  .tools-link:hover,
  .more:hover {
    color: var(--accent-strong);
  }

  /* ---------- Views ---------- */
  .views {
    list-style: none;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .view {
    display: inline-flex;
    align-items: center;
    gap: 9px;
    padding: 6px 14px 6px 6px;
    border: 1px solid var(--line-2);
    border-radius: 999px;
    background: var(--bg-elev);
    font-size: var(--fs-sm);
    font-weight: 500;
    color: var(--text);
  }
  .view .view-icon {
    width: 28px;
    height: 28px;
    border-radius: 999px;
  }
  .view-icon,
  .sec-icon {
    display: grid;
    place-items: center;
    width: 36px;
    height: 36px;
    border-radius: 10px;
    border: 1px solid var(--line-2);
    background: var(--surface-2);
    color: var(--text-2);
  }
  .shot {
    margin: 28px 0 0;
    border: 1px solid var(--line-2);
    border-radius: var(--radius-lg);
    overflow: hidden;
    background: #0b0c0e;
    box-shadow: var(--shadow-lg);
  }
  .shot img {
    display: block;
    width: 100%;
    height: auto;
  }

  /* ---------- History ---------- */
  .history-grid {
    display: grid;
    grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.3fr);
    gap: 48px;
    align-items: center;
  }
  .history-grid .section-head {
    margin-bottom: 0;
  }
  .stats {
    display: flex;
    gap: 40px;
    margin-top: 32px;
  }
  .stats dt {
    font-size: var(--fs-xs);
    color: var(--text-3);
  }
  .stats dd {
    margin: 4px 0 0;
    font-size: 2.5rem;
    font-weight: 620;
    letter-spacing: -0.02em;
    line-height: 1;
    color: var(--text);
    font-variant-numeric: tabular-nums;
  }
  .stats dd span {
    font-size: var(--fs-sm);
    font-weight: 500;
    letter-spacing: 0;
    color: var(--text-3);
  }
  .stats dd.accent {
    color: var(--accent);
  }

  /* ---------- Sources ---------- */
  .sources {
    list-style: none;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 14px;
  }
  .source {
    padding: 24px;
    display: flex;
    flex-direction: column;
  }
  .source h3 {
    font-size: 1.125rem;
    letter-spacing: -0.018em;
  }
  .pulls {
    list-style: none;
    padding: 0;
    margin-top: 16px;
    display: grid;
    gap: 8px;
    font-size: 0.9375rem;
    color: var(--text-2);
  }
  .pulls li {
    display: grid;
    grid-template-columns: 14px 1fr;
    gap: 10px;
    line-height: 1.45;
  }
  .pulls :global(svg) {
    margin-top: 3px;
    color: var(--accent);
  }

  /* ---------- Ownership ---------- */
  .own-grid {
    display: grid;
    grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr);
    gap: 40px;
    align-items: center;
  }
  .principles {
    list-style: none;
    padding: 0;
    display: grid;
    gap: 0;
  }
  .principles li {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 18px 0;
    border-top: 1px solid var(--line);
  }
  .principles li:first-child {
    border-top: 0;
    padding-top: 0;
  }
  .principles li :global(svg) {
    flex: none;
    color: var(--signal);
  }
  .principles h3 {
    font-size: 1.125rem;
    letter-spacing: -0.015em;
  }

  /* ---------- Security ---------- */
  .sec-grid {
    display: grid;
    grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr);
    gap: 40px;
    align-items: start;
  }
  .sec-list {
    list-style: none;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 32px 28px;
  }
  .sec-list li {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .sec-list h3 {
    font-size: 1.0625rem;
    letter-spacing: -0.015em;
  }
  .states {
    list-style: none;
    padding: 8px;
  }
  .states li {
    display: grid;
    grid-template-columns: 28px minmax(0, 1fr) auto;
    align-items: center;
    gap: 14px;
    padding: 14px 14px;
    border-radius: 10px;
  }
  .states li + li {
    border-top: 1px solid var(--line);
    border-radius: 0;
  }
  .st-n {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    border-radius: 8px;
    border: 1px solid var(--line-2);
    font-size: var(--fs-xs);
    font-weight: 600;
    color: var(--text-3);
    font-variant-numeric: tabular-nums;
  }
  .states code {
    font-size: 0.8125rem;
    padding: 0;
    border: 0;
    background: none;
    color: var(--text);
  }
  .st-label {
    display: block;
    font-size: var(--fs-xs);
    color: var(--text-3);
  }
  .st-badge {
    font-size: 11px;
    font-weight: 600;
    padding: 3px 9px;
    border-radius: 999px;
    color: var(--text-3);
    border: 1px solid var(--line-2);
    background: var(--surface-2);
  }
  .states li.ready {
    background: var(--accent-soft);
    border-radius: 10px;
    border-top-color: transparent;
  }
  .states li.ready .st-n {
    border-color: var(--accent-line);
    color: var(--accent);
  }
  .states li.ready .st-badge {
    color: var(--accent-ink);
    background: var(--accent-fill);
    border-color: transparent;
  }
  .states .st-foot {
    display: block;
    font-size: var(--fs-xs);
    color: var(--text-3);
    line-height: 1.55;
  }
  .states .st-foot code {
    font-size: 0.95em;
  }

  /* ---------- Agent ---------- */
  .agent-grid {
    display: grid;
    grid-template-columns: minmax(0, 0.95fr) minmax(0, 1.2fr);
    gap: 48px;
    align-items: center;
  }
  .agent-grid .section-head {
    margin-bottom: 0;
  }
  .human-steps {
    list-style: none;
    padding: 0;
    margin-top: 24px;
    display: grid;
    gap: 10px;
    font-size: 0.9375rem;
    color: var(--text-2);
  }
  .human-steps li {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .hs {
    flex: none;
    font-size: 11px;
    font-weight: 600;
    padding: 2px 8px;
    border-radius: 6px;
    color: var(--warn);
    background: var(--warn-soft);
  }

  /* ---------- Compare ---------- */
  .compare table {
    font-size: 0.9375rem;
  }
  .compare th[scope='row'] {
    font-weight: 500;
    color: var(--text);
    background: none;
    font-size: 0.9375rem;
    white-space: normal;
    letter-spacing: -0.005em;
  }
  .compare thead th {
    font-size: var(--fs-sm);
    color: var(--text-2);
    padding-block: 14px;
  }
  .compare thead th:nth-child(2) {
    color: var(--accent);
  }
  .compare td,
  .compare th {
    padding: 14px 18px;
  }
  .compare td {
    color: var(--text-3);
  }
  .compare td:nth-child(2) {
    background: light-dark(rgb(11 12 14 / 0.025), rgb(255 255 255 / 0.025));
  }
  .compare td:first-child {
    color: var(--text-3);
  }
  .compare .mark {
    display: inline-flex;
    vertical-align: -2px;
    margin-right: 9px;
    color: var(--text-4);
  }
  .compare td.good {
    color: var(--text);
  }
  .compare td.good .mark {
    color: var(--accent);
  }

  /* ---------- FAQ ---------- */
  .faq-grid {
    display: grid;
    grid-template-columns: minmax(0, 0.8fr) minmax(0, 1.4fr);
    gap: 48px;
    align-items: start;
  }
  .faq {
    border-top: 1px solid var(--line);
  }
  @media (min-width: 1001px) {
    .faq-grid .section-head,
    .mcp-grid > :global(.window) {
      position: sticky;
      top: calc(var(--header-h) + 32px);
    }
  }
  .faq details {
    border-bottom: 1px solid var(--line);
  }
  .faq summary {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 20px;
    padding: 20px 2px;
    list-style: none;
    cursor: pointer;
  }
  .faq summary::-webkit-details-marker {
    display: none;
  }
  .faq summary h3 {
    font-size: 1.0625rem;
    font-weight: 550;
    letter-spacing: -0.015em;
  }
  .faq summary:hover h3 {
    color: var(--accent-strong);
  }
  .plus {
    position: relative;
    flex: none;
    width: 14px;
    height: 14px;
  }
  .plus::before,
  .plus::after {
    content: '';
    position: absolute;
    left: 0;
    top: 6px;
    width: 14px;
    height: 1.5px;
    border-radius: 1px;
    background: var(--text-3);
    transition: transform 200ms var(--ease);
  }
  .plus::after {
    transform: rotate(90deg);
  }
  details[open] .plus::after {
    transform: rotate(0deg);
  }
  .faq p {
    padding: 0 40px 22px 2px;
    color: var(--text-2);
    font-size: 0.9375rem;
    line-height: 1.7;
  }

  /* ---------- Final ---------- */
  .final {
    position: relative;
    overflow: hidden;
    padding-block: clamp(5rem, 3rem + 8vw, 9rem);
    border-top: 1px solid var(--line);
    text-align: center;
  }
  .final-line {
    margin-top: clamp(3rem, 2rem + 4vw, 5rem);
  }
  .final h2 {
    font-size: var(--fs-3xl);
    letter-spacing: -0.02em;
    max-width: 760px;
    margin-inline: auto;
  }
  .final p {
    margin-top: 16px;
    color: var(--text-2);
    font-size: var(--fs-lg);
  }

  /* ---------- Responsive ---------- */
  @media (max-width: 1000px) {
    .funnel-grid,
    .mcp-grid,
    .history-grid,
    .own-grid,
    .sec-grid,
    .agent-grid,
    .faq-grid {
      grid-template-columns: minmax(0, 1fr);
    }
    .history-grid,
    .agent-grid,
    .faq-grid {
      gap: 32px;
    }
    .views,
    .sources {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
  @media (max-width: 640px) {
    .views,
    .sources,
    .sec-list {
      grid-template-columns: minmax(0, 1fr);
    }
    .stage,
    .stall,
    .view,
    .source {
      padding: 20px;
    }
    .stage-src {
      margin-left: 0;
      flex-basis: 100%;
      width: max-content;
      max-width: max-content;
    }
    .stats {
      gap: 28px;
    }
    .stats dd {
      font-size: 2rem;
    }
    .cta-row .btn {
      width: 100%;
    }
    .compare td,
    .compare th {
      padding: 12px;
    }
    .compare .mark {
      display: none;
    }
    .faq p {
      padding-right: 8px;
    }
    .strip .sep {
      display: none;
    }
  }
</style>
