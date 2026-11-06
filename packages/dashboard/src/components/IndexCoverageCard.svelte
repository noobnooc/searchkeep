<script lang="ts">
  import Card from './Card.svelte';
  import DataTable from './DataTable.svelte';
  import EmptyState from './EmptyState.svelte';
  import ErrorBanner from './ErrorBanner.svelte';
  import Notes from './Notes.svelte';
  import PathText from './PathText.svelte';
  import Pill from './Pill.svelte';
  import SegmentBar from './SegmentBar.svelte';
  import Segmented from './Segmented.svelte';
  import Skeleton from './Skeleton.svelte';
  import { apiUrl } from '../lib/api';
  import { dateTime, int, shortDate } from '../lib/format';
  import { resource } from '../lib/resource.svelte';
  import { ui } from '../lib/state.svelte';
  import type { Column } from '../lib/table';
  import type { IndexCoverageResponse, IndexStatusRow } from '../lib/types';

  type View = 'problems' | 'rich' | 'all';
  type StateRow = IndexCoverageResponse['states'][number];
  type IssueRow = IndexCoverageResponse['richResults']['issues'][number];

  let view = $state<View>('problems');
  const VIEWS: Array<{ value: View; label: string }> = [
    { value: 'problems', label: 'Not indexed' },
    { value: 'rich', label: 'Rich result issues' },
    { value: 'all', label: 'All URLs' },
  ];

  const coverage = resource<IndexCoverageResponse>(() =>
    ui.siteId ? apiUrl('/api/index-coverage', { site: ui.siteId, limit: 500, richResultIssues: view === 'rich' ? 1 : undefined }) : null,
  );
  const d = $derived(coverage.data);

  const VERDICT_LABEL: Record<string, string> = {
    PASS: 'Indexed',
    NEUTRAL: 'Not indexed',
    FAIL: 'Error',
    PENDING: 'Not inspected yet',
    ERROR: 'Inspection failed',
  };
  const VERDICT_TONE: Record<string, 'ok' | 'warn' | 'error' | 'neutral'> = { PASS: 'ok', NEUTRAL: 'warn', FAIL: 'error', ERROR: 'error' };
  const count = (v: string) => d?.states.filter((s) => s.verdict === v).reduce((t, s) => t + s.urls, 0) ?? 0;
  const parts = $derived([
    { key: 'PASS', label: 'Indexed', value: count('PASS'), color: 'var(--vital-good)' },
    { key: 'NEUTRAL', label: 'Not indexed', value: count('NEUTRAL'), color: 'var(--vital-ni)' },
    { key: 'FAIL', label: 'With errors', value: count('FAIL'), color: 'var(--vital-poor)' },
    { key: 'PENDING', label: 'Not inspected yet', value: count('PENDING') + count('ERROR'), color: 'var(--border-3)' },
  ]);

  const rows = $derived(view === 'problems' ? (d?.urls ?? []).filter((r) => r.verdict !== 'PASS') : (d?.urls ?? []));

  const stateCols: Column<StateRow>[] = [
    { key: 'coverageState', label: 'Coverage state', grow: true, sortable: true, text: (r) => r.coverageState ?? VERDICT_LABEL[r.verdict] ?? r.verdict },
    { key: 'verdict', label: 'Verdict', width: '150px', sortable: true, render: verdictCell },
    { key: 'urls', label: 'URLs', align: 'right', width: '90px', sortable: true, text: (r) => int(r.urls) },
  ];
  const urlCols: Column<IndexStatusRow>[] = [
    { key: 'url', label: 'URL', grow: true, sortable: true, render: urlCell },
    { key: 'coverageState', label: 'Coverage', sortable: true, text: (r) => r.coverageState ?? r.error ?? VERDICT_LABEL[r.verdict ?? 'PENDING'] ?? '—' },
    { key: 'richResultsVerdict', label: 'Rich results', width: '120px', sortable: true, render: richCell, hideOnMobile: true },
    { key: 'lastCrawlTime', label: 'Last crawl', width: '150px', sortable: true, text: (r) => dateTime(r.lastCrawlTime), hideOnMobile: true },
    { key: 'inspectedAt', label: 'Checked', width: '100px', sortable: true, text: (r) => (r.inspectedAt ? shortDate(r.inspectedAt) : '—'), hideOnMobile: true },
  ];
  const issueCols: Column<IssueRow>[] = [
    { key: 'type', label: 'Rich result', sortable: true, width: '170px' },
    { key: 'message', label: 'Issue', grow: true, sortable: true, render: issueCell },
    { key: 'urls', label: 'URLs', align: 'right', width: '80px', sortable: true, text: (r) => int(r.urls) },
  ];
</script>

