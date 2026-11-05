<script lang="ts">
  import Card from '../components/Card.svelte';
  import PathText from '../components/PathText.svelte';
  import DataTable from '../components/DataTable.svelte';
  import EmptyState from '../components/EmptyState.svelte';
  import ErrorBanner from '../components/ErrorBanner.svelte';
  import Notes from '../components/Notes.svelte';
  import PageHeader from '../components/PageHeader.svelte';
  import Pill from '../components/Pill.svelte';
  import SegmentBar from '../components/SegmentBar.svelte';
  import Segmented from '../components/Segmented.svelte';
  import Skeleton from '../components/Skeleton.svelte';
  import StackedBars, { type StackKey } from '../components/StackedBars.svelte';
  import { apiUrl } from '../lib/api';
  import { eachDay, int, percent, rangeLabel, shortDate } from '../lib/format';
  import { resource } from '../lib/resource.svelte';
  import { ui } from '../lib/state.svelte';
  import type { Column } from '../lib/table';
  import type { AiCrawlersResponse, CrawlerGroup, CrawlerPurpose, CrawlerRow } from '../lib/types';

  const PURPOSES: Array<StackKey & { key: CrawlerPurpose; text: string }> = [
    { key: 'training', label: 'Training', color: 'var(--series-training)', text: 'Collects content to train models' },
    { key: 'search', label: 'AI search', color: 'var(--series-search)', text: 'Builds indexes for AI search and answers' },
    { key: 'user', label: 'User fetch', color: 'var(--series-user)', text: 'Fetches a page because a user asked an assistant' },
    { key: 'other', label: 'Other', color: 'var(--series-other)', text: 'Unclassified AI agents' },
  ];
  const purposeOf = (p: string | undefined) => PURPOSES.find((x) => x.key === p);

  let group = $state<CrawlerGroup>('crawler');
  const GROUPS: Array<{ value: CrawlerGroup; label: string }> = [
    { value: 'crawler', label: 'Crawler' },
    { value: 'operator', label: 'Operator' },
    { value: 'purpose', label: 'Purpose' },
    { value: 'path', label: 'Page' },
    { value: 'status', label: 'Status' },
    { value: 'date', label: 'Day' },
  ];

  const range = () => ui.rangeParams({ relativeAll: true });
  const series = resource<AiCrawlersResponse>(() => (ui.siteId ? apiUrl('/api/ai-crawlers', { site: ui.siteId, ...range(), groupBy: 'purpose,date', limit: 500 }) : null));
  const table = resource<AiCrawlersResponse>(() =>
    ui.siteId ? apiUrl('/api/ai-crawlers', { site: ui.siteId, ...range(), groupBy: group === 'crawler' ? 'crawler,operator,purpose' : group, limit: group === 'date' ? 500 : 100 }) : null,
  );

  const chart = $derived.by(() => {
    const rows = series.data?.rows ?? [];
    if (rows.length === 0) return null;
    const dates = rows.map((r) => r.date!).filter(Boolean).sort();
    const all = eachDay(dates[0]!, dates[dates.length - 1]!);
    const byDate = new Map<string, Record<string, number>>(all.map((d) => [d, {}]));
    const totals: Record<string, number> = {};
    for (const r of rows) {
      if (!r.date) continue;
      const rec = byDate.get(r.date);
      const k = r.purpose ?? 'other';
      if (rec) rec[k] = (rec[k] ?? 0) + r.requests;
      totals[k] = (totals[k] ?? 0) + r.requests;
    }
    return { dates: all, values: all.map((d) => byDate.get(d)!), totals, start: all[0]!, end: all[all.length - 1]! };
  });
  // Purposes with no requests are left out; each purpose keeps its own color.
  const shown = $derived(chart ? PURPOSES.filter((p) => (chart.totals[p.key] ?? 0) > 0) : PURPOSES);
  const total = $derived(series.data?.totalRequests ?? 0);
  const truncated = $derived((series.data?.rows.length ?? 0) >= 500);

  const maxReq = $derived(Math.max(1, ...(table.data?.rows.map((r) => r.requests) ?? [])));
  const tableTotal = $derived(table.data?.totalRequests ?? 0);

  const columns = $derived.by((): Column<CrawlerRow>[] => {
    const req: Column<CrawlerRow> = {
      key: 'requests',
      label: 'Requests',
      align: 'right',
      sortable: true,
      width: '130px',
      text: (r) => int(r.requests),
      bar: (r) => ({ value: r.requests, max: maxReq, color: purposeOf(r.purpose)?.color ?? 'var(--chart)' }),
    };
    const share: Column<CrawlerRow> = { key: 'share', label: 'Share', align: 'right', width: '72px', text: (r) => (tableTotal ? percent(r.requests / tableTotal) : '—'), hideOnMobile: true };
    switch (group) {
      case 'crawler':
        return [
          { key: 'crawler', label: 'Crawler', grow: true, sortable: true },
          { key: 'operator', label: 'Operator', sortable: true, hideOnMobile: true },
          { key: 'purpose', label: 'Purpose', sortable: true, render: purposeCell },
          req,
          share,
        ];
      case 'purpose':
        return [{ key: 'purpose', label: 'Purpose', grow: true, sortable: true, render: purposeCell }, req, share];
      case 'path':
        return [{ key: 'path', label: 'Page', grow: true, sortable: true, render: pathCell }, req, share];
      case 'status':
        return [{ key: 'status', label: 'HTTP status', grow: true, sortable: true, render: statusCell }, req, share];
      case 'date':
        return [{ key: 'date', label: 'Day', grow: true, sortable: true, text: (r) => shortDate(r.date, true) }, req, share];
      default:
        return [{ key: 'operator', label: 'Operator', grow: true, sortable: true }, req, share];
    }
  });
