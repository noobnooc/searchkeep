<script lang="ts">
  // The GEO funnel as a ribbon that narrows from crawled to cited to clicked. Dots are pages:
  // most fade out where they stall, and the few that are clicked turn Signal at the end.
  // Motion is SMIL (no JavaScript); it is hidden for reduced motion.
  import Icon, { type IconName } from '../Icon.svelte';

  type Step = { step: string; icon: IconName; marks: IconName[]; source: string; value: number };
  const steps: Step[] = [
    { step: 'Crawled', icon: 'bot', marks: ['cloudflare'], source: 'Cloudflare AI crawlers', value: 412 },
    { step: 'Cited', icon: 'quote', marks: ['bing'], source: 'Bing AI Performance', value: 96 },
    { step: 'Clicked', icon: 'pointer', marks: ['cloudflare', 'searchconsole', 'bing'], source: 'Web Analytics · GSC · Bing', value: 38 },
  ];
  const stalls = [
    { pill: 'Crawled, not cited', title: 'AI reads it, then ignores it.', pages: steps[0]!.value - steps[1]!.value },
    { pill: 'Cited, not clicked', title: 'You’re the source, not the destination.', pages: steps[1]!.value - steps[2]!.value },
  ];

  // Geometry, in viewBox units.
  const W = 900;
  const CY = 70;
  const H = 156;
  const b1 = W / 3;
  const b2 = (2 * W) / 3;
  const h = steps.map((s) => (64 * s.value) / steps[0]!.value);
  const [h0, h1, h2] = h as [number, number, number];
  const x0 = 0.75;
  const xe = W - 0.75;
  const r0 = 8;
  const r2 = Math.min(6, h2);
  // Each step narrows into the next just before the next column starts.
  const A = 130;
  const B = 20;
  const M = (A - B) / 2;
  const f = (n: number) => Math.round(n * 10) / 10;

  const ribbon = [
    `M${x0},${f(CY - h0 + r0)}Q${x0},${f(CY - h0)} ${x0 + r0},${f(CY - h0)}`,
    `L${b1 - A},${f(CY - h0)}C${b1 - M},${f(CY - h0)} ${b1 - M},${f(CY - h1)} ${b1 + B},${f(CY - h1)}`,
    `L${b2 - A},${f(CY - h1)}C${b2 - M},${f(CY - h1)} ${b2 - M},${f(CY - h2)} ${b2 + B},${f(CY - h2)}`,
    `L${f(xe - r2)},${f(CY - h2)}Q${xe},${f(CY - h2)} ${xe},${f(CY - h2 + r2)}`,
    `L${xe},${f(CY + h2 - r2)}Q${xe},${f(CY + h2)} ${f(xe - r2)},${f(CY + h2)}`,
    `L${b2 + B},${f(CY + h2)}C${b2 - M},${f(CY + h2)} ${b2 - M},${f(CY + h1)} ${b2 - A},${f(CY + h1)}`,
    `L${b1 + B},${f(CY + h1)}C${b1 - M},${f(CY + h1)} ${b1 - M},${f(CY + h0)} ${b1 - A},${f(CY + h0)}`,
    `L${x0 + r0},${f(CY + h0)}Q${x0},${f(CY + h0)} ${x0},${f(CY + h0 - r0)}Z`,
  ].join('');

  // Pages, in the funnel's proportions: most stall after the crawl, some after the citation,
  // a few are clicked. Positions are fractions of each band's half height, from a seeded PRNG.
  type Dot = { p: number[]; reach: 0 | 1 | 2 };
  let seed = 7;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const side = () => (rnd() < 0.5 ? -1 : 1);
  const span = (lo: number, hi: number) => lo + rnd() * (hi - lo);
  const pool: Dot[] = [
    ...Array.from({ length: 28 }, (): Dot => ({ p: [side() * span(0.34, 0.94)], reach: 0 })),
    ...Array.from({ length: 5 }, (): Dot => ({ p: [span(-0.9, 0.9), side() * span(0.5, 0.92)], reach: 1 })),
    ...Array.from({ length: 3 }, (): Dot => ({ p: [span(-0.9, 0.9), span(-0.3, 0.3), span(-0.5, 0.5)], reach: 2 })),
  ];
  // Spread the few that get further evenly through the stream.
  const toCited = pool.filter((d) => d.reach === 1);
  const toClick = pool.filter((d) => d.reach === 2);
  const further = [toCited[0], toClick[0], toCited[1], toCited[2], toClick[1], toCited[3], toClick[2], toCited[4]].filter((d): d is Dot => !!d);
  const stalled = pool.filter((d) => d.reach === 0);
  const every = Math.round(pool.length / further.length);
  const dots: Dot[] = [];
  for (let i = 0; i < pool.length; i++) dots.push((i % every === 1 && further.length ? further.shift() : stalled.shift()) ?? further.shift()!);
  const T = 10;
  const RUN = 0.92; // share of the cycle a page that reaches the end spends moving
  const at = (x: number) => (x / W) * RUN;
  const flows = dots.map((d, k) => {
    const y = d.p.map((p, i) => f(CY + p * h[i]! * 0.9));
    const [y0, y1, y2] = y as [number, number?, number?];
    let path = `M0,${y0}`;
    let endX: number;
    const out = (y: number) => f(y + (y < CY ? -10 : 10));
    if (d.reach === 0) {
      endX = b1 - 30;
      path += `L${b1 - A},${y0}Q${b1 - 60},${y0} ${endX},${out(y0)}`;
    } else {
      path += `L${b1 - A},${y0}C${b1 - M},${y0} ${b1 - M},${y1} ${b1 + B},${y1}`;
      if (d.reach === 1) {
        endX = b2 - 30;
        path += `L${b2 - A},${y1}Q${b2 - 60},${y1} ${endX},${out(y1!)}`;
      } else {
        endX = W - 12;
        path += `L${b2 - A},${y1}C${b2 - M},${y1} ${b2 - M},${y2} ${b2 + B},${y2}L${endX},${y2}`;
      }
    }
    const end = f(at(endX) * 1000) / 1000;
    return {
      path,
      reach: d.reach,
      end,
      fadeFrom: f((end - 0.06) * 1000) / 1000,
      begin: `${f(-(k * T) / dots.length)}s`,
    };
  });
  const t1 = f(at(b1) * 1000) / 1000;
  const t2 = f(at(b2) * 1000) / 1000;
  const label = `Of ${steps[0]!.value} pages crawled by AI, ${steps[1]!.value} were cited and ${steps[2]!.value} were clicked.`;
