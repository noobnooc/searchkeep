import { findSite, SearchkeepError } from '../config.js';
import { safeMessage } from '../errors.js';
import type { ReadinessReport } from '../auth/readiness.js';
import type { SourceClients } from '../sources.js';
import { pageToUrl } from '../url.js';
import type { SearchSource, SiteConfig } from '../types.js';
import { previousPeriod } from '../dates.js';
import { metrics, resolve, type AnalysisContext, type CommonParams } from './common.js';
import { aiCrawlers } from './geo.js';

export interface OpsContext extends AnalysisContext {
  clients: SourceClients;
}

function sourcesOf(ctx: OpsContext, site: SiteConfig) {
  return {
    gsc: Boolean(site.gscProperty && ctx.clients.gsc),
    bing: Boolean(site.bingSiteUrl && ctx.clients.bing),
    aiCrawlers: Boolean(site.cloudflareZoneId && ctx.clients.cloudflare),
    webAnalytics: Boolean(site.webAnalyticsSiteTag && ctx.clients.cloudflare && ctx.config.cloudflare.accountId),
  };
}

export async function listSites(ctx: OpsContext) {
  const coverage = await ctx.store.coverage();
  return {
    sites: ctx.config.sites.map((site) => ({
      id: site.id,
      domain: site.domain,
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
  return { site: site.id, ...result, notes: ['Live call to the Search Console URL Inspection API (about 2,000 calls per property per day).'] };
}

export async function listSitemaps(ctx: OpsContext, p: { site?: string; live?: boolean }) {
  const site = findSite(ctx.config, p.site);
  if (p.live) {
    if (!ctx.clients.gsc || !site.gscProperty) throw new SearchkeepError('not_configured', 'Search Console is not configured for this site.');
    const maps = await ctx.clients.gsc.listSitemaps(site.gscProperty);
    await ctx.store.replaceSitemaps(site.id, 'gsc', maps);
    return { site: site.id, live: true, sitemaps: maps };
  }
  return { site: site.id, live: false, sitemaps: await ctx.store.listSitemaps(site.id, 'gsc') };
}

export async function submitSitemap(ctx: OpsContext, p: { site?: string; sitemapUrl: string }) {
  if (!ctx.config.enableWrites) {
    throw new SearchkeepError('writes_disabled', 'Writes are disabled. Set the ENABLE_WRITES secret to "true" and give the service account Full permission in Search Console.');
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
  for (const c of p.readiness.checks) add({ id: `readiness.${c.id}`, label: c.label, status: c.ok ? 'ok' : 'error', ...(c.detail ? { detail: c.detail } : {}) });
  for (const e of config.errors) add({ id: 'config', label: 'Configuration', status: 'error', detail: e });
  add({ id: 'config.sites', label: 'SITES has at least one site', status: config.sites.length > 0 ? 'ok' : 'error', ...(config.sites.length ? {} : { detail: 'Set the SITES secret (JSON array).' }) });
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
  add({ id: 'config.writes', label: 'Writes to external systems', status: 'ok', detail: config.enableWrites ? 'Enabled (submit_sitemap allowed).' : 'Disabled (read-only, default).' });

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
    const { gsc, bing, cloudflare } = ctx.clients;
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
        if (missing.length) return ['error', `Not visible to the service account: ${missing.map((s) => s.gscProperty).join(', ')}. Add ${config.gsc.clientEmail} as a Restricted user in Search Console.`];
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
    status: !last ? 'warn' : last.status === 'ok' || last.status === 'skipped' ? 'ok' : last.status === 'partial' ? 'warn' : last.status === 'running' ? 'warn' : 'error',
    detail: last ? `${last.status} at ${last.finishedAt ?? last.startedAt}; ${last.rowsWritten} rows written${last.message ? `; ${last.message}` : ''}` : 'No sync has run yet. Trigger one from the dashboard or with POST /api/sync.',
  });
  const errors = checks.filter((c) => c.status === 'error').length;
  return {
    state: p.readiness.state,
    ok: p.readiness.state === 'ready' && errors === 0,
    summary: errors === 0 ? 'All checks passed.' : `${errors} check(s) need attention.`,
    checks,
    sites: config.sites.map((s) => ({ id: s.id, domain: s.domain, sources: sourcesOf(ctx, s) })),
    coverage: await ctx.store.coverage(),
    recentSyncs: runs.map((r) => ({ startedAt: r.startedAt, finishedAt: r.finishedAt, trigger: r.trigger, status: r.status, rowsWritten: r.rowsWritten, message: r.message })),
  };
}

/** Dashboard home: headline numbers and trends for one site. */
export async function overview(ctx: OpsContext, p: CommonParams) {
  const r = await resolve(ctx, p, { days: 28 });
  const prev = previousPeriod(r.range);
  const sources: SearchSource[] = ['gsc', 'bing'];
  const perSource = await Promise.all(
    sources.map(async (source) => {
      const base = { siteId: r.site.id, source, filters: { brand: r.brand } } as const;
      const [cur, before, daily] = await Promise.all([
        ctx.store.queryPerformance({ ...base, range: r.range, dimensions: [], limit: 1 }),
        ctx.store.queryPerformance({ ...base, range: prev, dimensions: [], limit: 1 }),
        ctx.store.queryPerformance({ ...base, range: { start: prev.start, end: r.range.end }, dimensions: [source === 'bing' ? 'week' : 'date'], orderBy: 'date', order: 'asc', limit: 800 }),
      ]);
      return { source, current: cur[0] ?? metrics(0, 0, null), previous: before[0] ?? metrics(0, 0, null), series: daily };
    }),
  );
  const crawlers = await aiCrawlers(ctx, { ...(p.site ? { site: p.site } : {}), start: r.range.start, end: r.range.end, groupBy: ['crawler'], limit: 10 });
  return { site: r.site.id, range: r.range, previousRange: prev, brand: r.brand, search: perSource, crawlers: { total: crawlers.totalRequests, top: crawlers.rows }, notes: r.notes };
}
