<script lang="ts">
  let { wordmark = true, size = 24 }: { wordmark?: boolean; size?: number } = $props();
  const uid = $props.id();
</script>

<span class="logo">
  <svg
    class="mark"
    width={size}
    height={size}
    viewBox="0 0 32 32"
    aria-hidden="true"
    focusable="false"
  >
    <defs>
      <linearGradient id="{uid}-bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="oklch(0.93 0.13 160)" />
        <stop offset="1" stop-color="oklch(0.78 0.17 165)" />
      </linearGradient>
    </defs>
    <rect width="32" height="32" rx="8.5" fill="url(#{uid}-bg)" />
    <circle cx="14" cy="14" r="7.25" fill="none" stroke="#03140c" stroke-width="2.4" />
    <path d="M19.4 19.4 24.5 24.5" stroke="#03140c" stroke-width="2.8" stroke-linecap="round" />
    <rect x="10" y="10.6" width="8" height="1.9" rx=".95" fill="#03140c" />
    <rect x="11.2" y="13.05" width="5.6" height="1.9" rx=".95" fill="#03140c" />
    <rect x="12.4" y="15.5" width="3.2" height="1.9" rx=".95" fill="#03140c" />
  </svg>
  {#if wordmark}<span class="word">Searchkeep</span>{/if}
</span>

<style>
  .logo {
    display: inline-flex;
    align-items: center;
    gap: 10px;
  }
  .mark {
    flex: none;
    border-radius: 7px;
    box-shadow: 0 0 0 1px rgb(255 255 255 / 0.08), 0 4px 16px -4px var(--accent-glow);
  }
  .word {
    font-weight: 620;
    font-size: 1.02rem;
    letter-spacing: -0.028em;
    color: var(--text);
  }
</style>
