<script lang="ts" module>
  export type DeltaTone = 'pos' | 'neg' | 'neutral';
  export interface Delta {
    text: string;
    tone: DeltaTone;
    /** Direction of the raw change (arrow), independent of whether it is good. */
    dir: 'up' | 'down' | 'flat';
  }

  /**
   * Builds a delta chip. `higherIsBetter` decides the color; the arrow shows
   * the raw direction.
   */
  export function delta(change: number | null, text: string, higherIsBetter = true, epsilon = 0): Delta | null {
    if (change === null || !Number.isFinite(change)) return null;
    const dir = Math.abs(change) <= epsilon ? 'flat' : change > 0 ? 'up' : 'down';
    const good = dir === 'flat' ? null : (dir === 'up') === higherIsBetter;
    return { text, dir, tone: good === null ? 'neutral' : good ? 'pos' : 'neg' };
  }
</script>

<script lang="ts">
  import Icon from './Icon.svelte';
  import Sparkline from './Sparkline.svelte';

  interface Props {
    label: string;
    value: string;
    delta?: Delta | null;
    /** e.g. "vs 1,197" */
    sub?: string;
    spark?: number[];
    size?: 'md' | 'lg';
    empty?: boolean;
  }
  let { label, value, delta: d = null, sub, spark, size = 'md', empty = false }: Props = $props();
</script>

<div class="stat {size}" class:empty>
  <div class="label">{label}</div>
  <div class="value-row">
    <span class="value">{value}</span>
    {#if d}
      <span class="delta {d.tone}" title="Change vs the previous period">
        {#if d.dir !== 'flat'}<Icon name={d.dir === 'up' ? 'arrowUp' : 'arrowDown'} size={11} stroke={2.4} />{/if}
        {d.text}
      </span>
    {/if}
  </div>
  <div class="foot">
    {#if sub}<span class="sub num">{sub}</span>{/if}
    {#if spark && spark.length > 1}
      <span class="spark"><Sparkline values={spark} width={84} height={22} label="{label} trend" /></span>
    {/if}
  </div>
</div>

<style>
  .stat {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .label {
    font-size: 12.5px;
    color: var(--text-2);
    font-weight: 500;
  }
  .value-row {
    display: flex;
    align-items: baseline;
    gap: 8px;
    flex-wrap: wrap;
  }
  .value {
    font-family: var(--display);
    font-size: 25px;
    line-height: 1.15;
    font-weight: 600;
    letter-spacing: -0.015em;
    font-variant-numeric: tabular-nums;
    color: var(--text);
  }
  .lg .value {
    font-size: 30px;
  }
  .empty .value {
    color: var(--text-4);
  }
  .delta {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    font-size: 12px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    padding: 1px 6px 1px 4px;
    border-radius: 999px;
    white-space: nowrap;
  }
  .delta.pos {
    color: var(--pos);
    background: var(--pos-wash);
  }
  .delta.neg {
    color: var(--neg);
    background: var(--neg-wash);
  }
  .delta.neutral {
    color: var(--text-2);
    background: var(--neutral-wash);
    padding-left: 6px;
  }
  .foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 4px 8px;
    min-height: 22px;
  }
  .sub {
    font-size: 12px;
    color: var(--text-3);
    white-space: nowrap;
  }
  .spark {
    margin-left: auto;
    flex: none;
  }
</style>
