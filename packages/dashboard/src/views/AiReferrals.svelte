<script lang="ts">
  import BarList from '../components/BarList.svelte';
  import Card from '../components/Card.svelte';
  import PathText from '../components/PathText.svelte';
  import DataTable from '../components/DataTable.svelte';
  import EmptyState from '../components/EmptyState.svelte';
  import ErrorBanner from '../components/ErrorBanner.svelte';
  import Icon from '../components/Icon.svelte';
  import LineChart from '../components/LineChart.svelte';
  import Notes from '../components/Notes.svelte';
  import PageHeader from '../components/PageHeader.svelte';
  import Skeleton from '../components/Skeleton.svelte';
  import Stat from '../components/Stat.svelte';
  import { apiUrl } from '../lib/api';
  import { eachDay, int, rangeLabel } from '../lib/format';
  import { resource } from '../lib/resource.svelte';
  import { href } from '../lib/router.svelte';
  import { ui } from '../lib/state.svelte';
  import type { Column } from '../lib/table';
  import type { AiReferralsResponse, ReferralRow } from '../lib/types';

  const params = () => ({ site: ui.siteId, ...ui.rangeParams() });
  const byHost = resource<AiReferralsResponse>(() => (ui.siteId ? apiUrl('/api/ai-referrals', { ...params(), groupBy: 'refererHost', limit: 50 }) : null));
  const byDate = resource<AiReferralsResponse>(() => (ui.siteId ? apiUrl('/api/ai-referrals', { ...params(), groupBy: 'date', limit: 500 }) : null));
  const byPage = resource<AiReferralsResponse>(() => (ui.siteId ? apiUrl('/api/ai-referrals', { ...params(), groupBy: 'path', limit: 100 }) : null));

  const notConfigured = $derived(byHost.error?.code === 'not_configured');
  const visits = $derived((byHost.data?.rows ?? []).reduce((s, r) => s + r.visits, 0));
  const views = $derived((byHost.data?.rows ?? []).reduce((s, r) => s + r.pageViews, 0));

  // Group hosts by assistant (chatgpt.com and chat.openai.com are both ChatGPT).
  const assistants = $derived.by(() => {
    const m = new Map<string, { visits: number; hosts: string[] }>();
    for (const r of byHost.data?.rows ?? []) {
      const name = r.assistant ?? r.refererHost ?? 'Unknown';
      const e = m.get(name) ?? { visits: 0, hosts: [] };
      e.visits += r.visits;
      if (r.refererHost) e.hosts.push(r.refererHost);
      m.set(name, e);
    }
    return [...m.entries()].sort((a, b) => b[1].visits - a[1].visits);
  });

  const trend = $derived.by(() => {
    const rows = byDate.data?.rows ?? [];
    const range = byDate.data?.range;
    if (!range || rows.length === 0) return null;
    const m = new Map(rows.map((r) => [r.date ?? '', r]));
    const dates = eachDay(range.start, range.end);
    return { dates, values: dates.map((d) => m.get(d)?.visits ?? 0) };
  });

  const maxPage = $derived(Math.max(1, ...(byPage.data?.rows.map((r) => r.visits) ?? [])));
  const pageCols: Column<ReferralRow>[] = $derived([
    { key: 'path', label: 'Page', grow: true, sortable: true, render: pathCell },
    { key: 'visits', label: 'AI visits', align: 'right', sortable: true, width: '130px', text: (r) => int(r.visits), bar: (r) => ({ value: r.visits, max: maxPage }) },
    { key: 'pageViews', label: 'Page views', align: 'right', sortable: true, width: '100px', text: (r) => int(r.pageViews), hideOnMobile: true },
  ]);
</script>

{#snippet pathCell(r: ReferralRow)}
  <PathText path={r.path} />
{/snippet}

<PageHeader title="AI referrals" meta={byHost.data ? rangeLabel(byHost.data.range) : byHost.error ? null : undefined} />

{#if notConfigured}
  <Card>
    <EmptyState title="Web Analytics is not set up for this site" icon="referral">
      <p>Connect Cloudflare Web Analytics to this site in Settings.</p>
      {#snippet actions()}
        <a class="btn" href={href('settings', 'checks')}><Icon name="settings" size={14} /> Setup checks</a>
      {/snippet}
    </EmptyState>
  </Card>
{:else if byHost.error}
  <ErrorBanner error={byHost.error} retry={byHost.reload} />
{:else}
  <div class="stack">
    <div class="grid-2 top">
      <Card title="Visits from AI assistants" busy={byDate.loading && Boolean(byDate.data)}>
        {#if !byHost.data}
          <Skeleton kind="stats" />
        {:else}
          <div class="stats">
            <Stat label="AI visits" value={int(visits)} size="lg" />
            <Stat label="Page views" value={int(views)} size="lg" />
            <Stat label="Assistants" value={String(assistants.length)} size="lg" />
          </div>
          {#if trend}
            <div class="trend">
              <LineChart dates={trend.dates} series={[{ key: 'visits', label: 'AI visits', values: trend.values, color: 'var(--chart)', area: true }]} height={150} label="AI referral visits per day" />
            </div>
          {/if}
        {/if}
      </Card>
      <Card title="By assistant" busy={byHost.loading && Boolean(byHost.data)}>
        {#if !byHost.data}
          <Skeleton kind="table" rows={5} />
        {:else if assistants.length === 0}
          <EmptyState compact title="No AI referral visits in this range" icon="referral" />
        {:else}
          <BarList label="AI visits by assistant" items={assistants.map(([name, e]) => ({ key: name, label: name, value: e.visits, meta: e.hosts.join(', ') }))} />
        {/if}
      </Card>
    </div>

    <Card title="Landing pages" flush busy={byPage.loading && Boolean(byPage.data)}>
      {#if byPage.error}
        <div class="pad"><ErrorBanner error={byPage.error} retry={byPage.reload} /></div>
      {:else if !byPage.data}
        <div class="pad"><Skeleton kind="table" rows={8} /></div>
      {:else if byPage.data.rows.length === 0}
        <EmptyState compact title="No AI referral visits in this range" icon="referral" />
      {:else}
        <DataTable label="AI referral visits by landing page" rows={byPage.data.rows} columns={pageCols} sort={{ key: 'visits', dir: 'desc' }} rowKey={(r) => r.path ?? ''} limit={25} />
      {/if}
      {#snippet footer()}
        <Notes notes={byHost.data?.notes} />
      {/snippet}
    </Card>
  </div>
{/if}

<style>
  .stats {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 12px;
  }
  .trend {
    margin-top: 16px;
  }
  .pad {
    padding: 4px 16px 16px;
  }
</style>
