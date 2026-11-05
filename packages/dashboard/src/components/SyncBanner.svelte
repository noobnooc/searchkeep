<script lang="ts">
  import { href } from '../lib/router.svelte';
  import { ui } from '../lib/state.svelte';
  import { DATASET_LABEL, datasetLine, datasetTone, SOURCE_LABEL, syncWatch, when } from '../lib/sync.svelte';
  import Icon from './Icon.svelte';
  import ProgressBar from './ProgressBar.svelte';

  // Dismissing the history notice lasts for this browser session; the latest-days notice cannot be dismissed.
  const KEY = 'searchkeep:sync-banner-dismissed';
  function readDismissed(): string[] {
    try {
      return JSON.parse(sessionStorage.getItem(KEY) ?? '[]') as string[];
    } catch {
      return [];
    }
  }
  let dismissed = $state<string[]>(readDismissed());
  function dismiss(id: string) {
    dismissed = [...dismissed, id];
    try {
      sessionStorage.setItem(KEY, JSON.stringify(dismissed));
    } catch {
      // Session storage unavailable: dismissed for this page view only.
    }
  }

  const p = $derived(syncWatch.progress);
  const site = $derived(p?.sites.find((s) => s.siteId === ui.siteId));
  const paused = $derived((p?.paused ?? []).filter((x) => site?.datasets.some((d) => d.source === x.source && !d.complete)));
  const failing = $derived(site?.datasets.filter((d) => d.state === 'error') ?? []);
  const show = $derived(Boolean(site && site.datasets.length > 0 && (site.phase !== 'done' || failing.length > 0) && !(site.phase !== 'waiting' && site.phase !== 'recent' && dismissed.includes(site.siteId))));
  const many = $derived((p?.summary.sites ?? 0) > 1);

  const title = $derived.by(() => {
    if (!site) return '';
    if (site.phase === 'waiting') return `Getting ${site.domain} ready`;
    if (site.phase === 'recent') return `Syncing the latest days for ${site.domain}`;
    if (site.phase === 'history') return `${site.domain}: latest days are in, older history is still syncing`;
    return `${site.domain}: some data could not be synced`;
  });
  const text = $derived.by(() => {
    if (!site || !p) return '';
    if (site.phase === 'waiting')
      return many
        ? `Sync runs every 15 minutes and gives every site its latest days first (${p.summary.sitesWithRecentData} of ${p.summary.sites} sites so far), then fills in history. This page updates as data arrives.`
        : 'Sync runs every 15 minutes. This page updates as data arrives; you can also start a sync now.';
    if (site.phase === 'recent') return 'Some views are still empty or partial. They fill in as data arrives, no reload needed.';
    if (site.phase === 'history') return 'Long ranges and period comparisons stay incomplete until history is in.';
    return 'The rest of the data is in. Check the errors below.';
  });
</script>

{#if show && site && p}
  <div class="banner" class:quiet={site.phase === 'history' || site.phase === 'done'} role="status">
    <div class="head">
      <Icon name="sync" size={16} class={site.phase === 'waiting' || site.phase === 'recent' ? 'spin-slow' : ''} />
      <div class="titles">
        <strong>{title}</strong>
        <span>{text}</span>
      </div>
      <div class="actions">
        {#if site.phase === 'waiting'}
          <a class="btn sm primary" href={href('settings', 'sync')}><Icon name="sync" size={13} /> Sync now</a>
        {/if}
        <a class="btn sm" href={href('settings', 'progress')}>Details <Icon name="arrowRight" size={13} /></a>
        {#if site.phase === 'history' || site.phase === 'done'}
          <button class="btn ghost sm icon" aria-label="Hide until the next visit" title="Hide until the next visit" onclick={() => dismiss(site.siteId)}><Icon name="x" size={14} /></button>
        {/if}
      </div>
    </div>
    <ul class="datasets">
      {#each site.datasets as d (d.dataset)}
        <li title={d.message}>
          <div class="ds-head">
            <span class="ds-name">{DATASET_LABEL[d.dataset]}</span>
            <span class="ds-line" class:err={d.state === 'error'} class:warn={d.state === 'paused'}>{datasetLine(d)}</span>
          </div>
          <ProgressBar value={d.state === 'waiting' ? 0 : d.percent} tone={datasetTone(d)} label="{DATASET_LABEL[d.dataset]} sync progress" />
        </li>
      {/each}
    </ul>
    {#if paused.length || failing.length || (p.writeBudget.reached && site.phase === 'history')}
      <ul class="notes">
        {#each paused as x (x.source)}
          <li class="warn"><Icon name="alert" size={13} /> {SOURCE_LABEL[x.source]} asked Searchkeep to slow down. It is paused for every site and resumes {when(x.until)}; the other sources keep syncing.</li>
        {/each}
        {#each failing as d (d.dataset)}
          <li class="err"><Icon name="alert" size={13} /> {DATASET_LABEL[d.dataset]}: {d.message}. Retrying {when(d.retryAt)}.</li>
        {/each}
        {#if p.writeBudget.reached && site.phase === 'history'}
          <li><Icon name="info" size={13} /> Today's write budget is used up; history continues after 00:00 UTC.</li>
        {/if}
      </ul>
    {/if}
  </div>
{/if}

<style>
  .banner {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 14px 16px;
    margin-bottom: 20px;
    border-radius: var(--radius);
    border: 1px solid var(--accent-line);
    background: var(--accent-wash);
    font-size: 13px;
  }
  .banner.quiet {
    border-color: var(--border-2);
    background: var(--surface-2);
  }
  .head {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    flex-wrap: wrap;
    color: var(--accent-text);
  }
  .head > :global(.icon) {
    margin-top: 2px;
  }
  .titles {
    flex: 1 1 260px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    color: var(--text-2);
    min-width: 0;
  }
  .titles strong {
    color: var(--text);
    font-weight: 600;
  }
  .actions {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .datasets {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 10px 18px;
  }
  .datasets li {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
  }
  .ds-head {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }
  .ds-name {
    font-weight: 500;
    color: var(--text);
  }
  .ds-line {
    font-size: 12px;
    color: var(--text-3);
  }
  .ds-line.err,
  .notes .err {
    color: var(--neg);
  }
  .ds-line.warn,
  .notes .warn {
    color: var(--warn);
  }
  .notes {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
    color: var(--text-2);
    font-size: 12.5px;
  }
  .notes li {
    display: flex;
    gap: 7px;
    align-items: flex-start;
    overflow-wrap: anywhere;
  }
  .notes :global(.icon) {
    margin-top: 2px;
  }
  .banner :global(.spin-slow) {
    animation: spin 2.4s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .banner :global(.spin-slow) {
      animation: none;
    }
  }
</style>
