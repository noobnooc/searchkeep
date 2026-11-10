<script lang="ts">
  // What is stored for each site, and the AI citations CSV import (Bing has no API for them).
  import Card from '../../components/Card.svelte';
  import DataTable from '../../components/DataTable.svelte';
  import EmptyState from '../../components/EmptyState.svelte';
  import ErrorBanner from '../../components/ErrorBanner.svelte';
  import Icon from '../../components/Icon.svelte';
  import SiteIcon from '../../components/SiteIcon.svelte';
  import Skeleton from '../../components/Skeleton.svelte';
  import { apiUrl, request } from '../../lib/api';
  import { int, isoDate, shortDate } from '../../lib/format';
  import { refreshAll, type Resource } from '../../lib/resource.svelte';
  import { ui } from '../../lib/state.svelte';
  import type { Column } from '../../lib/table';
  import type { Coverage, ImportResponse, SetupStatusResponse } from '../../lib/types';

  interface Props {
    setup: Resource<SetupStatusResponse>;
    reloadSites: () => Promise<void>;
  }
  let { setup, reloadSites }: Props = $props();

  // ---- coverage ---------------------------------------------------------
  const DATASET_LABEL: Record<string, string> = {
    search: 'Search performance',
    ai_crawlers: 'AI crawler requests',
    search_crawlers: 'Search engine crawler requests',
    web_analytics: 'Web Analytics',
    ai_citations: 'AI citations',
    web_vitals: 'Web Vitals',
  };
  const SOURCE_LABEL: Record<string, string> = { gsc: 'Search Console', bing: 'Bing', cloudflare: 'Cloudflare', import: 'CSV import' };
  type CovRow = Coverage & { siteId: string };
  const many = $derived(ui.sites.length > 1);
  const domainOf = (id: string) => ui.sites.find((s) => s.id === id)?.domain ?? id;
  const covCols: Column<CovRow>[] = $derived([
    ...(many ? [{ key: 'siteId', label: 'Site', sortable: true, render: siteCell, sortValue: (r: CovRow) => domainOf(r.siteId) } as Column<CovRow>] : []),
    { key: 'dataset', label: 'Dataset', grow: true, sortable: true, text: (r) => DATASET_LABEL[r.dataset] ?? r.dataset },
    { key: 'source', label: 'Source', sortable: true, text: (r) => SOURCE_LABEL[r.source] ?? r.source },
    { key: 'firstDate', label: 'From', sortable: true, text: (r) => (r.firstDate ? shortDate(r.firstDate, true) : '—') },
    { key: 'lastDate', label: 'To', sortable: true, text: (r) => (r.lastDate ? shortDate(r.lastDate, true) : '—') },
    { key: 'days', label: 'Days', align: 'right', sortable: true, text: (r) => (r.days === null ? '—' : int(r.days)), hideOnMobile: true },
  ]);
  const stored = $derived((setup.data?.coverage ?? []).filter((r) => r.firstDate));

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
</script>

{#snippet siteCell(r: CovRow)}
  <span class="site"><SiteIcon site={{ id: r.siteId, domain: domainOf(r.siteId) }} size="sm" /><span class="truncate">{domainOf(r.siteId)}</span></span>
{/snippet}

<Card
  title="Stored data"
  subtitle="What your database holds for each site. History is kept for as long as you want."
  flush
  id="settings-coverage"
  busy={setup.loading && Boolean(setup.data)}>
  {#if setup.error}
    <div class="pad"><ErrorBanner error={setup.error} retry={setup.reload} /></div>
  {:else if !setup.data}
    <div class="pad"><Skeleton kind="table" rows={5} /></div>
  {:else if stored.length === 0}
    <EmptyState compact title="No data stored yet" icon="database"><p>Coverage appears after the first sync.</p></EmptyState>
  {:else}
    <DataTable label="Data coverage" rows={stored} columns={covCols} rowKey={(r) => `${r.siteId}|${r.source}|${r.dataset}`} />
  {/if}
</Card>

<Card title="Import AI citations" subtitle="Bing Webmaster Tools → AI Performance → Export (CSV)" id="settings-import">
  <form class="import" onsubmit={doImport}>
    <ol class="howto">
      <li>In Bing Webmaster Tools, open <strong>AI Performance</strong> for your site and select <strong>Export</strong>.</li>
      <li>Choose the CSV below. Columns are detected by name (URL, citations, optional date).</li>
    </ol>
    <div class="fields">
      {#if many}
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
  .site {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    max-width: 100%;
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
    flex: 0 1 260px;
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
</style>
