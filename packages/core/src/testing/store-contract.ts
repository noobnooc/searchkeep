/**
 * Store contract tests. Every Store implementation runs this suite against a
 * real database (D1 via Miniflare today; Postgres later). It also exercises the
 * analysis and sync code end-to-end on top of the store.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { loadConfig, type SearchkeepConfig } from '../config.js';
import { addDays } from '../dates.js';
import type { SourceClients } from '../sources.js';
import type { Store } from '../store.js';
import type { SearchFactInput } from '../types.js';
import { runSync } from '../sync/run-sync.js';
import {
  comparePeriods,
  findCannibalization,
  findContentDecay,
  findCtrAnomalies,
  findQuickWins,
  queryPerformance,
} from '../analysis/search.js';
import { aiCrawlers, geoFunnel } from '../analysis/geo.js';
import { listSites, setupStatus } from '../analysis/ops.js';
import { evaluateReadiness } from '../auth/readiness.js';

const SITE = {
  id: 'acme',
  domain: 'acme.com',
  gscProperty: 'sc-domain:acme.com',
  bingSiteUrl: 'https://acme.com/',
  cloudflareZoneId: 'zone1',
  webAnalyticsSiteTag: 'tag1',
};

function config(extra: Record<string, string> = {}): SearchkeepConfig {
  return loadConfig({ SITES: JSON.stringify([SITE]), BRAND_REGEX: 'acme', CLOUDFLARE_ACCOUNT_ID: 'acct', ...extra });
}

export function storeContract(name: string, makeStore: () => Promise<Store>): void {
  describe(`Store contract: ${name}`, () => {
    let store: Store;
    beforeEach(async () => {
      store = await makeStore();
      await store.syncSites([SITE]);
    });

    it('stores metadata', async () => {
      expect(await store.getMeta('k')).toBeNull();
      await store.setMeta('k', 'v1');
      await store.setMeta('k', 'v2');
      expect(await store.getMeta('k')).toBe('v2');
      await store.deleteMeta('k');
      expect(await store.getMeta('k')).toBeNull();
    });

    it('upserts facts idempotently and skips unchanged rows', async () => {
      const rows: SearchFactInput[] = [
        { date: '2026-10-01', kind: 'total', clicks: 10, impressions: 100, position: 5 },
        {
          date: '2026-10-01',
          kind: 'query_page',
          query: 'acme shoes',
          page: 'https://acme.com/shoes',
          clicks: 6,
          impressions: 50,
          position: 3,
        },
        {
          date: '2026-10-01',
          kind: 'query_page',
          query: 'red shoes',
          page: 'https://acme.com/shoes',
          clicks: 4,
          impressions: 50,
          position: 7,
        },
      ];
      expect(await store.writeSearchFacts('acme', 'gsc', rows)).toBeGreaterThan(0);
      expect(await store.writeSearchFacts('acme', 'gsc', rows)).toBe(0);
      const changed = rows.map((r, i) => (i === 2 ? { ...r, clicks: 5 } : r));
      expect(await store.writeSearchFacts('acme', 'gsc', changed)).toBe(1);
    });

    it('aggregates duplicate rows that normalize to the same key', async () => {
      await store.writeSearchFacts('acme', 'gsc', [
        { date: '2026-10-01', kind: 'query_page', query: 'q', page: '/a', clicks: 1, impressions: 10, position: 2 },
        { date: '2026-10-01', kind: 'query_page', query: 'q', page: '/a', clicks: 2, impressions: 30, position: 4 },
      ]);
      const rows = await store.queryPerformance({
        siteId: 'acme',
        source: 'gsc',
        range: { start: '2026-10-01', end: '2026-10-01' },
        dimensions: ['page'],
      });
      expect(rows).toEqual([{ page: '/a', clicks: 3, impressions: 40, ctr: 0.075, position: 3.5 }]);
    });

    describe('queryPerformance', () => {
      beforeEach(async () => {
        const facts: SearchFactInput[] = [];
        for (let i = 0; i < 14; i++) {
          const date = addDays('2026-10-01', i);
          facts.push({ date, kind: 'total', clicks: 20, impressions: 400, position: 6 });
          facts.push({ date, kind: 'query_page', query: 'acme shoes', page: '/shoes', clicks: 8, impressions: 100, position: 2 });
          facts.push({ date, kind: 'query_page', query: 'running shoes', page: '/shoes', clicks: 2, impressions: 100, position: 12 });
          facts.push({ date, kind: 'query_page', query: 'running shoes', page: '/blog/running', clicks: 3, impressions: 100, position: 9 });
        }
        await store.writeSearchFacts('acme', 'gsc', facts);
        await store.writeSearchFacts('acme', 'bing', [
          { date: '2026-10-06', kind: 'total', clicks: 5, impressions: 60 },
          { date: '2026-10-06', kind: 'query', query: 'running shoes', clicks: 3, impressions: 40, position: 4 },
          { date: '2026-10-06', kind: 'page', page: '/shoes', clicks: 4, impressions: 50, position: 3 },
        ]);
        await store.setBrandFlags(
          'acme',
          'acme',
          (await store.listQueriesForBrandClassification('acme', 'acme', 100)).map((q) => ({ id: q.id, isBrand: /acme/i.test(q.text) })),
        );
      });
      const range = { start: '2026-10-01', end: '2026-10-14' };

      it('uses site totals when no query/page dimension is requested', async () => {
        const [t] = await store.queryPerformance({ siteId: 'acme', source: 'gsc', range, dimensions: [] });
        expect(t).toMatchObject({ clicks: 280, impressions: 5600, position: 6 });
      });

      it('returns an empty list for a range without data', async () => {
        expect(
          await store.queryPerformance({
            siteId: 'acme',
            source: 'gsc',
            range: { start: '2020-01-01', end: '2020-01-02' },
            dimensions: [],
          }),
        ).toEqual([]);
      });

      it('groups by query with impression-weighted position', async () => {
        const rows = await store.queryPerformance({ siteId: 'acme', source: 'gsc', range, dimensions: ['query'], orderBy: 'clicks' });
        expect(rows.map((r) => r.query)).toEqual(['acme shoes', 'running shoes']);
        expect(rows[1]).toMatchObject({ clicks: 70, impressions: 2800, position: 10.5 });
      });

      it('groups by date and week in order', async () => {
        const days = await store.queryPerformance({
          siteId: 'acme',
          source: 'gsc',
          range,
          dimensions: ['date'],
          orderBy: 'date',
          order: 'asc',
        });
        expect(days).toHaveLength(14);
        expect(days[0]!.date).toBe('2026-10-01');
        const weeks = await store.queryPerformance({
          siteId: 'acme',
          source: 'gsc',
          range,
          dimensions: ['week'],
          orderBy: 'date',
          order: 'asc',
        });
        expect(weeks.map((w) => w.week)).toEqual(['2026-09-28', '2026-10-05', '2026-10-12']);
      });

      it('filters by brand, substring and having', async () => {
        const brand = await store.queryPerformance({
          siteId: 'acme',
          source: 'gsc',
          range,
          dimensions: ['query'],
          filters: { brand: 'brand' },
        });
        expect(brand.map((r) => r.query)).toEqual(['acme shoes']);
        const nonBrand = await store.queryPerformance({
          siteId: 'acme',
          source: 'gsc',
          range,
          dimensions: [],
          filters: { brand: 'non_brand' },
        });
        expect(nonBrand[0]).toMatchObject({ clicks: 70 });
        const blog = await store.queryPerformance({
          siteId: 'acme',
          source: 'gsc',
          range,
          dimensions: ['page'],
          filters: { pageContains: 'BLOG' },
        });
        expect(blog.map((r) => r.page)).toEqual(['/blog/running']);
        const mid = await store.queryPerformance({
          siteId: 'acme',
          source: 'gsc',
          range,
          dimensions: ['query', 'page'],
          having: { minPosition: 8, maxPosition: 20 },
        });
        expect(mid).toHaveLength(2);
      });

      it('keeps Bing query and page rows separate', async () => {
        const r = { start: '2026-10-05', end: '2026-10-11' };
        expect((await store.queryPerformance({ siteId: 'acme', source: 'bing', range: r, dimensions: ['query'] }))[0]).toMatchObject({
          query: 'running shoes',
          clicks: 3,
        });
        expect((await store.queryPerformance({ siteId: 'acme', source: 'bing', range: r, dimensions: ['page'] }))[0]).toMatchObject({
          page: '/shoes',
          clicks: 4,
        });
        expect((await store.queryPerformance({ siteId: 'acme', source: 'bing', range: r, dimensions: [] }))[0]).toMatchObject({
          clicks: 5,
        });
      });

      it('reports coverage and latest date', async () => {
        expect(await store.latestDate('acme', 'gsc')).toBe('2026-10-14');
        const cov = await store.coverage('acme');
        expect(cov.find((c) => c.source === 'gsc' && c.dataset === 'search')).toMatchObject({
          firstDate: '2026-10-01',
          lastDate: '2026-10-14',
          days: 14,
        });
      });
    });

    it('stores country/device breakdowns', async () => {
      await store.writeBreakdowns('acme', 'gsc', [
        { date: '2026-10-01', country: 'USA', device: 'mobile', clicks: 3, impressions: 30, position: 4 },
        { date: '2026-10-01', country: 'deu', device: 'DESKTOP', clicks: 1, impressions: 10, position: 8 },
      ]);
      const rows = await store.queryPerformance({
        siteId: 'acme',
        source: 'gsc',
        range: { start: '2026-10-01', end: '2026-10-01' },
        dimensions: ['country'],
      });
      expect(rows.map((r) => r.country)).toEqual(['usa', 'deu']);
      const mobile = await store.queryPerformance({
        siteId: 'acme',
        source: 'gsc',
        range: { start: '2026-10-01', end: '2026-10-01' },
        dimensions: [],
        filters: { device: 'mobile' },
      });
      expect(mobile[0]).toMatchObject({ clicks: 3 });
    });

    it('stores crawler, referral, vitals and citation data', async () => {
      await store.writeCrawlerRequests('acme', [
        { date: '2026-10-01', crawler: 'GPTBot', operator: 'OpenAI', purpose: 'training', path: '/a', status: 200, requests: 5 },
        { date: '2026-10-01', crawler: 'ClaudeBot', operator: 'Anthropic', purpose: 'training', path: '/a', status: 404, requests: 2 },
        { date: '2026-10-02', crawler: 'GPTBot', operator: 'OpenAI', purpose: 'training', path: '/b', status: 200, requests: 1 },
      ]);
      const range = { start: '2026-10-01', end: '2026-10-02' };
      const byCrawler = await store.queryCrawlers({ siteId: 'acme', range, groupBy: ['crawler'] });
      expect(byCrawler).toEqual([
        { crawler: 'GPTBot', requests: 6 },
        { crawler: 'ClaudeBot', requests: 2 },
      ]);
      expect(await store.queryCrawlers({ siteId: 'acme', range, groupBy: ['path'], crawler: 'gptbot' })).toEqual([
        { path: '/a', requests: 5 },
        { path: '/b', requests: 1 },
      ]);
      await store.writeWebAnalytics('acme', [
        { date: '2026-10-01', path: '/a', refererHost: 'chatgpt.com', visits: 3, pageViews: 4 },
        { date: '2026-10-01', path: '/a', refererHost: 'google.com', visits: 9, pageViews: 9 },
      ]);
      expect(await store.queryReferrals({ siteId: 'acme', range, refererHosts: ['chatgpt.com'], groupBy: ['path'] })).toEqual([
        { path: '/a', visits: 3, pageViews: 4 },
      ]);
      await store.writeWebVitals('acme', [{ date: '2026-10-01', path: '/a', lcpP75: 2000, inpP75: 150, clsP75: 0.05, samples: 10 }]);
      expect((await store.queryWebVitals('acme', range, 10))[0]).toMatchObject({ page: '/a', lcpP75: 2000, samples: 10 });
      await store.writeAiCitations('acme', [{ date: '2026-10-01', page: '/a', surface: 'bing_copilot', citations: 7 }]);
      expect(await store.queryAiCitations('acme', range, 10)).toEqual([{ page: '/a', value: 7 }]);
    });

    it('replaces crawl issue and sitemap snapshots', async () => {
      await store.replaceCrawlIssues('acme', 'bing', [{ url: 'https://acme.com/x', issue: 'Code4xx', httpCode: 404 }]);
      await store.replaceCrawlIssues('acme', 'bing', [{ url: 'https://acme.com/y', issue: 'Code5xx', httpCode: 500 }]);
      expect((await store.listCrawlIssues('acme', 'bing', 10)).map((i) => i.url)).toEqual(['https://acme.com/y']);
      await store.replaceSitemaps('acme', 'gsc', [
        { path: 'https://acme.com/sitemap.xml', errors: 0, warnings: 1, submitted: 10, indexed: null },
      ]);
      expect(await store.listSitemaps('acme', 'gsc')).toEqual([
        {
          path: 'https://acme.com/sitemap.xml',
          lastSubmitted: null,
          lastDownloaded: null,
          isPending: false,
          errors: 0,
          warnings: 1,
          submitted: 10,
          indexed: null,
        },
      ]);
    });

    it('stores dashboard-managed site configs', async () => {
      await store.saveSiteConfig({ id: 'blog', domain: 'blog.example.com', gscProperty: 'sc-domain:example.com' });
      await store.saveSiteConfig({ id: 'blog', domain: 'blog.example.com', bingSiteUrl: 'https://blog.example.com/' });
      await store.saveSiteConfig({
        id: 'shop',
        domain: 'shop.example.com',
        cloudflareZoneId: 'zone2',
        webAnalyticsSiteTag: 'tag2',
        brandRegex: 'shop',
      });
      expect(await store.listSiteConfigs()).toEqual([
        { id: 'blog', domain: 'blog.example.com', bingSiteUrl: 'https://blog.example.com/' },
        { id: 'shop', domain: 'shop.example.com', cloudflareZoneId: 'zone2', webAnalyticsSiteTag: 'tag2', brandRegex: 'shop' },
      ]);
      expect(await store.deleteSiteConfig('blog')).toBe(true);
      expect(await store.deleteSiteConfig('blog')).toBe(false);
      expect((await store.listSiteConfigs()).map((s) => s.id)).toEqual(['shop']);
    });

    it('records sync runs', async () => {
      const id = await store.startSyncRun({ startedAt: '2026-10-01T00:00:00.000Z', trigger: 'manual', status: 'running', rowsWritten: 0 });
      await store.finishSyncRun(id, { status: 'ok', rowsWritten: 5, finishedAt: '2026-10-01T00:00:01.000Z', details: [] });
      const [run] = await store.listSyncRuns(1);
      expect(run).toMatchObject({ id, status: 'ok', rowsWritten: 5, trigger: 'manual' });
    });

    it('reclassifies brand queries when the regex changes', async () => {
      await store.writeSearchFacts('acme', 'gsc', [
        { date: '2026-10-01', kind: 'query_page', query: 'widget', page: '/', clicks: 1, impressions: 1 },
      ]);
      expect(await store.listQueriesForBrandClassification('acme', 'v1', 10)).toHaveLength(1);
      const q = await store.listQueriesForBrandClassification('acme', 'v1', 10);
      await store.setBrandFlags(
        'acme',
        'v1',
        q.map((x) => ({ id: x.id, isBrand: false })),
      );
      expect(await store.listQueriesForBrandClassification('acme', 'v1', 10)).toHaveLength(0);
      expect(await store.listQueriesForBrandClassification('acme', 'v2', 10)).toHaveLength(1);
    });

    describe('analysis on top of the store', () => {
      beforeEach(async () => {
        const facts: SearchFactInput[] = [];
        for (let w = 0; w < 16; w++) {
          for (let d = 0; d < 7; d++) {
            const date = addDays('2026-07-06', w * 7 + d);
            const decaying = w < 8 ? 30 : 4;
            facts.push({ date, kind: 'total', clicks: 100, impressions: 3000, position: 8 });
            facts.push({
              date,
              kind: 'query_page',
              query: 'best widgets',
              page: '/widgets',
              clicks: decaying,
              impressions: 300,
              position: 4,
            });
            facts.push({ date, kind: 'query_page', query: 'cheap widgets', page: '/widgets', clicks: 1, impressions: 200, position: 11 });
            facts.push({
              date,
              kind: 'query_page',
              query: 'cheap widgets',
              page: '/blog/cheap',
              clicks: 1,
              impressions: 150,
              position: 13,
            });
            facts.push({ date, kind: 'query_page', query: 'widget review', page: '/review', clicks: 0, impressions: 120, position: 2 });
          }
        }
        await store.writeSearchFacts('acme', 'gsc', facts);
      });
      const ctx = () => ({ store, config: config(), clients: {} as SourceClients });

      it('compares periods', async () => {
        const res = await comparePeriods(ctx(), { days: 28 });
        expect(res.current.range.end).toBe('2026-10-25');
        expect(res.losers.length + res.gainers.length).toBeGreaterThanOrEqual(0);
        expect(res.current.clicks).toBe(2800);
      });

      it('finds quick wins at positions 8-20', async () => {
        const res = await findQuickWins(ctx(), { days: 28 });
        expect(res.quickWins.map((w) => w.query)).toEqual(['cheap widgets']);
        expect(res.quickWins[0]!.page).toBe('/widgets');
      });

      it('finds cannibalization', async () => {
        const res = await findCannibalization(ctx(), { days: 28 });
        expect(res.issues.map((i) => i.query)).toEqual(['cheap widgets']);
        expect(res.issues[0]!.pages).toHaveLength(2);
      });

      it('finds CTR anomalies', async () => {
        const res = await findCtrAnomalies(ctx(), { days: 28 });
        expect(res.anomalies.map((a) => a.query)).toContain('widget review');
      });

      it('finds content decay', async () => {
        const res = await findContentDecay(ctx(), { weeks: 16 });
        expect(res.decaying.map((d) => d.page)).toEqual(['/widgets']);
      });

      it('queries performance with brand notes', async () => {
        const res = await queryPerformance(ctx(), { dimensions: ['query'], brand: 'non_brand', days: 7 });
        expect(res.rows.length).toBe(3);
        expect(res.notes.join(' ')).toMatch(/anonymized/);
      });
    });

    describe('sync', () => {
      const NOW = new Date('2026-10-20T04:00:00Z');
      const clients = (): SourceClients => ({
        gsc: {
          async searchAnalytics(req) {
            if (req.dimensions.length === 1) return [{ keys: [req.startDate], clicks: 10, impressions: 100, ctr: 0.1, position: 5 }];
            if (req.dimensions.includes('country'))
              return [{ keys: [req.startDate, 'usa', 'MOBILE'], clicks: 10, impressions: 100, ctr: 0.1, position: 5 }];
            return [
              {
                keys: [req.startDate, 'acme widgets', 'https://acme.com/widgets?ref=x'],
                clicks: 9,
                impressions: 80,
                ctr: 0.11,
                position: 3,
              },
            ];
          },
          async listSitemaps() {
            return [{ path: 'https://acme.com/sitemap.xml', errors: 0, warnings: 0 }];
          },
          async submitSitemap() {},
          async inspectUrl() {
            throw new Error('not used');
          },
          async listProperties() {
            return [{ siteUrl: 'sc-domain:acme.com', permissionLevel: 'siteRestrictedUser' }];
          },
        },
        bing: {
          async getQueryStats() {
            return [{ date: '2026-10-12', query: 'widgets', clicks: 2, impressions: 20, avgImpressionPosition: 4 }];
          },
          async getPageStats() {
            return [{ date: '2026-10-12', page: 'https://acme.com/widgets', clicks: 2, impressions: 20, avgImpressionPosition: 4 }];
          },
          async getRankAndTrafficStats() {
            return [{ date: '2026-10-18', clicks: 3, impressions: 30 }];
          },
          async getCrawlIssues() {
            return [];
          },
          async getUserSites() {
            return [{ url: 'https://acme.com/', verified: true }];
          },
        },
        cloudflare: {
          async aiCrawlerRequests(_zone, date) {
            return [
              {
                date,
                userAgent: 'Mozilla/5.0 (compatible; GPTBot/1.2; +https://openai.com/gptbot)',
                host: 'acme.com',
                path: '/widgets',
                status: 200,
                requests: 4,
              },
            ];
          },
          async webAnalytics(_a, _t, date) {
            return [{ date, host: 'www.acme.com', path: '/widgets', refererHost: 'chatgpt.com', visits: 2, pageViews: 3 }];
          },
          async webVitals(_a, _t, date) {
            return [{ date, host: 'acme.com', path: '/widgets', lcpP75: 1800, inpP75: 100, clsP75: 0.01, samples: 5 }];
          },
          async verifyToken() {
            return { active: true };
          },
        },
      });

      it('syncs every source, then backfills, within budgets', async () => {
        const cfg = config({ SYNC_MAX_CALLS_PER_RUN: '900', GSC_BACKFILL_MONTHS: '1' });
        const run = await runSync({ store, config: cfg, clients: clients(), trigger: 'manual', now: NOW, timeBudgetMs: 60_000 });
        expect(run.status).toBe('ok');
        expect(run.rowsWritten).toBeGreaterThan(0);
        expect(await store.latestDate('acme', 'gsc')).toBe('2026-10-19');
        const pages = await store.queryPerformance({
          siteId: 'acme',
          source: 'gsc',
          range: { start: '2026-10-19', end: '2026-10-19' },
          dimensions: ['page'],
        });
        expect(pages[0]!.page).toBe('/widgets');
        // Backfill walked back one month.
        const cov = await store.coverage('acme');
        expect(cov.find((c) => c.source === 'gsc')!.firstDate).toBe('2026-09-20');
        const funnel = await geoFunnel({ store, config: cfg }, { start: '2026-10-01', end: '2026-10-19' });
        expect(funnel.pages[0]).toMatchObject({ page: '/widgets' });
        expect(funnel.totals.crawled).toBeGreaterThan(0);
        expect(funnel.totals.aiVisits).toBeGreaterThan(0);
        const crawlers = await aiCrawlers({ store, config: cfg }, { start: '2026-10-01', end: '2026-10-19' });
        expect(crawlers.rows[0]).toMatchObject({ crawler: 'GPTBot' });

        // A second pass the same day has nothing due.
        const again = await runSync({ store, config: cfg, clients: clients(), trigger: 'cron', now: NOW });
        expect(again.status).toBe('skipped');
        expect(again.rowsWritten).toBe(0);
      });

      it('stops at the call budget and resumes later', async () => {
        const cfg = config({ SYNC_MAX_CALLS_PER_RUN: '25', GSC_BACKFILL_MONTHS: '0' });
        const first = await runSync({ store, config: cfg, clients: clients(), trigger: 'cron', now: NOW });
        expect(first.status).toBe('partial');
        for (let i = 0; i < 40; i++) {
          const r = await runSync({ store, config: cfg, clients: clients(), trigger: 'cron', now: NOW });
          if (r.status === 'skipped') break;
        }
        const last = await runSync({ store, config: cfg, clients: clients(), trigger: 'cron', now: NOW });
        expect(last.status).toBe('skipped');
        expect(await store.latestDate('acme', 'bing')).toBe('2026-10-18');
      });

      it('records failures without stopping other sources', async () => {
        const c = clients();
        c.bing!.getQueryStats = async () => {
          throw new Error('HTTP 401 apikey=SECRET123');
        };
        const run = await runSync({
          store,
          config: config({ SYNC_MAX_CALLS_PER_RUN: '900', GSC_BACKFILL_MONTHS: '0' }),
          clients: c,
          trigger: 'manual',
          now: NOW,
        });
        expect(run.status).toBe('partial');
        const failed = run.details!.find((d) => d.task === 'bing.queries')!;
        expect(failed.status).toBe('error');
        expect(failed.message).not.toContain('SECRET123');
        expect(await store.latestDate('acme', 'gsc')).toBe('2026-10-19');
      });

      it('reports setup status without secrets', async () => {
        const cfg = config({
          GSC_CLIENT_EMAIL: 'sa@x.iam.gserviceaccount.com',
          GSC_PRIVATE_KEY: 'pk-s3cr3t-value',
          BING_API_KEY: 'bing-s3cr3t',
          CLOUDFLARE_API_TOKEN: 'cf-s3cr3t',
        });
        const readiness = evaluateReadiness({
          configured: true,
          identityOk: true,
          inspection: { appFound: true, managedOAuthEnabled: true, broadPolicyReasons: [] },
        });
        const status = await setupStatus({ store, config: cfg, clients: clients() }, { readiness });
        const text = JSON.stringify(status);
        expect(text).not.toContain('pk-s3cr3t-value');
        expect(text).not.toContain('bing-s3cr3t');
        expect(text).not.toContain('cf-s3cr3t');
        expect(status.state).toBe('ready');
        expect(status.checks.find((c) => c.id === 'probe.gsc')!.status).toBe('ok');
        const sites = await listSites({ store, config: cfg, clients: clients() });
        expect(sites.sites[0]!.sources).toEqual({ gsc: true, bing: true, aiCrawlers: true, webAnalytics: true });
      });
    });
  });
}
