<script lang="ts">
  import { int } from '../lib/format';
  import { DATASET_LABEL, datasetLine, datasetTone, pauseText, syncWatch } from '../lib/sync.svelte';
  import type { SyncDataset, SyncPhase } from '../lib/types';
  import Card from './Card.svelte';
  import Icon from './Icon.svelte';
  import Pill from './Pill.svelte';
  import ProgressBar from './ProgressBar.svelte';
  import Skeleton from './Skeleton.svelte';

  const p = $derived(syncWatch.progress);
  const DATASETS: SyncDataset[] = ['gsc', 'bing', 'ai_crawlers', 'search_crawlers', 'web_analytics'];
  const APP_DATASETS: SyncDataset[] = ['app_store', 'google_play', 'app_store_public'];
  const apps = $derived((p?.apps ?? []).filter((a) => a.datasets.length > 0));
  const appColumns = $derived(APP_DATASETS.filter((ds) => apps.some((a) => a.datasets.some((d) => d.dataset === ds))));
  const PHASE: Record<SyncPhase, { label: string; tone: 'ok' | 'warn' | 'neutral' | 'accent' }> = {
    waiting: { label: 'Waiting', tone: 'neutral' },
    recent: { label: 'Latest days', tone: 'accent' },
    history: { label: 'History', tone: 'accent' },
    done: { label: 'Synced', tone: 'ok' },
  };
  const SUBTITLE: Record<SyncPhase, string> = {
    waiting: 'Waiting for the first sync. It runs every 15 minutes.',
    recent: 'Every site gets its latest days first, round-robin, then history fills in for all sites at once.',
    history: 'The latest days are in for every site. History fills in newest first.',
    done: 'Everything is in. New days arrive with the daily increments.',
  };
  // Sites still syncing first, so the table answers "what is left?".
  const ORDER: Record<SyncPhase, number> = { waiting: 1, recent: 0, history: 2, done: 3 };
  const sites = $derived(
    [...(p?.sites ?? [])].sort((a, b) => {
      const ea = a.datasets.some((d) => d.state === 'error') ? -1 : 0;
      const eb = b.datasets.some((d) => d.state === 'error') ? -1 : 0;
      return ea - eb || ORDER[a.phase] - ORDER[b.phase];
    }),
  );
  let expanded = $state(false);
  const LIMIT = 12;
  const shown = $derived(expanded ? sites : sites.slice(0, LIMIT));
</script>

