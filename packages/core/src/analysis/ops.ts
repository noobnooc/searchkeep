import { findSite, SearchkeepError, segmentsEnabled } from '../config.js';
import { safeMessage } from '../errors.js';
import type { ReadinessReport } from '../auth/readiness.js';
import type { SourceClients } from '../sources.js';
import { pageToUrl } from '../url.js';
import type { AppConfig, SearchSource, SiteConfig } from '../types.js';
import { previousPeriod, rangeLength } from '../dates.js';
import { clampLimit, metrics, resolve, type AnalysisContext, type CommonParams } from './common.js';
import { aiCrawlers } from './geo.js';
import { syncProgress, type SyncProgressReport } from '../sync/progress.js';
import { MAX_INDEX_URLS } from '../sync/run-sync.js';
import { formatUntil, REINSPECT_DAYS, SOURCE_NAMES } from '../sync/state.js';
import type { IndexStatusRow } from '../types.js';

export interface OpsContext extends AnalysisContext {
  clients: SourceClients;
}

function sourcesOf(ctx: OpsContext, site: SiteConfig) {
  return {
    gsc: Boolean(site.gscProperty && ctx.clients.gsc),
    bing: Boolean(site.bingSiteUrl && ctx.clients.bing),
    aiCrawlers: Boolean(site.cloudflareZoneId && ctx.clients.cloudflare),
    searchCrawlers: Boolean(site.cloudflareZoneId && ctx.clients.cloudflare),
    webAnalytics: Boolean(site.webAnalyticsSiteTag && ctx.clients.cloudflare && ctx.config.cloudflare.accountId),
    indexCoverage: Boolean(site.gscProperty && ctx.clients.gsc && ctx.clients.sitemaps && ctx.config.gsc.inspectionsPerDay > 0),
    /** Query and page rows per country and device are synced (GSC_SEGMENT_SITES). */
    segments: Boolean(site.gscProperty && ctx.clients.gsc && segmentsEnabled(ctx.config, site.id)),
  };
}

/** Which app sources are connected for an app. */
export function appStoresOf(ctx: OpsContext, app: AppConfig) {
  return {
    appStore: Boolean(app.appleId && ctx.clients.asc),
    googlePlay: Boolean(app.playPackage && ctx.clients.play && ctx.config.play.bucket),
    appStorePublic: Boolean(app.appleId && ctx.clients.appStore),
  };
}

export async function listSites(ctx: OpsContext) {
  const coverage = await ctx.store.coverage();
  return {
    sites: ctx.config.sites.map((site) => ({
      id: site.id,
      domain: site.domain,
      origin: site.origin ?? 'secret',
      sources: sourcesOf(ctx, site),
      data: coverage.filter((c) => c.siteId === site.id).map(({ siteId: _s, ...rest }) => rest),
    })),
  };
}

export async function inspectUrl(ctx: OpsContext, p: { site?: string; url: string }) {
  const site = findSite(ctx.config, p.site);
  if (!ctx.clients.gsc || !site.gscProperty) throw new SearchkeepError('not_configured', 'Search Console is not configured for this site.');
  const url = /^https?:\/\//i.test(p.url) ? p.url : pageToUrl(p.url.startsWith('/') ? p.url : `/${p.url}`, site.domain);
  const result = await ctx.clients.gsc.inspectUrl(site.gscProperty, url);
  return {
    site: site.id,
    ...result,
    notes: ['Live call to the Search Console URL Inspection API (about 2,000 calls per property per day).'],
  };
}

export async function listSitemaps(ctx: OpsContext, p: { site?: string; live?: boolean }) {
  const site = findSite(ctx.config, p.site);
  if (p.live) {
    if (!ctx.clients.gsc || !site.gscProperty)
      throw new SearchkeepError('not_configured', 'Search Console is not configured for this site.');
    const maps = await ctx.clients.gsc.listSitemaps(site.gscProperty);
    await ctx.store.replaceSitemaps(site.id, 'gsc', maps);
    return { site: site.id, live: true, sitemaps: maps, notes: [SITEMAP_INDEXED_NOTE] };
  }
  return { site: site.id, live: false, sitemaps: await ctx.store.listSitemaps(site.id, 'gsc'), notes: [SITEMAP_INDEXED_NOTE] };
}

const SITEMAP_INDEXED_NOTE =
  "Google's Sitemaps API no longer reports how many URLs are indexed (indexed is null); index_coverage inspects the sitemaps' URLs and counts them.";

