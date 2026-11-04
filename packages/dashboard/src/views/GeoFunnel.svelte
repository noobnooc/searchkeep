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
  import { buildFunnel, GEO_STEPS as STEPS, geoFunnelUrl, type GeoStep } from '../lib/geo';
  import { resource } from '../lib/resource.svelte';
  import { href } from '../lib/router.svelte';
  import { ui } from '../lib/state.svelte';
  import type { Column, SortState } from '../lib/table';
  import type { GeoFunnelResponse, GeoPage } from '../lib/types';

  let filter = $state('');
  const pageContains = debounced(() => filter.trim(), 300);
  let sort = $state<SortState>({ key: 'crawled', dir: 'desc' });

  const geo = resource<GeoFunnelResponse>(() =>
    ui.siteId ? geoFunnelUrl(ui.siteId, ui.rangeParams(), { sortBy: sort.key as GeoStep, pageContains: pageContains.value }) : null,
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
  });
  const allEmpty = $derived(Boolean(d && STEPS.every((s) => d.totals[s.key] === 0)));
  const citedMissing = $derived(Boolean(d && d.totals.cited === 0 && d.totals.crawled + d.totals.aiVisits + d.totals.clicks > 0));

  const columns: Column<GeoPage>[] = $derived([
    { key: 'page', label: 'Page', grow: true, render: pageCell },
    ...STEPS.map(
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
    { key: 'impressions', label: 'Impressions', align: 'right', text: (r) => compact(r.impressions), hideOnMobile: true, width: '100px' },
  ]);
</script>

{#snippet pageCell(row: GeoPage)}
  <span class="page-cell">
    <PathText path={row.page} />
    {#if neverCitedSet.has(row.page)}<Pill tone="warn" icon={null} title="Crawled by AI bots, but never cited in AI answers">not cited</Pill>{/if}
  </span>
{/snippet}

<PageHeader title="GEO funnel" description="How AI systems find, cite and send visitors to your pages" meta={d ? rangeLabel(d.range) : undefined} />

{#if geo.error}
  <ErrorBanner error={geo.error} retry={geo.reload} />
{:else}
  <div class="stack">
    <Card busy={geo.loading && Boolean(d)}>
      {#if !d || !funnel}
        <Skeleton height={210} />
      {:else if allEmpty && !pageContains.value}
        <EmptyState title="The funnel is empty for this range" icon="funnel">
          <p>Each step comes from a different source: AI crawler requests from Cloudflare (<code>cloudflareZoneId</code>), citations from the Bing AI Performance CSV import, AI visits from Cloudflare Web Analytics (<code>webAnalyticsSiteTag</code>) and clicks from Search Console and Bing.</p>
          {#snippet actions()}
            <a class="btn" href={href('settings')}>Check setup</a>
            <a class="btn primary" href={href('settings', 'sync')}><Icon name="sync" size={14} /> Sync now</a>
          {/snippet}
        </EmptyState>
      {:else}
        <Funnel stages={funnel.stages} base={funnel.base} />
        <p class="legend-note">
          Big numbers are totals for each step. The band and page counts follow pages through the steps: a page counts at a step only if it also reached the steps before it.
        </p>
      {/if}
      {#snippet footer()}
        <Notes notes={d?.notes} />
      {/snippet}
    </Card>

    {#if d && citedMissing}
      <div class="callout">
        <div class="callout-icon"><Icon name="upload" size={16} /></div>
        <div class="callout-body">
          <h3>Fill the “Cited” step with Bing AI Performance</h3>
          <p>The Bing Webmaster API does not expose AI citations yet, so they come from a CSV export:</p>
          <ol>
            <li>Open Bing Webmaster Tools → <strong>AI Performance</strong> for {ui.site?.domain}.</li>
            <li>Choose the date range and select <strong>Export</strong>.</li>
            <li>Upload the CSV in Settings → Import AI citations.</li>
          </ol>
        </div>
        <a class="btn primary" href={href('settings', 'import')}>Import CSV <Icon name="arrowRight" size={13} /></a>
      </div>
    {/if}

    {#if neverCited.length}
      <Card title="Crawled but never cited" subtitle="AI bots request these pages often, yet no AI answer cited them in this range. Make the answer they hold easy to quote: a clear heading, a direct first paragraph, facts and sources.">
        {#snippet actions()}<span class="muted small">AI crawler requests</span>{/snippet}
        <BarList label="Pages crawled but never cited, by AI crawler requests" items={neverCited.map((p) => ({ key: p.page, label: p.page, value: p.crawled, mono: true }))} />
      </Card>
    {/if}

    {#if !(allEmpty && !pageContains.value)}
    <Card title="Pages" subtitle={d ? `${int(d.pages.length)}${d.pages.length >= 500 ? '+' : ''} pages with activity in at least one step` : undefined} flush busy={geo.loading && Boolean(d)}>
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
  .callout {
    display: flex;
    gap: 14px;
    align-items: flex-start;
    padding: 16px;
    border-radius: var(--radius);
    border: 1px solid var(--accent-line);
    background: var(--surface);
    flex-wrap: wrap;
  }
  .callout-icon {
    width: 32px;
    height: 32px;
    flex: none;
    border-radius: 8px;
    display: grid;
    place-items: center;
    color: var(--accent-text);
    background: var(--accent-wash-2);
  }
  .callout-body {
    flex: 1 1 280px;
    min-width: 0;
  }
  .callout h3 {
    font-size: 14px;
    font-weight: 600;
  }
  .callout p {
    margin-top: 3px;
    color: var(--text-2);
    font-size: 13px;
  }
  .callout ol {
    margin: 8px 0 0;
    padding-left: 18px;
    color: var(--text-2);
    font-size: 13px;
    line-height: 1.7;
  }
  .callout strong {
    color: var(--text);
    font-weight: 600;
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
