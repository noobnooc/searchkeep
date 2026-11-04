<script lang="ts" module>
  export interface FunnelStage {
    key: string;
    label: string;
    /** Total of the step's own measure (requests, citations, visits, clicks). */
    total: number;
    unit: string;
    /** Pages that reached this step (and every earlier step with data); null when the step has no data. */
    pages: number | null;
    color: string;
  }
</script>

<script lang="ts">
  import { int } from '../lib/format';
  import { big } from '../lib/metrics';

  interface Props {
    stages: FunnelStage[];
    /** Pages the funnel starts from (100%). */
    base: number;
  }
  let { stages, base }: Props = $props();

  let width = $state(0);
  const H = $derived(width < 560 ? 76 : 112);
  const uid = $props.id();

  // Steps without data pass the previous width through so the ribbon stays continuous.
  const shares = $derived.by(() => {
    let last = 1;
    return stages.map((s) => {
      if (s.pages === null) return last;
      last = base > 0 ? s.pages / base : 0;
      return last;
    });
  });

  // Each step starts on its column's left divider, holds its height briefly, then
  // flows into the next step; the last step runs to the right edge.
  const col = $derived(width / Math.max(1, stages.length));
  const xs = $derived(stages.map((_, i) => col * i));
  const hold = $derived(col * 0.22);
  const half = $derived(shares.map((s) => (s > 0 ? Math.max(1.5, (H / 2 - 2) * s) : 0)));

  // The ribbon draws its own rounded ends (no clip mask, which would cut the outline at the
  // corners) and stays half a stroke inside the SVG so the outline is never clipped.
  const R = 6;
  const IN = 0.75;
  const ribbon = $derived.by(() => {
    const n = stages.length;
    if (width === 0 || n === 0) return '';
    const cy = H / 2;
    const x0 = IN;
    const xe = width - IN;
    const end = (i: number) => (i === n - 1 ? xe : xs[i]! + hold);
    const h0 = half[0]!;
    const hn = half[n - 1]!;
    const r0 = Math.min(R, h0, (end(0) - x0) / 2);
    const rn = Math.min(R, hn, (xe - Math.max(x0, xs[n - 1]!)) / 2);
    let d = `M${x0},${cy - h0 + r0}Q${x0},${cy - h0} ${x0 + r0},${cy - h0}`;
    for (let i = 0; i < n; i++) {
      d += `L${i === n - 1 ? xe - rn : end(i)},${cy - half[i]!}`;
      if (i < n - 1) {
        const x1 = xs[i + 1]!;
        const mx = (end(i) + x1) / 2;
        d += `C${mx},${cy - half[i]!} ${mx},${cy - half[i + 1]!} ${x1},${cy - half[i + 1]!}`;
      }
    }
    d += `Q${xe},${cy - hn} ${xe},${cy - hn + rn}L${xe},${cy + hn - rn}Q${xe},${cy + hn} ${xe - rn},${cy + hn}`;
    for (let i = n - 1; i >= 0; i--) {
      d += `L${i === 0 ? x0 + r0 : xs[i]!},${cy + half[i]!}`;
      if (i > 0) {
        const x0i = end(i - 1);
        const mx = (xs[i]! + x0i) / 2;
        d += `C${mx},${cy + half[i]!} ${mx},${cy + half[i - 1]!} ${x0i},${cy + half[i - 1]!}`;
      }
    }
    return `${d}Q${x0},${cy + h0} ${x0},${cy + h0 - r0}Z`;
  });

  function conversion(i: number): string | null {
    const s = stages[i]!;
    if (i === 0 || s.pages === null) return null;
    let prev: number | null = null;
    for (let j = i - 1; j >= 0; j--) {
      if (stages[j]!.pages !== null) {
        prev = stages[j]!.pages;
        break;
      }
    }
    if (prev === null) prev = base;
    if (!prev) return null;
    return `${Math.round((s.pages / prev) * 100)}%`;
  }
</script>