</script>

<div class="flow card">
  <ol class="cols">
    {#each steps as s, i (s.step)}
      <li style:--n={s.value}>
        <div class="head">
          <span class="ico t{i}"><Icon name={s.icon} size={18} /></span>
          <h3>{s.step}</h3>
        </div>
        <div class="val">
          <span class="count">{s.value}</span>
          <span class="unit">pages</span>
          {#if i > 0}<span class="conv">{Math.round((s.value / steps[i - 1]!.value) * 100)}%</span>{/if}
        </div>
        <div class="src"><span class="marks">{#each s.marks as m, j (j)}<Icon name={m} size={12} />{/each}</span><span class="src-name">{s.source}</span></div>
      </li>
    {/each}
  </ol>

  <svg class="ribbon" viewBox="0 0 {W} {H}" role="img" aria-label={label}>
    <defs>
      <linearGradient id="geo-flow-g" x1="0" x2={W} y1="0" y2="0" gradientUnits="userSpaceOnUse">
        <stop offset="0" class="g0" />
        <stop offset="0.4" class="g1" />
        <stop offset="0.74" class="g2" />
      </linearGradient>
    </defs>
    <line class="drop-line" x1={b1} x2={b1} y1="0" y2={H} />
    <line class="drop-line" x1={b2} x2={b2} y1="0" y2={H} />
    <path class="band" d={ribbon} />
    <path class="edge" d={ribbon} />
    <g class="dots" aria-hidden="true">
      {#each flows as d, k (k)}
        <g>
          <circle r="2.4" class="d-n" />
          {#if d.reach > 0}
            <circle r="2.4" class="d-c" opacity="0">
              <animate attributeName="opacity" values="0;0;1;1" keyTimes="0;{t1 - 0.02};{t1 + 0.02};1" dur="{T}s" begin={d.begin} repeatCount="indefinite" />
            </circle>
          {/if}
          {#if d.reach > 1}
            <circle r="2.6" class="d-s" opacity="0">
              <animate attributeName="opacity" values="0;0;1;1" keyTimes="0;{t2 - 0.02};{t2 + 0.02};1" dur="{T}s" begin={d.begin} repeatCount="indefinite" />
            </circle>
          {/if}
          <animateMotion path={d.path} keyPoints="0;1;1" keyTimes="0;{d.end};1" calcMode="linear" dur="{T}s" begin={d.begin} repeatCount="indefinite" />
          <animate attributeName="opacity" values="0;1;1;0;0" keyTimes="0;0.03;{d.fadeFrom};{d.end};1" dur="{T}s" begin={d.begin} repeatCount="indefinite" />
        </g>
      {/each}
    </g>
    <circle class="today" cx={W - 9} cy={CY} r="3.5" />
    <circle class="ring" cx={W - 9} cy={CY} r="3.5" />
  </svg>

  <div class="stalls">
    <p class="fineprint">Figures are illustrative. Cited comes from Bing AI Performance, imported as CSV.</p>
    {#each stalls as st, i (st.pill)}
      <div class="stall" style:--i={i}>
        <span class="pill">{st.pill}</span>
        <h3>{st.title}</h3>
        <span class="lost"><strong>{st.pages}</strong> pages stall here</span>
      </div>
    {/each}
  </div>
</div>

<style>
  .flow {
    padding: 26px 28px 24px;
    timeline-scope: --ribbon;
  }
  .cols,
  .stalls {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
  .cols {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .cols li,
  .stall {
    min-width: 0;
    padding-left: 18px;
    border-left: 1px dashed var(--line-2);
  }
  .cols li:first-child {
    padding-left: 0;
    border-left: 0;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .ico {
    display: inline-flex;
    color: var(--text-3);
  }
  .ico.t2 {
    color: var(--accent-text);
  }
  .head h3 {
    font-size: 1.25rem;
    letter-spacing: -0.02em;
  }
  .val {
    display: flex;
    align-items: baseline;
    gap: 6px;
    margin-top: 14px;
    font-variant-numeric: tabular-nums;
  }
  .count,
  .count::before {
    font-family: var(--font-display);
    font-size: clamp(1.75rem, 1.2rem + 1.6vw, 2.5rem);
    font-weight: 600;
    line-height: 1;
    letter-spacing: -0.03em;
    color: var(--text);
  }
  .unit {
    font-size: var(--fs-sm);
    color: var(--text-3);
  }
  .conv {
    margin-left: 4px;
    padding: 1px 7px;
    border-radius: 999px;
    border: 1px solid var(--line-2);
    font-size: 11px;
    font-weight: 600;
    color: var(--text-3);
  }
  .src {
    display: flex;
    align-items: center;
    gap: 7px;
    margin-top: 10px;
    font-size: var(--fs-xs);
    color: var(--text-3);
  }
  .marks {
    display: inline-flex;
    gap: 4px;
    flex: none;
  }
  .src-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .ribbon {
    display: block;
    width: 100%;
    height: auto;
    margin-top: 18px;
    overflow: visible;
    view-timeline-name: --ribbon;
  }
  .drop-line {
    stroke: var(--line-2);
    stroke-dasharray: 3 4;
    vector-effect: non-scaling-stroke;
  }
  .g0 {
    stop-color: var(--text-4);
  }
  .g1 {
    stop-color: color-mix(in oklch, var(--accent-fill) 55%, var(--text-4));
  }
  .g2 {
    stop-color: var(--signal);
  }
  .band {
    fill: url(#geo-flow-g);
    fill-opacity: 0.2;
  }
  .edge {
    fill: none;
    stroke: url(#geo-flow-g);
    stroke-opacity: 0.7;
    stroke-width: 1.25;
    vector-effect: non-scaling-stroke;
  }
  .d-n {
    fill: var(--text-2);
  }
  .d-c {
    fill: color-mix(in oklch, var(--accent-fill) 70%, var(--text-2));
  }
  .d-s,
  .today {
    fill: var(--signal);
  }
  .ring {
    fill: none;
    stroke: var(--signal);
    stroke-width: 1.5;
    opacity: 0;
    transform-box: fill-box;
    transform-origin: center;
    vector-effect: non-scaling-stroke;
  }

  .stalls {
    margin-top: -2px;
  }
  .stall {
    padding-top: 4px;
  }
  .stall .pill {
    color: var(--text);
  }
  .stall h3 {
    margin-top: 10px;
    font-size: 1.0625rem;
    line-height: 1.35;
    letter-spacing: -0.01em;
  }
  .lost {
    display: block;
    margin-top: 8px;
    font-size: var(--fs-xs);
    color: var(--text-3);
    font-variant-numeric: tabular-nums;
  }
  .lost strong {
    color: var(--text);
    font-weight: 600;
  }
  .fineprint {
    align-self: end;
    padding-right: 18px;
    font-size: var(--fs-xs);
    color: var(--text-4);
  }

  /* Motion, tied to scroll where it can be: the ribbon unrolls, the counts climb with it, the
     stalls arrive in turn, and the end of the ribbon pings like today's dot in the hero. */
  @property --count {
    syntax: '<integer>';
    inherits: false;
    initial-value: 0;
  }
  @media (prefers-reduced-motion: reduce) {
    .dots {
      display: none;
    }
  }
  @media (prefers-reduced-motion: no-preference) {
    .ring {
      animation: ping 2.6s var(--ease) infinite;
    }
    .ribbon {
      animation: unroll linear both;
      animation-timeline: view();
      animation-range: entry 0% entry 100%;
    }
    .stall {
      animation: rise linear both;
      animation-timeline: view();
      animation-range: entry calc(20% + var(--i) * 25%) entry calc(80% + var(--i) * 20%);
    }
    @supports (animation-timeline: view()) {
      .count {
        font-size: 0;
      }
      .count::before {
        --count: var(--n);
        counter-reset: c var(--count);
        content: counter(c);
        animation: count linear both;
        animation-timeline: --ribbon;
        animation-range: entry 0% entry 100%;
      }
    }
  }
  @keyframes unroll {
    from {
      clip-path: inset(-20px 100% -20px 0);
    }
    to {
      clip-path: inset(-20px -20px -20px 0);
    }
  }
  @keyframes count {
    from {
      --count: 0;
    }
  }
  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(8px);
    }
  }
  @keyframes ping {
    0% {
      transform: scale(1);
      opacity: 0.6;
    }
    80%,
    100% {
      transform: scale(3.2);
      opacity: 0;
    }
  }

  @media (max-width: 720px) {
    .flow {
      padding: 20px 16px 18px;
    }
    .cols li {
      padding-left: 10px;
    }
    .head {
      gap: 6px;
    }
    .head h3 {
      font-size: 1rem;
    }
    .conv {
      display: none;
    }
    .src-name {
      display: none;
    }
    .unit {
      font-size: var(--fs-xs);
    }
    .stalls {
      grid-template-columns: minmax(0, 1fr);
      gap: 16px;
      margin-top: 8px;
    }
    .stall {
      padding-left: 12px;
    }
    .fineprint {
      order: 3;
      padding-right: 0;
    }
  }
</style>
