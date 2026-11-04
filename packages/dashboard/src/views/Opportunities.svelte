<script lang="ts">
  import Card from '../components/Card.svelte';
  import PathText from '../components/PathText.svelte';
  import DataTable from '../components/DataTable.svelte';
  import EmptyState from '../components/EmptyState.svelte';
  import ErrorBanner from '../components/ErrorBanner.svelte';
  import Notes from '../components/Notes.svelte';
  import PageHeader from '../components/PageHeader.svelte';
  import Pill from '../components/Pill.svelte';
  import SegmentBar from '../components/SegmentBar.svelte';
  import Segmented from '../components/Segmented.svelte';
  import Skeleton from '../components/Skeleton.svelte';
  import Sparkline from '../components/Sparkline.svelte';
  import Tabs from '../components/Tabs.svelte';
  import { apiUrl } from '../lib/api';
  import { decimal, int, percent, rangeLabel, shortDate } from '../lib/format';
  import { resource } from '../lib/resource.svelte';
  import { href, router } from '../lib/router.svelte';
  import { ui } from '../lib/state.svelte';
  import type { Column } from '../lib/table';
  import type { CannibalizationResponse, ContentDecayResponse, CtrAnomaliesResponse, CtrAnomaly, DecayPage, QuickWin, QuickWinsResponse } from '../lib/types';

  type TabId = 'quick-wins' | 'cannibalization' | 'ctr-anomalies' | 'content-decay';
  const TAB_IDS: TabId[] = ['quick-wins', 'cannibalization', 'ctr-anomalies', 'content-decay'];
  const tab = $derived<TabId>(TAB_IDS.includes(router.sub as TabId) ? (router.sub as TabId) : 'quick-wins');

  let weeks = $state(16);

  const base = () => ({ site: ui.siteId, brand: ui.brand, limit: 50 });
  const qw = resource<QuickWinsResponse>(() => (ui.siteId && tab === 'quick-wins' ? apiUrl('/api/quick-wins', { ...base(), source: ui.source, ...ui.rangeParams() }) : null));
  const cann = resource<CannibalizationResponse>(() => (ui.siteId && tab === 'cannibalization' ? apiUrl('/api/cannibalization', { ...base(), ...ui.rangeParams() }) : null));
  const ctr = resource<CtrAnomaliesResponse>(() => (ui.siteId && tab === 'ctr-anomalies' ? apiUrl('/api/ctr-anomalies', { ...base(), source: ui.source, ...ui.rangeParams() }) : null));
  const decay = resource<ContentDecayResponse>(() => (ui.siteId && tab === 'content-decay' ? apiUrl('/api/content-decay', { ...base(), source: ui.source, weeks }) : null));

  const active = $derived(tab === 'quick-wins' ? qw : tab === 'cannibalization' ? cann : tab === 'ctr-anomalies' ? ctr : decay);
  const range = $derived(active.data?.range);

  const TABS = [
    { id: 'quick-wins', label: 'Quick wins', href: href('opportunities', 'quick-wins') },
    { id: 'cannibalization', label: 'Cannibalization', href: href('opportunities', 'cannibalization') },
    { id: 'ctr-anomalies', label: 'CTR anomalies', href: href('opportunities', 'ctr-anomalies') },
    { id: 'content-decay', label: 'Content decay', href: href('opportunities', 'content-decay') },
  ];

  const INTRO: Record<TabId, string> = {
    'quick-wins': 'Queries ranking just below the top results with plenty of impressions. Small improvements here move the most clicks.',
    cannibalization: 'Queries where several of your pages compete for the same impressions. Consolidate or differentiate them.',
    'ctr-anomalies': 'Queries whose click-through rate is far below what their position usually earns on this site.',
    'content-decay': 'Pages whose weekly clicks have fallen well below their earlier peak, with a downward trend.',
  };

  // Quick wins
  const qwMax = $derived(Math.max(1, ...(qw.data?.quickWins.map((r) => r.potentialExtraClicks) ?? [])));
  const qwCols = $derived<Column<QuickWin>[]>([
    { key: 'query', label: 'Query', grow: true, sortable: true, render: qwQuery },
    { key: 'position', label: 'Position', align: 'right', sortable: true, width: '84px', text: (r) => decimal(r.position, 1) },
    { key: 'impressions', label: 'Impressions', align: 'right', sortable: true, width: '104px', text: (r) => int(r.impressions) },
    { key: 'clicks', label: 'Clicks', align: 'right', sortable: true, width: '80px', text: (r) => int(r.clicks), hideOnMobile: true },
    { key: 'ctr', label: 'CTR', align: 'right', sortable: true, width: '72px', text: (r) => percent(r.ctr), hideOnMobile: true },
    {
      key: 'potentialExtraClicks',
      label: 'Potential',
      title: 'Extra clicks per period if this query reached position ~3 at a benchmark CTR',
      align: 'right',
      sortable: true,
      width: '120px',
      text: (r) => `+${int(r.potentialExtraClicks)}`,
      bar: (r) => ({ value: r.potentialExtraClicks, max: qwMax }),
    },
  ]);

  // CTR anomalies
  const ctrMax = $derived(Math.max(1, ...(ctr.data?.anomalies.map((r) => r.lostClicks) ?? [])));
  const ctrCols = $derived<Column<CtrAnomaly>[]>([
    { key: 'query', label: 'Query', grow: true, sortable: true },
    { key: 'position', label: 'Position', align: 'right', sortable: true, width: '84px', text: (r) => decimal(r.position, 1) },
    { key: 'impressions', label: 'Impressions', align: 'right', sortable: true, width: '104px', text: (r) => int(r.impressions), hideOnMobile: true },
    { key: 'ctr', label: 'CTR vs expected', align: 'right', sortable: true, width: '150px', render: ctrCell },
    {
      key: 'lostClicks',
      label: 'Missed clicks',
      align: 'right',
      sortable: true,
      width: '120px',
      text: (r) => int(r.lostClicks),
      bar: (r) => ({ value: r.lostClicks, max: ctrMax, color: 'var(--warn)' }),
    },
  ]);

  // Content decay
  const decayCols = $derived<Column<DecayPage>[]>([
    { key: 'page', label: 'Page', grow: true, sortable: true, render: decayPage },
    { key: 'weekly', label: `Last ${weeks} weeks`, render: decaySpark, width: '140px' },
    { key: 'peakWeeklyClicks', label: 'Peak / wk', align: 'right', sortable: true, width: '96px', text: (r) => decimal(r.peakWeeklyClicks, 1), hideOnMobile: true },
    { key: 'recentWeeklyClicks', label: 'Recent / wk', align: 'right', sortable: true, width: '100px', text: (r) => decimal(r.recentWeeklyClicks, 1) },
    { key: 'declinePct', label: 'Decline', align: 'right', sortable: true, width: '84px', render: declineCell },
  ]);
