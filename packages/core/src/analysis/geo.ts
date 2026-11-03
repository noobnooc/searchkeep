import { findSite, SearchkeepError } from '../config.js';
import { AI_REFERRER_HOSTS } from '../crawlers.js';
import type { CrawlerQuery, DateRange } from '../types.js';
import { clampLimit, resolve, type AnalysisContext, type CommonParams } from './common.js';

export interface GeoFunnelParams extends CommonParams {
  pageContains?: string;
  sortBy?: 'crawled' | 'cited' | 'aiVisits' | 'clicks';
}

const AI_HOSTS = Object.keys(AI_REFERRER_HOSTS);
const CRAWLER_GROUPS: CrawlerQuery['groupBy'] = ['crawler', 'operator', 'purpose', 'path', 'status', 'date'];

/**
 * Per page: crawled by AI bots → cited by AI answers → visited from AI
 * assistants → clicked from search. The steps come from different sources and
 * are joined on the normalized page path.
 */
export async function geoFunnel(ctx: AnalysisContext, p: GeoFunnelParams) {
  const r = await resolve(ctx, { ...p, source: 'gsc', brand: 'all' }, { limit: 50 });
  const range = r.range;
  const siteId = r.site.id;
  const big = 5000;
  const [crawled, cited, referrals, gscPages, bingPages] = await Promise.all([
    ctx.store.queryCrawlers({ siteId, range, groupBy: ['path'], limit: big, ...(p.pageContains ? { pathContains: p.pageContains } : {}) }),
    ctx.store.queryAiCitations(siteId, range, big),
    ctx.store.queryReferrals({ siteId, range, refererHosts: AI_HOSTS, groupBy: ['path'], limit: big }),
    ctx.store.queryPerformance({ siteId, source: 'gsc', range, dimensions: ['page'], filters: p.pageContains ? { pageContains: p.pageContains } : {}, limit: big }),
    ctx.store.queryPerformance({ siteId, source: 'bing', range, dimensions: ['page'], filters: p.pageContains ? { pageContains: p.pageContains } : {}, limit: big }),
  ]);
  interface Row {
    page: string;
    crawled: number;
    cited: number;
    aiVisits: number;
    clicks: number;
    impressions: number;
  }
  const rows = new Map<string, Row>();
  const get = (page: string): Row => {
    let row = rows.get(page);
    if (!row) {
      row = { page, crawled: 0, cited: 0, aiVisits: 0, clicks: 0, impressions: 0 };
      rows.set(page, row);
    }
    return row;
  };
  const match = (page: string) => !p.pageContains || page.toLowerCase().includes(p.pageContains.toLowerCase());
  for (const c of crawled) if (c.path && match(c.path)) get(c.path).crawled += c.requests;
  for (const c of cited) if (match(c.page)) get(c.page).cited += c.value;
  for (const v of referrals) if (v.path && match(v.path)) get(v.path).aiVisits += v.visits;
  for (const g of [...gscPages, ...bingPages]) {
    if (!g.page) continue;
    const row = get(g.page);
    row.clicks += g.clicks;
    row.impressions += g.impressions;
  }
  const sortBy = p.sortBy ?? 'crawled';
  const all = [...rows.values()];
  const totals = all.reduce(
    (t, x) => ({ crawled: t.crawled + x.crawled, cited: t.cited + x.cited, aiVisits: t.aiVisits + x.aiVisits, clicks: t.clicks + x.clicks }),
    { crawled: 0, cited: 0, aiVisits: 0, clicks: 0 },
  );
  const notes: string[] = [];
  if (totals.crawled === 0) notes.push('No AI crawler data: set cloudflareZoneId for this site (the zone must be proxied through Cloudflare) and give the API token Zone Analytics Read.');
  if (totals.cited === 0) notes.push('No AI citation data yet. Bing AI Performance is not exposed by the Bing Webmaster API; import its CSV export from the dashboard (Settings → Import) to fill the "cited" step.');
  if (totals.aiVisits === 0) notes.push('No AI referral visits: set webAnalyticsSiteTag (Cloudflare Web Analytics) for this site. AI visits are page loads whose referrer is a known AI assistant.');
  const crawledNotCited = all.filter((x) => x.crawled > 0 && x.cited === 0).sort((a, b) => b.crawled - a.crawled).slice(0, 10).map((x) => x.page);
  return {
    site: siteId,
    range,
    totals,
    pages: all.sort((a, b) => b[sortBy] - a[sortBy] || b.clicks - a.clicks).slice(0, r.limit),
    insights: { crawledButNeverCited: totals.cited > 0 ? crawledNotCited : [] },
    notes,
  };
}

