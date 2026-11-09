<script lang="ts">
  import BarList from '../components/BarList.svelte';
  import Card from '../components/Card.svelte';
  import EmptyState from '../components/EmptyState.svelte';
  import ErrorBanner from '../components/ErrorBanner.svelte';
  import LineChart from '../components/LineChart.svelte';
  import Notes from '../components/Notes.svelte';
  import PageHeader from '../components/PageHeader.svelte';
  import Pill from '../components/Pill.svelte';
  import Segmented from '../components/Segmented.svelte';
  import Skeleton from '../components/Skeleton.svelte';
  import Stat from '../components/Stat.svelte';
  import { apiUrl } from '../lib/api';
  import { stars, STORE_LABEL } from '../lib/apps';
  import { decimal, eachDay, int, rangeLabel, shortDate } from '../lib/format';
  import { resource } from '../lib/resource.svelte';
  import { ui } from '../lib/state.svelte';
  import type { AppReviewsResponse, AppStore } from '../lib/types';

  const app = $derived(ui.app);
  const both = $derived(Boolean(app?.appleId && app?.playPackage));
  let store = $state<AppStore | 'all'>('all');
  let filter = $state<'all' | 'low' | 'mid' | 'high'>('all');
  let text = $state('');
  let query = $state('');
  const STORES: Array<{ value: AppStore | 'all'; label: string }> = [
    { value: 'all', label: 'Both stores' },
    { value: 'apple', label: 'App Store' },
    { value: 'play', label: 'Google Play' },
  ];
  const FILTERS: Array<{ value: typeof filter; label: string }> = [
    { value: 'all', label: 'All' },
    { value: 'low', label: '1–2★' },
    { value: 'mid', label: '3★' },
    { value: 'high', label: '4–5★' },
  ];
  const RATINGS = { all: undefined, low: '1,2', mid: '3', high: '4,5' } as const;

  const reviews = resource<AppReviewsResponse>(() =>
    ui.appId
      ? apiUrl('/api/app-reviews', {
          app: ui.appId,
          ...(store === 'all' ? {} : { store }),
          ...ui.appRangeParams(),
          ratings: RATINGS[filter],
          contains: query || undefined,
          limit: 100,
        })
      : null,
  );

  const summary = $derived(reviews.data?.summary ?? []);
  const trend = $derived.by(() => {
    const range = reviews.data?.range;
    if (!range) return null;
    const series = summary.filter((s) => s.ratingSeries.length > 1);
    if (series.length === 0) return null;
    const dates = eachDay(range.start, range.end);
    return {
      dates,
      series: series.map((s, i) => {
        const by = new Map(s.ratingSeries.map((x) => [x.date, x.average]));
        return { key: s.store, label: `${STORE_LABEL[s.store]} average`, values: dates.map((d) => by.get(d) ?? null), color: i === 0 ? 'var(--chart)' : 'var(--prev)' };
      }),
    };
  });

  let timer: ReturnType<typeof setTimeout> | null = null;
  function onSearch(e: Event) {
    text = (e.currentTarget as HTMLInputElement).value;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => (query = text.trim()), 350);
  }
</script>

<PageHeader title="Ratings & reviews" meta={reviews.data ? rangeLabel(reviews.data.range) : reviews.error ? null : undefined}>
  {#snippet controls()}
    {#if both}<Segmented label="Store" options={STORES} value={store} onchange={(v) => (store = v)} />{/if}
  {/snippet}
</PageHeader>

{#if reviews.error}
  <ErrorBanner error={reviews.error} retry={reviews.reload} />
{:else}
  <div class="stack">
    <div class="grid-2 top">
      {#if !reviews.data}
        <Card title="Ratings"><Skeleton kind="stats" /></Card>
        <Card title="Stars"><Skeleton kind="table" rows={5} /></Card>
      {:else}
        {#each summary as s (s.store)}
          <Card title={STORE_LABEL[s.store]} busy={reviews.loading}>
            <div class="stats">
              <Stat label="Average rating" value={s.rating?.average ? decimal(s.rating.average, 2) : '—'} sub={s.rating ? `${s.rating.count ? `${int(s.rating.count)} ratings · ` : ''}${s.rating.territory === '*' ? 'all countries' : s.rating.territory}, ${shortDate(s.rating.date)}` : 'Not available'} />
              <Stat label="Reviews in range" value={int(s.reviews)} sub={s.reviewAverage ? `averaging ${decimal(s.reviewAverage, 2)}★` : undefined} />
            </div>
            {#if s.reviews > 0}
              <div class="dist">
                <BarList label="{STORE_LABEL[s.store]} reviews by stars" items={[5, 4, 3, 2, 1].map((n) => ({ key: String(n), label: `${n}★`, value: s.distribution[String(n)] ?? 0 }))} />
              </div>
            {/if}
          </Card>
        {/each}
      {/if}
    </div>

    {#if trend}
      <Card title="Average rating over time">
        <LineChart dates={trend.dates} series={trend.series} height={160} label="Average rating per day" valueFormat={(n) => decimal(n, 2)} format={(n) => decimal(n, 1)} />
      </Card>
    {/if}

    <Card title="Reviews" subtitle="Newest first. Reviewer names are not stored." busy={reviews.loading && Boolean(reviews.data)}>
      {#snippet actions()}
        <Segmented label="Stars" options={FILTERS} value={filter} onchange={(v) => (filter = v)} size="sm" />
      {/snippet}
      <input class="input search" type="search" placeholder="Search reviews" value={text} oninput={onSearch} aria-label="Search reviews" />
      {#if !reviews.data}
        <Skeleton kind="table" rows={6} />
      {:else if reviews.data.reviews.length === 0}
        <EmptyState compact title="No reviews match" icon="search" />
      {:else}
        <ul class="reviews">
          {#each reviews.data.reviews as r (`${r.store}-${r.id}`)}
            <li>
              <div class="head">
                <span class="stars" class:low={r.rating <= 2} aria-label="{r.rating} stars">{stars(r.rating)}</span>
                {#if r.title}<strong class="title">{r.title}</strong>{/if}
                {#if r.replied}<Pill tone="ok">Replied</Pill>{/if}
              </div>
              {#if r.body}<p class="body">{r.body}</p>{/if}
              <div class="meta">
                {[both ? STORE_LABEL[r.store] : '', r.territory ?? r.language ?? '', r.version ? `v${r.version}` : '', shortDate(r.createdAt.slice(0, 10), true)].filter(Boolean).join(' · ')}
              </div>
            </li>
          {/each}
        </ul>
      {/if}
      {#snippet footer()}<Notes notes={reviews.data?.notes} />{/snippet}
    </Card>
  </div>
{/if}

<style>
  .stats {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
  }
  .dist {
    margin-top: 14px;
  }
  .search {
    width: 100%;
    max-width: 320px;
    margin-bottom: 12px;
  }
  .reviews {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
  }
  .reviews li {
    padding: 12px 0;
    border-top: 1px solid var(--border);
  }
  .reviews li:first-child {
    border-top: 0;
    padding-top: 0;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .stars {
    color: var(--accent-text);
    letter-spacing: 1px;
    font-size: 13px;
  }
  .stars.low {
    color: var(--warn);
  }
  .title {
    font-size: 13.5px;
  }
  .body {
    margin: 6px 0 4px;
    font-size: 13.5px;
    color: var(--text-2);
    white-space: pre-line;
  }
  .meta {
    font-size: 12px;
    color: var(--text-3);
  }
</style>
