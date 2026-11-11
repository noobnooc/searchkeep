<script lang="ts">
  import BarList from '../components/BarList.svelte';
  import Card from '../components/Card.svelte';
  import DataTable from '../components/DataTable.svelte';
  import EmptyState from '../components/EmptyState.svelte';
  import ErrorBanner from '../components/ErrorBanner.svelte';
  import Notes from '../components/Notes.svelte';
  import PageHeader from '../components/PageHeader.svelte';
  import Pill from '../components/Pill.svelte';
  import Segmented from '../components/Segmented.svelte';
  import Skeleton from '../components/Skeleton.svelte';
  import { apiUrl } from '../lib/api';
  import { regionName, sourceLabel, STORE_LABEL } from '../lib/apps';
  import { deltaCompact, int, money, percent, rangeLabel } from '../lib/format';
  import { resource } from '../lib/resource.svelte';
  import { ui } from '../lib/state.svelte';
  import type { Column } from '../lib/table';
  import type { AppPerformanceResponse, AppReferrerRow, AppRow, AppSearchTerm, AppSearchTermsResponse, AppStore } from '../lib/types';

  const app = $derived(ui.app);
  const both = $derived(Boolean(app?.appleId && app?.playPackage));
  let store = $state<AppStore | 'all'>('all');
  const STORES: Array<{ value: AppStore | 'all'; label: string }> = [
    { value: 'all', label: 'Both stores' },
    { value: 'apple', label: 'App Store' },
    { value: 'play', label: 'Google Play' },
  ];
  const params = () => ({ app: ui.appId, ...(store === 'all' ? {} : { store }), ...ui.appRangeParams() });
  const bySource = resource<AppPerformanceResponse>(() => (ui.appId ? apiUrl('/api/app-performance', { ...params(), groupBy: 'store,source', limit: 100 }) : null));
  const byTerritory = resource<AppPerformanceResponse>(() => (ui.appId ? apiUrl('/api/app-performance', { ...params(), groupBy: 'store,territory', limit: 200 }) : null));
  const referrers = resource<AppPerformanceResponse>(() => (ui.appId ? apiUrl('/api/app-performance', { ...params(), groupBy: 'referrer', limit: 100 }) : null));
  const terms = resource<AppSearchTermsResponse>(() =>
    ui.appId && app?.playPackage && store !== 'apple' ? apiUrl('/api/app-search-terms', { app: ui.appId, ...ui.appRangeParams(), limit: 200 }) : null,
  );

  /** Page views as each store counts them: product page views (App Store), unique visitors (Google Play). */
  const views = (r: AppRow) => (r.store === 'play' ? r.pageViewsUnique : r.pageViews);

  /** Amounts are per store currency (App Store: USD); a column shows them only when the rows share one. */
  const currencyOf = (r: { store?: AppStore }) => bySource.data?.stores.find((s) => s.store === r.store)?.currency ?? byTerritory.data?.stores.find((s) => s.store === r.store)?.currency ?? null;
  const territoryCurrency = $derived.by(() => {
    const paid = (byTerritory.data?.rows ?? []).filter((r) => r.proceedsCents !== 0);
    const currencies = new Set(paid.map(currencyOf));
    return currencies.size === 1 ? [...currencies][0]! : null;
  });

  const sourceGroups = $derived(
    (['apple', 'play'] as const)
      .map((s) => ({
        store: s,
        // A source can bring revenue without new downloads in the period (purchases by earlier users).
        rows: (bySource.data?.rows ?? [])
          .filter((r) => r.store === s && (r.downloads > 0 || views(r) > 0 || r.proceedsCents !== 0 || r.purchases !== 0))
          .sort((a, b) => b.downloads - a.downloads || b.proceedsCents - a.proceedsCents),
      }))
      .filter((g) => g.rows.length > 0),
  );

  const maxViews = $derived(Math.max(1, ...(byTerritory.data?.rows ?? []).map(views)));
  /** Google Play's bucket for countries with few visitors is not a country; the subtitle explains it. */
  function territoryLabel(r: AppRow): string {
    const code = r.territory ?? '';
    if (code === 'OTHER') return r.store === 'play' ? 'Other (grouped)' : 'Other';
    return code === '-' || !code ? 'Unknown' : code;
  }
  // Google Play breaks out installs by country but groups small countries' visitors and acquisitions.
  const playOnly = $derived(store === 'play' || Boolean(app && !app.appleId));
  const showInstalls = $derived(Boolean(app?.playPackage) && store !== 'apple');
  const playGrouped = $derived((byTerritory.data?.rows ?? []).some((r) => r.store === 'play' && r.territory === 'OTHER' && views(r) > 0));
  const territoryCols: Column<AppRow>[] = $derived([
    { key: 'territory', label: 'Territory', grow: true, sortable: true, render: territoryCell },
    ...(both && store === 'all' ? [{ key: 'store', label: 'Store', sortable: true, text: (r: AppRow) => (r.store ? STORE_LABEL[r.store] : '') }] : []),
    { key: 'views', label: 'Page views', align: 'right', sortable: true, sortValue: views, text: (r) => int(views(r)), bar: (r) => ({ value: views(r), max: maxViews }) },
    { key: 'downloads', label: 'Downloads', align: 'right', sortable: true, text: (r) => int(r.downloads) },
    ...(territoryCurrency
      ? [{ key: 'proceeds', label: 'Proceeds', align: 'right' as const, sortable: true, text: (r: AppRow) => (r.proceedsCents !== 0 ? money(r.proceeds, territoryCurrency, true) : '') }]
      : []),
    // Google Play's conversion means little once its visitors are grouped; its installs by country do.
    showInstalls
      ? { key: 'installs', label: 'Installs', align: 'right', sortable: true, text: (r) => int(r.installs) }
      : { key: 'pageConversion', label: 'Conversion', align: 'right', sortable: true, text: (r) => percent(r.pageConversion), hideOnMobile: true },
  ]);

  const refCols: Column<AppReferrerRow>[] = $derived([
    { key: 'referrer', label: 'Referrer', grow: true, sortable: true, render: refCell },
    ...(both ? [{ key: 'store', label: 'Store', sortable: true, text: (r: AppReferrerRow) => STORE_LABEL[r.store] }] : []),
    { key: 'pageViews', label: 'Page views', align: 'right', sortable: true, text: (r) => int(r.pageViews) },
    { key: 'downloads', label: 'Downloads', align: 'right', sortable: true, text: (r) => int(r.downloads) },
  ]);
  const KIND: Record<AppReferrerRow['kind'], string> = { web: 'Website', app: 'App', utm: 'UTM source' };

  const maxVisitors = $derived(Math.max(1, ...(terms.data?.terms ?? []).map((t) => t.visitors)));
  const termCols: Column<AppSearchTerm>[] = $derived([
    { key: 'term', label: 'Search term', grow: true, sortable: true },
    { key: 'visitors', label: 'Visitors', align: 'right', sortable: true, text: (t) => int(t.visitors), bar: (t) => ({ value: t.visitors, max: maxVisitors }) },
    { key: 'acquisitions', label: 'Acquisitions', align: 'right', sortable: true, text: (t) => int(t.acquisitions) },
    { key: 'conversion', label: 'Conversion', align: 'right', sortable: true, text: (t) => percent(t.conversion) },
    { key: 'visitorsChange', label: 'Change', align: 'right', sortable: true, text: (t) => deltaCompact(t.visitorsChange), hideOnMobile: true },
  ]);
