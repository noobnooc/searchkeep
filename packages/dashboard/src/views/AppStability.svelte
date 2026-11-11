<script lang="ts">
  import Card from '../components/Card.svelte';
  import DataTable from '../components/DataTable.svelte';
  import EmptyState from '../components/EmptyState.svelte';
  import ErrorBanner from '../components/ErrorBanner.svelte';
  import LineChart from '../components/LineChart.svelte';
  import Notes from '../components/Notes.svelte';
  import PageHeader from '../components/PageHeader.svelte';
  import Segmented from '../components/Segmented.svelte';
  import Skeleton from '../components/Skeleton.svelte';
  import Stat from '../components/Stat.svelte';
  import { apiUrl } from '../lib/api';
  import { STORE_LABEL } from '../lib/apps';
  import { decimal, eachDay, int, percent, rangeLabel } from '../lib/format';
  import { resource } from '../lib/resource.svelte';
  import { ui } from '../lib/state.svelte';
  import type { Column } from '../lib/table';
  import type { AppBreakdownDimension, AppBreakdownResponse, AppBreakdownRow, AppStabilityResponse, AppStore, AppVitalsRow } from '../lib/types';

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

  // Installs, ratings, crashes and sessions per app version, device or OS version (ADR 0010).
  let dimension = $state<AppBreakdownDimension>('app_version');
  const DIMENSIONS: Array<{ value: AppBreakdownDimension; label: string }> = [
    { value: 'app_version', label: 'App version' },
    { value: 'device', label: 'Device' },
    { value: 'os_version', label: 'OS version' },
  ];
  const breakdown = resource<AppBreakdownResponse>(() => (ui.appId ? apiUrl('/api/app-breakdown', { ...params(), dimension, limit: 100 }) : null));
  const bRows = $derived(breakdown.data?.rows ?? []);
  /** Only the columns some row has a number for, so the table stays narrow; a store leaves blank what it does not report. */
  const bCols: Column<AppBreakdownRow>[] = $derived.by(() => {
    const any = (f: (r: AppBreakdownRow) => number | null) => bRows.some((r) => (f(r) ?? 0) !== 0);
    const out: Column<AppBreakdownRow>[] = [{ key: 'value', label: DIMENSIONS.find((d) => d.value === dimension)!.label, grow: true, sortable: true }];
    if (new Set(bRows.map((r) => r.store)).size > 1) out.push({ key: 'store', label: 'Store', sortable: true, text: (r) => STORE_LABEL[r.store] });
    if (any((r) => r.installs)) out.push({ key: 'installs', label: 'Installs', align: 'right', sortable: true, text: (r) => (r.store === 'play' ? int(r.installs) : '') });
    if (any((r) => r.deletions)) out.push({ key: 'deletions', label: 'Uninstalls', align: 'right', sortable: true, text: (r) => (r.store === 'play' ? int(r.deletions) : ''), hideOnMobile: true });
    if (any((r) => r.totalRating))
      out.push({ key: 'totalRating', label: 'Rating', align: 'right', sortable: true, text: (r) => (r.totalRating ? `${decimal(r.totalRating, 2)}★` : '') });
    if (any((r) => r.sessions)) out.push({ key: 'sessions', label: 'Sessions', align: 'right', sortable: true, text: (r) => (r.store === 'apple' ? int(r.sessions) : '') });
    if (any((r) => r.crashes)) out.push({ key: 'crashes', label: 'Crashes', align: 'right', sortable: true, text: (r) => int(r.crashes) });
    if (any((r) => r.anrs)) out.push({ key: 'anrs', label: 'ANRs', align: 'right', sortable: true, text: (r) => (r.store === 'play' ? int(r.anrs) : ''), hideOnMobile: true });
    return out;
  });
  const bSort = $derived(bRows.some((r) => r.installs) ? 'installs' : bRows.some((r) => r.sessions) ? 'sessions' : 'crashes');

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
{:else}
  <div class="stack">
    {#if !has('apple') && !has('play')}
      <Card>
        <EmptyState title="No stability data in this range" icon="shield">
          <p>Google Play crash and ANR rates come from the Play Developer Reporting API; App Store crash counts from the App Crashes report.</p>
        </EmptyState>
      </Card>
    {:else}
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
    {/if}
    <Card title="Versions, devices and OS versions" subtitle="Installs, ratings, sessions and crashes for each" flush busy={breakdown.loading && Boolean(breakdown.data)}>
      <div class="pad switch"><Segmented label="Break down by" size="sm" options={DIMENSIONS} value={dimension} onchange={(v) => (dimension = v)} /></div>
      {#if breakdown.error}
        <div class="pad"><ErrorBanner error={breakdown.error} retry={breakdown.reload} /></div>
      {:else if !breakdown.data}
        <div class="pad"><Skeleton kind="table" rows={5} /></div>
      {:else if bRows.length === 0}
        <EmptyState compact title="Nothing in this range yet" icon="shield">
          <p>Google Play writes these files monthly; App Store sessions need people who share analytics.</p>
        </EmptyState>
      {:else}
        {#key `${dimension}-${bSort}`}
          <DataTable label="Numbers per {dimension.replace('_', ' ')}" rows={bRows} columns={bCols} sort={{ key: bSort, dir: 'desc' }} rowKey={(r) => `${r.store}-${r.value}`} limit={15} />
        {/key}
      {/if}
    </Card>
    <Notes notes={[...byDate.data.notes, ...(breakdown.data?.notes ?? [])]} />
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
  .switch {
    padding-top: 0;
    padding-bottom: 12px;
  }
</style>
