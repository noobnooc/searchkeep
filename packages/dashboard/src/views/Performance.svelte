<script lang="ts">
  import Card from '../components/Card.svelte';
  import PathText from '../components/PathText.svelte';
  import DataTable from '../components/DataTable.svelte';
  import EmptyState from '../components/EmptyState.svelte';
  import ErrorBanner from '../components/ErrorBanner.svelte';
  import Icon from '../components/Icon.svelte';
  import LineChart from '../components/LineChart.svelte';
  import Notes from '../components/Notes.svelte';
  import PageHeader from '../components/PageHeader.svelte';
  import Segmented from '../components/Segmented.svelte';
  import Skeleton from '../components/Skeleton.svelte';
  import { apiUrl } from '../lib/api';
  import { toCsv, downloadText } from '../lib/csv';
  import { debounced } from '../lib/debounce.svelte';
  import { compact, decimal, int, monthLabel, percent, rangeLabel, shortDate } from '../lib/format';
  import { resource } from '../lib/resource.svelte';
  import { ui } from '../lib/state.svelte';
  import { compareValues, type Column, type SortState } from '../lib/table';
  import type { Dimension, PerformanceResponse, PerformanceRow, SearchType } from '../lib/types';

  type Metric = 'clicks' | 'impressions' | 'ctr' | 'position';
  const TIME: Dimension[] = ['date', 'week', 'month'];
  const BREAKDOWN: Dimension[] = ['country', 'device'];
  const SEARCH_TYPES: Array<{ value: SearchType; label: string }> = [
    { value: 'web', label: 'Web search' },
    { value: 'image', label: 'Image search' },
    { value: 'video', label: 'Video search' },
    { value: 'news', label: 'News tab' },
    { value: 'discover', label: 'Discover' },
    { value: 'googleNews', label: 'Google News' },
  ];
  /** Discover and Google News report pages only: no queries and no positions. */
  const PAGE_ONLY: SearchType[] = ['discover', 'googleNews'];

  let dim = $state<Dimension>('query');
  let searchType = $state<SearchType>('web');
  let country = $state('');
  let device = $state('');
  let queryText = $state('');
  let pageText = $state('');
  let limit = $state(100);
  let sort = $state<SortState | null>(null);
  let chartMetric = $state<Metric>('clicks');

  const q = debounced(() => queryText.trim(), 300);
  const pg = debounced(() => pageText.trim(), 300);

  const isTime = $derived(TIME.includes(dim));
  const isBreakdown = $derived(BREAKDOWN.includes(dim));
  const isAppearance = $derived(dim === 'appearance');
  /** Search appearance and country/device come without query and page filters. */
  const standalone = $derived(isBreakdown || isAppearance);
  const bing = $derived(ui.source === 'bing');
  const type = $derived<SearchType>(bing ? 'web' : searchType);
  const pageOnly = $derived(PAGE_ONLY.includes(type));
  // Country and device of queries and pages: only for sites with segments (GSC_SEGMENT_SITES).
  const segments = $derived(!bing && type === 'web' && Boolean(ui.site?.sources.segments) && (dim === 'query' || dim === 'page'));
  const cc = debounced(() => country.trim().toLowerCase(), 300);

  // Server-side ordering for metrics; text columns are sorted in the browser.
  const serverOrder = $derived.by(() => {
    if (!sort) return {};
    if (['clicks', 'impressions', 'ctr', 'position'].includes(sort.key)) return { orderBy: sort.key, order: sort.dir };
    if (TIME.includes(sort.key as Dimension)) return { orderBy: 'date', order: sort.dir };
    return {};
  });

  const perf = resource<PerformanceResponse>(() =>
    ui.siteId
      ? apiUrl('/api/performance', {
          site: ui.siteId,
          source: ui.source,
          ...ui.rangeParams(),
          dimensions: dim,
          searchType: type === 'web' ? undefined : type,
          brand: standalone || pageOnly ? undefined : ui.brand,
          queryContains: standalone || pageOnly ? undefined : q.value,
          pageContains: standalone ? undefined : pg.value,
          country: segments ? cc.value : undefined,
          device: segments ? device : undefined,
          limit: isTime ? 500 : limit,
          ...serverOrder,
        })
      : null,
  );
  const d = $derived(perf.data);

  const rows = $derived.by(() => {
    const r = d?.rows ?? [];
    if (!sort || ['clicks', 'impressions', 'ctr', 'position', 'date', 'week', 'month'].includes(sort.key)) return r;
    const s = sort;
    return [...r].sort((a, b) => compareValues(a[s.key as keyof PerformanceRow], b[s.key as keyof PerformanceRow]) * (s.dir === 'asc' ? 1 : -1));
  });

  const DIMS: Array<{ value: Dimension; label: string }> = [
    { value: 'query', label: 'Query' },
    { value: 'page', label: 'Page' },
    { value: 'country', label: 'Country' },
    { value: 'device', label: 'Device' },
    { value: 'appearance', label: 'Appearance' },
    { value: 'date', label: 'Day' },
    { value: 'week', label: 'Week' },
    { value: 'month', label: 'Month' },
  ];
  /** Why a breakdown is not available for the current source and search type, if it is not. */
  function unavailable(d: Dimension): string | null {
    if (bing && BREAKDOWN.includes(d)) return 'Bing does not provide country or device breakdowns';
    if (bing && d === 'appearance') return 'Bing does not report search appearance';
    if (type !== 'web' && (BREAKDOWN.includes(d) || d === 'appearance')) return 'Available for web search only';
    if (pageOnly && d === 'query') return 'Discover and Google News report pages, not queries';
    return null;
  }
  const dimOptions = $derived(
    DIMS.map((o) => {
      const why = unavailable(o.value);
      return why ? { ...o, disabled: true, title: why } : o;
    }),
  );

  $effect(() => {
    if (unavailable(dim)) dim = pageOnly ? 'page' : 'query';
  });

  function setDim(v: Dimension) {
    dim = v;
    sort = null;
  }

  function dimText(r: PerformanceRow): string {
    switch (dim) {
      case 'date':
        return shortDate(r.date, true);
      case 'week':
        return `Week of ${shortDate(r.week, true)}`;
      case 'month':
        return r.month ? monthLabel(r.month) : '—';
      case 'country':
        return (r.country ?? '').toUpperCase() || '—';
      case 'device': {
        const v = (r.device ?? '').toLowerCase();
        return v ? v.charAt(0).toUpperCase() + v.slice(1) : '—';
      }
      case 'appearance': {
        const v = (r.appearance ?? '').toLowerCase().replace(/_/g, ' ');
        return v ? v.charAt(0).toUpperCase() + v.slice(1) : '—';
      }
      default:
        return (r[dim] as string | undefined) ?? '—';
    }
  }

  const maxClicks = $derived(Math.max(1, ...rows.map((r) => r.clicks)));
  const columns = $derived<Column<PerformanceRow>[]>([
    {
      key: dim,
      label: DIMS.find((x) => x.value === dim)!.label,
      grow: true,
      sortable: true,
      text: dimText,
      ...(dim === 'page' ? { render: pathCell } : {}),
    },
    { key: 'clicks', label: 'Clicks', align: 'right', sortable: true, width: '110px', text: (r) => int(r.clicks), bar: (r) => ({ value: r.clicks, max: maxClicks }) },
    { key: 'impressions', label: 'Impressions', align: 'right', sortable: true, width: '110px', text: (r) => int(r.impressions) },
    { key: 'ctr', label: 'CTR', align: 'right', sortable: true, width: '80px', text: (r) => percent(r.ctr) },
    { key: 'position', label: 'Position', align: 'right', sortable: true, width: '90px', text: (r) => decimal(r.position, 1) },
  ]);

  const chart = $derived.by(() => {
    if (!isTime || !d || d.rows.length < 2) return null;
    const sortedRows = [...d.rows].sort((a, b) => compareValues(a[dim as 'date'], b[dim as 'date']));
    return {
      dates: sortedRows.map((r) => (dim === 'month' ? `${r.month}-01` : ((r[dim as 'date'] as string) ?? ''))),
      values: sortedRows.map((r) => (chartMetric === 'ctr' ? r.ctr * 100 : (r[chartMetric] ?? null))),
    };
  });

  function download() {
    if (!d) return;
    const header = [dim, 'clicks', 'impressions', 'ctr', 'position'];
    const body = rows.map((r) => [r[dim as keyof PerformanceRow] ?? '', r.clicks, r.impressions, r.ctr, r.position ?? '']);
    const kind = type === 'web' ? d.source : `${d.source}-${type}`;
    downloadText(`searchkeep-${d.site}-${kind}-${dim}-${d.range.start}-to-${d.range.end}.csv`, toCsv(header, body));
  }
