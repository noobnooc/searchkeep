<script lang="ts" module>
  export interface StackKey {
    key: string;
    label: string;
    color: string;
  }
</script>

<script lang="ts">
  import { niceTicks, roundedTopBar, textWidth, tickIndices } from '../lib/chart';
  import { compact, int, monthLabel, shortDate } from '../lib/format';

  interface Props {
    dates: string[];
    /** Stack order, bottom first. */
    keys: StackKey[];
    /** One record per date: key → value. */
    values: Array<Record<string, number>>;
    height?: number;
    label: string;
    format?: (n: number) => string;
    valueFormat?: (n: number) => string;
  }
  let { dates, keys, values, height = 220, label, format = compact, valueFormat = int }: Props = $props();

  let width = $state(0);
  let hover = $state<number | null>(null);

  const mt = 10;
  const mb = 24;
  const mr = 6;
  const GAP = 2;

  const n = $derived(dates.length);
  const totals = $derived(values.map((v) => keys.reduce((s, k) => s + (v[k.key] ?? 0), 0)));
  const ticks = $derived(niceTicks(Math.max(0, ...totals), 4));
  const top = $derived(ticks[ticks.length - 1] || 1);
  const ml = $derived(Math.max(24, ...ticks.map((t) => textWidth(format(t)))) + 12);
  const iw = $derived(Math.max(10, width - ml - mr));
  const ih = $derived(height - mt - mb);
  const band = $derived(n > 0 ? iw / n : iw);
  const barW = $derived(Math.max(1.5, Math.min(24, band - GAP, band * 0.72)));
  const long = $derived(n > 120);

  const y = (v: number) => mt + ih - (v / top) * ih;
  const bx = (i: number) => ml + i * band + (band - barW) / 2;

  interface Seg {
    key: string;
    color: string;
    d: string;
  }
  const bars = $derived(
    values.map((v) => {
      const segs: Seg[] = [];
      let cursor = mt + ih;
      let acc = 0;
      const present = keys.filter((k) => (v[k.key] ?? 0) > 0);
      present.forEach((k, idx) => {
        acc += v[k.key]!;
        const yTop = y(acc);
        const bottom = idx === 0 ? cursor : cursor - GAP;
        const h = bottom - yTop;
        cursor = yTop;
        if (h < 0.75) return;
        segs.push({ key: k.key, color: k.color, d: idx === present.length - 1 ? roundedTopBar(0, yTop, barW, h, 4) : `M0,${yTop}h${barW}v${h}h${-barW}Z` });
      });
      return segs;
    }),
  );
  const xticks = $derived(tickIndices(n, iw, long ? 72 : 80));

  function pick(e: PointerEvent) {
    const rect = (e.currentTarget as SVGElement).getBoundingClientRect();
    const i = Math.floor((e.clientX - rect.left - ml) / band);
    hover = i >= 0 && i < n ? i : null;
  }

  function onkeydown(e: KeyboardEvent) {
    if (n === 0) return;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      const d = e.key === 'ArrowLeft' ? -1 : 1;
      hover = Math.max(0, Math.min(n - 1, (hover ?? (d < 0 ? n : -1)) + d));
    } else if (e.key === 'Escape') hover = null;
  }

  function valueText(i: number): string {
    if (i < 0 || i >= n) return 'No data';
    const parts = keys.map((k) => `${k.label} ${valueFormat(values[i]?.[k.key] ?? 0)}`);
    return `${shortDate(dates[i], true)}: ${valueFormat(totals[i] ?? 0)} total; ${parts.join(', ')}`;
  }

  const tipLeft = $derived(hover === null ? 0 : ml + hover * band + band / 2);
  const tipFlip = $derived(tipLeft > width * 0.58);
</script>

<div class="chart" bind:clientWidth={width} style:height="{height}px">
  {#if width > 0}
    <svg
      {width}
      {height}
      role="slider"
      aria-label="{label}. Use the arrow keys to read values."
      aria-valuemin={0}
      aria-valuemax={Math.max(0, n - 1)}
      aria-valuenow={hover ?? Math.max(0, n - 1)}
      aria-valuetext={valueText(hover ?? n - 1)}
      tabindex="0"
      onpointermove={pick}
      onpointerdown={pick}
      onpointerleave={() => (hover = null)}
      onblur={() => (hover = null)}
      {onkeydown}>
      <g class="grid">
        {#each ticks as t (t)}
          <line x1={ml} x2={ml + iw} y1={y(t)} y2={y(t)} class:base={t === 0} />
          <text x={ml - 8} y={y(t)} dy="0.32em" text-anchor="end">{format(t)}</text>
        {/each}
      </g>
      <g class="xaxis">
        {#each xticks as i (i)}
          <text x={ml + i * band + band / 2} y={height - 6} text-anchor={i === 0 && n > 3 ? 'start' : i === n - 1 && n > 3 ? 'end' : 'middle'}
            >{long ? monthLabel(dates[i]!) : shortDate(dates[i]!)}</text>
        {/each}
      </g>
      {#each bars as segs, i (dates[i])}
        <g transform="translate({bx(i)},0)" class="bar" class:dim={hover !== null && hover !== i}>
          {#each segs as s (s.key)}
            <path d={s.d} style:fill={s.color} />
          {/each}
        </g>
      {/each}
    </svg>
    {#if hover !== null}
      <div class="tip" class:flip={tipFlip} style:left="{tipLeft}px" role="presentation">
        <div class="tip-title">{shortDate(dates[hover], true)}</div>
        <div class="tip-row total"><strong class="num">{valueFormat(totals[hover] ?? 0)}</strong><span class="lbl">total</span></div>
        {#each [...keys].reverse() as k (k.key)}
          <div class="tip-row">
            <span class="key" style:background={k.color}></span>
            <strong class="num">{valueFormat(values[hover]?.[k.key] ?? 0)}</strong>
            <span class="lbl">{k.label}</span>
          </div>
        {/each}
      </div>
    {/if}
  {/if}
</div>

<style>
  .chart {
    position: relative;
    width: 100%;
    min-width: 0;
    user-select: none;
    touch-action: pan-y;
  }
  svg {
    display: block;
    overflow: visible;
  }
  svg:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 4px;
    border-radius: 6px;
  }
  .grid line {
    stroke: var(--grid);
    shape-rendering: crispEdges;
  }
  .grid line.base {
    stroke: var(--axis);
  }
  text {
    fill: var(--text-3);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
  }
  .bar {
    transition: opacity 120ms ease;
  }
  .bar.dim {
    opacity: 0.45;
  }
  .tip {
    position: absolute;
    top: 0;
    transform: translateX(14px);
    pointer-events: none;
    background: var(--surface-2);
    border-radius: 8px;
    box-shadow: var(--shadow-pop);
    padding: 8px 10px;
    min-width: 140px;
    font-size: 12px;
    z-index: 5;
    white-space: nowrap;
  }
  .tip.flip {
    transform: translateX(calc(-100% - 14px));
  }
  .tip-title {
    color: var(--text-2);
    font-weight: 500;
    margin-bottom: 2px;
  }
  .tip-row {
    display: flex;
    align-items: center;
    gap: 7px;
    line-height: 1.7;
  }
  .tip-row.total {
    margin-bottom: 2px;
    padding-bottom: 3px;
    border-bottom: 1px solid var(--border);
  }
  .key {
    width: 10px;
    height: 2px;
    border-radius: 1px;
    flex: none;
  }
  strong {
    color: var(--text);
    font-weight: 600;
  }
  .lbl {
    color: var(--text-3);
  }
</style>
