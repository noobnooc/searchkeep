<script lang="ts" module>
  export interface LineSeries {
    key: string;
    label: string;
    values: Array<number | null>;
    /** CSS color of the line. */
    color: string;
    /** Draw a 10% wash under the line. */
    area?: boolean;
    /** Per-point dates shown in the tooltip (e.g. the previous period's days). */
    dates?: string[];
  }
</script>

<script lang="ts">
  import { areaPath, linePath, niceTicks, textWidth, tickIndices } from '../lib/chart';
  import { compact, int, monthLabel, shortDate } from '../lib/format';

  interface Props {
    dates: string[];
    series: LineSeries[];
    height?: number;
    /** Axis tick format. */
    format?: (n: number) => string;
    /** Tooltip value format. */
    valueFormat?: (n: number) => string;
    label: string;
    /** Label for the x position (defaults to the date). */
    xLabel?: (date: string) => string;
    /** Tooltip heading for a position (defaults to the full date). */
    tipTitle?: (date: string) => string;
  }
  let { dates, series, height = 200, format = compact, valueFormat = int, label, xLabel, tipTitle }: Props = $props();

  let width = $state(0);
  let hover = $state<number | null>(null);

  const mt = 10;
  const mb = 24;
  const mr = 14;

  const n = $derived(dates.length);
  const max = $derived(Math.max(0, ...series.flatMap((s) => s.values.filter((v): v is number => v !== null && Number.isFinite(v)))));
  const ticks = $derived(niceTicks(max, height < 170 ? 3 : 4));
  const top = $derived(ticks[ticks.length - 1] || 1);
  const ml = $derived(Math.max(24, ...ticks.map((t) => textWidth(format(t)))) + 12);
  const iw = $derived(Math.max(10, width - ml - mr));
  const ih = $derived(height - mt - mb);
  const long = $derived(n > 120);

  function x(i: number): number {
    return ml + (n <= 1 ? iw / 2 : (i * iw) / (n - 1));
  }
  function y(v: number): number {
    return mt + ih - (v / top) * ih;
  }

  const drawn = $derived(
    series.map((s) => {
      const pts = s.values.map((v, i): [number, number] | null => (v === null || !Number.isFinite(v) ? null : [x(i), y(v)]));
      return { s, line: linePath(pts), area: s.area ? areaPath(pts, mt + ih) : '' };
    }),
  );
  const xticks = $derived(tickIndices(n, iw, long ? 72 : 84));

  function tickLabel(d: string): string {
    return xLabel ? xLabel(d) : long ? monthLabel(d) : shortDate(d);
  }

  function pick(e: PointerEvent) {
    const el = e.currentTarget as SVGElement;
    const rect = el.getBoundingClientRect();
    const px = e.clientX - rect.left;
    if (n === 0) return;
    const i = n <= 1 ? 0 : Math.round(((px - ml) / iw) * (n - 1));
    hover = Math.max(0, Math.min(n - 1, i));
  }

  function onkeydown(e: KeyboardEvent) {
    if (n === 0) return;
    const keys: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1 };
    if (e.key in keys) {
      e.preventDefault();
      hover = Math.max(0, Math.min(n - 1, (hover ?? (e.key === 'ArrowLeft' ? n : -1)) + keys[e.key]!));
    } else if (e.key === 'Home') {
      e.preventDefault();
      hover = 0;
    } else if (e.key === 'End') {
      e.preventDefault();
      hover = n - 1;
    } else if (e.key === 'Escape') {
      hover = null;
    }
  }

  function valueText(i: number): string {
    if (i < 0 || i >= n) return 'No data';
    const parts = series.map((s) => `${s.label} ${s.values[i] === null || s.values[i] === undefined ? 'no data' : valueFormat(s.values[i]!)}`);
    return `${tipTitle ? tipTitle(dates[i]!) : shortDate(dates[i], true)}: ${parts.join(', ')}`;
  }

  const tipLeft = $derived(hover === null ? 0 : x(hover));
  const tipFlip = $derived(hover !== null && tipLeft > width * 0.58);
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
          <text x={x(i)} y={height - 6} text-anchor={i === 0 && n > 1 ? 'start' : i === n - 1 && n > 1 ? 'end' : 'middle'}>{tickLabel(dates[i]!)}</text>
        {/each}
      </g>
      {#each drawn as d (d.s.key)}
        {#if d.area}<path d={d.area} style:fill={d.s.color} opacity="0.1" />{/if}
      {/each}
      {#each drawn as d (d.s.key)}
        <path d={d.line} fill="none" style:stroke={d.s.color} stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
      {/each}
      {#if n > 1 && hover === null}
        {@const s0 = series[0]}
        {@const v0 = s0?.values[n - 1]}
        {#if v0 !== null && v0 !== undefined}
          <circle class="latest" cx={x(n - 1)} cy={y(v0)} r="3.5" />
        {/if}
      {/if}
      {#if n === 1}
        {#each series as s (s.key)}
          {#if s.values[0] !== null && s.values[0] !== undefined}
            <circle cx={x(0)} cy={y(s.values[0])} r="4" style:fill={s.color} />
          {/if}
        {/each}
      {/if}
      {#if hover !== null}
        <line class="crosshair" x1={x(hover)} x2={x(hover)} y1={mt} y2={mt + ih} />
        {#each series as s (s.key)}
          {@const v = s.values[hover]}
          {#if v !== null && v !== undefined}
            <circle cx={x(hover)} cy={y(v)} r="4" style:fill={s.color} style:stroke="var(--surface)" stroke-width="2" />
          {/if}
        {/each}
      {/if}
    </svg>
    {#if hover !== null}
      <div class="tip" class:flip={tipFlip} style:left="{tipLeft}px" role="presentation">
        <div class="tip-title">{tipTitle ? tipTitle(dates[hover]!) : shortDate(dates[hover], true)}</div>
        {#each series as s (s.key)}
          {@const v = s.values[hover]}
          <div class="tip-row">
            <span class="key" style:background={s.color}></span>
            <strong class="num">{v === null || v === undefined ? '—' : valueFormat(v)}</strong>
            <span class="lbl">{s.label}{#if s.dates?.[hover]}<span class="sub">{` · ${shortDate(s.dates[hover], true)}`}</span>{/if}</span>
          </div>
        {/each}
      </div>
    {/if}
  {/if}
</div>

<style>
  .latest {
    fill: var(--signal);
    stroke: var(--surface);
    stroke-width: 2;
  }
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
    stroke-width: 1;
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
  .crosshair {
    stroke: var(--border-3);
    stroke-width: 1;
    shape-rendering: crispEdges;
  }
  .tip {
    position: absolute;
    top: 0;
    transform: translateX(12px);
    pointer-events: none;
    background: var(--surface-2);
    border-radius: 8px;
    box-shadow: var(--shadow-pop);
    padding: 8px 10px;
    min-width: 150px;
    font-size: 12px;
    z-index: 5;
    white-space: nowrap;
  }
  .tip.flip {
    transform: translateX(calc(-100% - 12px));
  }
  .tip-title {
    color: var(--text-2);
    font-weight: 500;
    margin-bottom: 4px;
  }
  .tip-row {
    display: flex;
    align-items: center;
    gap: 7px;
    line-height: 1.7;
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
  .sub {
    color: var(--text-4);
  }
</style>
