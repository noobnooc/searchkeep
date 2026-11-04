<script lang="ts" module>
  export interface BarItem {
    key: string;
    label: string;
    value: number;
    /** Secondary text after the label. */
    meta?: string;
    /** Small colored mark before the label (identity, e.g. crawler purpose). */
    color?: string;
    mono?: boolean;
  }
</script>

<script lang="ts">
  import { compact, int } from '../lib/format';

  interface Props {
    items: BarItem[];
    label: string;
    format?: (n: number) => string;
    max?: number;
  }
  let { items, label, format = compact, max }: Props = $props();
  const top = $derived(max ?? Math.max(1, ...items.map((i) => i.value)));
</script>

<ul class="bars" aria-label={label}>
  {#each items as item (item.key)}
    <li title="{item.label}: {int(item.value)}">
      <span class="fill" style:width="{Math.max(0.5, (item.value / top) * 100)}%"></span>
      <span class="label" class:mono={item.mono}>
        {#if item.color}<span class="dot" style:background={item.color}></span>{/if}
        <span class="truncate">{item.label}</span>
        {#if item.meta}<span class="meta">{item.meta}</span>{/if}
      </span>
      <span class="value num">{format(item.value)}</span>
    </li>
  {/each}
</ul>

<style>
  .bars {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  li {
    position: relative;
    display: flex;
    align-items: center;
    gap: 12px;
    height: 28px;
    padding: 0 8px;
    font-size: 13px;
    border-radius: 5px;
  }
  .fill {
    position: absolute;
    inset: 0 auto 0 0;
    border-radius: 5px;
    background: var(--chart-wash);
    transition: width 240ms ease;
  }
  li:hover .fill {
    background: var(--chart-wash-2);
  }
  .label {
    position: relative;
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 7px;
    color: var(--text);
  }
  .label.mono .truncate {
    font-family: var(--mono);
    font-size: 12.5px;
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 2px;
    flex: none;
  }
  .meta {
    color: var(--text-3);
    font-size: 12px;
    white-space: nowrap;
  }
  .value {
    position: relative;
    color: var(--text-2);
    font-weight: 500;
  }
</style>