<Card title="Sync progress" subtitle={p ? SUBTITLE[p.phase] : 'How far the sync has come'} id="settings-progress">
  {#snippet actions()}
    {#if p}<Pill tone={PHASE[p.phase].tone} icon={p.phase === 'done' ? 'auto' : null}>{PHASE[p.phase].label}</Pill>{/if}
    <button class="btn ghost sm icon" onclick={() => syncWatch.refresh()} aria-label="Refresh progress" title="Refresh progress"><Icon name="refresh" size={14} /></button>
  {/snippet}
  {#if !p}
    <Skeleton kind="table" rows={4} />
  {:else if p.sites.length === 0 && apps.length === 0}
    <p class="muted">No sites or apps yet.</p>
  {:else}
    <div class="summary">
      {#if p.summary.sites > 0}
        <div class="stat">
          <span class="k">Latest days</span>
          <span class="v num">{p.summary.sitesWithRecentData}<span class="of"> / {p.summary.sites} sites</span></span>
          <ProgressBar value={(p.summary.sitesWithRecentData / p.summary.sites) * 100} tone={p.summary.sitesWithRecentData === p.summary.sites ? 'ok' : 'accent'} label="Sites with their latest days" />
        </div>
      {/if}
      {#if apps.length > 0}
        <div class="stat">
          <span class="k">Apps</span>
          <span class="v num">{p.summary.appsWithRecentData ?? 0}<span class="of"> / {apps.length} apps</span></span>
          <ProgressBar value={((p.summary.appsWithRecentData ?? 0) / apps.length) * 100} tone={(p.summary.appsWithRecentData ?? 0) === apps.length ? 'ok' : 'accent'} label="Apps with their latest data" />
        </div>
      {/if}
      <div class="stat">
        <span class="k">History</span>
        <span class="v num">{Math.floor(p.summary.historyPercent)}<span class="of">%</span></span>
        <ProgressBar value={p.summary.historyPercent} tone={p.summary.historyPercent >= 100 ? 'ok' : 'accent'} label="History synced" />
      </div>
      <div class="stat">
        <span class="k">Rows written today</span>
        <span class="v num">{int(p.writeBudget.used)}<span class="of"> / {int(p.writeBudget.limit)}</span></span>
        <ProgressBar value={(p.writeBudget.used / p.writeBudget.limit) * 100} tone={p.writeBudget.reached ? 'warn' : 'accent'} label="Daily write budget used" />
      </div>
    </div>

    {#if p.paused.length || p.summary.issues || (p.writeBudget.reached && p.phase !== 'done')}
      <ul class="notes">
        {#each p.paused as x (x.source)}
          <li class="warn">
            <Icon name="alert" size={13} />
            <span>{pauseText(x.source, x.reason, x.until)}</span>
          </li>
        {/each}
        {#if p.summary.issues}
          <li class="err">
            <Icon name="alert" size={13} />
            <span><strong>{p.summary.issues} {p.summary.issues === 1 ? 'dataset failed' : 'datasets failed'}</strong> and {p.summary.issues === 1 ? 'is' : 'are'} retried with a growing delay. <strong>Sync now</strong> retries right away.</span>
          </li>
        {/if}
        {#if p.writeBudget.reached && p.phase !== 'done'}
          <li>
            <Icon name="info" size={13} />
            <span>Today's write budget (<code>SYNC_DAILY_WRITE_BUDGET</code>) is used up, so history continues after 00:00 UTC. The latest days keep syncing.</span>
          </li>
        {/if}
      </ul>
    {/if}

    {#if p.sites.length > 0}
    <div class="table-wrap">
      <table aria-label="Sync progress per site">
        <thead>
          <tr>
            <th scope="col">Site</th>
            {#each DATASETS as d (d)}<th scope="col">{DATASET_LABEL[d]}</th>{/each}
          </tr>
        </thead>
        <tbody>
          {#each shown as s (s.siteId)}
            <tr>
              <th scope="row">
                <span class="domain truncate">{s.domain}</span>
                <span class="phase {s.phase}">{PHASE[s.phase].label}</span>
              </th>
              {#each DATASETS as ds (ds)}
                {@const d = s.datasets.find((x) => x.dataset === ds)}
                <td title={d?.message}>
                  {#if d}
                    <ProgressBar value={d.state === 'waiting' ? 0 : d.percent} tone={datasetTone(d)} label="{s.domain} {DATASET_LABEL[ds]}" />
                    <span class="line" class:err={d.state === 'error'} class:warn={d.state === 'paused'}>{datasetLine(d)}</span>
                    {#if d.state === 'error' && d.message}<span class="msg">{d.message}</span>{/if}
                  {:else}
                    <span class="muted">Not connected</span>
                  {/if}
                </td>
              {/each}
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    {/if}
    {#if apps.length > 0}
      <div class="table-wrap apps">
        <table aria-label="Sync progress per app">
          <thead>
            <tr>
              <th scope="col">App</th>
              {#each appColumns as d (d)}<th scope="col">{DATASET_LABEL[d]}</th>{/each}
            </tr>
          </thead>
          <tbody>
            {#each apps as a (a.appId)}
              <tr>
                <th scope="row">
                  <span class="domain truncate">{a.name}</span>
                  <span class="phase {a.phase}">{PHASE[a.phase].label}</span>
                </th>
                {#each appColumns as ds (ds)}
                  {@const d = a.datasets.find((x) => x.dataset === ds)}
                  <td title={d?.message}>
                    {#if d}
                      <ProgressBar value={d.state === 'waiting' ? 0 : d.percent} tone={datasetTone(d)} label="{a.name} {DATASET_LABEL[ds]}" />
                      <span class="line" class:err={d.state === 'error'} class:warn={d.state === 'paused'}>{datasetLine(d)}</span>
                      {#if d.state === 'error' && d.message}<span class="msg">{d.message}</span>{/if}
                    {:else}
                      <span class="muted">Not connected</span>
                    {/if}
                  </td>
                {/each}
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
    {#if sites.length > LIMIT}
      <button class="btn ghost sm more" onclick={() => (expanded = !expanded)}>{expanded ? 'Show fewer' : `Show all ${sites.length} sites`}</button>
    {/if}
  {/if}
  {#snippet footer()}
    {#if p?.lastRun}
      <span>Last run {p.lastRun.status}, {int(p.lastRun.rowsWritten)} rows{p.lastRun.message ? `. ${p.lastRun.message}` : ''}</span>
    {:else}
      <span>No sync has run yet.</span>
    {/if}
  {/snippet}
</Card>

<style>
  .summary {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
    gap: 14px 24px;
    margin-bottom: 16px;
  }
  .stat {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .k {
    font-family: var(--mono);
    font-size: 10.5px;
    font-weight: 500;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-3);
  }
  .v {
    font-family: var(--display);
    font-size: 22px;
    font-weight: 600;
    color: var(--text);
    line-height: 1.1;
  }
  .of {
    font-size: 13px;
    font-weight: 500;
    color: var(--text-3);
  }
  .notes {
    list-style: none;
    margin: 0 0 16px;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
    font-size: 12.5px;
    color: var(--text-2);
  }
  .notes li {
    display: flex;
    gap: 8px;
    align-items: flex-start;
  }
  .notes :global(.icon) {
    margin-top: 2px;
    flex: none;
  }
  .notes .warn :global(.icon) {
    color: var(--warn);
  }
  .notes .err :global(.icon) {
    color: var(--neg);
  }
  .table-wrap.apps {
    margin-top: 16px;
  }
  .table-wrap {
    overflow-x: auto;
    margin: 0 -16px;
    padding: 0 16px;
  }
  table {
    width: 100%;
    min-width: 720px;
    border-collapse: collapse;
    font-size: 12.5px;
  }
  thead th {
    text-align: left;
    font-family: var(--mono);
    font-size: 10.5px;
    font-weight: 500;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-3);
    padding: 0 12px 8px 0;
    border-bottom: 1px solid var(--border);
  }
  tbody th,
  td {
    vertical-align: top;
    padding: 10px 12px 10px 0;
    border-bottom: 1px solid var(--border);
    width: 19%;
  }
  tbody th {
    text-align: left;
    font-weight: 500;
    width: 24%;
    max-width: 0;
  }
  tbody tr:last-child th,
  tbody tr:last-child td {
    border-bottom: 0;
  }
  .domain {
    display: block;
    color: var(--text);
  }
  .phase {
    font-size: 11.5px;
    font-weight: 400;
    color: var(--text-3);
  }
  .phase.done {
    color: var(--pos);
  }
  td {
    max-width: 0;
  }
  td :global(.bar) {
    margin-bottom: 6px;
  }
  .line {
    display: block;
    color: var(--text-2);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .line.err,
  .notes .err strong {
    color: var(--neg);
  }
  .line.warn {
    color: var(--warn);
  }
  .msg {
    display: block;
    margin-top: 2px;
    font-size: 11.5px;
    color: var(--text-3);
    overflow-wrap: anywhere;
  }
  .more {
    margin-top: 10px;
  }
</style>