</script>

{#snippet purposeCell(r: CrawlerRow)}
  {@const p = purposeOf(r.purpose)}
  <span class="purpose"><i style:background={p?.color ?? 'var(--text-4)'}></i>{p?.label ?? r.purpose ?? 'Unknown'}</span>
{/snippet}

{#snippet pathCell(r: CrawlerRow)}
  <PathText path={r.path} />
{/snippet}

{#snippet statusCell(r: CrawlerRow)}
  {#if r.status !== undefined}
    <Pill tone={r.status < 300 ? 'ok' : r.status < 400 ? 'neutral' : r.status < 500 ? 'warn' : 'error'} icon={null}>{r.status}</Pill>
  {/if}
{/snippet}

<PageHeader title="AI crawlers" meta={chart ? rangeLabel({ start: chart.start, end: chart.end }) : series.error || series.data ? null : undefined} />

{#if series.error}
  <ErrorBanner error={series.error} retry={series.reload} />
{:else}
  <div class="stack">
    <Card title="Requests by purpose" subtitle={series.data ? `${int(total)} requests` : undefined} subtitlePending={!series.data && !series.error} busy={series.loading && Boolean(series.data)}>
      {#snippet actions()}
        {#if chart}
          <ul class="legend" aria-label="Legend">
            {#each shown as p (p.key)}
              <li title={p.text}><i style:background={p.color}></i>{p.label} <span class="num">{int(chart.totals[p.key] ?? 0)}</span></li>
            {/each}
          </ul>
        {/if}
      {/snippet}
      {#if !series.data}
        <Skeleton kind="chart" height={220} />
      {:else if !chart}
        <EmptyState title="No AI crawler requests recorded" icon="bot">
          <p>Searchkeep reads AI crawler traffic from Cloudflare. Set <code>cloudflareZoneId</code> for this site (the zone must be proxied, orange cloud) and give the API token Zone Analytics Read.</p>
        </EmptyState>
      {:else}
        <StackedBars dates={chart.dates} keys={shown} values={chart.values} height={220} label="AI crawler requests per day, stacked by purpose" />
        <div class="mix">
          <SegmentBar label="Share of requests by purpose" parts={shown.map((p) => ({ key: p.key, label: p.label, value: chart.totals[p.key] ?? 0, color: p.color }))} height={6} />
        </div>
      {/if}
      {#snippet footer()}
        <Notes notes={[...(series.data?.notes ?? []), ...(truncated ? ['Only the 500 largest purpose × day buckets are shown; choose a shorter range for every day.'] : [])]} />
        {#if !series.data?.notes.length && !truncated}<span>Purposes follow each operator’s own documentation. Cloudflare keeps about 30 days of history; Searchkeep keeps everything it has synced.</span>{/if}
      {/snippet}
    </Card>

    <Card title="Breakdown" flush busy={table.loading && Boolean(table.data)}>
      {#snippet actions()}
        <Segmented label="Group by" size="sm" options={GROUPS} value={group} onchange={(v) => (group = v)} />
      {/snippet}
      {#if table.error}
        <div class="pad"><ErrorBanner error={table.error} retry={table.reload} /></div>
      {:else if !table.data}
        <div class="pad"><Skeleton kind="table" rows={8} /></div>
      {:else if table.data.rows.length === 0}
        <EmptyState compact title="Nothing to break down yet" icon="bot" />
      {:else}
        {#key group}
          <DataTable label="AI crawler requests by {group}" rows={table.data.rows} {columns} sort={group === 'date' ? { key: 'date', dir: 'desc' } : { key: 'requests', dir: 'desc' }} limit={25} />
        {/key}
      {/if}
    </Card>
  </div>
{/if}

<style>
  .legend {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 4px 14px;
    font-size: 12px;
    color: var(--text-2);
  }
  .legend li {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .legend .num {
    color: var(--text-3);
  }
  .legend i,
  .purpose i {
    width: 8px;
    height: 8px;
    border-radius: 2px;
    display: inline-block;
    flex: none;
  }
  .purpose {
    display: inline-flex;
    align-items: center;
    gap: 7px;
  }
  .mix {
    margin-top: 14px;
  }
  .pad {
    padding: 4px 16px 16px;
  }
</style>
