<script lang="ts">
  // The Searchkeep logo: "the keep" on the mint tile, plus the outlined wordmark.
  // Geometry lives in #lib/brand.ts (source of truth: docs/brand).
  import { BRAND_GRADIENT, BRAND_INK, MARK, MARK_SMALL, WORDMARK, WORDMARK_VIEWBOX } from '#lib/brand.ts';

  let { wordmark = true, size = 26 }: { wordmark?: boolean; size?: number } = $props();
  const uid = $props.id();
  const d = $derived(size <= 32 ? MARK_SMALL : MARK);
</script>

<span class="logo" style:gap="{Math.round(size * 0.36)}px">
  <svg class="mark" width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
    <defs>
      <linearGradient id="{uid}-g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color={BRAND_GRADIENT[0]} />
        <stop offset=".55" stop-color={BRAND_GRADIENT[1]} />
        <stop offset="1" stop-color={BRAND_GRADIENT[2]} />
      </linearGradient>
    </defs>
    <rect width="64" height="64" rx="16.6" fill="url(#{uid}-g)" />
    <path transform="translate(10.24 10.24) scale(0.68)" fill={BRAND_INK} {d} />
  </svg>
  {#if wordmark}
    <svg class="word" height={Math.round(size * 0.74)} viewBox={WORDMARK_VIEWBOX} role="img" aria-label="Searchkeep">
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
    border-radius: 27%;
    box-shadow:
      0 0 0 1px rgb(255 255 255 / 0.1),
      0 6px 18px -6px var(--accent-glow);
  }
  .word {
    display: block;
    width: auto;
    /* Optical alignment: the wordmark's x-height sits on the tile's centre line. */
    transform: translateY(1px);
  }
</style>