</script>

{#snippet qwQuery(r: QuickWin)}
  <span class="q">{r.query}</span>
  {#if r.page}<span class="sub path">{r.page}</span>{/if}
{/snippet}

{#snippet ctrCell(r: CtrAnomaly)}
  <span class="ctr-pair">
    <strong>{percent(r.ctr)}</strong>
    <span class="muted">vs {percent(r.expectedCtr)}</span>
  </span>
  <span class="sub">{r.expectedBasis === 'site' ? 'site median' : 'benchmark'}</span>
{/snippet}

{#snippet decayPage(r: DecayPage)}
  <PathText path={r.page} />
  {#if r.peakWeekOf}<span class="sub">Peak from week of {shortDate(r.peakWeekOf, true)} · −{decimal(r.lostClicksPerWeek, 1)} clicks/wk</span>{/if}
{/snippet}

{#snippet decaySpark(r: DecayPage)}
  <Sparkline values={r.weekly} width={120} height={28} highlight={4} label="Weekly clicks for {r.page}, last four weeks highlighted" />
{/snippet}

{#snippet declineCell(r: DecayPage)}
  <span class="decline">−{decimal(r.declinePct, 0)}%</span>
{/snippet}

<PageHeader
  title="Opportunities"
  meta={range ? rangeLabel(range) : undefined}
  source={tab === 'cannibalization' ? 'gsc-only' : true}
  brand
  range={tab !== 'content-decay'}>
  {#snippet controls()}
    {#if tab === 'content-decay'}
      <Segmented
        label="Weeks analysed"
        options={[
          { value: '12', label: '12 wk' },
          { value: '16', label: '16 wk' },
          { value: '26', label: '26 wk' },
          { value: '52', label: '52 wk' },
        ]}
        value={String(weeks)}
        onchange={(v) => (weeks = Number(v))} />
    {/if}
  {/snippet}
</PageHeader>

<Tabs label="Opportunity reports" tabs={TABS} active={tab} />
<p class="intro">{INTRO[tab]}</p>

{#if active.error}
  <ErrorBanner error={active.error} retry={active.reload} />
{:else if tab === 'quick-wins'}
  <Card flush busy={qw.loading && Boolean(qw.data)}>
    {#if !qw.data}
      <div class="pad"><Skeleton kind="table" rows={8} /></div>
    {:else if qw.data.quickWins.length === 0}
      <EmptyState compact title="No quick wins in this range" icon="opportunities">
        <p>No query sits between position {qw.data.criteria.minPosition} and {qw.data.criteria.maxPosition} with at least {int(qw.data.criteria.minImpressions)} impressions. Try a longer range.</p>
      </EmptyState>
    {:else}
      <DataTable label="Quick wins" rows={qw.data.quickWins} columns={qwCols} sort={{ key: 'potentialExtraClicks', dir: 'desc' }} rowKey={(r) => `${r.query}|${r.page}`} limit={25} />
    {/if}
    {#snippet footer()}
      {#if qw.data}
        <div class="foot">
          <span class="criteria">Position {qw.data.criteria.minPosition}–{qw.data.criteria.maxPosition} · at least {int(qw.data.criteria.minImpressions)} impressions</span>
          <Notes notes={qw.data.notes} />
        </div>
      {/if}
    {/snippet}
  </Card>
{:else if tab === 'cannibalization'}
  {#if !cann.data}
    <Card><Skeleton kind="table" rows={6} /></Card>
  {:else if cann.data.issues.length === 0}
    <Card>
      <EmptyState compact title="No competing pages found" icon="check">
        <p>No query splits its impressions across two or more pages with at least {Math.round(cann.data.criteria.minShare * 100)}% each.</p>
      </EmptyState>
    </Card>
  {:else}
    <div class="issues" class:refetching={cann.loading}>
      {#each cann.data.issues as issue (issue.query)}
        <Card>
          <div class="issue-head">
            <h3>{issue.query}</h3>
            <span class="issue-meta num">{int(issue.impressions)} impressions · {int(issue.clicks)} clicks · {issue.pages.length} pages</span>
          </div>
          <SegmentBar
            label="Impression share for “{issue.query}”"
            parts={issue.pages.map((p, i) => ({ key: p.page ?? String(i), label: p.page ?? '?', value: p.impressions, color: ['var(--series-training)', 'var(--series-search)', 'var(--series-user)', 'var(--series-other)', 'var(--text-4)'][i] ?? 'var(--text-4)' }))} />
          <ul class="competing">
            {#each issue.pages as p, i (p.page ?? i)}
              <li>
                <span class="sw" style:background={['var(--series-training)', 'var(--series-search)', 'var(--series-user)', 'var(--series-other)', 'var(--text-4)'][i] ?? 'var(--text-4)'}></span>
                <span class="grow"><PathText path={p.page} /></span>
                <span class="num share">{Math.round(p.share * 100)}%</span>
                <span class="num cell">pos {decimal(p.position, 1)}</span>
                <span class="num cell">{int(p.clicks)} {p.clicks === 1 ? 'click' : 'clicks'}</span>
              </li>
            {/each}
          </ul>
        </Card>
      {/each}
    </div>
  {/if}
  <div class="notes-below"><Notes notes={cann.data?.notes} /></div>
{:else if tab === 'ctr-anomalies'}
  <Card flush busy={ctr.loading && Boolean(ctr.data)}>
    {#if !ctr.data}
      <div class="pad"><Skeleton kind="table" rows={8} /></div>
    {:else if ctr.data.anomalies.length === 0}
      <EmptyState compact title="No CTR anomalies" icon="check">
        <p>Every query with at least {int(ctr.data.criteria.minImpressions)} impressions earns at least {Math.round(ctr.data.criteria.threshold * 100)}% of its expected CTR.</p>
      </EmptyState>
    {:else}
      <DataTable label="CTR anomalies" rows={ctr.data.anomalies} columns={ctrCols} sort={{ key: 'lostClicks', dir: 'desc' }} rowKey={(r) => r.query ?? ''} limit={25} />
    {/if}
    {#snippet footer()}
      {#if ctr.data}
        <div class="foot">
          <span class="criteria">At least {int(ctr.data.criteria.minImpressions)} impressions · CTR below {Math.round(ctr.data.criteria.threshold * 100)}% of expected</span>
          <Notes notes={ctr.data.notes} />
        </div>
      {/if}
    {/snippet}
  </Card>
{:else}
  <Card flush busy={decay.loading && Boolean(decay.data)}>
    {#if !decay.data}
      <div class="pad"><Skeleton kind="table" rows={6} /></div>
    {:else if decay.data.decaying.length === 0}
      <EmptyState compact title="No decaying pages" icon="check">
        <p>No page with at least {decay.data.criteria.minWeeklyClicks} clicks a week at its peak has dropped {Math.round(decay.data.criteria.minDecline * 100)}% or more.</p>
      </EmptyState>
    {:else}
      <DataTable label="Content decay" rows={decay.data.decaying} columns={decayCols} sort={{ key: 'declinePct', dir: 'desc' }} rowKey={(r) => r.page} limit={25} />
    {/if}
    {#snippet footer()}
      {#if decay.data}
        <div class="foot">
          <span class="criteria">{rangeLabel(decay.data.range)} · {weeks} complete weeks</span>
          <Notes notes={decay.data.notes} />
        </div>
      {/if}
    {/snippet}
  </Card>
{/if}

<style>
  .pad {
    padding: 4px 16px 16px;
  }
  .q {
    display: block;
  }
  .sub {
    display: block;
    margin-top: 1px;
    font-size: 11.5px;
    color: var(--text-3);
  }
  .sub.path {
    font-size: 11.5px;
    color: var(--text-3);
  }
  .ctr-pair {
    display: inline-flex;
    gap: 6px;
    align-items: baseline;
  }
  .ctr-pair strong {
    font-weight: 600;
    color: var(--warn);
  }
  .decline {
    font-weight: 600;
    color: var(--neg);
  }
  .foot {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .criteria {
    font-size: 12px;
    color: var(--text-2);
  }
  .issues {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 16px;
  }
  @media (max-width: 1080px) {
    .issues {
      grid-template-columns: minmax(0, 1fr);
    }
  }
  .issue-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 4px 12px;
    flex-wrap: wrap;
    margin-bottom: 12px;
  }
  .issue-head h3 {
    font-size: 14px;
    font-weight: 600;
  }
  .issue-meta {
    font-size: 12px;
    color: var(--text-3);
  }
  .competing {
    list-style: none;
    margin: 12px 0 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .competing li {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 12.5px;
    flex-wrap: wrap;
  }
  .sw {
    width: 8px;
    height: 8px;
    border-radius: 2px;
    flex: none;
  }
  .grow {
    flex: 1 1 160px;
    min-width: 0;
  }
  .share {
    font-weight: 600;
    min-width: 36px;
    text-align: right;
  }
  .cell {
    color: var(--text-3);
    min-width: 56px;
    text-align: right;
  }
  .intro {
    margin: -4px 0 14px;
    font-size: 13px;
    color: var(--text-2);
    max-width: 760px;
  }
  .notes-below {
    margin-top: 12px;
  }
</style>
