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
  import { change, CHART_LABEL, STORE_LABEL } from '../lib/apps';
  import { compact, eachDay, int, pctChange, percent, rangeLabel } from '../lib/format';
  import { resource } from '../lib/resource.svelte';
  import { href } from '../lib/router.svelte';
  import { ui } from '../lib/state.svelte';
  import type { AppMetrics, AppPerformanceResponse, AppStore } from '../lib/types';

  const perf = resource<AppPerformanceResponse>(() => (ui.appId ? apiUrl('/api/app-performance', { app: ui.appId, ...ui.appRangeParams() }) : null));
  const app = $derived(ui.app);
  const reports = $derived(app?.appStoreReports);
  const needsStart = $derived(Boolean(app?.appleId && app.stores.appStore && reports && (!reports.started || reports.stopped)));

  interface Kpi {
    label: string;
    key: keyof AppMetrics;
    rate?: boolean;
  }
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

  function stat(k: Kpi, cur: AppMetrics, prev: AppMetrics) {
    const c = cur[k.key];
    const p = prev[k.key];
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

    {#if perf.data.charts?.length}
      <Card title="App Store charts" subtitle="Your app's position in Apple's public top charts (opt-in)">
        <ul class="charts">
          {#each perf.data.charts as c (`${c.territory}-${c.chart}-${c.genre}`)}
            <li>
              <span class="where">{c.territory} · {CHART_LABEL[c.chart] ?? c.chart}{c.genre ? ' (category)' : ''}</span>
              {#if c.rank}<Pill tone="ok">#{c.rank}</Pill>{:else}<span class="muted">Not in the top 100</span>{/if}
            </li>
          {/each}
        </ul>
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
  .charts {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 8px 16px;
  }
  .charts li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    font-size: 13px;
  }
  @media (max-width: 640px) {
    .callout {
      flex-direction: column;
      align-items: flex-start;
    }
  }
</style>
