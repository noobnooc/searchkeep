<script lang="ts">
  // The three first-party sources, wired into the D1 database in your own account. Dots flow
  // along the wires (SMIL, no JavaScript) and are hidden for reduced motion.
  import Icon, { type IconName } from '../Icon.svelte';

  const sources: { mark: IconName; name: string; color: string; pulls: string[] }[] = [
    { mark: 'searchconsole', name: 'Google Search Console', color: '#458cf5', pulls: ['Search Analytics', 'Sitemaps', 'URL Inspection'] },
    { mark: 'bing', name: 'Bing Webmaster Tools', color: '#258ffa', pulls: ['Search traffic', 'Crawl issues', 'AI citations (CSV)'] },
    { mark: 'cloudflare', name: 'Cloudflare', color: '#f38020', pulls: ['AI crawler requests', 'Web Analytics', 'Core Web Vitals'] },
  ];

  // Wires: one row per source, 104 units tall, converging on the D1 node's middle.
  const W = 160;
  const ROW = 104;
  const H = ROW * sources.length;
  const mid = H / 2;
  const wires = sources.map((_, i) => {
    const y = ROW * i + ROW / 2;
    return `M0,${y}C${W * 0.55},${y} ${W * 0.45},${mid} ${W},${mid}`;
  });
  const T = 3.6;
  const PER = 3;
  const dots = wires.flatMap((d, i) =>
    Array.from({ length: PER }, (_, k) => ({ d, begin: `${-((k * T) / PER + i * 0.5).toFixed(2)}s` })),
  );
</script>

<div class="sflow card">
  <ul class="srcs">
    {#each sources as s (s.name)}
      <li class="src" style:--brand={s.color}>
        <span class="tile"><Icon name={s.mark} size={20} /></span>
        <div class="src-body">
          <h3>{s.name}</h3>
          <ul class="pulls">
            {#each s.pulls as p (p)}<li>{p}</li>{/each}
          </ul>
        </div>
      </li>
    {/each}
  </ul>

  <svg class="wires" viewBox="0 0 {W} {H}" width={W} height={H} aria-hidden="true">
    {#each wires as d, i (i)}
      <path class="wire" {d} />
    {/each}
    <g class="dots">
      {#each dots as dot, k (k)}
        <circle r="2.4">
          <animateMotion path={dot.d} dur="{T}s" begin={dot.begin} repeatCount="indefinite" />
          <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.12;0.85;1" dur="{T}s" begin={dot.begin} repeatCount="indefinite" />
        </circle>
      {/each}
    </g>
  </svg>

  <div class="sink">
    <span class="sink-tag">Your Cloudflare account</span>
    <span class="db"><Icon name="database" size={22} /></span>
    <h3>D1</h3>
    <dl>
      <div><dt><Icon name="refresh" size={13} /></dt><dd>Syncs every 15 min</dd></div>
      <div><dt><Icon name="clock" size={13} /></dt><dd>Kept forever</dd></div>
    </dl>
  </div>
</div>

<style>
  .sflow {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 160px minmax(220px, 0.42fr);
    align-items: center;
    padding: 20px 28px;
  }
  .srcs {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .src {
    display: flex;
    align-items: center;
    gap: 16px;
    height: 104px;
  }
  .src + .src {
    border-top: 1px solid var(--line);
  }
  .tile {
    display: grid;
    place-items: center;
    flex: none;
    width: 44px;
    height: 44px;
    border-radius: 12px;
    border: 1px solid var(--line-2);
    background: var(--surface);
    color: var(--text-2);
    transition: color 200ms var(--ease), border-color 200ms var(--ease);
  }
  .src:hover .tile {
    color: var(--brand);
    border-color: var(--line-3);
  }
  .src-body {
    min-width: 0;
  }
  .src h3 {
    font-size: 1.0625rem;
    letter-spacing: -0.015em;
  }
  .pulls {
    list-style: none;
    margin: 8px 0 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .pulls li {
    padding: 2px 8px;
    border: 1px solid var(--line-2);
    border-radius: 6px;
    font-size: var(--fs-xs);
    color: var(--text-2);
    white-space: nowrap;
  }

  .wires {
    display: block;
    overflow: visible;
  }
  .wire {
    fill: none;
    stroke: var(--line-3);
    stroke-width: 1.25;
    stroke-dasharray: 3 4;
  }
  .dots circle {
    fill: var(--text-2);
  }

  .sink {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    padding: 34px 22px 20px;
    border: 1px dashed var(--line-3);
    border-radius: var(--radius-lg);
  }
  .sink-tag {
    position: absolute;
    top: -10px;
    left: 16px;
    padding: 0 6px;
    background: var(--bg-elev);
    font-family: var(--font-mono);
    font-size: 10.5px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-3);
  }
  .db {
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    border-radius: 12px;
    border: 1px solid var(--accent-line);
    background: var(--accent-soft);
    color: var(--accent-text);
  }
  .sink h3 {
    margin-top: 14px;
    font-size: 1.375rem;
    letter-spacing: -0.02em;
  }
  dl {
    margin: 10px 0 0;
    display: grid;
    gap: 6px;
  }
  dl div {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: var(--fs-sm);
    color: var(--text-2);
  }
  dt {
    display: inline-flex;
    color: var(--text-3);
  }
  dd {
    margin: 0;
  }

  @media (prefers-reduced-motion: reduce) {
    .dots {
      display: none;
    }
  }
  @media (max-width: 900px) {
    .sflow {
      grid-template-columns: minmax(0, 1fr);
      padding: 8px 20px 20px;
    }
    .wires {
      display: none;
    }
    .src {
      height: auto;
      padding-block: 16px;
    }
    .sink {
      margin-top: 18px;
    }
  }
</style>
