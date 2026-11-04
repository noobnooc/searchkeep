<script lang="ts">
  import { tick } from 'svelte';
  import Card from '../components/Card.svelte';
  import CopyButton from '../components/CopyButton.svelte';
  import DataTable from '../components/DataTable.svelte';
  import EmptyState from '../components/EmptyState.svelte';
  import ErrorBanner from '../components/ErrorBanner.svelte';
  import Icon from '../components/Icon.svelte';
  import PageHeader from '../components/PageHeader.svelte';
  import Pill from '../components/Pill.svelte';
  import Segmented from '../components/Segmented.svelte';
  import SitesManager from '../components/SitesManager.svelte';
  import Skeleton from '../components/Skeleton.svelte';
  import { apiUrl, request } from '../lib/api';
  import { dateTime, int, isoDate, shortDate, timeAgo } from '../lib/format';
  import { refreshAll, resource } from '../lib/resource.svelte';
  import { router } from '../lib/router.svelte';
  import { ui, type ThemePref } from '../lib/state.svelte';
  import type { Column } from '../lib/table';
  import type { CheckStatus, Coverage, ImportResponse, SetupCheck, SetupStatusResponse, SiteSources, SyncRun, SyncRunsResponse, SyncTaskResult } from '../lib/types';

  interface Props {
    reloadSites: () => Promise<void>;
  }
  let { reloadSites }: Props = $props();

  const setup = resource<SetupStatusResponse>(() => apiUrl('/api/setup-status'));
  const runs = resource<SyncRunsResponse>(() => apiUrl('/api/sync-runs', { limit: 15 }));

  const origin = window.location.origin;
  const mcpUrl = `${origin}/mcp`;
  const claudeCmd = `claude mcp add --transport http searchkeep ${mcpUrl}`;
  const jsonCfg = JSON.stringify({ mcpServers: { searchkeep: { url: mcpUrl } } }, null, 2);

  // Scroll to #/settings/<section>.
  $effect(() => {
    const id = router.sub;
    if (!id) return;
    tick().then(() => document.getElementById(`settings-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  });

  // ---- checks -----------------------------------------------------------
  const GROUPS: Array<{ prefix: string; title: string }> = [
    { prefix: 'readiness.', title: 'Access' },
    { prefix: 'config', title: 'Configuration' },
    { prefix: 'probe.', title: 'Connections' },
    { prefix: 'sync.', title: 'Sync' },
  ];
  const grouped = $derived(
    GROUPS.map((g) => ({ ...g, checks: (setup.data?.checks ?? []).filter((c) => c.id.startsWith(g.prefix)) })).filter((g) => g.checks.length > 0),
  );
  const tone = (s: CheckStatus) => (s === 'ok' ? 'ok' : s === 'warn' ? 'warn' : s === 'error' ? 'error' : 'neutral') as 'ok' | 'warn' | 'error' | 'neutral';
  const STATUS_LABEL: Record<CheckStatus, string> = { ok: 'OK', warn: 'Check', error: 'Fix', skipped: 'Skipped' };
  const errorCount = $derived((setup.data?.checks ?? []).filter((c: SetupCheck) => c.status === 'error').length);

  // ---- sync -------------------------------------------------------------
  let syncing = $state(false);
  let syncResult = $state.raw<SyncRun | null>(null);
  let syncError = $state.raw<unknown>(null);

  async function syncNow() {
    syncing = true;
    syncError = null;
    try {
      syncResult = await request<SyncRun>('/api/sync', { method: 'POST' });
      refreshAll();
      await reloadSites();
    } catch (err) {
      syncError = err;
    } finally {
      syncing = false;
    }
  }

  const runTone = (s: SyncRun['status']) => (s === 'ok' ? 'ok' : s === 'partial' || s === 'running' ? 'warn' : s === 'error' ? 'error' : 'neutral') as 'ok' | 'warn' | 'error' | 'neutral';
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
    { key: 'siteId', label: 'Site' },
    { key: 'status', label: 'Status', render: taskStatus },
    { key: 'rowsWritten', label: 'Rows', align: 'right', text: (r) => int(r.rowsWritten) },
  ];

  // ---- import -----------------------------------------------------------
  let importSite = $state(ui.siteId);
  let importDate = $state('');
  let file = $state<File | null>(null);
  let importing = $state(false);
  let importResult = $state.raw<ImportResponse | null>(null);
  let importError = $state.raw<unknown>(null);
  let fileInput = $state<HTMLInputElement | null>(null);

  async function doImport(e: SubmitEvent) {
    e.preventDefault();
    if (!file) return;
    importing = true;
    importError = null;
    importResult = null;
    try {
      if (file.size > 5_000_000) throw new Error('The CSV is larger than 5 MB. Export a shorter date range.');
      const text = await file.text();
      importResult = await request<ImportResponse>(apiUrl('/api/import/ai-citations', { site: importSite, date: importDate || undefined }), {
        method: 'POST',
        body: text,
        contentType: 'text/csv; charset=utf-8',
      });
      refreshAll();
      await reloadSites();
    } catch (err) {
      importError = err;
    } finally {
      importing = false;
    }
  }

  // ---- coverage ---------------------------------------------------------
  const DATASET_LABEL: Record<string, string> = { search: 'Search performance', ai_crawlers: 'AI crawler requests', web_analytics: 'Web Analytics', ai_citations: 'AI citations', web_vitals: 'Web Vitals' };
  const SOURCE_LABEL: Record<string, string> = { gsc: 'Search Console', bing: 'Bing', cloudflare: 'Cloudflare', import: 'CSV import' };
  type CovRow = Coverage & { siteId: string };
  const covCols: Column<CovRow>[] = [
    { key: 'siteId', label: 'Site', sortable: true },
    { key: 'dataset', label: 'Dataset', grow: true, sortable: true, text: (r) => DATASET_LABEL[r.dataset] ?? r.dataset },
    { key: 'source', label: 'Source', sortable: true, text: (r) => SOURCE_LABEL[r.source] ?? r.source },
    { key: 'firstDate', label: 'From', sortable: true, text: (r) => (r.firstDate ? shortDate(r.firstDate, true) : '—') },
    { key: 'lastDate', label: 'To', sortable: true, text: (r) => (r.lastDate ? shortDate(r.lastDate, true) : '—') },
    { key: 'days', label: 'Days', align: 'right', sortable: true, text: (r) => (r.days === null ? '—' : int(r.days)), hideOnMobile: true },
  ];
  const SOURCE_KEYS: Array<[keyof SiteSources, string]> = [
    ['gsc', 'Search Console'],
    ['bing', 'Bing'],
    ['aiCrawlers', 'AI crawlers'],
    ['webAnalytics', 'Web Analytics'],
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

<PageHeader title="Settings" range={false} />

<div class="stack">
  <SitesManager {reloadSites} />

  <div class="grid-2">
    <Card title="Setup checks" id="settings-checks" busy={setup.loading && Boolean(setup.data)}>
      {#snippet actions()}
        {#if setup.data}
          <Pill tone={errorCount === 0 ? 'ok' : 'error'}>{setup.data.summary}</Pill>
        {/if}
        <button class="btn ghost sm icon" onclick={setup.reload} aria-label="Run checks again" title="Run checks again"><Icon name="refresh" size={14} /></button>
      {/snippet}
      {#if setup.error}
        <ErrorBanner error={setup.error} retry={setup.reload} />
      {:else if !setup.data}
        <Skeleton kind="table" rows={8} />
      {:else}
        <div class="check-groups">
          {#each grouped as g (g.title)}
            <section>
              <h3>{g.title}</h3>
              <ul class="checks">
                {#each g.checks as c, i (`${c.id}-${i}`)}
                  <li>
                    <Pill tone={tone(c.status)}>{STATUS_LABEL[c.status]}</Pill>
                    <div>
                      <span class="label">{c.label}</span>
                      {#if c.detail}<span class="detail">{c.detail}</span>{/if}
                    </div>
                  </li>
                {/each}
              </ul>
            </section>
          {/each}
        </div>
      {/if}
    </Card>

    <div class="stack">
      <Card title="Sync" subtitle="Every 15 minutes" id="settings-sync">
        {#snippet actions()}
          <button class="btn primary" onclick={syncNow} disabled={syncing}>
            <Icon name="sync" size={14} class={syncing ? 'spin' : ''} />
            {syncing ? 'Syncing…' : 'Sync now'}
          </button>
        {/snippet}
        {#if syncError}
          <ErrorBanner error={syncError} title="Sync failed" />
        {:else if syncResult}
          <div class="sync-result" role="status">
            <div class="row">
              <Pill tone={runTone(syncResult.status)}>{syncResult.status}</Pill>
              <strong class="num">{int(syncResult.rowsWritten)} rows written</strong>
              <span class="muted num">in {duration(syncResult)}</span>
            </div>
            {#if syncResult.message}<p class="muted">{syncResult.message}</p>{/if}
            {#if syncResult.details?.length}
              <div class="details"><DataTable label="Sync tasks" rows={syncResult.details} columns={taskCols} limit={8} /></div>
            {/if}
          </div>
        {:else}
          <p class="muted">Pulls what is due, within free-tier limits.</p>
        {/if}
      </Card>

      <Card title="Recent sync runs" flush busy={runs.loading && Boolean(runs.data)}>
        {#if runs.error}
          <div class="pad"><ErrorBanner error={runs.error} retry={runs.reload} /></div>
        {:else if !runs.data}
          <div class="pad"><Skeleton kind="table" rows={4} /></div>
        {:else if runs.data.runs.length === 0}
          <EmptyState compact title="No sync has run yet" icon="sync">
            <p>The first scheduled sync starts within 15 minutes of the deployment becoming ready. Or select Sync now.</p>
          </EmptyState>
        {:else}
          <DataTable label="Recent sync runs" rows={runs.data.runs} columns={runCols} rowKey={(r, i) => String(r.id ?? i)} limit={6} />
        {/if}
      </Card>
    </div>
  </div>

  <div class="grid-2">
    <Card title="Import AI citations" subtitle="Bing Webmaster Tools → AI Performance → Export (CSV)" id="settings-import">
      <form class="import" onsubmit={doImport}>
        <ol class="howto">
          <li>In Bing Webmaster Tools, open <strong>AI Performance</strong> for your site and select <strong>Export</strong>.</li>
          <li>Choose the CSV below. Columns are detected by name (URL, citations, optional date).</li>
        </ol>
        <div class="fields">
          {#if ui.sites.length > 1}
            <label class="field">
              Site
              <select class="select" bind:value={importSite}>
                {#each ui.sites as s (s.id)}<option value={s.id}>{s.domain}</option>{/each}
              </select>
            </label>
          {/if}
          <label class="field">
            Date for rows without one
            <input class="input" type="date" bind:value={importDate} max={isoDate(new Date())} />
          </label>
        </div>
        <label class="drop" class:has={file}>
          <input
            bind:this={fileInput}
            type="file"
            accept=".csv,text/csv"
            onchange={(e) => {
              file = (e.currentTarget as HTMLInputElement).files?.[0] ?? null;
              importResult = null;
              importError = null;
            }} />
          <Icon name={file ? 'file' : 'upload'} size={18} />
          <span>
            {#if file}<strong>{file.name}</strong> <span class="muted num">{(file.size / 1024).toFixed(1)} KB</span>{:else}<strong>Choose a CSV file</strong> <span class="muted">or drop it here</span>{/if}
          </span>
        </label>
        <div class="row">
          <button class="btn primary" type="submit" disabled={!file || importing}><Icon name="upload" size={14} /> {importing ? 'Importing…' : 'Import'}</button>
          {#if file && !importing}
            <button
              class="btn ghost"
              type="button"
              onclick={() => {
                file = null;
                if (fileInput) fileInput.value = '';
              }}>Clear</button>
          {/if}
          <span class="muted small">The file is sent only to your own Worker.</span>
        </div>
      </form>
      {#if importError}
        <div class="mt"><ErrorBanner error={importError} title="Import failed" /></div>
      {:else if importResult}
        <div class="import-result" role="status">
          <div class="ir-stats">
            <div><span class="ir-n num">{int(importResult.imported)}</span><span class="ir-l">rows imported</span></div>
            <div><span class="ir-n num">{int(importResult.skipped)}</span><span class="ir-l">skipped</span></div>
            <div><span class="ir-n num">{int(importResult.rowsWritten)}</span><span class="ir-l">new or changed</span></div>
          </div>
          <p class="muted small">
            Columns used: URL from “{importResult.columns.page}”, citations from “{importResult.columns.citations}”{importResult.columns.date
              ? `, date from “${importResult.columns.date}”`
              : ', no date column (used the date above or today)'}.
          </p>
        </div>
      {/if}
    </Card>

    <Card title="Connect an AI client" subtitle="Claude · Cursor · ChatGPT" id="settings-mcp">
      <div class="mcp">
        <div class="kv">
          <span class="k">MCP endpoint</span>
          <div class="code-row">
            <code class="code">{mcpUrl}</code>
            <CopyButton text={mcpUrl} />
          </div>
        </div>
        <div class="kv">
          <span class="k">Claude Code</span>
          <div class="code-row">
            <code class="code">{claudeCmd}</code>
            <CopyButton text={claudeCmd} />
          </div>
        </div>
        <div class="kv">
          <span class="k">Other clients (JSON config)</span>
          <div class="code-row top">
            <pre class="code">{jsonCfg}</pre>
            <CopyButton text={jsonCfg} />
          </div>
        </div>
        <p class="muted small">
          The first connection opens a Cloudflare Access sign-in (Managed OAuth with PKCE). Tools are read-only unless <code>ENABLE_WRITES</code> is set.
        </p>
      </div>
    </Card>
  </div>

  <Card title="Sites and data coverage" flush id="settings-coverage" busy={setup.loading && Boolean(setup.data)}>
    {#if !setup.data}
      <div class="pad"><Skeleton kind="table" rows={5} /></div>
    {:else}
      <ul class="sites">
        {#each setup.data.sites as s (s.id)}
          <li>
            <div class="site-name"><strong>{s.domain}</strong> <span class="muted mono">{s.id}</span></div>
            <div class="row">
              {#each SOURCE_KEYS as [k, label] (k)}
                <Pill tone={s.sources[k] ? 'ok' : 'neutral'} icon={s.sources[k] ? 'check' : null} title={s.sources[k] ? `${label} is connected` : `${label} is not configured`}>{label}</Pill>
              {/each}
            </div>
          </li>
        {/each}
      </ul>
      {#if setup.data.coverage.length === 0}
        <EmptyState compact title="No data stored yet" icon="sync"><p>Coverage appears after the first sync.</p></EmptyState>
      {:else}
        <DataTable label="Data coverage" rows={setup.data.coverage} columns={covCols} rowKey={(r) => `${r.siteId}|${r.source}|${r.dataset}`} />
      {/if}
    {/if}
  </Card>

  <Card title="Appearance">
    <div class="row between">
      <span class="muted">Theme for this browser</span>
      <Segmented
        label="Theme"
        options={[
          { value: 'system', label: 'System' },
          { value: 'light', label: 'Light' },
          { value: 'dark', label: 'Dark' },
        ]}
        value={ui.theme}
        onchange={(v: ThemePref) => ui.setTheme(v)} />
    </div>
    {#snippet footer()}
      <span>Signed in as {ui.status?.identity?.email ?? 'unknown'} through Cloudflare Access. Searchkeep sends no telemetry and loads nothing from third parties.</span>
    {/snippet}
  </Card>
</div>

<style>
  .pad {
    padding: 4px 16px 16px;
  }
  .mt {
    margin-top: 12px;
  }
  .small {
    font-size: 12.5px;
  }
  .mono {
    font-family: var(--mono);
    font-size: 12px;
  }
  .between {
    justify-content: space-between;
  }
  .check-groups {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  h3 {
    font-family: var(--mono);
    font-size: 10.5px;
    font-weight: 500;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-3);
    margin-bottom: 8px;
  }
  .checks {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 9px;
  }
  .checks li {
    display: grid;
    grid-template-columns: 64px minmax(0, 1fr);
    align-items: start;
    gap: 10px;
    font-size: 13px;
  }
  .checks li > :global(.pill) {
    justify-self: start;
  }
  .label {
    display: block;
  }
  .detail {
    display: block;
    font-size: 12.5px;
    color: var(--text-3);
    overflow-wrap: anywhere;
  }
  .sync-result {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .details {
    margin: 4px -16px -16px;
    border-top: 1px solid var(--border);
  }
  .import {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .howto {
    margin: 0;
    padding-left: 18px;
    color: var(--text-2);
    font-size: 13px;
    line-height: 1.7;
  }
  .howto strong {
    color: var(--text);
    font-weight: 600;
  }
  .fields {
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
  }
  .fields .field {
    flex: 1 1 180px;
  }
  .drop {
    position: relative;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 16px;
    border: 1px dashed var(--border-3);
    border-radius: var(--radius);
    color: var(--text-2);
    cursor: pointer;
    transition:
      border-color 120ms ease,
      background 120ms ease;
    min-width: 0;
  }
  .drop:hover,
  .drop:focus-within {
    border-color: var(--text-3);
    background: var(--surface-2);
  }
  .drop.has {
    border-style: solid;
    border-color: var(--accent-line);
  }
  .drop input {
    position: absolute;
    inset: 0;
    opacity: 0;
    cursor: pointer;
    width: 100%;
  }
  .drop span {
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .drop strong {
    color: var(--text);
    font-weight: 600;
  }
  .import-result {
    margin-top: 14px;
    padding: 12px 14px;
    border-radius: var(--radius);
    background: var(--pos-wash);
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .ir-stats {
    display: flex;
    gap: 24px;
    flex-wrap: wrap;
  }
  .ir-stats div {
    display: flex;
    flex-direction: column;
  }
  .ir-n {
    font-family: var(--display);
    font-size: 20px;
    font-weight: 600;
    letter-spacing: -0.015em;
  }
  .ir-l {
    font-size: 12px;
    color: var(--text-2);
  }
  .mcp {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .kv {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
  }
  .k {
    font-size: 12px;
    font-weight: 500;
    color: var(--text-2);
  }
  .code-row {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }
  .code-row.top {
    align-items: flex-start;
  }
  .code {
    flex: 1;
    min-width: 0;
    margin: 0;
    padding: 7px 10px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border);
    background: var(--surface-2);
    font-family: var(--mono);
    font-size: 12.5px;
    color: var(--text);
    overflow-x: auto;
    white-space: pre;
  }
  .sites {
    list-style: none;
    margin: 0;
    padding: 0 16px 12px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    border-bottom: 1px solid var(--border);
  }
  .sites li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px 16px;
    flex-wrap: wrap;
  }
  .site-name {
    display: flex;
    align-items: baseline;
    gap: 8px;
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
