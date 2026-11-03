<script lang="ts" module>
  export interface Segment {
    key: string;
    label: string;
    value: number;
    color: string;
  }
</script>

<script lang="ts">
  import { int } from '../lib/format';

  interface Props {
    parts: Segment[];
    label: string;
    height?: number;
  }
  let { parts, label, height = 8 }: Props = $props();
  const total = $derived(parts.reduce((s, p) => s + Math.max(0, p.value), 0));
  const summary = $derived(parts.map((p) => `${p.label} ${total ? Math.round((p.value / total) * 100) : 0}%`).join(', '));
</script>

<div class="seg-bar" style:height="{height}px" role="img" aria-label="{label}: {summary}">
  {#each parts as p (p.key)}
    {#if p.value > 0}
      <span style:flex-grow={p.value} style:background={p.color} title="{p.label}: {int(p.value)} ({total ? Math.round((p.value / total) * 100) : 0}%)"></span>
    {/if}
  {/each}
  {#if total === 0}<span class="empty"></span>{/if}
</div>

<style>
  .seg-bar {
    display: flex;
    gap: 2px;
    width: 100%;
    min-width: 40px;
  }
  span {
    flex-basis: 0;
    min-width: 3px;
    border-radius: 2px;
  }
  span:first-child {
    border-top-left-radius: 999px;
    border-bottom-left-radius: 999px;
  }
  span:last-child {
    border-top-right-radius: 999px;
    border-bottom-right-radius: 999px;
  }
  .empty {
    flex-grow: 1;
    background: var(--neutral-wash);
  }
</style>
