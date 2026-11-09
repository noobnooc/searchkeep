<script lang="ts">
  // Picks the app the Apps area shows (ADR 0009). Apps have no icon fetch: their first letter is the mark.
  import { dismissable } from '../lib/dismiss';
  import { ui } from '../lib/state.svelte';
  import type { AppInfo } from '../lib/types';
  import Icon from './Icon.svelte';

  let open = $state(false);
  const app = $derived(ui.app);
  const multiple = $derived(ui.apps.length > 1);
  const stores = (a: AppInfo) => [a.appleId ? 'App Store' : '', a.playPackage ? 'Google Play' : ''].filter(Boolean).join(' · ');
</script>

<div class="switcher" {@attach dismissable(() => open, () => (open = false))}>
  <button class="trigger" aria-haspopup="listbox" aria-expanded={open} disabled={!multiple} onclick={() => (open = !open)} title={multiple ? 'Switch app' : undefined}>
    <span class="avatar" aria-hidden="true">{app?.name.charAt(0).toUpperCase() ?? '?'}</span>
    <span class="names">
      <span class="name truncate">{app?.name ?? 'No app configured'}</span>
      {#if app}<span class="sub truncate">{stores(app)}</span>{/if}
    </span>
    {#if multiple}<Icon name="chevronDown" size={14} class="chev" />{/if}
  </button>
  {#if open}
    <ul class="pop" role="listbox" aria-label="Apps">
      {#each ui.apps as a (a.id)}
        <li>
          <button
            role="option"
            aria-selected={a.id === ui.appId}
            onclick={() => {
              ui.setApp(a.id);
              open = false;
            }}>
            <span class="avatar sm" aria-hidden="true">{a.name.charAt(0).toUpperCase()}</span>
            <span class="names">
              <span class="name truncate">{a.name}</span>
              <span class="sub truncate">{stores(a)}</span>
            </span>
            {#if a.id === ui.appId}<Icon name="check" size={14} stroke={2.4} class="tick" />{/if}
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .switcher {
    position: relative;
    min-width: 0;
  }
  .trigger {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 8px;
    border-radius: 8px;
    border: 1px solid var(--border);
    background: var(--surface);
    text-align: left;
    min-width: 0;
  }
  .trigger:hover:not(:disabled) {
    border-color: var(--border-2);
    background: var(--surface-2);
  }
  .trigger:disabled {
    cursor: default;
  }
  .trigger :global(.chev) {
    color: var(--text-3);
    margin-left: auto;
  }
  .avatar {
    flex: none;
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    border-radius: 7px;
    background: var(--accent-wash, var(--surface-3));
    color: var(--accent-text);
    font-size: 13px;
    font-weight: 600;
  }
  .avatar.sm {
    width: 22px;
    height: 22px;
    border-radius: 6px;
    font-size: 11px;
  }
  .names {
    display: flex;
    flex-direction: column;
    min-width: 0;
    line-height: 1.25;
  }
  .name {
    font-size: 13px;
    font-weight: 600;
    color: var(--text);
  }
  .sub {
    font-size: 11.5px;
    color: var(--text-3);
  }
  .pop {
    position: absolute;
    left: 0;
    right: 0;
    top: calc(100% + 6px);
    z-index: 40;
    list-style: none;
    margin: 0;
    padding: 4px;
    background: var(--surface);
    border-radius: 10px;
    box-shadow: var(--shadow-pop);
    min-width: 220px;
    max-height: 320px;
    overflow: auto;
  }
  .pop button {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 6px 8px;
    border: 0;
    background: transparent;
    border-radius: 6px;
    text-align: left;
  }
  .pop button:hover {
    background: var(--neutral-wash);
  }
  .pop :global(.tick) {
    margin-left: auto;
    color: var(--accent-text);
  }
</style>
