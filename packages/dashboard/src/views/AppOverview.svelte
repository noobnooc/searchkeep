<script lang="ts">
  import Card from '../components/Card.svelte';
  import EmptyState from '../components/EmptyState.svelte';
  import ErrorBanner from '../components/ErrorBanner.svelte';
  import Icon from '../components/Icon.svelte';
  import LineChart from '../components/LineChart.svelte';
  import Notes from '../components/Notes.svelte';
  import PageHeader from '../components/PageHeader.svelte';
  import Pill from '../components/Pill.svelte';
  import Skeleton from '../components/Skeleton.svelte';
  import Stat, { delta } from '../components/Stat.svelte';
  import { apiUrl } from '../lib/api';
  import { change, CHART_LABEL, regionName, STORE_LABEL } from '../lib/apps';
  import { compact, decimal, duration, eachDay, int, money, pctChange, percent, rangeLabel, shortDate } from '../lib/format';
  import { resource } from '../lib/resource.svelte';
  import { href } from '../lib/router.svelte';
  import { ui } from '../lib/state.svelte';
  import type { AppChartRank, AppMetrics, AppPerformanceResponse, AppStore } from '../lib/types';

  const perf = resource<AppPerformanceResponse>(() => (ui.appId ? apiUrl('/api/app-performance', { app: ui.appId, ...ui.appRangeParams() }) : null));
  const app = $derived(ui.app);
  const reports = $derived(app?.appStoreReports);
  const needsStart = $derived(Boolean(app?.appleId && app.stores.appStore && reports && (!reports.started || reports.stopped)));

  // Chart positions as a storefront × chart table, storefronts in the order the API ranks them.
  const chartTable = $derived.by(() => {
    const list = perf.data?.charts ?? [];
    if (!list.length) return null;
    const columns: Array<{ key: string; chart: string; scope: string; category: boolean }> = [];
    const rows: Array<{ territory: string; cells: Map<string, AppChartRank> }> = [];
    for (const c of list) {
      const key = `${c.chart}|${c.genre}`;
      if (!columns.some((x) => x.key === key))
        columns.push({ key, chart: CHART_LABEL[c.chart] ?? c.chart, scope: c.genre ? (c.genreName ?? 'Category') : 'All apps', category: Boolean(c.genre) });
      let row = rows.find((r) => r.territory === c.territory);
      if (!row) rows.push((row = { territory: c.territory, cells: new Map() }));
      row.cells.set(key, c);
    }
    columns.sort((a, b) => Number(a.category) - Number(b.category) || a.chart.localeCompare(b.chart));
    return { columns, rows, ranked: list.some((c) => c.rank), checked: list.reduce((d, c) => (c.date > d ? c.date : d), '') };
  });

  function movement(c: AppChartRank): { text: string; tone: 'up' | 'down' | ''; title: string } | null {
    if (!c.previous || !c.rank) return null;
    const on = `Since ${shortDate(c.previous.date)}`;
    if (!c.previous.rank) return { text: 'new', tone: 'up', title: `${on}: not in the top 100 before` };
    const d = c.previous.rank - c.rank;
    if (d === 0) return null;
    return d > 0 ? { text: `↑${d}`, tone: 'up', title: `${on}: was #${c.previous.rank}` } : { text: `↓${-d}`, tone: 'down', title: `${on}: was #${c.previous.rank}` };
  }

  interface Kpi {
    label: string;
    key: keyof AppMetrics;
    rate?: boolean;
    /** How the value reads: an amount in the store's currency, a duration, or a plain ratio. */
    format?: 'money' | 'duration' | 'ratio';
  }
  /** Revenue and sessions (ADR 0010), shown for a store once it reports any. */
  const VALUE_KPIS: Kpi[] = [
    { label: 'Proceeds', key: 'proceeds', format: 'money' },
    { label: 'Paying users', key: 'payingUsers' },
    { label: 'Proceeds per download', key: 'proceedsPerDownload', format: 'money' },
    { label: 'Sessions', key: 'sessions' },
    { label: 'Average session', key: 'averageSessionSeconds', format: 'duration' },
    { label: 'Sessions per device', key: 'sessionsPerDevice', format: 'ratio' },
  ];
  const hasValue = (m: AppMetrics) => m.proceedsCents !== 0 || m.purchases !== 0 || m.sessions > 0;
  const KPIS: Record<AppStore, Kpi[]> = {
    apple: [
      { label: 'Impressions', key: 'impressions' },
      { label: 'Product page views', key: 'pageViews' },
      { label: 'First-time downloads', key: 'downloads' },
      { label: 'Conversion', key: 'impressionConversion', rate: true },
      { label: 'Redownloads', key: 'redownloads' },
      { label: 'Deletions', key: 'deletions' },
    ],
    play: [
      { label: 'Store listing visitors', key: 'pageViewsUnique' },
      { label: 'Acquisitions', key: 'downloads' },
      { label: 'Conversion', key: 'pageConversion', rate: true },
      { label: 'Device installs', key: 'installs' },
      { label: 'Uninstalls', key: 'deletions' },
      { label: 'Active devices', key: 'activeDevices' },
    ],
  };

  function stat(k: Kpi, cur: AppMetrics, prev: AppMetrics, currency: string | null = null) {
    const c = cur[k.key];
    const p = prev[k.key];
    if (k.format) {
      const show = (v: number | null) =>
        k.format === 'money' ? (currency ? money(v, currency, true) : decimal(v, 2)) : k.format === 'duration' ? duration(v) : decimal(v, 2);
      const ch = c === null || p === null ? null : change(c as number, p as number);
      return { value: show(c as number | null), delta: delta(ch === null ? null : ch * 100, pctChange(ch === null ? null : ch * 100), true, 0.05), sub: `vs ${show(p as number | null)}` };
    }
    if (k.rate) {
      const pp = c !== null && p !== null ? (Number(c) - Number(p)) * 100 : null;
      return { value: percent(c as number | null), delta: delta(pp, pp === null ? '' : `${pp >= 0 ? '+' : '−'}${Math.abs(pp).toFixed(1)} pp`, true, 0.05), sub: `vs ${percent(p as number | null)}` };
    }
    const ch = change(c as number, p as number);
    const lower = k.key === 'deletions';
    return { value: compact(c as number), delta: delta(ch === null ? null : ch * 100, pctChange(ch === null ? null : ch * 100), !lower, 0.05), sub: `vs ${compact(p as number)}` };
  }

  const stores = $derived(perf.data?.stores ?? []);
  function trend(store: AppStore) {
    const s = stores.find((x) => x.store === store);
    const range = perf.data?.range;
    if (!s || !range || s.series.length === 0) return null;
    const by = new Map(s.series.map((r) => [r.date, r]));
    const dates = eachDay(range.start, range.end);
    const views = store === 'apple' ? 'pageViews' : 'pageViewsUnique';
    return {
      dates,
      series: [
        { key: 'downloads', label: store === 'apple' ? 'First-time downloads' : 'Acquisitions', values: dates.map((d) => by.get(d)?.downloads ?? null), color: 'var(--chart)', area: true },
        { key: 'views', label: store === 'apple' ? 'Product page views' : 'Store listing visitors', values: dates.map((d) => by.get(d)?.[views] ?? null), color: 'var(--prev)' },
      ],
    };
  }
