<script lang="ts">
  import { dismissable } from '../lib/dismiss';
  import { ui } from '../lib/state.svelte';
  import Icon from './Icon.svelte';

  let open = $state(false);
  const site = $derived(ui.site);
  const multiple = $derived(ui.sites.length > 1);

  function initial(domain: string): string {
    return domain.replace(/^www\./, '').charAt(0).toUpperCase() || '?';
  }
</script>

<div class="switcher" {@attach dismissable(() => open, () => (open = false))}>
  <button class="trigger" aria-haspopup="listbox" aria-expanded={open} disabled={!multiple} onclick={() => (open = !open)} title={multiple ? 'Switch site' : undefined}>
    <span class="avatar" aria-hidden="true">{site ? initial(site.domain) : '?'}</span>
    <span class="names">
      <span class="domain truncate">{site?.domain ?? 'No site configured'}</span>
      {#if site}<span class="id truncate">{site.id}</span>{/if}
    </span>
    {#if multiple}<Icon name="chevronDown" size={14} class="chev" />{/if}
  </button>
  {#if open}
    <ul class="pop" role="listbox" aria-label="Sites">
      {#each ui.sites as s (s.id)}
        <li>
          <button
            role="option"
            aria-selected={s.id === ui.siteId}
            onclick={() => {
              ui.setSite(s.id);
              open = false;
            }}>
            <span class="avatar sm" aria-hidden="true">{initial(s.domain)}</span>
            <span class="names">
              <span class="domain truncate">{s.domain}</span>
              <span class="id truncate">{s.id}</span>
            </span>
            {#if s.id === ui.siteId}<Icon name="check" size={14} stroke={2.4} class="tick" />{/if}
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
    width: 26px;
    height: 26px;
    border-radius: 7px;
    display: grid;
    place-items: center;
    font-size: 12.5px;
    font-weight: 650;
    color: var(--accent-text);
    background: var(--accent-wash);
    border: 1px solid var(--accent-wash-2);
    flex: none;
  }
  .avatar.sm {
    width: 22px;
    height: 22px;
    font-size: 11px;
    border-radius: 6px;
  }
  .names {
    display: flex;
    flex-direction: column;
    min-width: 0;
    line-height: 1.25;
  }
  .domain {
    font-size: 13px;
    font-weight: 600;
    color: var(--text);
  }
  .id {
    font-size: 11.5px;
    color: var(--text-3);
    font-family: var(--mono);
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
