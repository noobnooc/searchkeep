<script lang="ts">
  import BarList from '../components/BarList.svelte';
  import Card from '../components/Card.svelte';
  import EmptyState from '../components/EmptyState.svelte';
  import ErrorBanner from '../components/ErrorBanner.svelte';
  import Funnel from '../components/Funnel.svelte';
  import Icon, { type IconName } from '../components/Icon.svelte';
  import LineChart, { type LineSeries } from '../components/LineChart.svelte';
  import Notes from '../components/Notes.svelte';
  import PageHeader from '../components/PageHeader.svelte';
  import Segmented from '../components/Segmented.svelte';
  import Skeleton from '../components/Skeleton.svelte';
  import Stat from '../components/Stat.svelte';
  import { apiUrl } from '../lib/api';
  import { int, rangeLabel, shortDate } from '../lib/format';
  import { buildFunnel, geoFunnelUrl } from '../lib/geo';
  import { searchKpis, splitSeries } from '../lib/metrics';
  import { resource } from '../lib/resource.svelte';
  import { href, type ViewId } from '../lib/router.svelte';
  import { ui } from '../lib/state.svelte';
  import type { GeoFunnelResponse, OverviewResponse, Source } from '../lib/types';

  const ov = resource<OverviewResponse>(() => (ui.siteId ? apiUrl('/api/overview', { site: ui.siteId, brand: ui.brand, ...ui.rangeParams() }) : null));
  const geo = resource<GeoFunnelResponse>(() => (ui.siteId ? geoFunnelUrl(ui.siteId, ui.rangeParams()) : null));
  const funnel = $derived(geo.data ? buildFunnel(geo.data) : null);

  let chartSource = $state<Source>(ui.source);

  const d = $derived(ov.data);
  const sources = $derived(
    (['gsc', 'bing'] as const).map((id) => {
      const s = d?.search.find((x) => x.source === id);
      const hasData = Boolean(s && (s.series.length > 0 || s.current.impressions > 0 || s.previous.impressions > 0));
      const kpis = s ? searchKpis(s.current, s.previous) : [];
      // Bing reports no average position for site totals.
      if (s && s.current.position === null && s.previous.position === null && kpis[3]) kpis[3] = { ...kpis[3], sub: `Not reported by ${id === 'bing' ? 'Bing' : 'Google'}` };
      return { id, name: id === 'gsc' ? 'Google Search Console' : 'Bing Webmaster Tools', s, hasData, kpis };
    }),
  );
  const split = $derived(d ? splitSeries(d.search.find((x) => x.source === chartSource), d.range, d.previousRange) : null);
  const sparks = $derived(
    d
      ? Object.fromEntries(
          (['gsc', 'bing'] as const).map((id) => {
            const sp = splitSeries(d.search.find((x) => x.source === id), d.range, d.previousRange);
            return [id, { clicks: sp.cur.map((r) => r?.clicks ?? 0), impressions: sp.cur.map((r) => r?.impressions ?? 0) }];
          }),
        )
      : {},
  );

  function seriesFor(metric: 'clicks' | 'impressions'): LineSeries[] {
    if (!split) return [];
    const out: LineSeries[] = [{ key: 'cur', label: 'Current period', values: split.cur.map((r) => (r ? r[metric] : null)), color: 'var(--chart)', area: true }];
    if (split.prev.some((r) => r !== null)) {
      out.push({ key: 'prev', label: 'Previous period', values: split.prev.map((r) => (r ? r[metric] : null)), color: 'var(--prev)', dates: split.prevDates });
    }
    return out;
  }
  const clickSeries = $derived(seriesFor('clicks'));
  const imprSeries = $derived(seriesFor('impressions'));
  const hasPrev = $derived(clickSeries.length > 1);
  const chartEmpty = $derived(!split || split.cur.every((r) => r === null));

  const everythingEmpty = $derived(Boolean(d && !sources.some((s) => s.hasData) && d.crawlers.total === 0));
  const neverSynced = $derived(Boolean(ui.site && !ui.site.data.some((x) => x.lastDate)));

  const LINKS: Array<{ view: ViewId; sub?: string; icon: IconName; title: string; text: string }> = [
    { view: 'opportunities', icon: 'opportunities', title: 'Quick wins', text: 'Queries on page 1–2 that are close to the top.' },
    { view: 'opportunities', sub: 'content-decay', icon: 'trendDown', title: 'Content decay', text: 'Pages losing clicks week over week.' },
    { view: 'compare', icon: 'compare', title: 'Compare periods', text: 'Gainers and losers against the previous period.' },
    { view: 'technical', icon: 'technical', title: 'Technical health', text: 'Web Vitals, sitemaps and crawl issues.' },
  ];
