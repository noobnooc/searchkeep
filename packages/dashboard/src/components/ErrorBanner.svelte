<script lang="ts">
  import { ApiError } from '../lib/api';
  import { href } from '../lib/router.svelte';
  import Icon from './Icon.svelte';

  interface Props {
    error: unknown;
    retry?: () => void;
    title?: string;
  }
  let { error, retry, title }: Props = $props();
  const code = $derived(error instanceof ApiError ? error.code : undefined);
  const message = $derived(error instanceof Error ? error.message : 'Something went wrong.');
  const heading = $derived(title ?? (code === 'not_configured' ? 'Not configured yet' : code === 'network' ? 'Connection problem' : 'Could not load this data'));
</script>

<div class="banner" class:info={code === 'not_configured'} role="alert">
  <Icon name={code === 'not_configured' ? 'info' : 'alert'} size={16} />
  <div class="text">
    <strong>{heading}</strong>
    <span>{message}</span>
    {#if code === 'not_configured'}
      <span class="hint">See <a href={href('settings', 'checks')}>Settings → Setup checks</a> for what is set up.</span>
    {/if}
  </div>
  {#if retry && code !== 'not_configured'}
    <button class="btn sm" onclick={retry}><Icon name="refresh" size={13} /> Retry</button>
  {/if}
</div>

<style>
  .banner {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 12px 14px;
    border-radius: var(--radius);
    border: 1px solid color-mix(in srgb, var(--neg) 35%, transparent);
    background: var(--neg-wash);
    color: var(--neg);
  }
  .banner.info {
    border-color: var(--border-2);
    background: var(--surface-2);
    color: var(--text-2);
  }
  .banner > :global(.icon) {
    margin-top: 1px;
  }
  .text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
    font-size: 13px;
  }
  strong {
    font-weight: 600;
    color: var(--text);
  }
  span {
    color: var(--text-2);
    overflow-wrap: anywhere;
  }
  .hint {
    color: var(--text-3);
    font-size: 12.5px;
  }
</style>
