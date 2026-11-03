<script lang="ts">
  import Window from './Window.svelte';

  // Deterministic sample series: AI crawler requests per day, 28 days.
  const days = 28;
  const series = Array.from({ length: days }, (_, i) => {
    const trend = 1150 + i * 26;
    const weekly = Math.sin((i / 7) * Math.PI * 2) * 120;
    const noise = Math.sin(i * 12.9898) * 43758.5453;
    return Math.round(trend + weekly + (noise - Math.floor(noise) - 0.5) * 260);
  });
  const max = Math.max(...series) * 1.08;
  const W = 320;
  const H = 120;
  const pts = series.map((v, i) => [(i / (days - 1)) * W, H - (v / max) * H] as const);
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const area = `${line} L${W} ${H} L0 ${H} Z`;
  const last = pts[pts.length - 1]!;

  const spark = (seed: number, up = true) =>
    Array.from({ length: 14 }, (_, i) => {
      const n = Math.sin((i + seed) * 7.13) * 0.5 + 0.5;
      return (up ? i * 0.9 : 13 - i * 0.6) + n * 4;
    })
      .map((v, i, a) => {
        const mx = Math.max(...a);
        const mn = Math.min(...a);
        return `${((i / 13) * 64).toFixed(1)},${(22 - ((v - mn) / (mx - mn)) * 20).toFixed(1)}`;
      })
      .join(' ');

  const kpis = [
    { label: 'Search clicks', value: '61,482', delta: '+12.4%', seed: 1 },
    { label: 'AI crawler requests', value: '48,207', delta: '+31.0%', seed: 3 },
    { label: 'AI citations', value: '1,284', delta: '+18.2%', seed: 5 },
    { label: 'AI referral visits', value: '3,912', delta: '+22.7%', seed: 8 },
  ];

  const funnel = [
    { label: 'Crawled', note: 'pages fetched by AI crawlers', value: 412 },
    { label: 'Cited', note: 'pages cited in AI answers', value: 96 },
    { label: 'Clicked', note: 'pages with AI referral visits', value: 38 },
  ];

  const rows = [
    { page: '/docs/api/authentication', crawled: '3,214', cited: '112', ai: '486', clicks: '4,120', status: 'ok' },
    { page: '/blog/pricing-models-explained', crawled: '2,876', cited: '0', ai: '0', clicks: '1,904', status: 'uncited' },
    { page: '/guides/migrate-from-v1', crawled: '2,410', cited: '74', ai: '9', clicks: '2,388', status: 'unclicked' },
    { page: '/changelog', crawled: '1,987', cited: '0', ai: '0', clicks: '312', status: 'uncited' },
    { page: '/docs/webhooks', crawled: '1,522', cited: '51', ai: '203', clicks: '1,733', status: 'ok' },
  ] as const;
  const statusLabel = { ok: 'Healthy', uncited: 'Not cited', unclicked: 'Not clicked' } as const;

  const nav = ['Overview', 'GEO funnel', 'Performance', 'Compare', 'Opportunities', 'AI crawlers', 'Technical', 'Settings'];
</script>

<Window
  title="searchkeep.acme.com"
  label="Searchkeep dashboard for acme.com: 61,482 search clicks, 48,207 AI crawler requests, 1,284 AI citations and 3,912 AI referral visits in the last 28 days. The GEO funnel shows 412 pages crawled by AI, 96 cited and 38 clicked, with a table of pages that are crawled but never cited."