</script>

<PageHeader title="Overview" description={ui.site?.domain} meta={d ? `${rangeLabel(d.range)} · vs ${rangeLabel(d.previousRange)}` : undefined} brand />

{#if ov.error}
  <ErrorBanner error={ov.error} retry={ov.reload} />
{:else if everythingEmpty}
  <Card>
    <EmptyState title={neverSynced ? `No data synced for ${ui.site?.domain} yet` : 'No data in this range yet'} icon="sync">
      <p>{neverSynced ? 'Syncs every 15 minutes, then backfills 16 months. Run one now, or check Settings.' : 'Try a longer range.'}</p>
      {#snippet actions()}
        <a class="btn primary" href={href('settings', 'sync')}><Icon name="sync" size={14} /> Sync now</a>
      {/snippet}
    </EmptyState>
  </Card>
{:else}
  <div class="stack">
    <div class="kpi-grid">
      {#each sources as src (src.id)}
        <Card title={src.name} busy={ov.loading && Boolean(d)}>
          {#snippet actions()}
            <a class="head-link" href={href('performance')} onclick={() => ui.setSource(src.id)}>Explore <Icon name="arrowRight" size={12} /></a>
          {/snippet}
          {#if !d}
            <Skeleton kind="stats" />
          {:else if !src.hasData}
            <p class="muted small">No {src.id === 'gsc' ? 'Search Console' : 'Bing'} data in this range. {src.id === 'bing' ? 'Set bingSiteUrl and BING_API_KEY to add Bing.' : 'Set gscProperty and the service account secrets.'}</p>
          {:else}
            <div class="kpis">
              {#each src.kpis as k, i (k.label)}
                <Stat label={k.label} value={k.value} delta={k.delta} sub={k.sub} spark={i === 0 ? sparks[src.id]?.clicks : i === 1 ? sparks[src.id]?.impressions : undefined} />
              {/each}
            </div>
          {/if}
        </Card>
      {/each}
    </div>

    <Card title="Search performance" subtitle={split?.weekly ? 'Weekly totals (Bing reports weeks)' : 'Daily totals, current vs previous period'} busy={ov.loading && Boolean(d)}>
      {#snippet actions()}
        {#if hasPrev}
          <div class="legend" aria-hidden="true">
            <span><i class="lk" style:background="var(--chart)"></i>Current</span>
            <span><i class="lk" style:background="var(--prev)"></i>Previous</span>
          </div>
        {/if}
        <Segmented
          label="Chart source"
          size="sm"
          options={[
            { value: 'gsc', label: 'Google' },
            { value: 'bing', label: 'Bing' },
          ]}
          value={chartSource}
          onchange={(v) => (chartSource = v)} />
      {/snippet}
      {#if !d}
        <div class="charts"><Skeleton kind="chart" height={190} /><Skeleton kind="chart" height={190} /></div>
      {:else if chartEmpty}
        <EmptyState compact title="No {chartSource === 'gsc' ? 'Search Console' : 'Bing'} data in this range" icon="performance" />
      {:else}
        <div class="charts">
          <figure>
            <figcaption>Clicks <span class="num">{int(split?.cur.reduce((s, r) => s + (r?.clicks ?? 0), 0))}</span></figcaption>
            <LineChart
              dates={split!.dates}
              series={clickSeries}
              height={190}
              label="Clicks per {split!.weekly ? 'week' : 'day'}, current versus previous period"
              tipTitle={(x) => (split!.weekly ? `Week of ${shortDate(x, true)}` : shortDate(x, true))} />
          </figure>
          <figure>
            <figcaption>Impressions <span class="num">{int(split?.cur.reduce((s, r) => s + (r?.impressions ?? 0), 0))}</span></figcaption>
            <LineChart
              dates={split!.dates}
              series={imprSeries}
              height={190}
              label="Impressions per {split!.weekly ? 'week' : 'day'}, current versus previous period"
              tipTitle={(x) => (split!.weekly ? `Week of ${shortDate(x, true)}` : shortDate(x, true))} />
          </figure>
        </div>
      {/if}
      {#snippet footer()}
        <Notes notes={d?.notes} />
      {/snippet}
    </Card>

    <div class="grid-2">
      <Card title="GEO funnel" busy={geo.loading && Boolean(geo.data)}>
        {#snippet actions()}
          <a class="head-link" href={href('geo')}>Open funnel <Icon name="arrowRight" size={12} /></a>
        {/snippet}
        {#if geo.error}
          <ErrorBanner error={geo.error} retry={geo.reload} />
        {:else if !geo.data || !funnel}
          <Skeleton height={190} />
        {:else}
          <Funnel stages={funnel.stages} base={funnel.base} />
          {#if geo.data.totals.cited === 0}
            <p class="hint">
              <Icon name="info" size={13} /> No citations yet. <a href={href('settings', 'import')}>Import the Bing AI Performance CSV</a> to fill the “Cited” step.
            </p>
          {:else if geo.data.insights.crawledButNeverCited.length}
            <p class="hint">
              <Icon name="sparkle" size={13} />
              {geo.data.insights.crawledButNeverCited.length} heavily crawled {geo.data.insights.crawledButNeverCited.length === 1 ? 'page has' : 'pages have'} never been cited.
              <a href={href('geo')}>See which</a>
            </p>
          {/if}
        {/if}
      </Card>

      <Card title="AI crawlers" subtitle={d ? `${int(d.crawlers.total)} requests in this range` : 'Requests from AI bots'} busy={ov.loading && Boolean(d)}>
        {#snippet actions()}
          <a class="head-link" href={href('ai-crawlers')}>All crawlers <Icon name="arrowRight" size={12} /></a>
        {/snippet}
        {#if !d}
          <Skeleton kind="table" rows={5} />
        {:else if d.crawlers.top.length === 0}
          <EmptyState compact title="No AI crawler requests recorded" icon="bot">
            <p>Set <code>cloudflareZoneId</code> for this site; the zone must be proxied through Cloudflare.</p>
          </EmptyState>
        {:else}
          <BarList label="Top AI crawlers by requests" items={d.crawlers.top.slice(0, 6).map((r) => ({ key: r.crawler ?? '?', label: r.crawler ?? 'Unknown', value: r.requests }))} />
        {/if}
      </Card>
    </div>

    <nav class="explore" aria-label="Explore">
      {#each LINKS as l (l.title)}
        <a class="explore-card" href={href(l.view, l.sub)}>
          <span class="ex-icon"><Icon name={l.icon} size={16} /></span>
          <span class="ex-text" title={l.text}>
            <strong>{l.title}</strong>
          </span>
          <Icon name="arrowRight" size={14} class="ex-arrow" />
        </a>
      {/each}
    </nav>
  </div>
{/if}

<style>
  .kpi-grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 16px;
  }
  .kpis {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 0;
  }
  .kpis > :global(.stat) {
    padding: 2px 20px 0;
    border-left: 1px solid var(--border);
  }
  .kpis > :global(.stat:first-child) {
    padding-left: 0;
    border-left: 0;
  }
  @media (max-width: 760px) {
    .kpis {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      row-gap: 18px;
    }
    .kpis > :global(.stat:nth-child(3)) {
      padding-left: 0;
      border-left: 0;
    }
  }
  .head-link {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 12.5px;
    font-weight: 500;
    color: var(--text-2);
  }
  .head-link:hover {
    color: var(--text);
    text-decoration: none;
  }
  .small {
    font-size: 13px;
  }
  .legend {
    display: flex;
    gap: 12px;
    font-size: 12px;
    color: var(--text-3);
  }
  .legend span {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .lk {
    display: inline-block;
    width: 12px;
    height: 2px;
    border-radius: 1px;
  }
  .charts {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 28px;
  }
  @media (max-width: 1080px) {
    .charts {
      grid-template-columns: minmax(0, 1fr);
      gap: 20px;
    }
  }
  figure {
    margin: 0;
    min-width: 0;
  }
  figcaption {
    display: flex;
    align-items: baseline;
    gap: 8px;
    font-size: 12.5px;
    font-weight: 500;
    color: var(--text-2);
    margin-bottom: 6px;
  }
  figcaption .num {
    color: var(--text);
    font-weight: 600;
  }
  .hint {
    margin-top: 12px;
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
    font-size: 12.5px;
    color: var(--text-2);
  }
  .explore {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 12px;
  }
  @media (max-width: 1080px) {
    .explore {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
  @media (max-width: 520px) {
    .explore {
      grid-template-columns: minmax(0, 1fr);
    }
  }
  .explore-card {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 14px;
    border-radius: var(--radius);
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--text);
    min-width: 0;
    transition:
      border-color 120ms ease,
      background 120ms ease;
  }
  .explore-card:hover {
    text-decoration: none;
    border-color: var(--border-2);
    background: var(--surface-2);
  }
  .ex-icon {
    width: 28px;
    height: 28px;
    flex: none;
    display: grid;
    place-items: center;
    border-radius: 7px;
    color: var(--text-2);
    background: var(--surface-3);
  }
  .ex-text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .ex-text strong {
    font-size: 13px;
    font-weight: 600;
  }
  .explore-card :global(.ex-arrow) {
    color: var(--text-4);
  }
  .explore-card:hover :global(.ex-arrow) {
    color: var(--text-2);
  }
</style>
