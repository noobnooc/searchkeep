<script lang="ts">
  // The Searchkeep logo: the Horizon mark plus the outlined wordmark.
  // Geometry lives in #lib/brand.ts (source of truth: docs/brand).
  import { MARK_CUTS, MARK_DOT, MARK_HORIZON, MARK_VIEWBOX, SIGNAL, WORDMARK, WORDMARK_VIEWBOX, markCut } from '#lib/brand.ts';

  let { wordmark = true, size = 26 }: { wordmark?: boolean; size?: number } = $props();
  const cut = $derived(MARK_CUTS[markCut(size)]);
</script>

<span class="logo" style:gap="{Math.round(size * 0.3)}px">
  <svg class="mark" width={size} height={size} viewBox={MARK_VIEWBOX} fill="none" aria-hidden="true" focusable="false">
    {#if cut.horizon}
      <line
        x1={MARK_HORIZON.x}
        y1={MARK_HORIZON.y1}
        x2={MARK_HORIZON.x}
        y2={MARK_HORIZON.y2}
        stroke="currentColor"
        stroke-opacity="0.4"
        stroke-width="2"
        stroke-dasharray="2.5 3"
      />
    {/if}
    <polyline points={cut.line} stroke="currentColor" stroke-width={cut.stroke} stroke-linecap="round" stroke-linejoin="round" />
    <circle cx={MARK_DOT.cx} cy={MARK_DOT.cy} r={cut.dot} fill={SIGNAL} />
  </svg>
  {#if wordmark}
    <svg class="word" height={Math.round(size * 0.84)} viewBox={WORDMARK_VIEWBOX} role="img" aria-label="Searchkeep">
      <path fill="currentColor" d={WORDMARK} />
    </svg>
  {/if}
</span>

<style>
  .logo {
    display: inline-flex;
    align-items: center;
    color: var(--text);
  }
  .mark {
    flex: none;
    display: block;
  }
  .word {
    display: block;
    width: auto;
  }
</style>