export interface IndexCoverageParams {
  site?: string;
  /** Only URLs whose coverage state contains this text, e.g. "Crawled - currently not indexed". */
  coverageState?: string;
  /** Only URLs with this verdict: PASS (indexed), NEUTRAL (excluded), FAIL (error), PENDING (not inspected yet), ERROR (inspection failed). */
  verdict?: string;
  /** Only URLs with rich result (structured data) issues. */
  richResultIssues?: boolean;
  /** Coverage changes of the last this many days. Default 7. */
  changedDays?: number;
  limit?: number;
}

const VERDICTS = ['PASS', 'NEUTRAL', 'FAIL', 'PENDING', 'ERROR'];

/** Drops empty fields so long URL lists stay compact. */
function compactRow(r: IndexStatusRow): Partial<IndexStatusRow> {
  return Object.fromEntries(
    Object.entries(r).filter(([, v]) => v !== null && v !== undefined && !(Array.isArray(v) && v.length === 0)),
  ) as Partial<IndexStatusRow>;
}

/**
 * Index coverage from the stored URL Inspection snapshot of the sitemaps' URLs: how many are
 * indexed, why the others are not, rich result (structured data) problems, and recent changes.
 */
export async function indexCoverage(ctx: OpsContext, p: IndexCoverageParams) {
  const site = findSite(ctx.config, p.site);
  const verdict = p.verdict?.toUpperCase();
  if (verdict && !VERDICTS.includes(verdict)) throw new SearchkeepError('bad_request', `verdict must be one of ${VERDICTS.join(', ')}.`);
  const now = ctx.now ? ctx.now() : new Date();
  const changedDays = Math.max(1, Math.min(365, Math.floor(p.changedDays ?? 7)));
  const res = await ctx.store.indexCoverage({
    siteId: site.id,
    ...(p.coverageState ? { coverageState: p.coverageState } : {}),
    ...(verdict ? { verdict } : {}),
    ...(p.richResultIssues ? { richResultIssues: true } : {}),
    changedSince: new Date(now.getTime() - changedDays * 86_400_000).toISOString(),
    limit: clampLimit(p.limit, 50),
  });
  const count = (v: string) => res.states.filter((s) => s.verdict === v).reduce((t, s) => t + s.urls, 0);
  const t = res.totals;
  const perDay = ctx.config.gsc.inspectionsPerDay;
  const notes: string[] = [];
  if (!site.gscProperty || !ctx.clients.gsc) notes.push('Search Console is not configured for this site.');
  else if (perDay === 0) notes.push('Index coverage is off: GSC_INSPECTIONS_PER_DAY is 0.');
  else if (t.urls === 0)
    notes.push(
      'No URLs tracked yet. They come from the sitemaps Search Console knows (see list_sitemaps), read once a day; the sync then inspects them with the calls it has left over.',
    );
  else if (t.inspected < t.urls)
    notes.push(`${t.urls - t.inspected} of ${t.urls} URLs are not inspected yet; up to ${perDay} are inspected per day.`);
  if (t.urls >= MAX_INDEX_URLS) notes.push(`Only the first ${MAX_INDEX_URLS.toLocaleString('en-US')} sitemap URLs are tracked.`);
  notes.push(
    `A snapshot, not live: each URL is inspected again after about ${REINSPECT_DAYS} days (oldest first), up to GSC_INSPECTIONS_PER_DAY (${perDay}) per site and day. inspect_url shares the URL Inspection quota (about 2,000 per property and day).`,
  );
  return {
    site: site.id,
    totals: {
      urls: t.urls,
      inspected: t.inspected,
      indexed: count('PASS'),
      notIndexed: count('NEUTRAL') + count('FAIL'),
      pending: t.urls - t.inspected,
      errors: t.errors,
      oldestInspectedAt: t.oldestInspectedAt,
      newestInspectedAt: t.newestInspectedAt,
    },
    states: res.states,
    richResults: res.richResults,
    urls: res.urls.map(compactRow),
    changes: res.changes,
    notes,
  };
}

