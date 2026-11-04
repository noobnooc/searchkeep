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
    {
      step: 'Crawled',
      source: 'Cloudflare AI crawler traffic',
      text: 'Which pages GPTBot, ClaudeBot, PerplexityBot and friends actually fetch, how often, and with what status code.',
      value: 412,
    },
    {
      step: 'Cited',
      source: 'Bing AI Performance (CSV import)',
      text: 'Which of those pages show up as sources in AI answers, so you know crawling turned into visibility.',
      value: 96,
    },
    {
      step: 'Clicked',
      source: 'Web Analytics · GSC · Bing',
      text: 'Visits referred by ChatGPT, Perplexity, Copilot and others, side by side with classic search clicks.',
      value: 38,
    },
  ];

  const dashboardViews: { icon: IconName; title: string; text: string }[] = [
    { icon: 'chart', title: 'Overview', text: 'Clicks, impressions and AI crawler requests for a site, against the previous period.' },
    { icon: 'sparkle', title: 'GEO funnel', text: 'Every page’s path from crawled to cited to clicked, with crawled-but-never-cited pages flagged.' },
    { icon: 'eye', title: 'AI crawlers & referrals', text: 'Requests by bot, operator and purpose (training, search, user), and visits sent by AI assistants.' },
    { icon: 'globe', title: 'Performance & compare', text: 'GSC and Bing queries and pages, brand vs non-brand, by country and device, period over period.' },
    { icon: 'zap', title: 'Opportunities', text: 'Quick wins, cannibalization, CTR anomalies and content decay, ranked.' },
    { icon: 'shield', title: 'Technical & settings', text: 'Web Vitals, sitemaps, crawl issues and URL inspection, plus setup checks, sync runs and Sync now.' },
  ];

  const sources = [
    {
      name: 'Google Search Console',
      pulls: ['Search Analytics by date, query, page, country, device', 'Sitemaps', 'Live URL Inspection'],
      cred: 'Service account, added as a Restricted user',
      limit: '16 months of history, a few days of delay',
    },
    {
      name: 'Bing Webmaster Tools',
      pulls: ['Traffic, query and page stats', 'Crawl issues', 'AI Performance citations, imported from its CSV export'],
      cred: 'API key',
      limit: 'Weekly granularity, no date filter',
    },
    {
      name: 'Cloudflare',
      pulls: ['AI crawler requests by bot, path and status', 'Web Analytics page views and referrers', 'Core Web Vitals'],
      cred: 'Read-only API token',
      limit: 'AI crawler data needs a proxied zone',
    },
  ];

  const security: { icon: IconName; title: string; text: string }[] = [
    { icon: 'lock', title: 'Cloudflare Access in front', text: 'One self-hosted Access app guards the dashboard and the MCP endpoint. Only the emails you allow get in.' },
    { icon: 'key', title: 'Managed OAuth for MCP', text: 'Access acts as the OAuth 2.1 server with dynamic client registration and PKCE. No client IDs to paste.' },
    { icon: 'shield', title: 'JWT re-verified in the Worker', text: 'Every request’s Access JWT is checked against your team’s keys and AUD tag, so bypassing Access gets nothing.' },
    { icon: 'eye', title: 'Locked until ready', text: 'Until Access, Managed OAuth and a tight policy are confirmed, data and sync stay off. Break a check later and it locks again.' },
  ];

  type Cell = { v: string; good?: boolean; no?: boolean };
  const comparison: { row: string; sk: Cell; saas: Cell }[] = [
    { row: 'Where your data lives', sk: { v: 'Your Cloudflare account', good: true }, saas: { v: 'The vendor’s servers' } },
    { row: 'Price', sk: { v: 'Free, MIT licensed', good: true }, saas: { v: 'Monthly subscription' } },
    { row: 'History past GSC’s 16 months', sk: { v: 'Kept in D1, forever', good: true }, saas: { v: 'Varies; often only while subscribed' } },
    { row: 'AI crawled → cited → clicked, per page', sk: { v: 'Built in', good: true }, saas: { v: 'Rare' } },
    { row: 'Ask from Claude, Cursor, ChatGPT', sk: { v: '12 read-only MCP tools', good: true }, saas: { v: 'Sometimes' } },
    { row: 'Telemetry', sk: { v: 'None', good: true }, saas: { v: 'Usually' } },
    { row: 'Writes to your properties', sk: { v: 'Off unless you opt in', good: true }, saas: { v: 'Varies' } },
    { row: 'Backlink index', sk: { v: 'No, by design', no: true }, saas: { v: 'Yes', good: true } },
    { row: 'Competitor research', sk: { v: 'No, by design', no: true }, saas: { v: 'Yes', good: true } },
    { row: 'Rank tracking (SERP scraping)', sk: { v: 'No, by design', no: true }, saas: { v: 'Yes', good: true } },
  ];

  const jsonld = [organization, website, softwareApplication, faqPage(FAQS, '/')];
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
    <p class="hero-sub">
      SEO &amp; GEO analytics that lives in your own Cloudflare account. See which pages AI crawlers read, cite and
      send clicks to, keep your history forever, and ask about it from Claude, Cursor or ChatGPT.
    </p>
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
      <h2 id="funnel-title">Crawled. Cited. Clicked.<br /><span class="muted">Finally in one place.</span></h2>
      <p>
        Generative engines read your site long before anyone clicks. Searchkeep joins three first-party sources per
        page, so you can see where AI visibility leaks out, not just that it does.
      </p>
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
            <p>{f.text}</p>
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
          <p>
            Often thin or outdated pages, missing direct answers, or crawlers hitting errors. Fix the content or the
            status code.
          </p>
        </div>
        <div class="stall card">
          <span class="pill">Cited, not clicked</span>
          <h3>You’re the source, not the destination.</h3>
          <p>The answer is complete without you. Add what an answer can’t: tools, data, depth, a next step.</p>
        </div>
        <p class="fineprint">
          The Cited step uses Bing AI Performance, which has no API yet: you import its CSV export from the
          dashboard. Example figures are illustrative.
        </p>
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
      <p>
        Point Claude, Claude Code, Cursor or ChatGPT at <code>https://your-domain/mcp</code>. Twelve task-shaped
        read-only tools aggregate on the server and return compact answers, so your assistant does the digging.
      </p>
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
            <li>
              <code class="tname">{t.name}</code>
              <span class="tsum">{t.summary}</span>
              {#if !t.readOnly}<span class="pill wtag">write · off</span>{/if}
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
      <h2 id="dash-title">And look, when you’d rather look.</h2>
      <p>
        A fast dashboard served by the same Worker. Every view runs the same analysis functions as the MCP tools, so
        the numbers your assistant quotes are the numbers you see.
      </p>
    </div>
    <ul class="views">
      {#each dashboardViews as v (v.title)}
        <li class="view card">
          <span class="view-icon"><Icon name={v.icon} size={18} /></span>
          <h3>{v.title}</h3>
          <p>{v.text}</p>
        </li>
      {/each}
    </ul>
  </div>
</section>

<!-- History -->
<section class="section alt" id="history" aria-labelledby="history-title">
  <div class="container">
    <div class="history-grid">
      <div class="section-head">
        <span class="eyebrow">Long-term history</span>
        <h2 id="history-title">Keep your history forever.</h2>
        <p>
          Search Console forgets everything older than 16 months. Searchkeep starts backfilling those 16 months the
          day you deploy, keeps every new day in D1 and never deletes. Comparing this quarter with the same quarter two
          years ago just works.
        </p>
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
      <p>
        Searchkeep reads the APIs you already have access to, for sites you own. Each source is synced into D1 once a
        day, in small batches; live calls are reserved for things like URL inspection.
      </p>
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
          <dl class="source-meta">
            <div><dt>Credential</dt><dd>{s.cred}</dd></div>
            <div><dt>Keep in mind</dt><dd>{s.limit}</dd></div>
          </dl>
        </li>
      {/each}
    </ul>
    <a class="more" href="/docs/data-sources">Every source, permission and limitation <Icon name="arrow" size={14} /></a>
  </div>
</section>

<!-- Principles + architecture -->
<section class="section alt" id="ownership" aria-labelledby="own-title">
  <div class="container">
    <div class="section-head">
      <span class="eyebrow">Ownership</span>
      <h2 id="own-title">One Worker. Your account.<br /><span class="muted">Nobody else in the loop.</span></h2>
      <p>
        MCP, the dashboard and the scheduled sync are three entrances to one Worker, sharing one core and one D1
        database. There is no Searchkeep server to trust, pay or outlive.
      </p>
    </div>
    <div class="own-grid">
      <ArchitectureDiagram />
      <ul class="principles">
        {#each PRINCIPLES as p (p.title)}
          <li>
            <h3>{p.title}</h3>
            <p>{p.body}</p>
          </li>
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
      <h2 id="sec-title">Secure by default.<br /><span class="muted">Locked until it’s safe.</span></h2>
      <p>
        Search data is sensitive. Searchkeep refuses to serve any of it until Cloudflare Access is protecting it
        properly, and it checks again on every request.
      </p>
    </div>
    <div class="sec-grid">
      <ul class="sec-list">
        {#each security as s (s.title)}
          <li>
            <span class="sec-icon"><Icon name={s.icon} size={18} /></span>
            <div>
              <h3>{s.title}</h3>
              <p>{s.text}</p>
            </div>
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
        <li class="st-foot">Cron only syncs after <code>ready</code> is recorded, and re-checks Access before every pass.</li>
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
        <p>
          The deploy guide is written as an idempotent runbook: every step can be re-run and comes with a check. An
          agent with GitHub and Cloudflare MCP access can do almost all of it, and stops to ask when a human must click.
        </p>
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
      <p>
        Searchkeep is deliberately narrow: your own data, for your own sites. If you need backlinks, competitor research
        or rank tracking, keep a SaaS tool for that, and use Searchkeep for everything you own.
      </p>
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
      <p>More in the <a class="inline" href="/docs/faq">docs FAQ</a>, or open an <a class="inline" href={GITHUB.issues}>issue on GitHub</a>.</p>
    </div>
    <div class="faq">
      {#each FAQS as f, i (f.q)}
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
    <p>Every day you wait is a day Search Console forgets. Deploying takes about 30–45 minutes.</p>
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
  .stage p {
    margin-top: 8px;
    color: var(--text-2);
    font-size: 0.9375rem;
    max-width: 560px;
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
  .s2 {
    background: var(--accent-fill);
    box-shadow: 0 0 16px var(--accent-glow);
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
    font-size: 1.125rem;
    letter-spacing: -0.018em;
  }
  .stall p {
    margin-top: 6px;
    color: var(--text-2);
    font-size: 0.9375rem;
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
    padding: 0;
  }
  .tools li {
    display: grid;
    grid-template-columns: minmax(0, auto) 1fr;
    grid-template-areas: 'name tag' 'sum sum';
    gap: 2px 8px;
    padding: 9px 12px;
    border-radius: 9px;
    transition: background-color 150ms;
  }
  .tools li:hover {
    background: var(--surface-2);
  }
  .tools .tname {
    grid-area: name;
    justify-self: start;
    font-size: 0.8125rem;
    padding: 0;
    border: 0;
    background: none;
    color: var(--text);
    font-weight: 500;
  }
  .tsum {
    grid-area: sum;
    font-size: 0.8125rem;
    color: var(--text-3);
    line-height: 1.45;
  }
  .wtag {
    grid-area: tag;
    justify-self: start;
    height: 19px;
    font-size: 10.5px;
    color: var(--warn);
    border-color: transparent;
    background: var(--warn-soft);
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
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 14px;
  }
  .view {
    padding: 24px;
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
    color: var(--accent);
  }
  .view h3 {
    margin-top: 18px;
    font-size: 1.0625rem;
    letter-spacing: -0.015em;
  }
  .view p {
    margin-top: 6px;
    font-size: 0.9375rem;
    color: var(--text-3);
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
  .source-meta {
    margin-top: auto;
    padding-top: 20px;
    display: grid;
    gap: 10px;
  }
  .source-meta div {
    padding-top: 10px;
    border-top: 1px solid var(--line);
  }
  .source-meta dt {
    font-size: var(--fs-xs);
    color: var(--text-4);
  }
  .source-meta dd {
    margin: 2px 0 0;
    font-size: var(--fs-sm);
    color: var(--text-2);
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
    padding: 20px 0;
    border-top: 1px solid var(--line);
  }
  .principles li:first-child {
    border-top: 0;
    padding-top: 0;
  }
  .principles h3 {
    font-size: 1.0625rem;
    letter-spacing: -0.015em;
  }
  .principles p {
    margin-top: 6px;
    font-size: 0.9375rem;
    color: var(--text-3);
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
  .sec-list h3 {
    margin-top: 16px;
    font-size: 1.0625rem;
    letter-spacing: -0.015em;
  }
  .sec-list p {
    margin-top: 6px;
    font-size: 0.9375rem;
    color: var(--text-3);
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
  .inline {
    color: var(--text);
    text-decoration: underline;
    text-decoration-color: var(--accent-line);
    text-underline-offset: 3px;
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