</script>

{#snippet pathCell(r: PerformanceRow)}
  <PathText path={r.page} />
{/snippet}

<PageHeader title="Performance" meta={d ? rangeLabel(d.range) : perf.error ? null : undefined} source brand />

<div class="stack">
  <div class="toolbar" role="group" aria-label="Breakdown and filters">
    {#if !bing}
      <label class="limit">
        <span class="sr-only">Search type</span>
        <select class="select" bind:value={searchType}>
          {#each SEARCH_TYPES as t (t.value)}
            <option value={t.value}>{t.label}</option>
          {/each}
        </select>
      </label>
    {/if}
    <Segmented label="Group by" options={dimOptions} value={dim} onchange={setDim} />
    <label class="search" title={standalone ? 'Search Console reports this separately from queries and pages' : pageOnly ? 'Discover and Google News report pages, not queries' : undefined}>
      <Icon name="search" size={14} />
      <span class="sr-only">Query contains</span>
      <input class="input" type="search" placeholder="Query contains…" bind:value={queryText} disabled={standalone || pageOnly} />
    </label>
    <label class="search" title={standalone ? 'Search Console reports this separately from queries and pages' : undefined}>
      <Icon name="file" size={14} />
      <span class="sr-only">Page contains</span>
      <input class="input" type="search" placeholder="Page contains…" bind:value={pageText} disabled={standalone} />
    </label>
    {#if segments}
      <label class="search narrow" title="ISO 3166-1 alpha-3 country code, e.g. usa">
        <Icon name="globe" size={14} />
        <span class="sr-only">Country</span>
        <input class="input" type="search" placeholder="Country (usa)…" bind:value={country} maxlength="3" />
      </label>
      <label class="limit">
        <span class="sr-only">Device</span>
        <select class="select" bind:value={device}>
          <option value="">All devices</option>
          <option value="DESKTOP">Desktop</option>
          <option value="MOBILE">Mobile</option>
          <option value="TABLET">Tablet</option>
        </select>
      </label>
    {/if}
    <span class="spacer"></span>
    {#if !isTime}
      <label class="limit">
        <span class="sr-only">Rows</span>
        <select class="select" bind:value={limit}>
          <option value={50}>50 rows</option>
          <option value={100}>100 rows</option>
          <option value={250}>250 rows</option>
          <option value={500}>500 rows</option>
        </select>
      </label>
    {/if}
    <button class="btn" onclick={download} disabled={!d || rows.length === 0}><Icon name="download" size={14} /> CSV</button>
  </div>

  {#if standalone && (ui.brand !== 'all' || queryText || pageText)}
    <p class="hint"><Icon name="info" size={13} /> Brand, query and page filters don’t apply to {isAppearance ? 'search appearance' : 'country and device'}.</p>
  {/if}

  {#if perf.error}
    <ErrorBanner error={perf.error} retry={perf.reload} />
  {:else}
    {#if isTime}
      <Card title="Trend" busy={perf.loading && Boolean(d)}>
        {#snippet actions()}
          <Segmented
            label="Chart metric"
            size="sm"
            options={[
              { value: 'clicks', label: 'Clicks' },
              { value: 'impressions', label: 'Impressions' },
              { value: 'ctr', label: 'CTR' },
              { value: 'position', label: 'Position' },
            ]}
            value={chartMetric}
            onchange={(v) => (chartMetric = v)} />
        {/snippet}
        {#if !d}
          <Skeleton kind="chart" height={200} />
        {:else if chart}
          <LineChart
            dates={chart.dates}
            series={[{ key: chartMetric, label: chartMetric === 'ctr' ? 'CTR' : chartMetric === 'position' ? 'Avg. position' : chartMetric[0]!.toUpperCase() + chartMetric.slice(1), values: chart.values, color: 'var(--chart)', area: chartMetric !== 'position' }]}
            height={200}
            format={chartMetric === 'ctr' ? (n) => `${decimal(n, 1)}%` : chartMetric === 'position' ? (n) => decimal(n, 0) : compact}
            valueFormat={chartMetric === 'ctr' ? (n) => `${decimal(n, 2)}%` : chartMetric === 'position' ? (n) => decimal(n, 1) : int}
            xLabel={dim === 'month' ? (x) => monthLabel(x) : undefined}
            tipTitle={dim === 'week' ? (x) => `Week of ${shortDate(x, true)}` : dim === 'month' ? (x) => monthLabel(x) : undefined}
            label="{chartMetric} by {dim}" />
          {#if chartMetric === 'position'}<p class="hint small">Lower is better.</p>{/if}
        {:else}
          <EmptyState compact title="Not enough points to draw a trend" icon="performance" />
        {/if}
      </Card>
    {/if}

    <Card flush busy={perf.loading && Boolean(d)}>
      {#if !d}
        <div class="pad"><Skeleton kind="table" rows={10} /></div>
      {:else if rows.length === 0}
        <EmptyState compact title="No rows for these filters" icon="search">
          <p>Try a longer range or fewer filters.</p>
        </EmptyState>
      {:else}
        <DataTable label="Search performance by {dim}" {rows} {columns} {sort} onsort={(s) => (sort = s)} limit={100} rowKey={(r, i) => `${dimText(r)}|${i}`} />
      {/if}
      {#snippet footer()}
        <div class="foot">
          <span class="num">{d ? `${int(rows.length)} rows` : ''}</span>
          <Notes notes={d?.notes} />
        </div>
      {/snippet}
    </Card>
  {/if}
</div>

<style>
  .toolbar {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .search {
    position: relative;
    display: flex;
    align-items: center;
    flex: 0 1 200px;
    min-width: 150px;
  }
  .search :global(.icon) {
    position: absolute;
    left: 9px;
    color: var(--text-3);
    pointer-events: none;
  }
  .search .input {
    width: 100%;
    padding-left: 30px;
  }
  .search .input:disabled {
    opacity: 0.5;
  }
  .search.narrow {
    flex: 0 1 140px;
    min-width: 120px;
  }
  .hint {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12.5px;
    color: var(--text-3);
  }
  .hint.small {
    margin-top: 6px;
  }
  .pad {
    padding: 4px 16px 16px;
  }
  .foot {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  @media (max-width: 640px) {
    .search {
      flex: 1 1 100%;
    }
    .spacer {
      display: none;
    }
  }
</style>
