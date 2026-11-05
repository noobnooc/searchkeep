<script lang="ts">
  interface Props {
    /** 0–100 */
    value: number;
    label: string;
    tone?: 'accent' | 'ok' | 'warn' | 'error';
  }
  let { value, label, tone = 'accent' }: Props = $props();
  const pct = $derived(Math.max(0, Math.min(100, value)));
</script>

<div class="bar {tone}" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}>
  {#if pct > 0}<span style:width="{pct}%"></span>{/if}
</div>

<style>
  .bar {
    position: relative;
    height: 4px;
    border-radius: 999px;
    background: var(--neutral-wash);
    overflow: hidden;
  }
  span {
    position: absolute;
    inset: 0 auto 0 0;
    min-width: 2px;
    border-radius: inherit;
    background: var(--accent);
    transition: width 0.4s ease;
  }
  .ok span {
    background: var(--pos);
  }
  .warn span {
    background: var(--warn);
  }
  .error span {
    background: var(--neg);
  }
  @media (prefers-reduced-motion: reduce) {
    span {
      transition: none;
    }
  }
</style>
