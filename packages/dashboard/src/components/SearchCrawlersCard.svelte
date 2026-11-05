<script lang="ts">
  import Card from './Card.svelte';
  import DataTable from './DataTable.svelte';
  import EmptyState from './EmptyState.svelte';
  import ErrorBanner from './ErrorBanner.svelte';
  import LineChart from './LineChart.svelte';
  import Notes from './Notes.svelte';
  import PathText from './PathText.svelte';
  import Pill from './Pill.svelte';
  import Segmented from './Segmented.svelte';
  import Skeleton from './Skeleton.svelte';
  import { apiUrl } from '../lib/api';
  import { eachDay, int, percent } from '../lib/format';
  import { resource } from '../lib/resource.svelte';
  import { ui } from '../lib/state.svelte';
  import type { Column } from '../lib/table';
  import type { AiCrawlersResponse, CrawlerRow } from '../lib/types';

  type Group = 'crawler' | 'status' | 'path';
  let group = $state<Group>('crawler');
  const GROUPS: Array<{ value: Group; label: string }> = [
    { value: 'crawler', label: 'Crawler' },
    { value: 'status', label: 'Status' },
    { value: 'path', label: 'Page' },
  ];
  const PURPOSE_LABEL: Record<string, string> = { search: 'Web search', media: 'Images & video', ads: 'Ads', other: 'Other' };

  const range = () => ui.rangeParams({ relativeAll: true });
  const series = resource<AiCrawlersResponse>(() =>
    ui.siteId ? apiUrl('/api/search-crawlers', { site: ui.siteId, ...range(), groupBy: 'date', limit: 500 }) : null,
  );
  const table = resource<AiCrawlersResponse>(() =>
    ui.siteId
      ? apiUrl('/api/search-crawlers', { site: ui.siteId, ...range(), groupBy: group === 'crawler' ? 'crawler,operator,purpose' : group, limit: 100 })
      : null,
  );

  const chart = $derived.by(() => {
    const rows = (series.data?.rows ?? []).filter((r) => r.date);
    if (rows.length < 2) return null;
    const dates = rows.map((r) => r.date!).sort();
    const all = eachDay(dates[0]!, dates[dates.length - 1]!);
    const byDate = new Map(rows.map((r) => [r.date!, r.requests]));
    return { dates: all, values: all.map((d) => byDate.get(d) ?? 0) };
  });
  const total = $derived(series.data?.totalRequests ?? 0);
  const tableTotal = $derived(table.data?.totalRequests ?? 0);
  const maxReq = $derived(Math.max(1, ...(table.data?.rows.map((r) => r.requests) ?? [])));

  const columns = $derived.by((): Column<CrawlerRow>[] => {
    const req: Column<CrawlerRow> = {
      key: 'requests',
      label: 'Requests',
      align: 'right',
      sortable: true,
      width: '130px',
      text: (r) => int(r.requests),
      bar: (r) => ({ value: r.requests, max: maxReq, color: 'var(--chart)' }),
    };
    const share: Column<CrawlerRow> = { key: 'share', label: 'Share', align: 'right', width: '72px', text: (r) => (tableTotal ? percent(r.requests / tableTotal) : '—'), hideOnMobile: true };
    if (group === 'status') return [{ key: 'status', label: 'HTTP status', grow: true, sortable: true, render: statusCell }, req, share];
    if (group === 'path') return [{ key: 'path', label: 'Page', grow: true, sortable: true, render: pathCell }, req, share];
    return [
      { key: 'crawler', label: 'Crawler', grow: true, sortable: true },
      { key: 'operator', label: 'Operator', sortable: true, hideOnMobile: true },
      { key: 'purpose', label: 'Purpose', sortable: true, text: (r) => PURPOSE_LABEL[r.purpose ?? 'other'] ?? r.purpose ?? '—' },
      req,
      share,
    ];
  });
</script>

{#snippet statusCell(r: CrawlerRow)}
  {#if r.status !== undefined}
    <Pill tone={r.status < 300 ? 'ok' : r.status < 400 ? 'neutral' : r.status < 500 ? 'warn' : 'error'} icon={null}>{r.status}</Pill>
  {/if}
{/snippet}

{#snippet pathCell(r: CrawlerRow)}
  <PathText path={r.path} />
{/snippet}

<Card
  title="Search engine crawlers"
  subtitle={series.data ? `${int(total)} requests · Googlebot, Bingbot and others` : undefined}
  subtitlePending={!series.data && !series.error}
  flush
  busy={(series.loading && Boolean(series.data)) || (table.loading && Boolean(table.data))}>
  {#snippet actions()}
    <Segmented label="Group by" size="sm" options={GROUPS} value={group} onchange={(v) => (group = v)} />
  {/snippet}
  {#if series.error}
    <div class="pad"><ErrorBanner error={series.error} retry={series.reload} /></div>
  {:else if !series.data}
    <div class="pad"><Skeleton kind="chart" height={160} /></div>
  {:else if total === 0}
    <EmptyState compact title="No search engine crawler requests recorded" icon="bot">
      <p>They come from Cloudflare, like the AI crawlers: set <code>cloudflareZoneId</code> for this site (the zone must be proxied) and give the API token Zone Analytics Read.</p>
    </EmptyState>
  {:else}
    {#if chart}
      <div class="pad">
        <LineChart dates={chart.dates} series={[{ key: 'requests', label: 'Requests', values: chart.values, color: 'var(--chart)', area: true }]} height={160} label="Search engine crawler requests per day" />
      </div>
    {/if}
    {#if table.error}
      <div class="pad"><ErrorBanner error={table.error} retry={table.reload} /></div>
    {:else if !table.data}
      <div class="pad"><Skeleton kind="table" rows={5} /></div>
    {:else}
      {#key group}
        <DataTable label="Search engine crawler requests by {group}" rows={table.data.rows} {columns} sort={{ key: 'requests', dir: 'desc' }} limit={10} />
      {/key}
    {/if}
  {/if}
  {#snippet footer()}
    <Notes notes={series.data?.notes} />
  {/snippet}
</Card>

<style>
  .pad {
    padding: 4px 16px 16px;
  }
</style>