<div class="funnel" bind:clientWidth={width}>
  <ol class="cols" style:--n={stages.length}>
    {#each stages as s, i (s.key)}
      {@const conv = conversion(i)}
      <li class:nodata={s.pages === null && s.total === 0}>
        <div class="step"><span class="n" style:background={s.color}></span>{s.label}</div>
        <div class="total" title="{int(s.total)} {s.unit}">{big(s.total)}</div>
        <div class="unit">{s.unit}</div>
        <div class="pages num">
          {#if s.pages === null}
            <span class="muted">No data yet</span>
          {:else}
            <strong>{int(s.pages)}</strong> {s.pages === 1 ? 'page' : 'pages'}{#if conv}<span class="conv">{conv}</span>{/if}
          {/if}
        </div>
      </li>
    {/each}
  </ol>
  {#if width > 0}
    <svg {width} height={H} role="img" aria-label="Pages reaching each step: {stages.map((s) => `${s.label} ${s.pages ?? 'no data'}`).join(', ')}">
      <defs>
        <linearGradient id="{uid}-g" x1="0" x2={width} y1="0" y2="0" gradientUnits="userSpaceOnUse">
          {#each stages as s, i (s.key)}
            <stop offset={width ? (xs[i]! + hold / 2) / width : 0} style:stop-color={s.color} />
          {/each}
        </linearGradient>
      </defs>
      <path d={ribbon} fill="url(#{uid}-g)" fill-opacity="0.24" />
      <path d={ribbon} fill="none" stroke="url(#{uid}-g)" stroke-opacity="0.75" stroke-width="1.25" />
      {#each stages as s, i (s.key)}
        {#if half[i]! > 0 && i > 0}
          <rect x={xs[i]! - 1} y={H / 2 - half[i]!} width="2" height={half[i]! * 2} style:fill={s.pages === null ? 'var(--text-4)' : s.color} />
        {/if}
      {/each}
    </svg>
  {/if}
</div>

<style>
  .funnel {
    width: 100%;
    min-width: 0;
    container-type: inline-size;
  }
  .cols {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(var(--n), minmax(0, 1fr));
  }
  li {
    padding: 0 14px 16px;
    border-left: 1px solid var(--border);
    min-width: 0;
  }
  li:first-child {
    border-left: 0;
    padding-left: 0;
  }
  .step {
    display: flex;
    align-items: center;
    gap: 7px;
    font-size: 12.5px;
    font-weight: 500;
    color: var(--text-2);
    white-space: nowrap;
  }
  .n {
    width: 8px;
    height: 8px;
    border-radius: 2px;
    flex: none;
  }
  .total {
    margin-top: 6px;
    font-family: var(--display);
    font-size: 32px;
    line-height: 1.1;
    font-weight: 600;
    letter-spacing: -0.02em;
    color: var(--text);
  }
  .nodata .total {
    color: var(--text-4);
  }
  .unit {
    font-size: 12px;
    color: var(--text-3);
    margin-top: 2px;
  }
  .pages {
    margin-top: 10px;
    font-size: 12.5px;
    color: var(--text-2);
    display: flex;
    align-items: baseline;
    gap: 4px;
    flex-wrap: wrap;
  }
  .pages strong {
    color: var(--text);
    font-weight: 600;
  }
  .conv {
    margin-left: 4px;
    padding: 0 6px;
    border-radius: 999px;
    font-size: 11.5px;
    font-weight: 600;
    color: var(--text-2);
    background: var(--neutral-wash);
  }
  svg {
    display: block;
  }
  @container (max-width: 720px) {
    .total {
      font-size: 26px;
    }
  }
  @container (max-width: 560px) {
    li {
      padding: 0 8px 12px;
    }
    li:first-child {
      padding-left: 0;
    }
    .conv {
      display: none;
    }
    .total {
      font-size: 19px;
    }
    .unit {
      display: none;
    }
    .step {
      font-size: 11.5px;
      gap: 5px;
    }
    .pages {
      font-size: 11.5px;
    }
    .conv {
      margin-left: 0;
    }
  }
</style>