export async function submitSitemap(ctx: OpsContext, p: { site?: string; sitemapUrl: string }) {
  if (!ctx.config.enableWrites) {
    throw new SearchkeepError(
      'writes_disabled',
      'Writes are disabled. Set the ENABLE_WRITES secret to "true" and give the service account Full permission in Search Console.',
    );
  }
  const site = findSite(ctx.config, p.site);
  if (!ctx.clients.gsc || !site.gscProperty) throw new SearchkeepError('not_configured', 'Search Console is not configured for this site.');
  if (!/^https:\/\//i.test(p.sitemapUrl)) throw new SearchkeepError('bad_request', 'sitemapUrl must be an absolute https URL.');
  await ctx.clients.gsc.submitSitemap(site.gscProperty, p.sitemapUrl);
  return { site: site.id, submitted: p.sitemapUrl };
}

export interface SetupCheck {
  id: string;
  label: string;
  status: 'ok' | 'warn' | 'error' | 'skipped';
  detail?: string;
}

/**
 * Everything an agent (or a human) needs to verify a deployment. Never returns
 * secret values — only whether they are present and whether probes succeed.
 */
export async function setupStatus(ctx: OpsContext, p: { readiness: ReadinessReport; probe?: boolean }) {
  const { config } = ctx;
  const checks: SetupCheck[] = [];
  const add = (c: SetupCheck) => checks.push(c);
  for (const c of p.readiness.checks)
    add({ id: `readiness.${c.id}`, label: c.label, status: c.ok ? 'ok' : 'error', ...(c.detail ? { detail: c.detail } : {}) });
  for (const e of config.errors) add({ id: 'config', label: 'Configuration', status: 'error', detail: e });
  add({
    id: 'config.sites',
    label: 'At least one site or app is configured',
    status: config.sites.length > 0 || config.apps.length > 0 ? 'ok' : 'error',
    ...(config.sites.length || config.apps.length
      ? {}
      : { detail: 'Add a site or an app in the dashboard (Settings), or set the SITES or APPS secret.' }),
  });
  add({ id: 'config.cloudflare_account', label: 'CLOUDFLARE_ACCOUNT_ID is set', status: config.cloudflare.accountId ? 'ok' : 'error' });
  add({ id: 'config.cloudflare_token', label: 'CLOUDFLARE_API_TOKEN is set', status: config.cloudflare.apiToken ? 'ok' : 'error' });
  const anyGsc = config.sites.some((s) => s.gscProperty);
  const anyBing = config.sites.some((s) => s.bingSiteUrl);
  add({
    id: 'config.gsc',
    label: 'Search Console credentials (GSC_CLIENT_EMAIL, GSC_PRIVATE_KEY)',
    status: !anyGsc ? 'skipped' : config.gsc.clientEmail && config.gsc.privateKey ? 'ok' : 'error',
    ...(!anyGsc ? { detail: 'No site has gscProperty.' } : {}),
  });
  add({
    id: 'config.bing',
    label: 'Bing Webmaster Tools API key (BING_API_KEY)',
    status: !anyBing ? 'skipped' : config.bing.apiKey ? 'ok' : 'error',
    ...(!anyBing ? { detail: 'No site has bingSiteUrl.' } : {}),
  });
  const anyApple = config.apps.some((a) => a.appleId);
  const anyPlay = config.apps.some((a) => a.playPackage);
  const ascSet = [config.asc.keyId, config.asc.issuerId, config.asc.privateKey].filter(Boolean).length;
  add({
    id: 'config.asc',
    label: 'App Store Connect key (ASC_KEY_ID, ASC_ISSUER_ID, ASC_PRIVATE_KEY; Sales and Reports role)',
    status: !anyApple ? 'skipped' : ascSet === 3 ? 'ok' : 'error',
    ...(!anyApple ? { detail: 'No app has an App Store Apple ID.' } : ascSet === 3 ? {} : { detail: 'Set all three secrets.' }),
  });
  add({
    id: 'config.play',
    label: 'Google Play reports (PLAY_REPORTS_BUCKET and a service account)',
    status: !anyPlay ? 'skipped' : config.play.bucket && config.play.clientEmail && config.play.privateKey ? 'ok' : 'error',
    ...(!anyPlay
      ? { detail: 'No app has a Google Play package name.' }
      : !config.play.bucket
        ? { detail: 'Set PLAY_REPORTS_BUCKET to the Cloud Storage bucket of your Play Console reports.' }
        : !(config.play.clientEmail && config.play.privateKey)
          ? { detail: 'Set GSC_CLIENT_EMAIL and GSC_PRIVATE_KEY (or PLAY_CLIENT_EMAIL and PLAY_PRIVATE_KEY).' }
          : {}),
  });
  if (config.appStorePublic)
    add({
      id: 'config.app_store_public',
      label: 'App Store public feeds (opt-in plugin)',
      status: 'ok',
      detail: "On: reads Apple's public charts and ratings and keeps only your own apps' position and rating.",
    });
  add({
    id: 'config.writes',
    label: 'Writes to external systems',
    status: 'ok',
    detail: config.enableWrites ? 'Enabled (submit_sitemap allowed).' : 'Disabled (read-only, default).',
  });

  if (p.probe !== false) {
    const probe = async (id: string, label: string, fn: () => Promise<SetupCheck['status'] | [SetupCheck['status'], string]>) => {
      try {
        const res = await fn();
        const [status, detail] = Array.isArray(res) ? res : [res, undefined];
        add({ id, label, status, ...(detail ? { detail } : {}) });
      } catch (err) {
        add({ id, label, status: 'error', detail: safeMessage(err) });
      }
    };
    const { gsc, bing, cloudflare, asc, play } = ctx.clients;
    if (asc && anyApple) {
      await probe('probe.asc', 'App Store Connect key can see each app', async () => {
        const apps = await asc.listApps();
        const missing = config.apps.filter((a) => a.appleId && !apps.some((x) => x.id === a.appleId));
        if (missing.length)
          return ['error', `Not visible to the App Store Connect key: ${missing.map((a) => `${a.name} (${a.appleId})`).join(', ')}.`];
        return 'ok';
      });
    }
    if (play && anyPlay && config.play.bucket) {
      await probe('probe.play', 'Service account can read the Play Console reports', async () => {
        const pkg = config.apps.find((a) => a.playPackage)!.playPackage!;
        const files = await play.listObjects(config.play.bucket!, `stats/installs/installs_${pkg}_`);
        if (files.length === 0)
          return [
            'warn',
            `No report files for ${pkg} yet. The Play Console writes them within a day or two; access granted to a new service account can take up to 24 hours.`,
          ];
        return 'ok';
      });
    }
    if (cloudflare) {
      await probe('probe.cloudflare_token', 'Cloudflare API token is active', async () => {
        const v = await cloudflare.verifyToken();
        return v.active ? 'ok' : ['error', v.message ?? 'Token is not active.'];
      });
    }
    if (gsc && anyGsc) {
      await probe('probe.gsc', 'Service account can read each GSC property', async () => {
        const props = await gsc.listProperties();
        const missing = config.sites.filter((s) => s.gscProperty && !props.some((x) => x.siteUrl === s.gscProperty));
        if (missing.length)
          return [
            'error',
            `Not visible to the service account: ${missing.map((s) => s.gscProperty).join(', ')}. Add ${config.gsc.clientEmail} as a Restricted user in Search Console.`,
          ];
        return 'ok';
      });
    }
    if (bing && anyBing) {
      await probe('probe.bing', 'Bing API key can read each site', async () => {
        const sites = await bing.getUserSites();
        const norm = (u: string) => u.toLowerCase().replace(/\/+$/, '');
        const missing = config.sites.filter((s) => s.bingSiteUrl && !sites.some((x) => norm(x.url) === norm(s.bingSiteUrl!)));
        if (missing.length) return ['error', `Not found in Bing Webmaster Tools: ${missing.map((s) => s.bingSiteUrl).join(', ')}.`];
        return 'ok';
      });
    }
  }

  const runs = await ctx.store.listSyncRuns(5);
  const last = runs[0];
  add({
    id: 'sync.last_run',
    label: 'Most recent sync',
    status: !last
      ? 'warn'
      : last.status === 'ok' || last.status === 'skipped'
        ? 'ok'
        : last.status === 'partial'
          ? 'warn'
          : last.status === 'running'
            ? 'warn'
            : 'error',
    detail: last
      ? `${last.status} at ${last.finishedAt ?? last.startedAt}; ${last.rowsWritten} rows written${last.message ? `; ${last.message}` : ''}`
      : 'No sync has run yet. Trigger one from the dashboard or with POST /api/sync.',
  });
  const progress = await syncProgress(ctx);
  add({
    id: 'sync.progress',
    label: 'Initial sync and history',
    status: progress.summary.issues > 0 ? 'warn' : 'ok',
    detail: describeProgress(progress),
  });
  const errors = checks.filter((c) => c.status === 'error').length;
  return {
    state: p.readiness.state,
    ok: p.readiness.state === 'ready' && errors === 0,
    summary: errors === 0 ? 'All checks passed.' : `${errors} check(s) need attention.`,
    checks,
    sites: config.sites.map((s) => ({ id: s.id, domain: s.domain, sources: sourcesOf(ctx, s) })),
    apps: config.apps.map((a) => ({ id: a.id, name: a.name, stores: appStoresOf(ctx, a) })),
    coverage: await ctx.store.coverage(),
    syncProgress: progress,
    recentSyncs: runs.map((r) => ({
      startedAt: r.startedAt,
      finishedAt: r.finishedAt,
      trigger: r.trigger,
      status: r.status,
      rowsWritten: r.rowsWritten,
      message: r.message,
    })),
  };
}

/** One sentence on where the sync stands, for `setup_status`. */
export function describeProgress(p: SyncProgressReport): string {
  const today = p.checkedAt.slice(0, 10);
  const parts: string[] = [];
  const apps = p.summary.apps ?? 0;
  if (p.summary.sites === 0 && apps === 0) parts.push('No sites or apps to sync.');
  else if (p.phase === 'done') parts.push('Everything is synced; new days arrive with the daily increments.');
  else {
    const what = [
      ...(p.summary.sites ? [`${p.summary.sitesWithRecentData} of ${p.summary.sites} site${p.summary.sites === 1 ? '' : 's'}`] : []),
      ...(apps ? [`${p.summary.appsWithRecentData} of ${apps} app${apps === 1 ? '' : 's'}`] : []),
    ];
    parts.push(`Latest days are in for ${what.join(' and ')}; history is ${p.summary.historyPercent}% synced.`);
  }
  for (const x of p.paused) parts.push(`${SOURCE_NAMES[x.source]} is paused until ${formatUntil(x.until, today)} (rate limited).`);
  if (p.writeBudget.reached && p.phase !== 'done') parts.push('History continues after 00:00 UTC (daily write budget reached).');
  if (p.summary.issues > 0)
    parts.push(
      `${p.summary.issues} dataset${p.summary.issues === 1 ? '' : 's'} failed and will be retried; see syncProgress for the errors.`,
    );
  return parts.join(' ');
}

/** Dashboard home: headline numbers and trends for one site. */
export async function overview(ctx: OpsContext, p: CommonParams) {
  const r = await resolve(ctx, { ...p, searchType: 'web' }, { days: 28 });
  const prev = previousPeriod(r.range);
  const sources: SearchSource[] = ['gsc', 'bing'];
  const perSource = await Promise.all(
    sources.map(async (source) => {
      const base = { siteId: r.site.id, source, filters: { brand: r.brand } } as const;
      const [cur, before, daily] = await Promise.all([
        ctx.store.queryPerformance({ ...base, range: r.range, dimensions: [], limit: 1 }),
        ctx.store.queryPerformance({ ...base, range: prev, dimensions: [], limit: 1 }),
        ctx.store.queryPerformance({
          ...base,
          range: { start: prev.start, end: r.range.end },
          dimensions: [source === 'bing' ? 'week' : 'date'],
          orderBy: 'date',
          order: 'asc',
          limit: 800,
        }),
      ]);
      return { source, current: cur[0] ?? metrics(0, 0, null), previous: before[0] ?? metrics(0, 0, null), series: daily };
    }),
  );
  // Crawler data is fresher than GSC: same window length, ending at its own latest date.
  const crawlers = await aiCrawlers(ctx, {
    ...(p.site ? { site: p.site } : {}),
    days: rangeLength(r.range),
    groupBy: ['crawler'],
    limit: 10,
  });
  return {
    site: r.site.id,
    range: r.range,
    previousRange: prev,
    brand: r.brand,
    search: perSource,
    crawlers: { total: crawlers.totalRequests, top: crawlers.rows },
    notes: r.notes,
  };
}

type Discovery<T> = { ok: true; items: T[] } | { ok: false; reason: string };

async function discover<T>(enabled: boolean, reason: string, fn: () => Promise<T[]>): Promise<Discovery<T>> {
  if (!enabled) return { ok: false, reason };
  try {
    return { ok: true, items: await fn() };
  } catch (err) {
    return { ok: false, reason: safeMessage(err) };
  }
}

/**
 * Lists what the configured credentials can see, so the dashboard can offer
 * choices instead of asking for identifiers. Every part degrades gracefully.
 */
export async function discoverSources(ctx: OpsContext) {
  const { gsc, bing, cloudflare } = ctx.clients;
  const accountId = ctx.config.cloudflare.accountId;
  const [gscProperties, bingSites, zones, webAnalytics] = await Promise.all([
    discover(Boolean(gsc), 'Search Console credentials (GSC_CLIENT_EMAIL, GSC_PRIVATE_KEY) are not set.', () => gsc!.listProperties()),
    discover(Boolean(bing), 'BING_API_KEY is not set.', () => bing!.getUserSites()),
    discover(Boolean(cloudflare?.listZones && accountId), 'CLOUDFLARE_API_TOKEN or CLOUDFLARE_ACCOUNT_ID is not set.', () =>
      cloudflare!.listZones!(accountId!),
    ),
    discover(Boolean(cloudflare?.listWebAnalyticsSites && accountId), 'CLOUDFLARE_API_TOKEN or CLOUDFLARE_ACCOUNT_ID is not set.', () =>
      cloudflare!.listWebAnalyticsSites!(accountId!),
    ),
  ]);
  return { gscProperties, bingSites, zones, webAnalytics };
}
