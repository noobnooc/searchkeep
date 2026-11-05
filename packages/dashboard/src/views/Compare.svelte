<script lang="ts">
  import Card from '../components/Card.svelte';
  import DataTable from '../components/DataTable.svelte';
  import EmptyState from '../components/EmptyState.svelte';
  import ErrorBanner from '../components/ErrorBanner.svelte';
  import Notes from '../components/Notes.svelte';
  import PathText from '../components/PathText.svelte';
  import PageHeader from '../components/PageHeader.svelte';
  import Pill from '../components/Pill.svelte';
  import Segmented from '../components/Segmented.svelte';
  import Skeleton from '../components/Skeleton.svelte';
  import Stat from '../components/Stat.svelte';
  import { apiUrl } from '../lib/api';
  import { addYears, deltaCompact, deltaDecimal, int, rangeLabel } from '../lib/format';
  import { searchKpis } from '../lib/metrics';
  import { resource } from '../lib/resource.svelte';
  import { ui } from '../lib/state.svelte';
  import type { Column } from '../lib/table';
  import type { CompareChange, CompareResponse } from '../lib/types';

  let dimension = $state<'query' | 'page'>('query');
  let against = $state<'previous' | 'year'>('previous');

  const yearRange = $derived.by(() => {
    const r = ui.absoluteRange(ui.source);
    return r ? { compareStart: addYears(r.start, -1), compareEnd: addYears(r.end, -1) } : null;
  });

  const cmp = resource<CompareResponse>(() =>
    ui.siteId
      ? apiUrl('/api/compare', {
          site: ui.siteId,
          source: ui.source,
          brand: ui.brand,
          ...ui.rangeParams(),
          dimension,
          limit: 50,
          ...(against === 'year' && yearRange ? yearRange : {}),
        })
      : null,
  );
  const d = $derived(cmp.data);
  const kpis = $derived(d ? searchKpis(d.current, d.previous) : []);
  const empty = $derived(Boolean(d && d.current.impressions === 0 && d.previous.impressions === 0));

  function keyOf(r: CompareChange): string {
    return (dimension === 'query' ? r.query : r.page) ?? '';
  }

  const maxGain = $derived(Math.max(1, ...(d?.gainers.map((r) => r.clicksDelta) ?? [])));
  const maxLoss = $derived(Math.max(1, ...(d?.losers.map((r) => -r.clicksDelta) ?? [])));

  function columnsFor(kind: 'gain' | 'loss'): Column<CompareChange>[] {
    return [
      { key: dimension, label: dimension === 'query' ? 'Query' : 'Page', grow: true, render: keyCell, sortable: true, sortValue: keyOf },
      {
        key: 'clicksDelta',
        label: 'Δ Clicks',
        align: 'right',
        sortable: true,
        width: '110px',
        render: deltaCell,
        bar: (r) => ({ value: Math.abs(r.clicksDelta), max: kind === 'gain' ? maxGain : maxLoss, color: kind === 'gain' ? 'var(--pos)' : 'var(--neg)' }),
      },
      { key: 'clicks', label: 'Clicks', align: 'right', sortable: true, width: '96px', render: clicksCell },
      {
        key: 'positionDelta',
        label: 'Δ Position',
        align: 'right',
        sortable: true,
        width: '96px',
        hideOnMobile: true,
        render: positionCell,
      },
    ];
  }
</script>

{#snippet keyCell(r: CompareChange)}
  <span class="key-cell">
    {#if dimension === 'page'}<PathText path={keyOf(r)} />{:else}<span>{keyOf(r) || '(not set)'}</span>{/if}
    {#if r.status === 'new'}<Pill tone="accent" icon={null}>new</Pill>{:else if r.status === 'lost'}<Pill tone="neutral" icon={null}>lost</Pill>{/if}
  </span>
{/snippet}

{#snippet deltaCell(r: CompareChange)}
  <span class="delta" class:pos={r.clicksDelta > 0} class:neg={r.clicksDelta < 0}>{deltaCompact(r.clicksDelta)}</span>
{/snippet}

{#snippet clicksCell(r: CompareChange)}
  <span>{int(r.clicks)}</span>
  <span class="was">from {int(r.previousClicks)}</span>
{/snippet}

{#snippet positionCell(r: CompareChange)}
  {#if r.positionDelta === null}
    <span class="muted">{'—'}</span>
  {:else}
    <!-- Lower position is better, so a negative delta is an improvement. -->
    <span class="delta" class:pos={r.positionDelta < -0.05} class:neg={r.positionDelta > 0.05}>{deltaDecimal(r.positionDelta, 1)}</span>
  {/if}
{/snippet}

<PageHeader title="Compare" meta={d ? `${rangeLabel(d.current.range)} · vs ${rangeLabel(d.previous.range)}` : cmp.error ? null : undefined} source brand>
  {#snippet controls()}
    <Segmented
      label="Compare against"
      options={[
        { value: 'previous', label: 'Previous period' },
        { value: 'year', label: 'Year before', disabled: !yearRange, title: yearRange ? undefined : 'Needs a resolved date range' },
      ]}
      value={against}
      onchange={(v) => (against = v)} />
  {/snippet}
</PageHeader>

{#if cmp.error}
  <ErrorBanner error={cmp.error} retry={cmp.reload} />
{:else}
  <div class="stack">
    <Card busy={cmp.loading && Boolean(d)}>
      {#if !d}
        <Skeleton kind="stats" />
      {:else}
        <div class="kpis">
          {#each kpis as k (k.label)}
            <Stat label={k.label} value={k.value} delta={k.delta} sub={k.sub} />
          {/each}
        </div>
      {/if}
    </Card>

    {#if empty}
      <Card>
        <EmptyState title="No search data in either period" icon="compare">
          <p>Choose another range, or wait for the next sync to bring in data.</p>
        </EmptyState>
      </Card>
    {:else}
      <div class="row-head">
        <Segmented
          label="Compare by"
          options={[
            { value: 'query', label: 'Queries' },
            { value: 'page', label: 'Pages' },
          ]}
          value={dimension}
          onchange={(v) => (dimension = v)} />
      </div>
      <div class="grid-2">
        <Card title="Gainers" subtitle="Largest increase in clicks" flush busy={cmp.loading && Boolean(d)}>
          {#if !d}
            <div class="pad"><Skeleton kind="table" /></div>
          {:else if d.gainers.length === 0}
            <EmptyState compact title="No gainers in this period" icon="arrowUp" />
          {:else}
            <DataTable label="Gainers" rows={d.gainers} columns={columnsFor('gain')} rowKey={keyOf} limit={15} />
          {/if}
        </Card>
        <Card title="Losers" subtitle="Largest drop in clicks" flush busy={cmp.loading && Boolean(d)}>
          {#if !d}
            <div class="pad"><Skeleton kind="table" /></div>
          {:else if d.losers.length === 0}
            <EmptyState compact title="No losers in this period" icon="arrowDown" />
          {:else}
            <DataTable label="Losers" rows={d.losers} columns={columnsFor('loss')} rowKey={keyOf} limit={15} />
          {/if}
        </Card>
      </div>
    {/if}
    <Notes notes={d?.notes} />
  </div>
{/if}

<style>
  .kpis {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
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
  .row-head {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: -4px;
  }
  .key-cell {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .delta {
    font-weight: 600;
    color: var(--text-2);
  }
  .delta.pos {
    color: var(--pos);
  }
  .delta.neg {
    color: var(--neg);
  }
  .was {
    display: block;
    font-size: 11.5px;
    color: var(--text-3);
  }
  .pad {
    padding: 4px 16px 16px;
  }
</style>
