<script lang="ts">
  import BarList from '../components/BarList.svelte';
  import Card from '../components/Card.svelte';
  import DataTable from '../components/DataTable.svelte';
  import EmptyState from '../components/EmptyState.svelte';
  import ErrorBanner from '../components/ErrorBanner.svelte';
  import Funnel from '../components/Funnel.svelte';
  import Icon from '../components/Icon.svelte';
  import Notes from '../components/Notes.svelte';
  import PageHeader from '../components/PageHeader.svelte';
  import Pill from '../components/Pill.svelte';
  import Skeleton from '../components/Skeleton.svelte';
  import PathText from '../components/PathText.svelte';
  import { debounced } from '../lib/debounce.svelte';
  import { compact, int, rangeLabel } from '../lib/format';
  import { buildFunnel, GEO_STEPS as STEPS, geoFunnelUrl, visibleSteps, type GeoSortKey } from '../lib/geo';
  import { resource } from '../lib/resource.svelte';
  import { href } from '../lib/router.svelte';
  import { ui } from '../lib/state.svelte';
  import type { Column, SortState } from '../lib/table';
  import type { GeoFunnelResponse, GeoPage } from '../lib/types';

  let filter = $state('');
  const pageContains = debounced(() => filter.trim(), 300);
  let sort = $state<SortState>({ key: 'crawled', dir: 'desc' });

  const geo = resource<GeoFunnelResponse>(() =>
    ui.siteId ? geoFunnelUrl(ui.siteId, ui.rangeParams(), { sortBy: sort.key as GeoSortKey, pageContains: pageContains.value }) : null,
  );
  const d = $derived(geo.data);
  const funnel = $derived(d ? buildFunnel(d) : null);

  const neverCited = $derived(
    d ? d.insights.crawledButNeverCited.map((page) => ({ page, crawled: d.pages.find((p) => p.page === page)?.crawled ?? 0 })) : [],
  );
  const neverCitedSet = $derived(new Set(d?.insights.crawledButNeverCited ?? []));
  const max = $derived({
    crawled: Math.max(1, ...(d?.pages.map((p) => p.crawled) ?? [])),
    cited: Math.max(1, ...(d?.pages.map((p) => p.cited) ?? [])),
    aiVisits: Math.max(1, ...(d?.pages.map((p) => p.aiVisits) ?? [])),
    clicks: Math.max(1, ...(d?.pages.map((p) => p.clicks) ?? [])),
    impressions: Math.max(1, ...(d?.pages.map((p) => p.impressions) ?? [])),
  });
  const allEmpty = $derived(Boolean(d && STEPS.every((s) => d.totals[s.key] === 0)));

  const columns: Column<GeoPage>[] = $derived([
    { key: 'page', label: 'Page', grow: true, render: pageCell },
    ...visibleSteps(d).map(
      (s): Column<GeoPage> => ({
        key: s.key,
        label: s.label,
        align: 'right',
        sortable: true,
        width: '120px',
        text: (r) => int(r[s.key]),
        bar: (r) => ({ value: r[s.key], max: max[s.key], color: s.color }),
      }),
    ),
    {
      key: 'impressions',
      label: 'Impressions',
      align: 'right',
      sortable: true,
      text: (r) => compact(r.impressions),
      // A neutral bar like the steps', so every value in the row sits on the same line.
      bar: (r) => ({ value: r.impressions, max: max.impressions }),
      hideOnMobile: true,
      width: '110px',
    },
  ]);
</script>

{#snippet pageCell(row: GeoPage)}
  <span class="page-cell">
    <PathText path={row.page} />
    {#if neverCitedSet.has(row.page)}<Pill tone="warn" icon={null} title="Crawled by AI bots, but never cited in AI answers">not cited</Pill>{/if}
  </span>
{/snippet}

<PageHeader title="GEO funnel" meta={d ? rangeLabel(d.range) : geo.error ? null : undefined} />

{#if geo.error}
  <ErrorBanner error={geo.error} retry={geo.reload} />
{:else}
  <div class="stack">
    <Card busy={geo.loading && Boolean(d)}>
      {#if !d || !funnel}
        <Skeleton height={210} />
      {:else if allEmpty && !pageContains.value}
        <EmptyState title="The funnel is empty for this range" icon="funnel">
          <p>Each step comes from a different source: AI crawler requests from Cloudflare (<code>cloudflareZoneId</code>), AI visits from Cloudflare Web Analytics (<code>webAnalyticsSiteTag</code>) and clicks from Search Console and Bing.</p>
          {#snippet actions()}
            <a class="btn" href={href('settings', 'checks')}>Check setup</a>
            <a class="btn primary" href={href('settings', 'sync')}><Icon name="sync" size={14} /> Sync now</a>
          {/snippet}
        </EmptyState>
      {:else}
        <Funnel stages={funnel.stages} base={funnel.base} />
        <p class="legend-note">
          Each step counts only pages that reached every earlier step. Hover a total to see it across all pages.{#if d.totals.cited === 0}
            Add a Cited step by <a href={href('settings', 'import')}>importing Bing AI Performance</a>.{/if}
        </p>
      {/if}
      {#snippet footer()}
        <Notes notes={d?.notes} />
      {/snippet}
    </Card>


    {#if neverCited.length}
      <Card title="Crawled but never cited" subtitle="Make their answer easy to quote.">
        {#snippet actions()}<span class="muted small">AI crawler requests</span>{/snippet}
        <BarList label="Pages crawled but never cited, by AI crawler requests" items={neverCited.map((p) => ({ key: p.page, label: p.page, value: p.crawled, mono: true }))} />
      </Card>
    {/if}

    {#if !(allEmpty && !pageContains.value)}
    <Card title="Pages" subtitle={d ? `${int(d.pages.length)}${d.pages.length >= 500 ? '+' : ''} pages with activity in at least one step` : undefined} subtitlePending={!d && !geo.error} flush busy={geo.loading && Boolean(d)}>
      {#snippet actions()}
        <label class="filter">
          <Icon name="search" size={14} />
          <span class="sr-only">Filter pages</span>
          <input class="input" type="search" placeholder="Filter pages…" bind:value={filter} />
        </label>
      {/snippet}
      {#if !d}
        <div class="pad"><Skeleton kind="table" /></div>
      {:else if d.pages.length === 0}
        <EmptyState compact title={pageContains.value ? `No pages match “${pageContains.value}”` : 'No pages yet'} icon="search" />
      {:else}
        <DataTable label="GEO funnel by page" rows={d.pages} {columns} {sort} onsort={(s) => (sort = { key: s.key, dir: 'desc' })} rowKey={(r) => r.page} limit={50} />
      {/if}
    </Card>
    {/if}
  </div>
{/if}

<style>
  .legend-note {
    margin-top: 10px;
    font-size: 12px;
    color: var(--text-3);
  }
  .filter {
    position: relative;
    display: flex;
    align-items: center;
  }
  .filter :global(.icon) {
    position: absolute;
    left: 9px;
    color: var(--text-3);
    pointer-events: none;
  }
  .filter .input {
    padding-left: 30px;
    width: 220px;
    max-width: 100%;
  }
  .page-cell {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .pad {
    padding: 4px 16px 16px;
  }
  .small {
    font-size: 12px;
  }
  @media (max-width: 640px) {
    .filter {
      flex: 1 1 100%;
    }
    .filter .input {
      width: 100%;
    }
  }
</style>
