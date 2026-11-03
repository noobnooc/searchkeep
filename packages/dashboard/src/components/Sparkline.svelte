<script lang="ts">
  import { linePath } from '../lib/chart';

  interface Props {
    values: number[];
    width?: number;
    height?: number;
    /** Trailing points drawn in the accent (the "current" window). */
    highlight?: number;
    label: string;
  }
  let { values, width = 112, height = 28, highlight = 0, label }: Props = $props();

  const pad = 3;
  const max = $derived(Math.max(1, ...values));
  const min = $derived(Math.min(0, ...values));
  const pts = $derived(
    values.map((v, i): [number, number] => [
      pad + (values.length <= 1 ? (width - 2 * pad) / 2 : (i * (width - 2 * pad)) / (values.length - 1)),
      pad + (height - 2 * pad) * (1 - (v - min) / (max - min || 1)),
    ]),
  );
  const cut = $derived(Math.max(0, values.length - highlight - 1));
  const last = $derived(pts[pts.length - 1]);
</script>

<svg class="spark" {width} {height} viewBox="0 0 {width} {height}" role="img" aria-label={label}>
  <path d={linePath(highlight > 0 ? pts.slice(0, cut + 1) : pts)} fill="none" style:stroke="var(--spark)" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" />
  {#if highlight > 0}
    <path d={linePath(pts.slice(cut))} fill="none" style:stroke="var(--accent)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
  {/if}
  {#if last}
    <circle cx={last[0]} cy={last[1]} r="2.5" style:fill={highlight > 0 ? 'var(--accent)' : 'var(--spark)'} />
  {/if}
</svg>

<style>
  .spark {
    display: block;
    overflow: visible;
  }
</style>
