<script lang="ts">
  import Card from '../components/Card.svelte';
  import PathText from '../components/PathText.svelte';
  import DataTable from '../components/DataTable.svelte';
  import EmptyState from '../components/EmptyState.svelte';
  import ErrorBanner from '../components/ErrorBanner.svelte';
  import Icon from '../components/Icon.svelte';
  import IndexCoverageCard from '../components/IndexCoverageCard.svelte';
  import SearchCrawlersCard from '../components/SearchCrawlersCard.svelte';
  import Notes from '../components/Notes.svelte';
  import PageHeader from '../components/PageHeader.svelte';
  import Pill from '../components/Pill.svelte';
  import SegmentBar from '../components/SegmentBar.svelte';
  import Skeleton from '../components/Skeleton.svelte';
  import { apiUrl, request } from '../lib/api';
  import { dateTime, decimal, int, ms, rangeLabel, shortDate } from '../lib/format';
  import { resource } from '../lib/resource.svelte';
  import { ui } from '../lib/state.svelte';
  import type { Column } from '../lib/table';
  import type { CrawlIssue, CrawlIssuesResponse, InspectResponse, Sitemap, SitemapsResponse, WebVitalsPage, WebVitalsResponse } from '../lib/types';

  type Rating = 'good' | 'ni' | 'poor';
  type VitalKey = 'lcpP75' | 'inpP75' | 'clsP75';
  interface Vital {
    key: VitalKey;
    name: string;
    full: string;
    good: number;
    poor: number;
    fmt: (n: number) => string;
  }
  const VITALS: Vital[] = [
    { key: 'lcpP75', name: 'LCP', full: 'Largest Contentful Paint', good: 2500, poor: 4000, fmt: (n) => ms(n) },
    { key: 'inpP75', name: 'INP', full: 'Interaction to Next Paint', good: 200, poor: 500, fmt: (n) => ms(n) },
    { key: 'clsP75', name: 'CLS', full: 'Cumulative Layout Shift', good: 0.1, poor: 0.25, fmt: (n) => decimal(n, 2) },
  ];
  const RATINGS: Rating[] = ['good', 'ni', 'poor'];
  const RATING_LABEL: Record<Rating, string> = { good: 'Good', ni: 'Needs improvement', poor: 'Poor' };
  const RATING_COLOR: Record<Rating, string> = { good: 'var(--vital-good)', ni: 'var(--vital-ni)', poor: 'var(--vital-poor)' };

  function rate(v: number | null | undefined, x: Vital): Rating | null {
    if (v === null || v === undefined || !Number.isFinite(v)) return null;
    return v <= x.good ? 'good' : v <= x.poor ? 'ni' : 'poor';
  }

  const vitals = resource<WebVitalsResponse>(() => (ui.siteId ? apiUrl('/api/web-vitals', { site: ui.siteId, ...ui.rangeParams({ relativeAll: true }), limit: 200 }) : null));
  const sitemaps = resource<SitemapsResponse>(() => (ui.siteId ? apiUrl('/api/sitemaps', { site: ui.siteId }) : null));
  const issues = resource<CrawlIssuesResponse>(() => (ui.siteId ? apiUrl('/api/crawl-issues', { site: ui.siteId }) : null));

  const summary = $derived(
    VITALS.map((v) => {
      const counts: Record<Rating, number> = { good: 0, ni: 0, poor: 0 };
      for (const p of vitals.data?.pages ?? []) {
        const r = rate(p[v.key], v);
        if (r) counts[r]++;
      }
      return { v, counts };
    }),
  );

  const vitalCols: Column<WebVitalsPage>[] = $derived([
    { key: 'page', label: 'Page', grow: true, sortable: true, render: pathCell },
    { key: 'lcpP75', label: 'LCP p75', title: 'Largest Contentful Paint', align: 'right', sortable: true, width: '116px', render: lcpCell },
    { key: 'inpP75', label: 'INP p75', title: 'Interaction to Next Paint', align: 'right', sortable: true, width: '116px', render: inpCell },
    { key: 'clsP75', label: 'CLS p75', title: 'Cumulative Layout Shift', align: 'right', sortable: true, width: '104px', render: clsCell },
    { key: 'samples', label: 'Samples', align: 'right', sortable: true, width: '90px', text: (r) => int(r.samples), hideOnMobile: true },
  ]);

  // Sitemaps: the stored snapshot, or a live refresh from Search Console.
  let live = $state.raw<SitemapsResponse | null>(null);
  let liveError = $state.raw<unknown>(null);
  let refreshing = $state(false);
  const maps = $derived(live ?? sitemaps.data);

  async function refreshSitemaps() {
    refreshing = true;
    liveError = null;
    try {
      live = await request<SitemapsResponse>(apiUrl('/api/sitemaps', { site: ui.siteId, live: 1 }));
    } catch (err) {
      liveError = err;
    } finally {
      refreshing = false;
    }
  }

  const sitemapCols: Column<Sitemap>[] = $derived([
    { key: 'path', label: 'Sitemap', grow: true, sortable: true, render: sitemapPath },
    { key: 'status', label: 'Status', width: '120px', render: sitemapStatus },
    { key: 'submitted', label: 'URLs', align: 'right', sortable: true, width: '80px', text: (r) => int(r.submitted) },
    { key: 'lastSubmitted', label: 'Submitted', sortable: true, width: '120px', text: (r) => (r.lastSubmitted ? shortDate(r.lastSubmitted, true) : '—'), hideOnMobile: true },
    { key: 'lastDownloaded', label: 'Last read by Google', sortable: true, width: '160px', text: (r) => dateTime(r.lastDownloaded) },
  ]);

  const ISSUE_NAMES: Record<string, string> = {
    Code4xx: '4xx response',
    Code5xx: '5xx response',
    Code301: 'Redirect (301)',
    Code302: 'Redirect (302)',
    BlockedByRobotsTxt: 'Blocked by robots.txt',
    DnsErrors: 'DNS error',
    TimeOutErrors: 'Timeout',
  };
  const humanIssue = (s: string) => ISSUE_NAMES[s] ?? s.replace(/([a-z])([A-Z])/g, '$1 $2');

  const issueCols: Column<CrawlIssue>[] = $derived([
    { key: 'url', label: 'URL', grow: true, sortable: true, render: issueUrl },
    { key: 'issue', label: 'Issue', sortable: true, text: (r) => humanIssue(r.issue) },
    { key: 'httpCode', label: 'HTTP', align: 'right', sortable: true, width: '70px', render: issueCode },
    { key: 'detectedAt', label: 'Detected', sortable: true, width: '110px', text: (r) => (r.detectedAt ? shortDate(r.detectedAt, true) : '—'), hideOnMobile: true },
  ]);

  // URL inspection: a live Search Console call (quota: about 2,000 per day per property).
  let inspectInput = $state('');
  let inspecting = $state(false);
  let inspectError = $state.raw<unknown>(null);
  let inspection = $state.raw<InspectResponse | null>(null);

  async function inspect(e: SubmitEvent) {
    e.preventDefault();
    const url = inspectInput.trim();
    if (!url) return;
    inspecting = true;
    inspectError = null;
    try {
      inspection = await request<InspectResponse>('/api/inspect', { method: 'POST', body: JSON.stringify({ site: ui.siteId, url }), contentType: 'application/json' });
    } catch (err) {
      inspection = null;
      inspectError = err;
    } finally {
      inspecting = false;
    }
  }

  function verdictTone(v: string | null | undefined): 'ok' | 'warn' | 'error' | 'neutral' {
    const s = (v ?? '').toUpperCase();
    if (s === 'PASS') return 'ok';
    if (s === 'FAIL') return 'error';
    if (s === 'PARTIAL') return 'warn';
    return 'neutral';
  }
  const INSPECT_FIELDS: Array<[keyof InspectResponse, string]> = [
    ['coverageState', 'Coverage'],
    ['indexingState', 'Indexing'],
    ['robotsTxtState', 'robots.txt'],
    ['pageFetchState', 'Page fetch'],
    ['lastCrawlTime', 'Last crawl'],
    ['crawledAs', 'Crawled as'],
    ['googleCanonical', 'Google canonical'],
    ['userCanonical', 'Declared canonical'],
    ['mobileUsabilityVerdict', 'Mobile usability'],
    ['richResultsVerdict', 'Rich results'],
  ];
  const humanEnum = (s: string) => (/^[A-Z_]+$/.test(s) ? s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ') : s);
</script>

{#snippet pathCell(r: WebVitalsPage)}
  <PathText path={r.page} />
{/snippet}

{#snippet vitalValue(x: Vital, val: number | null | undefined)}
  {@const rt = rate(val, x)}
  {#if rt && val !== null && val !== undefined}
    <span class="vital" title="{x.full}: {RATING_LABEL[rt]}">
      <span class="v-dot" style:background={RATING_COLOR[rt]} aria-hidden="true"></span>
      <span class:poor={rt === 'poor'}>{x.fmt(val)}</span>
      <span class="sr-only">({RATING_LABEL[rt]})</span>
    </span>
  {:else}
    <span class="muted">{'—'}</span>
  {/if}
{/snippet}
{#snippet lcpCell(r: WebVitalsPage)}{@render vitalValue(VITALS[0]!, r.lcpP75)}{/snippet}
{#snippet inpCell(r: WebVitalsPage)}{@render vitalValue(VITALS[1]!, r.inpP75)}{/snippet}
{#snippet clsCell(r: WebVitalsPage)}{@render vitalValue(VITALS[2]!, r.clsP75)}{/snippet}

{#snippet sitemapPath(r: Sitemap)}
  <PathText path={r.path} />
{/snippet}

{#snippet sitemapStatus(r: Sitemap)}
  {#if (r.errors ?? 0) > 0}
    <Pill tone="error">{r.errors} {r.errors === 1 ? 'error' : 'errors'}</Pill>
  {:else if (r.warnings ?? 0) > 0}
    <Pill tone="warn">{r.warnings} {r.warnings === 1 ? 'warning' : 'warnings'}</Pill>
  {:else if r.isPending}
    <Pill tone="neutral" icon={null}>Pending</Pill>
  {:else}
    <Pill tone="ok">Success</Pill>
  {/if}
{/snippet}

{#snippet issueUrl(r: CrawlIssue)}
  <PathText path={r.url} />
{/snippet}

{#snippet issueCode(r: CrawlIssue)}
  {#if r.httpCode}
    <Pill tone={r.httpCode >= 500 ? 'error' : r.httpCode >= 400 ? 'warn' : 'neutral'} icon={null}>{r.httpCode}</Pill>
  {:else}
    <span class="muted">{'—'}</span>
  {/if}
{/snippet}

<PageHeader title="Technical" meta={vitals.data ? `Web Vitals: ${rangeLabel(vitals.data.range)}` : vitals.error ? null : undefined} />

<div class="stack">
  <IndexCoverageCard />

  <SearchCrawlersCard />

  <Card title="Core Web Vitals" subtitle="p75 · real visitors" busy={vitals.loading && Boolean(vitals.data)} flush>
    {#if vitals.error}
      <div class="pad"><ErrorBanner error={vitals.error} retry={vitals.reload} /></div>
    {:else if !vitals.data}
      <div class="pad"><Skeleton kind="stats" /></div>
    {:else if vitals.data.pages.length === 0}
      <EmptyState compact title="No Web Vitals yet" icon="technical">
        <p>Web Vitals come from Cloudflare Web Analytics. Set <code>webAnalyticsSiteTag</code> for this site; data appears after the next sync.</p>
      </EmptyState>
    {:else}
      <div class="vital-summary">
        {#each summary as s (s.v.key)}
          <div class="vs">
            <div class="vs-head">
              <strong>{s.v.name}</strong>
              <span class="muted truncate">{s.v.full}</span>
            </div>
            <SegmentBar label="{s.v.name} ratings across pages" parts={RATINGS.map((r) => ({ key: r, label: RATING_LABEL[r], value: s.counts[r], color: RATING_COLOR[r] }))} />
            <div class="vs-legend num">
              {#each RATINGS as r (r)}
                <span><i style:background={RATING_COLOR[r]}></i>{s.counts[r]} {RATING_LABEL[r].toLowerCase()}</span>
              {/each}
            </div>
            <div class="vs-th">Good ≤ {s.v.fmt(s.v.good)} · Poor &gt; {s.v.fmt(s.v.poor)}</div>
          </div>
        {/each}
      </div>
      <DataTable label="Web Vitals by page" rows={vitals.data.pages} columns={vitalCols} sort={{ key: 'samples', dir: 'desc' }} rowKey={(r) => r.page} limit={25} />
    {/if}
  </Card>

  <div class="grid-2">
    <Card title="URL inspection" subtitle="Live from Search Console">
      <form class="inspect" onsubmit={inspect}>
        <label class="sr-only" for="inspect-url">URL or path</label>
        <input id="inspect-url" class="input" type="text" inputmode="url" placeholder="/pricing or https://{ui.site?.domain ?? 'example.com'}/pricing" bind:value={inspectInput} autocomplete="off" spellcheck="false" />
        <button class="btn primary" type="submit" disabled={inspecting || !inspectInput.trim()}>
          <Icon name="search" size={14} />
          {inspecting ? 'Inspecting…' : 'Inspect'}
        </button>
      </form>
      {#if inspectError}
        <div class="mt"><ErrorBanner error={inspectError} /></div>
      {:else if inspection}
        <div class="result">
          <div class="verdict">
            <span class="path">{inspection.url}</span>
            <Pill tone={verdictTone(inspection.verdict)}>{inspection.verdict ? humanEnum(inspection.verdict) : 'No verdict'}</Pill>
          </div>
          <dl>
            {#each INSPECT_FIELDS as [k, label] (k)}
              {@const v = inspection[k]}
              {#if v !== null && v !== undefined && v !== ''}
                <div>
                  <dt>{label}</dt>
                  <dd class:path={k === 'googleCanonical' || k === 'userCanonical'}>{k === 'lastCrawlTime' ? dateTime(String(v)) : humanEnum(String(v))}</dd>
                </div>
              {/if}
            {/each}
          </dl>
          {#if inspection.inspectionResultLink}
            <a class="ext" href={inspection.inspectionResultLink} target="_blank" rel="noopener noreferrer">Open in Search Console <Icon name="external" size={12} /></a>
          {/if}
          <Notes notes={inspection.notes} />
        </div>
      {:else}
        <p class="hint">About 2,000 inspections per property per day.</p>
      {/if}
    </Card>

    <Card title="Bing crawl issues" subtitle="Bing Webmaster Tools" flush busy={issues.loading && Boolean(issues.data)}>
      {#if issues.error}
        <div class="pad"><ErrorBanner error={issues.error} retry={issues.reload} /></div>
      {:else if !issues.data}
        <div class="pad"><Skeleton kind="table" rows={4} /></div>
      {:else if issues.data.issues.length === 0}
        <EmptyState compact title="No crawl issues reported" icon="check">
          <p>Bing has not reported crawl problems for this site (or Bing is not connected yet).</p>
        </EmptyState>
      {:else}
        <DataTable label="Bing crawl issues" rows={issues.data.issues} columns={issueCols} rowKey={(r) => `${r.url}|${r.issue}`} limit={15} />
      {/if}
    </Card>
  </div>

  <Card title="Sitemaps" subtitle={maps?.live ? 'Fresh from Search Console' : 'Last synced from Search Console'} flush busy={(sitemaps.loading && Boolean(sitemaps.data)) || refreshing}>
    {#snippet actions()}
      <button class="btn sm" onclick={refreshSitemaps} disabled={refreshing}>
        <Icon name="refresh" size={13} />
        {refreshing ? 'Refreshing…' : 'Refresh from Search Console'}
      </button>
    {/snippet}
    {#if liveError}
      <div class="pad"><ErrorBanner error={liveError} title="Could not refresh from Search Console" /></div>
    {/if}
    {#if sitemaps.error && !live}
      <div class="pad"><ErrorBanner error={sitemaps.error} retry={sitemaps.reload} /></div>
    {:else if !maps}
      <div class="pad"><Skeleton kind="table" rows={3} /></div>
    {:else if maps.sitemaps.length === 0}
      <EmptyState compact title="No sitemaps on record" icon="file">
        <p>Submit one in Search Console, then refresh.</p>
      </EmptyState>
    {:else}
      <DataTable label="Sitemaps" rows={maps.sitemaps} columns={sitemapCols} rowKey={(r) => r.path} />
    {/if}
  </Card>
</div>

<style>
  .pad {
    padding: 4px 16px 16px;
  }
  .mt {
    margin-top: 12px;
  }
  .vital-summary {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 24px;
    padding: 6px 16px 18px;
    border-bottom: 1px solid var(--border);
  }
  @media (max-width: 760px) {
    .vital-summary {
      grid-template-columns: minmax(0, 1fr);
      gap: 16px;
    }
  }
  .vs {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: 0;
  }
  .vs-head {
    display: flex;
    align-items: baseline;
    gap: 8px;
    min-width: 0;
  }
  .vs-head strong {
    font-size: 15px;
    font-weight: 650;
  }
  .vs-head .muted {
    font-size: 12px;
  }
  .vs-legend {
    display: flex;
    flex-wrap: wrap;
    gap: 2px 12px;
    font-size: 12px;
    color: var(--text-2);
  }
  .vs-legend span {
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }
  .vs-legend i {
    width: 7px;
    height: 7px;
    border-radius: 50%;
  }
  .vs-th {
    font-size: 11.5px;
    color: var(--text-3);
  }
  .vital {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    justify-content: flex-end;
  }
  .v-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    flex: none;
  }
  .poor {
    font-weight: 600;
  }
  .inspect {
    display: flex;
    gap: 8px;
  }
  .inspect .input {
    flex: 1;
    min-width: 0;
  }
  .hint {
    margin-top: 12px;
    font-size: 12.5px;
    color: var(--text-3);
  }
  .result {
    margin-top: 14px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .verdict {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    flex-wrap: wrap;
  }
  dl {
    margin: 0;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px 16px;
  }
  @media (max-width: 520px) {
    dl {
      grid-template-columns: minmax(0, 1fr);
    }
  }
  dt {
    font-size: 11.5px;
    color: var(--text-3);
  }
  dd {
    margin: 0;
    font-size: 13px;
    overflow-wrap: anywhere;
  }
  .ext {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 12.5px;
    font-weight: 500;
  }
</style>
