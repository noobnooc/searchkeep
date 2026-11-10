<script lang="ts">
  // How far the sync has come, a manual "Sync now", and the latest runs.
  import Card from '../../components/Card.svelte';
  import DataTable from '../../components/DataTable.svelte';
  import EmptyState from '../../components/EmptyState.svelte';
  import ErrorBanner from '../../components/ErrorBanner.svelte';
  import Icon from '../../components/Icon.svelte';
  import Pill from '../../components/Pill.svelte';
  import Skeleton from '../../components/Skeleton.svelte';
  import SyncProgressCard from '../../components/SyncProgressCard.svelte';
  import { apiUrl, request } from '../../lib/api';
  import { dateTime, int, timeAgo } from '../../lib/format';
  import { refreshAll, resource } from '../../lib/resource.svelte';
  import { syncWatch } from '../../lib/sync.svelte';
  import type { Column } from '../../lib/table';
  import type { SyncRun, SyncRunsResponse, SyncTaskResult } from '../../lib/types';

  interface Props {
    reloadSites: () => Promise<void>;
  }
  let { reloadSites }: Props = $props();

  const runs = resource<SyncRunsResponse>(() => apiUrl('/api/sync-runs', { limit: 15 }));

  let syncing = $state(false);
  let syncResult = $state.raw<SyncRun | null>(null);
  let syncError = $state.raw<unknown>(null);

  async function syncNow() {
    syncing = true;
    syncError = null;
    syncResult = null;
    try {
      syncResult = await request<SyncRun>('/api/sync', { method: 'POST' });
      refreshAll();
      await reloadSites();
      void syncWatch.refresh({ quiet: true });
    } catch (err) {
      syncError = err;
    } finally {
      syncing = false;
    }
  }

  const runTone = (s: SyncRun['status']) =>
    (s === 'ok' ? 'ok' : s === 'partial' || s === 'running' ? 'warn' : s === 'error' ? 'error' : 'neutral') as 'ok' | 'warn' | 'error' | 'neutral';
  function duration(r: SyncRun): string {
    if (!r.finishedAt) return '—';
    const s = (new Date(r.finishedAt).getTime() - new Date(r.startedAt).getTime()) / 1000;
    return s < 60 ? `${s.toFixed(1)} s` : `${Math.round(s / 60)} min`;
  }
  const runCols: Column<SyncRun>[] = $derived([
    { key: 'startedAt', label: 'Started', render: runStarted },
    { key: 'trigger', label: 'Trigger', text: (r) => (r.trigger === 'cron' ? 'Scheduled' : 'Manual') },
    { key: 'status', label: 'Status', render: runStatus },
    { key: 'rowsWritten', label: 'Rows', align: 'right', text: (r) => int(r.rowsWritten) },
    { key: 'duration', label: 'Took', align: 'right', text: duration, hideOnMobile: true },
    { key: 'message', label: 'Message', grow: true, text: (r) => r.message ?? '', hideOnMobile: true },
  ]);
  const taskCols: Column<SyncTaskResult>[] = [
    { key: 'task', label: 'Task', grow: true },
    { key: 'siteId', label: 'Site or app' },
    { key: 'status', label: 'Status', render: taskStatus },
    { key: 'rowsWritten', label: 'Rows', align: 'right', text: (r) => int(r.rowsWritten) },
  ];
</script>

{#snippet runStarted(r: SyncRun)}
  <span title={dateTime(r.startedAt)}>{timeAgo(r.startedAt)}</span>
{/snippet}
{#snippet runStatus(r: SyncRun)}
  <Pill tone={runTone(r.status)}>{r.status}</Pill>
{/snippet}
{#snippet taskStatus(r: SyncTaskResult)}
  <Pill tone={r.status === 'ok' ? 'ok' : r.status === 'error' ? 'error' : 'neutral'} title={r.message}>{r.status}</Pill>
{/snippet}

{#snippet syncButton()}
  <button class="btn primary sm" onclick={syncNow} disabled={syncing} title="Pull what is due now, within the free-tier limits">
    <Icon name="sync" size={14} class={syncing ? 'spin' : ''} />
    {syncing ? 'Syncing…' : 'Sync now'}
  </button>
{/snippet}

{#if syncError}
  <ErrorBanner error={syncError} title="Sync failed" />
{:else if syncResult}
  <div class="result" role="status">
    <div class="row">
      <Pill tone={runTone(syncResult.status)}>{syncResult.status}</Pill>
      <strong class="num">{int(syncResult.rowsWritten)} rows written</strong>
      <span class="muted num">in {duration(syncResult)}</span>
      <button class="btn ghost sm icon close" onclick={() => (syncResult = null)} aria-label="Dismiss" title="Dismiss"><Icon name="x" size={14} /></button>
    </div>
    {#if syncResult.message}<p class="muted">{syncResult.message}</p>{/if}
    {#if syncResult.details?.length}
      <details>
        <summary>{syncResult.details.length} {syncResult.details.length === 1 ? 'task' : 'tasks'}</summary>
        <div class="details"><DataTable label="Sync tasks" rows={syncResult.details} columns={taskCols} limit={8} /></div>
      </details>
    {/if}
  </div>
{/if}

<SyncProgressCard actions={syncButton} />

<Card title="Recent runs" subtitle="Scheduled every 15 minutes, plus each Sync now" flush busy={runs.loading && Boolean(runs.data)}>
  {#if runs.error}
    <div class="pad"><ErrorBanner error={runs.error} retry={runs.reload} /></div>
  {:else if !runs.data}
    <div class="pad"><Skeleton kind="table" rows={4} /></div>
  {:else if runs.data.runs.length === 0}
    <EmptyState compact title="No sync has run yet" icon="sync">
      <p>The first scheduled sync starts within 15 minutes of the deployment becoming ready. Or select Sync now.</p>
    </EmptyState>
  {:else}
    <DataTable label="Recent sync runs" rows={runs.data.runs} columns={runCols} rowKey={(r, i) => String(r.id ?? i)} limit={8} />
  {/if}
</Card>

<style>
  .pad {
    padding: 4px 16px 16px;
  }
  .result {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px 14px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
    box-shadow: var(--shadow-card);
  }
  .result p {
    margin: 0;
    font-size: 13px;
  }
  .close {
    margin-left: auto;
  }
  summary {
    cursor: pointer;
    font-size: 12.5px;
    color: var(--text-2);
  }
  .details {
    margin: 8px -14px -12px;
    border-top: 1px solid var(--border);
  }
  :global(.spin) {
    animation: spin 1s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