</script>

<PageHeader title={app?.name ?? 'App'} description="Store funnel" meta={perf.data ? rangeLabel(perf.data.range) : perf.error ? null : undefined} />

{#if needsStart}
  <div class="callout" role="status">
    <Icon name="info" size={15} />
    <div>
      <strong>{reports?.stopped ? 'Apple stopped the App Store reports for this app.' : 'App Store reports are not started for this app yet.'}</strong>
      <span>Apple generates them only after a one-time request with an Admin key. Searchkeep uses that key once and never stores it.</span>
    </div>
    <a class="btn sm primary" href={href('settings', 'apps')}>Start App Store reports</a>
  </div>
{/if}

{#if perf.error}
  <ErrorBanner error={perf.error} retry={perf.reload} />
{:else if !perf.data}
  <div class="stack">
    <Card title="App Store"><Skeleton kind="stats" /></Card>
    <Card title="Google Play"><Skeleton kind="stats" /></Card>
  </div>
{:else if stores.length === 0}
  <Card>
    <EmptyState title="No store connected for this app" icon="plus">
      <p>Set up App Store Connect or Google Play in Settings, then the sync fills this in.</p>
      {#snippet actions()}<a class="btn" href={href('settings', 'apps')}><Icon name="settings" size={14} /> Apps settings</a>{/snippet}
    </EmptyState>
  </Card>
{:else}
  <div class="stack">
    {#each stores as s (s.store)}
      {@const t = trend(s.store)}
      <Card title={STORE_LABEL[s.store]} subtitle={s.store === 'apple' ? 'Impressions → product page → first-time download' : 'Store listing visitors → acquisitions'} busy={perf.loading}>
        <div class="kpis">
          {#each KPIS[s.store] as k (k.key)}
            {@const st = stat(k, s.current, s.previous)}
            <Stat label={k.label} value={st.value} delta={st.delta} sub={st.sub} />
          {/each}
        </div>
        {#if hasValue(s.current) || hasValue(s.previous)}
          <h3 class="kpi-group">Revenue and usage{s.currency ? ` · ${s.currency}` : ''}</h3>
          <div class="kpis">
            {#each VALUE_KPIS as k (k.key)}
              {@const st = stat(k, s.current, s.previous, s.currency)}
              <Stat label={k.label} value={st.value} delta={st.delta} sub={st.sub} />
            {/each}
          </div>
        {/if}
        {#if t}
          <div class="trend">
            <LineChart dates={t.dates} series={t.series} height={170} label="{STORE_LABEL[s.store]} per day" valueFormat={(n) => int(n)} />
          </div>
        {:else}
          <EmptyState compact title="No data in this range yet" icon="sync">
            <p>{s.store === 'apple' ? 'App Store reports arrive 2-5 days late.' : 'Google Play files arrive 3-7 days late.'}</p>
          </EmptyState>
        {/if}
      </Card>
    {/each}

    {#if chartTable}
      <Card title="App Store charts" subtitle="Your app's place in Apple's top 100 charts, checked {shortDate(chartTable.checked)}">
        {#if !chartTable.ranked}
          <p class="charts-none">Not in the top 100 of any chart checked yet.</p>
        {/if}
        <div class="charts-wrap">
          <table class="charts" aria-label="App Store chart positions per storefront">
            <thead>
              <tr>
                <th scope="col">Storefront</th>
                {#each chartTable.columns as col (col.key)}
                  <th scope="col"><span class="chart-name">{col.chart}</span> <span class="chart-scope">{col.scope}</span></th>
                {/each}
              </tr>
            </thead>
            <tbody>
              {#each chartTable.rows as row (row.territory)}
                <tr>
                  <th scope="row"><span class="region">{regionName(row.territory)}</span> <span class="code">{row.territory}</span></th>
                  {#each chartTable.columns as col (col.key)}
                    {@const c = row.cells.get(col.key)}
                    <td>
                      {#if !c}
                        <span class="muted" title="Not checked in this storefront">·</span>
                      {:else if c.rank}
                        <Pill tone="ok" icon={null}>#{c.rank}</Pill>
                        {@const m = movement(c)}
                        {#if m}<span class="move {m.tone}" title={m.title}>{m.text}</span>{/if}
                      {:else}
                        <span class="muted" title="Not in the top 100">—</span>
                        {#if c.previous?.rank}<span class="move" title="On {shortDate(c.previous.date)}">was #{c.previous.rank}</span>{/if}
                      {/if}
                    </td>
                  {/each}
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
        <p class="charts-foot">— means not in the top 100. Free apps are checked in the free charts, paid apps in the paid ones.</p>
      </Card>
    {/if}

    <Notes notes={perf.data.notes} />
  </div>
{/if}

<style>
  .kpis {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 12px;
  }
  .trend {
    margin-top: 16px;
  }
  .kpi-group {
    margin: 18px 0 10px;
    font-size: 12px;
    font-weight: 500;
    color: var(--text-3);
  }
  .callout {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 14px;
    margin-bottom: 16px;
    border-radius: 10px;
    border: 1px solid var(--border);
    background: var(--surface);
    font-size: 13px;
  }
  .callout div {
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex: 1;
  }
  .callout span {
    color: var(--text-3);
  }
  .charts-none {
    margin: 0 0 10px;
    font-size: 13px;
    color: var(--text-2);
  }
  .charts-wrap {
    overflow-x: auto;
  }
  .charts {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
  }
  .charts thead th {
    text-align: left;
    font-weight: 500;
    font-size: 12px;
    color: var(--text-3);
    padding: 0 16px 8px 0;
    border-bottom: 1px solid var(--border);
    white-space: nowrap;
  }
  .chart-scope {
    color: var(--text-4);
  }
  .chart-scope::before {
    content: '· ';
  }
  .charts tbody th,
  .charts td {
    text-align: left;
    padding: 9px 16px 9px 0;
    border-bottom: 1px solid var(--border);
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }
  .charts tbody tr:last-child th,
  .charts tbody tr:last-child td {
    border-bottom: 0;
  }
  .charts tbody th {
    font-weight: 500;
  }
  .code {
    margin-left: 4px;
    font-family: var(--mono);
    font-size: 11px;
    color: var(--text-4);
  }
  .move {
    margin-left: 6px;
    font-size: 12px;
    color: var(--text-3);
  }
  .move.up {
    color: var(--pos);
  }
  .move.down {
    color: var(--neg);
  }
  .charts-foot {
    margin: 10px 0 0;
    font-size: 12px;
    color: var(--text-4);
  }
  @media (max-width: 640px) {
    .callout {
      flex-direction: column;
      align-items: flex-start;
    }
    .charts thead th {
      white-space: normal;
      vertical-align: bottom;
    }
    .chart-scope {
      display: block;
    }
    .chart-scope::before {
      content: none;
    }
    .charts tbody th,
    .charts td {
      padding-right: 12px;
    }
    .code {
      display: none;
    }
  }
</style>
