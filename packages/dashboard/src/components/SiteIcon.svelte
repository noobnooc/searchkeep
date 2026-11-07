<script lang="ts">
  // The site's own icon (apple-touch-icon, icon or favicon.ico), which the Worker
  // reads from the site itself. Shows the domain's first letter until the icon
  // loads, and when the site has none.
  import { apiUrl } from '../lib/api';

  interface Props {
    site: { id: string; domain: string } | undefined;
    small?: boolean;
  }
  let { site, small = false }: Props = $props();

  const src = $derived(site ? apiUrl('/api/site-icon', { site: site.id }) : '');
  const letter = $derived(site?.domain.replace(/^www\./, '').charAt(0).toUpperCase() || '?');
  // Both hold the URL they apply to, so switching sites starts over on its own.
  let loaded = $state('');
  let failed = $state('');
</script>

<span class="avatar" class:sm={small} aria-hidden="true">
  {#if loaded !== src}{letter}{/if}
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
