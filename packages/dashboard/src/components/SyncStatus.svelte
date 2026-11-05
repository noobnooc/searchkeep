<script lang="ts">
  import { href, router } from '../lib/router.svelte';
  import { SOURCE_LABEL, syncWatch } from '../lib/sync.svelte';
  import Icon from './Icon.svelte';
  import ProgressBar from './ProgressBar.svelte';

  // Sidebar summary of the sync; hidden once everything is in and healthy.
  const p = $derived(syncWatch.progress);
  const visible = $derived(Boolean(p && p.summary.sites > 0 && (p.phase !== 'done' || p.paused.length > 0 || p.summary.issues > 0)));
  const label = $derived.by(() => {
    if (!p) return '';
    if (p.phase === 'waiting') return 'Waiting for the first sync';
    if (p.phase === 'recent') return `Latest days: ${p.summary.sitesWithRecentData} of ${p.summary.sites} sites`;
    if (p.phase === 'history') return `History ${Math.floor(p.summary.historyPercent)}%`;
    return 'Synced';
  });
  const value = $derived(p ? (p.phase === 'recent' || p.phase === 'waiting' ? (p.summary.sitesWithRecentData / Math.max(1, p.summary.sites)) * 100 : p.summary.historyPercent) : 0);
  const note = $derived.by(() => {
    if (!p) return '';
    if (p.paused.length) return `${p.paused.map((x) => SOURCE_LABEL[x.source]).join(', ')} paused (rate limited)`;
    if (p.summary.issues) return `${p.summary.issues} ${p.summary.issues === 1 ? 'dataset' : 'datasets'} failing`;
    return '';
  });
</script>

{#if visible && p}
  <a class="sync" href={href('settings', 'progress')} aria-current={router.view === 'settings' && router.sub === 'progress' ? 'page' : undefined}>
    <div class="top">
      <Icon name="sync" size={14} />
      <span class="label truncate">{label}</span>
    </div>
    <ProgressBar value={value} tone={p.phase === 'done' ? 'ok' : 'accent'} label="Sync progress" />
    {#if note}<span class="note truncate" class:err={!p.paused.length}>{note}</span>{/if}
  </a>
{/if}

<style>
  .sync {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px;
    border-radius: 8px;
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--text-2);
    font-size: 12px;
  }
  .sync:hover {
    text-decoration: none;
    border-color: var(--border-2);
    color: var(--text);
  }
  .top {
    display: flex;
    align-items: center;
    gap: 7px;
    min-width: 0;
  }
  .top :global(.icon) {
    color: var(--accent-text);
  }
  .label {
    font-weight: 500;
    min-width: 0;
  }
  .note {
    color: var(--warn);
    font-size: 11.5px;
  }
  .note.err {
    color: var(--neg);
  }
</style>
