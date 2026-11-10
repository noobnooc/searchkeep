<script lang="ts">
  // An icon the Worker reads for a site or an app (/api/site-icon, /api/app-icon). Shows `letter`
  // until the icon loads, and when there is none.
  interface Props {
    /** Icon URL; empty for none. */
    src: string;
    letter: string;
    /** sm 22 px · md 26 px · lg 34 px */
    size?: 'sm' | 'md' | 'lg';
    /** Apps get the rounder store-icon corners and an accent letter. */
    kind?: 'site' | 'app';
  }
  let { src, letter, size = 'md', kind = 'site' }: Props = $props();

  // Both hold the URL they apply to, so a new src starts over on its own.
  let loaded = $state('');
  let failed = $state('');
</script>

<span class="avatar {size} {kind}" class:has-icon={loaded === src && src !== ''} aria-hidden="true">
  {#if loaded !== src || !src}{letter}{/if}
  {#if src && failed !== src}
    {#key src}
      <img {src} alt="" decoding="async" class:ready={loaded === src} onload={() => (loaded = src)} onerror={() => (failed = src)} />
    {/key}
  {/if}
</span>

<style>
  .avatar {
    position: relative;
    width: 26px;
    height: 26px;
    border-radius: 7px;
    display: grid;
    place-items: center;
    overflow: hidden;
    font-family: var(--mono);
    font-size: 12px;
    font-weight: 500;
    color: var(--text);
    background: var(--surface-3);
    border: 1px solid var(--border-2);
    flex: none;
  }
  .avatar.sm {
    width: 22px;
    height: 22px;
    font-size: 11px;
    border-radius: 6px;
  }
  .avatar.lg {
    width: 34px;
    height: 34px;
    font-size: 14px;
    border-radius: 9px;
  }
  .avatar.app {
    /* Store icons: corners about 22% of the side. */
    border-radius: 23%;
    font-family: inherit;
    font-weight: 600;
    color: var(--accent-text);
    background: var(--accent-wash, var(--surface-3));
    border-color: transparent;
  }
  .avatar.app.has-icon {
    border-color: var(--border);
  }
  img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    opacity: 0;
  }
  img.ready {
    opacity: 1;
  }
</style>
