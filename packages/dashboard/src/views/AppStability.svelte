<script lang="ts">
  import Card from '../components/Card.svelte';
  import DataTable from '../components/DataTable.svelte';
  import EmptyState from '../components/EmptyState.svelte';
  import ErrorBanner from '../components/ErrorBanner.svelte';
  import LineChart from '../components/LineChart.svelte';
  import Notes from '../components/Notes.svelte';
  import PageHeader from '../components/PageHeader.svelte';
  import Skeleton from '../components/Skeleton.svelte';
  import Stat from '../components/Stat.svelte';
  import { apiUrl } from '../lib/api';
  import { STORE_LABEL } from '../lib/apps';
  import { eachDay, int, percent, rangeLabel } from '../lib/format';
  import { resource } from '../lib/resource.svelte';
  import { ui } from '../lib/state.svelte';
  import type { Column } from '../lib/table';
  import type { AppStabilityResponse, AppStore, AppVitalsRow } from '../lib/types';

  const params = () => ({ app: ui.appId, ...ui.appRangeParams() });
  const byDate = resource<AppStabilityResponse>(() => (ui.appId ? apiUrl('/api/app-stability', { ...params(), groupBy: 'date', limit: 2000 }) : null));
  const byVersion = resource<AppStabilityResponse>(() => (ui.appId ? apiUrl('/api/app-stability', { ...params(), groupBy: 'version', limit: 100 }) : null));

  /** Google flags apps above these user-perceived rates (Android vitals). */
  const BAD = { crash: 0.0109, anr: 0.0047 };
  const summary = $derived(byDate.data?.summary ?? []);
  const has = (s: AppStore) => (byDate.data?.rows ?? []).some((r) => r.store === s);

  function chart(store: AppStore) {
    const range = byDate.data?.range;
    const rows = (byDate.data?.rows ?? []).filter((r) => r.store === store);
    if (!range || rows.length === 0) return null;
    const by = new Map(rows.map((r) => [r.date ?? '', r]));
    const dates = eachDay(range.start, range.end);
    if (store === 'play')
      return {
        dates,
        series: [
          { key: 'crash', label: 'User-perceived crash rate', values: dates.map((d) => by.get(d)?.userPerceivedCrashRate ?? null), color: 'var(--chart)', area: true },
          { key: 'anr', label: 'User-perceived ANR rate', values: dates.map((d) => by.get(d)?.userPerceivedAnrRate ?? null), color: 'var(--warn)' },
        ],
        format: (n: number) => percent(n),
      };
    return {
      dates,
      series: [{ key: 'crashes', label: 'Crashes', values: dates.map((d) => by.get(d)?.crashes ?? null), color: 'var(--chart)', area: true }],
      format: (n: number) => int(n),
    };
  }

  const cols: Column<AppVitalsRow>[] = [
    { key: 'version', label: 'Version', grow: true, sortable: true },
    { key: 'store', label: 'Store', sortable: true, text: (r) => STORE_LABEL[r.store] },
    { key: 'userPerceivedCrashRate', label: 'Crash rate (user-perceived)', align: 'right', sortable: true, text: (r) => percent(r.userPerceivedCrashRate) },
    { key: 'userPerceivedAnrRate', label: 'ANR rate (user-perceived)', align: 'right', sortable: true, text: (r) => percent(r.userPerceivedAnrRate), hideOnMobile: true },
    { key: 'crashes', label: 'Crashes', align: 'right', sortable: true, text: (r) => int(r.crashes) },
    { key: 'distinctUsers', label: 'User-days', align: 'right', sortable: true, text: (r) => int(r.distinctUsers), hideOnMobile: true },
  ];
</script>

<PageHeader title="Stability" description="Crashes and ANRs" meta={byDate.data ? rangeLabel(byDate.data.range) : byDate.error ? null : undefined} />

{#if byDate.error}
  <ErrorBanner error={byDate.error} retry={byDate.reload} />
{:else if !byDate.data}
  <Card title="Stability"><Skeleton kind="chart" /></Card>
{:else if !has('apple') && !has('play')}
  <Card>
    <EmptyState title="No stability data in this range" icon="shield">
      <p>Google Play crash and ANR rates come from the Play Developer Reporting API; App Store crash counts from the App Crashes report.</p>
    </EmptyState>
  </Card>
{:else}
  <div class="stack">
    {#each summary.filter((s) => has(s.store)) as s (s.store)}
      {@const c = chart(s.store)}
      <Card title={STORE_LABEL[s.store]} busy={byDate.loading}>
        <div class="kpis">
          {#if s.store === 'play'}
            <Stat label="Crash rate (user-perceived)" value={percent(s.userPerceivedCrashRate)} sub={s.userPerceivedCrashRate !== null && s.userPerceivedCrashRate > BAD.crash ? 'Above Google’s 1.09% threshold' : 'Threshold 1.09%'} />
            <Stat label="ANR rate (user-perceived)" value={percent(s.userPerceivedAnrRate)} sub={s.userPerceivedAnrRate !== null && s.userPerceivedAnrRate > BAD.anr ? 'Above Google’s 0.47% threshold' : 'Threshold 0.47%'} />
            <Stat label="Crash rate (all)" value={percent(s.crashRate)} />
            <Stat label="ANR rate (all)" value={percent(s.anrRate)} />
          {:else}
            <Stat label="Crashes" value={int(s.crashes)} />
            <Stat label="Devices with crashes" value={int(s.crashDevices)} />
          {/if}
        </div>
        {#if c}
          <div class="trend"><LineChart dates={c.dates} series={c.series} height={160} label="{STORE_LABEL[s.store]} stability per day" valueFormat={c.format} format={c.format} /></div>
        {/if}
      </Card>
    {/each}

    <Card title="By app version" flush busy={byVersion.loading && Boolean(byVersion.data)}>
      {#if byVersion.error}
        <div class="pad"><ErrorBanner error={byVersion.error} retry={byVersion.reload} /></div>
      {:else if !byVersion.data}
        <div class="pad"><Skeleton kind="table" rows={5} /></div>
      {:else if byVersion.data.rows.length === 0}
        <EmptyState compact title="No versions in this range" icon="shield" />
      {:else}
        <DataTable label="Stability by app version" rows={byVersion.data.rows} columns={cols} sort={{ key: 'crashes', dir: 'desc' }} rowKey={(r) => `${r.store}-${r.version}`} limit={15} />
      {/if}
    </Card>
    <Notes notes={byDate.data.notes} />
  </div>
{/if}

<style>
  .kpis {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    gap: 12px;
  }
  .trend {
    margin-top: 16px;
  }
  .pad {
    padding: 4px 16px 16px;
  }
</style>