>
  <div class="dash-wrap">
  <div class="dash">
    <aside class="side">
      <div class="ws">
        <span class="ws-mark"></span>
        <span>acme.com</span>
        <span class="chev">⌄</span>
      </div>
      <ul>
        {#each nav as item, i (item)}
          <li class:active={i === 1}><span class="dot"></span>{item}</li>
        {/each}
      </ul>
      <div class="sync">
        <span class="live"></span>
        Synced 12 min ago
      </div>
    </aside>

    <div class="main">
      <div class="top">
        <div>
          <div class="crumb">acme.com / GEO funnel</div>
          <div class="h">Last 28 days</div>
        </div>
        <div class="filters">
          <span class="chip">Oct 6 – Nov 2, 2026</span>
          <span class="chip hide-sm">All queries</span>
          <span class="chip hide-sm">GSC · Bing · Cloudflare</span>
        </div>
      </div>

      <div class="kpis">
        {#each kpis as k (k.label)}
          <div class="kpi">
            <div class="k-label">{k.label}</div>
            <div class="k-row">
              <span class="k-value">{k.value}</span>
              <svg class="k-spark" viewBox="0 0 64 24" preserveAspectRatio="none">
                <polyline points={spark(k.seed)} />
              </svg>
            </div>
            <div class="k-delta">{k.delta} <span>vs prev.</span></div>
          </div>
        {/each}
      </div>

      <div class="row">
        <section class="panel funnel">
          <header><span>GEO funnel</span><span class="muted-sm">pages</span></header>
          <ol>
            {#each funnel as f, i (f.label)}
              <li style="--w: {(f.value / funnel[0]!.value) * 100}%; --i: {i}">
                <div class="f-head">
                  <span class="f-label">{f.label}</span>
                  <span class="f-value">{f.value}</span>
                </div>
                <div class="f-track"><div class="f-bar s{i}"></div></div>
                <div class="f-note">{f.note}</div>
              </li>
            {/each}
          </ol>
        </section>

        <section class="panel chart">
          <header><span>AI crawler requests</span><span class="muted-sm">per day</span></header>
          <div class="plot-wrap">
          <svg viewBox="0 0 {W} {H}" preserveAspectRatio="none" class="plot">
            <defs>
              <linearGradient id="dash-area" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stop-color="var(--accent-fill)" stop-opacity="0.28" />
                <stop offset="1" stop-color="var(--accent-fill)" stop-opacity="0" />
              </linearGradient>
            </defs>
            {#each [0.25, 0.5, 0.75] as g (g)}
              <line x1="0" x2={W} y1={H * g} y2={H * g} class="grid" />
            {/each}
            <path d={area} fill="url(#dash-area)" />
            <path d={line} class="stroke" />
          </svg>
          <div class="last" style="left: {(last[0] / W) * 100}%; top: {(last[1] / H) * 100}%"></div>
          </div>
          <div class="axis"><span>Oct 6</span><span>Oct 20</span><span>Nov 2</span></div>
        </section>
      </div>

      <section class="panel table">
        <header><span>Pages</span><span class="muted-sm">sorted by AI crawler requests</span></header>
        <div class="t">
          <div class="tr th">
            <span class="left">Page</span><span>Crawled</span><span>Cited</span><span class="c-ai">AI visits</span><span class="c-clicks">Clicks</span><span class="c-status">Status</span>
          </div>
          {#each rows as r (r.page)}
            <div class="tr">
              <span class="page">{r.page}</span>
              <span>{r.crawled}</span>
              <span class:zero={r.cited === '0'}>{r.cited}</span>
              <span class="c-ai" class:zero={r.ai === '0'}>{r.ai}</span>
              <span class="c-clicks">{r.clicks}</span>
              <span class="c-status"><span class="st {r.status}">{statusLabel[r.status]}</span></span>
            </div>
          {/each}
        </div>
      </section>
    </div>
  </div>
  </div>
</Window>

<style>
  .dash-wrap {
    container-type: inline-size;
  }
  .dash {
    display: grid;
    grid-template-columns: 188px minmax(0, 1fr);
    font-size: 12px;
    color: var(--text-2);
    text-align: left;
  }
  .side {
    border-right: 1px solid var(--line);
    padding: 14px 10px;
    display: flex;
    flex-direction: column;
    gap: 14px;
    background: light-dark(#fbfbfa, #0c0d0f);
  }
  .ws {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    border-radius: 8px;
    color: var(--text);
    font-weight: 550;
  }
  .ws-mark {
    width: 16px;
    height: 16px;
    border-radius: 5px;
    background: linear-gradient(135deg, oklch(0.75 0.12 260), oklch(0.6 0.15 300));
  }
  .chev {
    margin-left: auto;
    color: var(--text-4);
  }
  .side ul {
    list-style: none;
    padding: 0;
    display: grid;
    gap: 1px;
  }
  .side li {
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 6px 8px;
    border-radius: 7px;
    color: var(--text-3);
  }
  .side li .dot {
    width: 12px;
    height: 12px;
    border-radius: 4px;
    border: 1.5px solid currentColor;
    opacity: 0.6;
  }
  .side li.active {
    background: var(--surface-2);
    color: var(--text);
    box-shadow: 0 0 0 1px var(--line) inset;
  }
  .side li.active .dot {
    border-color: var(--accent);
    background: var(--accent-soft);
    opacity: 1;
  }
  .sync {
    margin-top: auto;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px;
    color: var(--text-4);
    font-size: 11px;
  }
  .live {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--accent-fill);
    box-shadow: 0 0 0 3px var(--accent-soft);
  }

  .main {
    padding: 16px 18px 18px;
    display: grid;
    gap: 12px;
    min-width: 0;
  }
  .top {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 12px;
  }
  .crumb {
    color: var(--text-4);
    font-size: 11px;
  }
  .h {
    font-size: 15px;
    font-weight: 600;
    color: var(--text);
    letter-spacing: -0.01em;
  }
  .filters {
    display: flex;
    gap: 6px;
  }
  .chip {
    padding: 4px 9px;
    border: 1px solid var(--line-2);
    border-radius: 7px;
    background: var(--surface);
    color: var(--text-2);
    white-space: nowrap;
    font-size: 11px;
  }

  .kpis {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 10px;
  }
  .kpi,
  .panel {
    border: 1px solid var(--line);
    border-radius: 10px;
    background: var(--surface);
  }
  .kpi {
    padding: 10px 12px;
    min-width: 0;
  }
  .k-label {
    color: var(--text-3);
    font-size: 11px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .k-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-top: 2px;
  }
  .k-value {
    font-size: 18px;
    font-weight: 600;
    color: var(--text);
    letter-spacing: -0.02em;
    font-variant-numeric: tabular-nums;
  }
  .k-spark {
    width: 56px;
    height: 22px;
    flex: none;
  }
  .k-spark polyline {
    fill: none;
    stroke: var(--accent);
    stroke-width: 1.5;
    vector-effect: non-scaling-stroke;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .k-delta {
    font-size: 11px;
    color: var(--accent);
    font-variant-numeric: tabular-nums;
  }
  .k-delta span {
    color: var(--text-4);
  }

  .row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1.25fr);
    gap: 10px;
  }
  .panel {
    padding: 12px 14px;
    min-width: 0;
    position: relative;
  }
  .panel header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    color: var(--text);
    font-weight: 550;
    margin-bottom: 10px;
  }
  .muted-sm {
    color: var(--text-4);
    font-weight: 400;
    font-size: 11px;
  }
  .funnel ol {
    list-style: none;
    padding: 0;
    display: grid;
    gap: 10px;
  }
  .f-head {
    display: flex;
    justify-content: space-between;
  }
  .f-label {
    color: var(--text-2);
  }
  .f-value {
    color: var(--text);
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
  .f-track {
    height: 8px;
    margin-top: 5px;
    border-radius: 4px;
    background: var(--surface-2);
    overflow: hidden;
  }
  .f-bar {
    width: var(--w);
    height: 100%;
    border-radius: 4px;
    transform-origin: left;
    animation: grow 1.1s var(--ease) both;
    animation-delay: calc(var(--i) * 140ms + 200ms);
  }
  .s0 {
    background: color-mix(in oklch, var(--accent-fill) 45%, var(--surface-3));
  }
  .s1 {
    background: color-mix(in oklch, var(--accent-fill) 72%, var(--surface-3));
  }
  .s2 {
    background: var(--accent-fill);
  }
  .f-note {
    margin-top: 3px;
    color: var(--text-4);
    font-size: 10.5px;
  }
  @keyframes grow {
    from {
      transform: scaleX(0);
    }
  }

  .plot {
    width: 100%;
    height: 112px;
    overflow: visible;
  }
  .plot .grid {
    stroke: var(--line);
    stroke-dasharray: 2 4;
    vector-effect: non-scaling-stroke;
  }
  .plot .stroke {
    fill: none;
    stroke: var(--accent);
    stroke-width: 2;
    vector-effect: non-scaling-stroke;
    stroke-linejoin: round;
    stroke-linecap: round;
  }
  .plot-wrap {
    position: relative;
  }
  .last {
    position: absolute;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--accent);
    box-shadow: 0 0 0 2px var(--surface), 0 0 0 5px var(--accent-soft);
    transform: translate(-50%, -50%);
  }
  .axis {
    display: flex;
    justify-content: space-between;
    margin-top: 6px;
    color: var(--text-4);
    font-size: 10.5px;
  }

  .t {
    display: grid;
  }
  .tr {
    display: grid;
    grid-template-columns: minmax(0, 2.4fr) repeat(4, minmax(0, 0.8fr)) minmax(0, 1fr);
    gap: 10px;
    align-items: center;
    padding: 7px 0;
    border-top: 1px solid var(--line);
    font-variant-numeric: tabular-nums;
  }
  .tr > span:not(.page):not(.c-status):not(.left) {
    text-align: right;
  }
  .th {
    border-top: 0;
    padding-top: 0;
    color: var(--text-4);
    font-size: 11px;
  }
  .tr > span.left {
    text-align: left;
  }
  .page {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .zero {
    color: var(--text-4);
  }
  .c-status {
    text-align: right;
  }
  .st {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 2px 7px;
    border-radius: 6px;
    font-size: 10.5px;
    white-space: nowrap;
    border: 1px solid var(--line-2);
  }
  .st::before {
    content: '';
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: currentColor;
  }
  .st.ok {
    color: var(--accent);
  }
  .st.uncited {
    color: var(--warn);
    background: var(--warn-soft);
    border-color: transparent;
  }
  .st.unclicked {
    color: var(--text-2);
  }

  @container (max-width: 760px) {
    .dash {
      grid-template-columns: minmax(0, 1fr);
    }
    .side {
      display: none;
    }
    .hide-sm {
      display: none;
    }
  }
  @container (max-width: 620px) {
    .kpis {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .row {
      grid-template-columns: minmax(0, 1fr);
    }
    .tr {
      grid-template-columns: minmax(0, 2fr) repeat(2, minmax(0, 0.8fr)) minmax(0, 1.1fr);
    }
    .c-ai,
    .c-clicks {
      display: none;
    }
  }
  @container (max-width: 400px) {
    .main {
      padding: 12px;
    }
    .top .filters {
      display: none;
    }
    .tr {
      grid-template-columns: minmax(0, 2fr) repeat(2, minmax(0, 0.7fr));
    }
    .c-status {
      display: none;
    }
  }
</style>