{#snippet verdictCell(r: StateRow)}
  <Pill tone={VERDICT_TONE[r.verdict] ?? 'neutral'} icon={r.verdict === 'PENDING' ? null : 'auto'}>{VERDICT_LABEL[r.verdict] ?? r.verdict}</Pill>
{/snippet}

{#snippet urlCell(r: IndexStatusRow)}
  <PathText path={r.url} />
{/snippet}

{#snippet richCell(r: IndexStatusRow)}
  {#if r.richResultsVerdict}
    <Pill tone={r.richResultsVerdict === 'PASS' ? 'ok' : r.richResultsVerdict === 'FAIL' ? 'error' : 'warn'} title={(r.richResultTypes ?? []).join(', ')}>
      {r.richResultsVerdict === 'PASS' ? 'Valid' : r.richResultsVerdict === 'FAIL' ? 'Invalid' : 'Warnings'}
    </Pill>
  {:else}
    <span class="muted">{'—'}</span>
  {/if}
{/snippet}

{#snippet issueCell(r: IssueRow)}
  <span class="issue"><Pill tone={r.severity === 'ERROR' ? 'error' : 'warn'} icon={null}>{r.severity === 'ERROR' ? 'Error' : 'Warning'}</Pill> {r.message}</span>
{/snippet}

<Card
  title="Index coverage"
  subtitle={d ? `${int(d.totals.indexed)} of ${int(d.totals.urls)} sitemap URLs indexed` : undefined}
  subtitlePending={!d && !coverage.error}
  flush
  busy={coverage.loading && Boolean(d)}>
  {#snippet actions()}
    {#if d && d.totals.urls > 0}
      <Segmented label="Show" size="sm" options={VIEWS} value={view} onchange={(v) => (view = v)} />
    {/if}
  {/snippet}
  {#if coverage.error}
    <div class="pad"><ErrorBanner error={coverage.error} retry={coverage.reload} /></div>
  {:else if !d}
    <div class="pad"><Skeleton kind="table" rows={5} /></div>
  {:else if d.totals.urls === 0}
    <EmptyState compact title="No index coverage yet" icon="search">
      <p>
        Searchkeep reads the sitemaps Search Console knows once a day and inspects their URLs with the URL Inspection API, a few at a time with the calls each sync has left over. Submit a sitemap in Search Console if none is listed below.
      </p>
    </EmptyState>
  {:else}
    <div class="summary">
      <SegmentBar label="Sitemap URLs by index status" {parts} />
      <div class="legend num">
        {#each parts as p (p.key)}
          <span><i style:background={p.color}></i>{int(p.value)} {p.label.toLowerCase()}</span>
        {/each}
      </div>
    </div>
    {#if view !== 'rich'}
      <DataTable label="URLs by coverage state" rows={d.states} columns={stateCols} sort={{ key: 'urls', dir: 'desc' }} rowKey={(r) => `${r.verdict}|${r.coverageState}`} limit={8} />
    {/if}
    {#if view === 'rich' && d.richResults.issues.length > 0}
      <DataTable label="Rich result issues" rows={d.richResults.issues} columns={issueCols} sort={{ key: 'urls', dir: 'desc' }} rowKey={(r) => `${r.type}|${r.severity}|${r.message}`} limit={10} />
    {/if}
    {#if rows.length === 0}
      <EmptyState compact title={view === 'rich' ? 'No rich result issues' : 'Every inspected URL is indexed'} icon="check" />
    {:else}
      <DataTable label="Sitemap URLs" {rows} columns={urlCols} rowKey={(r) => r.url} limit={15} />
    {/if}
    {#if d.changes.length > 0}
      <div class="changes">
        <h3>Changed in the last 7 days</h3>
        <ul>
          {#each d.changes.slice(0, 10) as c (c.url)}
            <li><PathText path={c.url} /> <span class="muted">{c.from ?? '—'} → {c.to ?? '—'}</span></li>
          {/each}
        </ul>
      </div>
    {/if}
  {/if}
  {#snippet footer()}
    <Notes notes={d?.notes} />
  {/snippet}
</Card>

<style>
  .pad {
    padding: 4px 16px 16px;
  }
  .summary {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 6px 16px 16px;
    border-bottom: 1px solid var(--border);
  }
  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 2px 14px;
    font-size: 12px;
    color: var(--text-2);
  }
  .legend span {
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }
  .legend i {
    width: 7px;
    height: 7px;
    border-radius: 50%;
  }
  .issue {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }
  .changes {
    padding: 12px 16px 4px;
    border-top: 1px solid var(--border);
  }
  .changes h3 {
    margin: 0 0 8px;
    font-size: 12.5px;
    font-weight: 600;
    color: var(--text-2);
  }
  .changes ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: 12.5px;
  }
  .changes li {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 10px;
    min-width: 0;
  }
</style>