export interface AiCrawlersParams extends Omit<CommonParams, 'source' | 'brand'> {
  groupBy?: CrawlerQuery['groupBy'];
  crawler?: string;
  pathContains?: string;
}

export async function aiCrawlers(ctx: AnalysisContext, p: AiCrawlersParams) {
  const r = await resolve(ctx, { ...p, source: 'gsc' }, { days: 7, limit: 50 });
  const groupBy: CrawlerQuery['groupBy'] = p.groupBy && p.groupBy.length > 0 ? p.groupBy : ['crawler'];
  for (const g of groupBy) {
    if (!CRAWLER_GROUPS.includes(g)) throw new SearchkeepError('bad_request', `Unknown groupBy "${g}". Use: ${CRAWLER_GROUPS.join(', ')}.`);
  }
  const rows = await ctx.store.queryCrawlers({
    siteId: r.site.id,
    range: await crawlerRange(ctx, r.site.id, p, r.range),
    groupBy,
    ...(p.crawler ? { crawler: p.crawler } : {}),
    ...(p.pathContains ? { pathContains: p.pathContains } : {}),
    limit: r.limit,
  });
  const total = rows.reduce((s, x) => s + x.requests, 0);
  const notes: string[] = [];
  if (rows.length === 0) notes.push('No AI crawler requests recorded for this range. Check that cloudflareZoneId is set and the zone is proxied (orange cloud).');
  return { site: r.site.id, range: r.range, groupBy, totalRequests: total, rows, notes };
}

/** Crawler data has its own latest date; default the window to it rather than to GSC's. */
async function crawlerRange(ctx: AnalysisContext, siteId: string, p: CommonParams, fallback: DateRange): Promise<DateRange> {
  if (p.end || p.start) return fallback;
  const cov = await ctx.store.coverage(siteId);
  const c = cov.find((x) => x.dataset === 'ai_crawlers');
  if (!c?.lastDate) return fallback;
  const days = Math.max(1, Math.floor(p.days ?? 7));
  const end = c.lastDate;
  const start = new Date(Date.parse(`${end}T00:00:00Z`) - (days - 1) * 86_400_000).toISOString().slice(0, 10);
  return { start, end };
}

export interface AiReferralsParams extends Omit<CommonParams, 'source' | 'brand'> {
  groupBy?: Array<'path' | 'refererHost' | 'date'>;
}

export async function aiReferrals(ctx: AnalysisContext, p: AiReferralsParams) {
  const site = findSite(ctx.config, p.site);
  if (!site.webAnalyticsSiteTag) throw new SearchkeepError('not_configured', 'webAnalyticsSiteTag is not set for this site.');
  const r = await resolve(ctx, { ...p, source: 'gsc' }, { limit: 50 });
  const groupBy = p.groupBy && p.groupBy.length > 0 ? p.groupBy : (['refererHost'] as const);
  for (const g of groupBy) {
    if (!['path', 'refererHost', 'date'].includes(g)) throw new SearchkeepError('bad_request', `Unknown groupBy "${g}". Use: path, refererHost, date.`);
  }
  const rows = await ctx.store.queryReferrals({
    siteId: site.id,
    range: r.range,
    refererHosts: AI_HOSTS,
    groupBy: [...groupBy],
    limit: clampLimit(p.limit, 50),
  });
  return {
    site: site.id,
    range: r.range,
    rows: rows.map((x) => (x.refererHost ? { ...x, assistant: AI_REFERRER_HOSTS[x.refererHost] ?? x.refererHost } : x)),
    notes: ['AI referrals are Web Analytics page loads whose referrer host is a known AI assistant. Many assistants strip referrers, so this undercounts.'],
  };
}