</script>

{#snippet territoryCell(r: AppRow)}
  <span title={r.territory && /^[A-Z]{2}$/.test(r.territory) ? regionName(r.territory) : undefined}>{territoryLabel(r)}</span>
{/snippet}

{#snippet refCell(r: AppReferrerRow)}
  <span class="ref">
    <span class="truncate">{r.referrer}</span>
    <span class="kind">{KIND[r.kind]}</span>
    {#if r.ownSite}<Pill tone="ok">Your site</Pill>{/if}
  </span>
{/snippet}

<PageHeader title="Acquisition" description="Where people find the app" meta={bySource.data ? rangeLabel(bySource.data.range) : bySource.error ? null : undefined}>
  {#snippet controls()}
    {#if both}<Segmented label="Store" options={STORES} value={store} onchange={(v) => (store = v)} />{/if}
  {/snippet}
</PageHeader>

{#if bySource.error}
  <ErrorBanner error={bySource.error} retry={bySource.reload} />
{:else}
  <div class="stack">
    <div class="grid-2 top">
      <Card title="Sources" subtitle="Downloads by where people found the app" busy={bySource.loading && Boolean(bySource.data)}>
        {#if !bySource.data}
          <Skeleton kind="table" rows={5} />
        {:else if sourceGroups.length === 0}
          <EmptyState compact title="No store data in this range" icon="search" />
        {:else}
          {#each sourceGroups as g (g.store)}
            {#if sourceGroups.length > 1}<h3 class="store">{STORE_LABEL[g.store]}</h3>{/if}
            <BarList
              label="{STORE_LABEL[g.store]} downloads by source"
              items={g.rows.map((r) => {
                const cur = currencyOf(r);
                const paid = cur && r.proceedsCents !== 0 ? ` · ${money(r.proceeds, cur, true)}` : '';
                return { key: `${g.store}-${r.source}`, label: sourceLabel(r.source), value: r.downloads, meta: `${int(views(r))} page views · ${percent(r.pageConversion)}${paid}` };
              })} />
          {/each}
        {/if}
      </Card>
      <Card
        title="Territories"
        subtitle={playGrouped ? 'Google Play groups the visitors and downloads of countries with few visitors into Other; its installs by country are not grouped.' : undefined}
        flush
        busy={byTerritory.loading && Boolean(byTerritory.data)}>
        {#if byTerritory.error}
          <div class="pad"><ErrorBanner error={byTerritory.error} retry={byTerritory.reload} /></div>
        {:else if !byTerritory.data}
          <div class="pad"><Skeleton kind="table" rows={6} /></div>
        {:else if (byTerritory.data.rows ?? []).length === 0}
          <EmptyState compact title="No store data in this range" icon="globe" />
        {:else}
          {#key playOnly}
            <DataTable
              label="Store funnel by territory"
              rows={byTerritory.data.rows ?? []}
              columns={territoryCols}
              sort={{ key: playOnly ? 'installs' : 'downloads', dir: 'desc' }}
              rowKey={(r) => `${r.store}-${r.territory}`}
              limit={10} />
          {/key}
        {/if}
      </Card>
    </div>

    <Card title="Referrers" subtitle="Websites, apps and UTM sources that sent people to the store page" flush busy={referrers.loading && Boolean(referrers.data)}>
      {#if referrers.error}
        <div class="pad"><ErrorBanner error={referrers.error} retry={referrers.reload} /></div>
      {:else if !referrers.data}
        <div class="pad"><Skeleton kind="table" rows={5} /></div>
      {:else if (referrers.data.referrers ?? []).length === 0}
        <EmptyState compact title="No referrers in this range" icon="referral">
          <p>App Store referrers come from Apple's Detailed reports; Google Play lists the UTM sources of third-party referrals.</p>
        </EmptyState>
      {:else}
        <DataTable label="Referrers" rows={referrers.data.referrers ?? []} columns={refCols} sort={{ key: 'downloads', dir: 'desc' }} rowKey={(r) => `${r.store}-${r.kind}-${r.referrer}`} limit={15} />
      {/if}
    </Card>

    {#if app?.playPackage && store !== 'apple'}
      <Card title="Google Play search terms" subtitle="Searches on Google Play that brought store listing visitors" flush busy={terms.loading && Boolean(terms.data)}>
        {#if terms.error}
          <div class="pad"><ErrorBanner error={terms.error} retry={terms.reload} /></div>
        {:else if !terms.data}
          <div class="pad"><Skeleton kind="table" rows={8} /></div>
        {:else if terms.data.terms.length === 0}
          <EmptyState compact title="No search terms in this range" icon="search" />
        {:else}
          {#if terms.data.lowConverting.length}
            <div class="low">
              <strong>Visited, but rarely installed:</strong>
              {#each terms.data.lowConverting.slice(0, 8) as t (t.term)}<span class="chip">{t.term} <span class="muted num">{percent(t.conversion)}</span></span>{/each}
            </div>
          {/if}
          <DataTable label="Google Play search terms" rows={terms.data.terms} columns={termCols} sort={{ key: 'visitors', dir: 'desc' }} rowKey={(t) => t.term} limit={20} />
        {/if}
        {#snippet footer()}<Notes notes={terms.data?.notes} />{/snippet}
      </Card>
    {/if}

    <Notes notes={bySource.data?.notes} />
  </div>
{/if}

<style>
  .pad {
    padding: 4px 16px 16px;
  }
  .store {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-3);
    margin: 12px 0 6px;
  }
  .store:first-child {
    margin-top: 0;
  }
  .ref {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }
  .kind {
    font-size: 11.5px;
    color: var(--text-3);
    flex: none;
  }
  .low {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    padding: 4px 16px 12px;
    font-size: 13px;
  }
  .chip {
    padding: 2px 8px;
    border-radius: 999px;
    background: var(--surface-3);
    font-size: 12px;
  }
</style>
