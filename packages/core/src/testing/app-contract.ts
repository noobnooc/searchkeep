/**
 * Store contract tests for apps (ADR 0009): the app tables, and the app sync and analysis on top
 * of a real store, with fake App Store Connect, Google Play and public feed clients.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { appPerformance, appReviews, appSearchTerms, appStability, listApps, startAppStoreReports } from '../apps/analysis.js';
import { loadConfig, withStoredApps, type SearchkeepConfig } from '../config.js';
import { addDays, daysBetween } from '../dates.js';
import type { DelimitedRow } from '../delimited.js';
import { SourceError } from '../http.js';
import type { AscClient, AscReportRequest, PlayClient, AppStorePublicClient, SourceClients } from '../sources.js';
import type { Store } from '../store.js';
import { syncProgress } from '../sync/progress.js';
import { runSync } from '../sync/run-sync.js';
import { syncKeys } from '../sync/state.js';

const APP = { id: 'acme-app', name: 'Acme', appleId: '1234567', playPackage: 'com.acme.app', siteId: 'acme' };
const NOW = new Date('2026-10-20T04:00:00Z');

function config(extra: Record<string, string> = {}): SearchkeepConfig {
  return loadConfig({
    SITES: JSON.stringify([{ id: 'acme', domain: 'acme.com' }]),
    APPS: JSON.stringify([APP]),
    ASC_KEY_ID: 'KEY',
    ASC_ISSUER_ID: 'issuer',
    ASC_PRIVATE_KEY: 'pk',
    GSC_CLIENT_EMAIL: 'sa@x.iam.gserviceaccount.com',
    GSC_PRIVATE_KEY: 'pk',
    PLAY_REPORTS_BUCKET: 'pubsite_prod_rev_1',
    APP_STORE_PUBLIC_DATA: 'true',
    SYNC_MAX_CALLS_PER_RUN: '900',
    ...extra,
  });
}

/** App Store Connect with an ongoing request (three daily instances) and a snapshot. */
function fakeAsc(opts: { listForbidden?: boolean; requests?: AscReportRequest[] } = {}) {
  const calls: string[] = [];
  const requests: AscReportRequest[] = opts.requests ?? [
    { id: 'ongoing', accessType: 'ONGOING', stoppedDueToInactivity: false },
    { id: 'snap', accessType: 'ONE_TIME_SNAPSHOT', stoppedDueToInactivity: false },
  ];
  const instances: Record<string, Array<{ id: string; processingDate: string }>> = {
    eng: ['2026-10-17', '2026-10-18', '2026-10-19'].map((d) => ({ id: `eng-${d}`, processingDate: d })),
    dl: [{ id: 'dl-2026-10-19', processingDate: '2026-10-19' }],
    crash: [{ id: 'crash-2026-10-19', processingDate: '2026-10-19' }],
    'snap-eng': [{ id: 'snap-eng-1', processingDate: '2026-10-19' }],
  };
  const rowsFor = (instanceId: string): DelimitedRow[] => {
    if (instanceId === 'snap-eng-1') {
      // History: every day from Sep 1 to Oct 17 (overlapping the ongoing report's days).
      const out: DelimitedRow[] = [];
      for (let d = '2026-09-01'; d <= '2026-10-17'; d = addDays(d, 1))
        out.push(eng(d, 'US', 'App Store search', 'Impression', 'No page', 999, 500));
      return out;
    }
    const [kind, ...rest] = instanceId.split('-');
    const p = rest.join('-');
    if (kind === 'eng') {
      const out: DelimitedRow[] = [];
      for (const d of [addDays(p, -2), addDays(p, -1)]) {
        const v = 10 * daysBetween(d, p);
        out.push(eng(d, 'US', 'App Store search', 'Impression', 'No page', v, v / 2));
        out.push(eng(d, 'US', 'App Store search', 'Page view', 'Product page', v / 2, v / 5));
        out.push(eng(d, 'US', 'App Store browse', 'Page view', 'Product page', 3, 2));
        out.push(eng(d, 'US', 'App Store search', 'Tap', 'No page', 7, 7));
        // Only the first instance reports Great Britain for its first day.
        if (p === '2026-10-17') out.push(eng(d, 'GB', 'Web referrer', 'Impression', 'No page', 4, 4));
      }
      return out;
    }
    if (kind === 'dl') {
      return [
        { date: '2026-10-18', 'download type': 'First-time download', 'source type': 'App Store search', territory: 'US', counts: '4' },
        { date: '2026-10-18', 'download type': 'Redownload', 'source type': 'App Store search', territory: 'US', counts: '1' },
        { date: '2026-10-18', 'download type': 'Manual update', 'source type': 'App Store search', territory: 'US', counts: '9' },
      ];
    }
    return [
      { date: '2026-10-18', 'app version': '2.0', crashes: '3', 'unique devices': '2' },
      { date: '2026-10-18', 'app version': '2.1', crashes: '1', 'unique devices': '1' },
    ];
  };
  function eng(
    date: string,
    territory: string,
    source: string,
    event: string,
    pageType: string,
    counts: number,
    unique: number,
  ): DelimitedRow {
    return {
      date,
      'app name': 'Acme',
      event,
      'page type': pageType,
      'source type': source,
      'engagement type': '',
      device: 'iPhone',
      'platform version': 'iOS 26',
      territory,
      counts: String(counts),
      'unique counts': String(unique),
    };
  }
  const client: AscClient = {
    async listApps() {
      return [{ id: APP.appleId, name: 'Acme', bundleId: 'com.acme.app' }];
    },
    async listReportRequests() {
      calls.push('listReportRequests');
      if (opts.listForbidden) throw new SourceError('asc', 403, 'HTTP 403: FORBIDDEN_ERROR');
      return requests;
    },
    async createReportRequest(_id, accessType) {
      calls.push(`create:${accessType}`);
      const r = { id: `new-${accessType}`, accessType, stoppedDueToInactivity: false };
      requests.push(r);
      return r;
    },
    async deleteReportRequest(id) {
      calls.push(`delete:${id}`);
    },
    async getReportRequest(id) {
      calls.push(`get:${id}`);
      return requests.find((r) => r.id === id) ?? { id, accessType: 'ONGOING', stoppedDueToInactivity: false };
    },
    async listReports(requestId) {
      calls.push(`listReports:${requestId}`);
      return requestId === 'snap'
        ? [{ id: 'snap-eng', name: 'App Store Discovery and Engagement Standard', category: 'APP_STORE_ENGAGEMENT' }]
        : [
            { id: 'eng', name: 'App Store Discovery and Engagement Standard', category: 'APP_STORE_ENGAGEMENT' },
            { id: 'dl', name: 'App Downloads Standard', category: 'APP_STORE_COMMERCE' },
            { id: 'crash', name: 'App Crashes', category: 'APP_USAGE' },
            { id: 'other', name: 'App Crashes Expanded', category: 'PERFORMANCE' },
          ];
    },
    async listInstances(reportId) {
      calls.push(`listInstances:${reportId}`);
      return [...(instances[reportId] ?? [])].reverse().map((i) => ({ ...i, granularity: 'DAILY' }));
    },
    async listSegments(instanceId) {
      calls.push(`segments:${instanceId}`);
      return [{ id: `${instanceId}-0`, url: instanceId, sizeInBytes: 100 }];
    },
    async readSegment(segment, onRow) {
      const rows = rowsFor(segment.url);
      for (const r of rows) onRow(r);
      return rows.length;
    },
    async listReviews() {
      calls.push('listReviews');
      return {
        reviews: [
          { id: 'r1', rating: 5, title: 'Great', body: 'Love it', createdDate: '2026-10-18T10:00:00-07:00', territory: 'USA' },
          { id: 'r2', rating: 1, title: 'Crashes', body: 'Crashes on start', createdDate: '2026-10-12T10:00:00Z', territory: 'GBR' },
        ],
        next: null,
      };
    },
  };
  return { client, calls };
}

function fakePlay() {
  const calls: string[] = [];
  const pkg = APP.playPackage;
  const files: Record<string, DelimitedRow[]> = {
    [`stats/store_performance/store_performance_${pkg}_202610_country.csv`]: [
      { date: '2026-10-10', 'package name': pkg, country: 'US', 'store listing acquisitions': '10', 'store listing visitors': '40' },
      { date: '2026-10-10', 'package name': pkg, country: 'DE', 'store listing acquisitions': '5', 'store listing visitors': '10' },
    ],
    [`stats/store_performance/store_performance_${pkg}_202610_traffic_source.csv`]: [
      {
        date: '2026-10-10',
        'traffic source': 'Google Play search',
        'search term': 'acme',
        'utm source': '',
        'store listing acquisitions': '8',
        'store listing visitors': '20',
      },
      {
        date: '2026-10-10',
        'traffic source': 'Google Play search',
        'search term': 'widgets',
        'utm source': '',
        'store listing acquisitions': '1',
        'store listing visitors': '25',
      },
      {
        date: '2026-10-10',
        'traffic source': 'Third-party referrals',
        'search term': '',
        'utm source': 'acme.com',
        'store listing acquisitions': '6',
        'store listing visitors': '5',
      },
    ],
    [`stats/store_performance/store_performance_${pkg}_202608_country.csv`]: [
      { date: '2026-08-05', 'package name': pkg, country: 'US', 'store listing acquisitions': '2', 'store listing visitors': '9' },
    ],
    [`stats/installs/installs_${pkg}_202610_country.csv`]: [
      { date: '2026-10-09', country: 'US', 'daily device installs': '7', 'daily device uninstalls': '2', 'active device installs': '100' },
      { date: '2026-10-10', country: 'US', 'daily device installs': '8', 'daily device uninstalls': '1', 'active device installs': '107' },
      { date: '2026-10-10', country: 'DE', 'daily device installs': '1', 'daily device uninstalls': '0', 'active device installs': '20' },
    ],
    [`stats/ratings/ratings_${pkg}_202610_overview.csv`]: [
      { date: '2026-10-10', 'daily average rating': '4.00', 'total average rating': '4.31' },
    ],
    [`reviews/reviews_${pkg}_202610.csv`]: [
      {
        'package name': pkg,
        'app version name': '3.1',
        'reviewer language': 'en',
        'review submit millis since epoch': String(Date.parse('2026-10-11T08:00:00Z')),
        'star rating': '2',
        'review title': '',
        'review text': 'Slow, crashes',
        'developer reply text': 'Thanks, fixed in 3.2',
        'review link':
          'https://play.google.com/console/developers/x/app/y/user-feedback/review-details?reviewId=gp-1&corpus=PUBLIC_REVIEWS',
      },
    ],
    'stats/installs/installs_com.other.app_202610_country.csv': [],
  };
  const client: PlayClient = {
    async listObjects(_bucket, prefix) {
      calls.push(`list:${prefix}`);
      return Object.keys(files)
        .filter((n) => n.startsWith(prefix))
        .map((name) => ({ name, generation: '1', size: 10, updated: '2026-10-19T00:00:00Z' }));
    },
    async readCsv(_bucket, name, onRow) {
      calls.push(`read:${name}`);
      for (const r of files[name] ?? []) onRow(r);
      return files[name]?.length ?? 0;
    },
    async vitals(_pkg, metric, range) {
      calls.push(`vitals:${metric}:${range.start}..${range.end}`);
      return [
        {
          date: range.end,
          version: '31',
          rate: metric === 'crash' ? 0.01 : 0.002,
          userPerceivedRate: metric === 'crash' ? 0.008 : 0.001,
          distinctUsers: 300,
        },
        {
          date: range.end,
          version: '32',
          rate: metric === 'crash' ? 0.002 : 0.001,
          userPerceivedRate: metric === 'crash' ? 0.001 : 0.0005,
          distinctUsers: 100,
        },
      ];
    },
    async listApps() {
      return [{ packageName: pkg, name: 'Acme' }];
    },
  };
  return { client, calls };
}

const fakePublic = (): AppStorePublicClient => ({
  async lookup() {
    return { appleId: APP.appleId, name: 'Acme', averageUserRating: 4.6, userRatingCount: 1234, version: '2.1', primaryGenreId: '6007' };
  },
  async topChart(_country, chart, genre) {
    if (genre) return ['1', '2', '3', APP.appleId];
    return chart === 'top-free' ? ['9', APP.appleId] : ['9', '8'];
  },
});

export function appContract(name: string, makeStore: () => Promise<Store>): void {
  describe(`Store contract (apps): ${name}`, () => {
    let store: Store;
    beforeEach(async () => {
      store = await makeStore();
    });

    it('stores dashboard-managed app configs', async () => {
      await store.saveAppConfig({ id: 'a', name: 'A', appleId: '123456', territories: ['us', 'gb'] });
      await store.saveAppConfig({ id: 'a', name: 'A2', playPackage: 'com.a.app' });
      await store.saveAppConfig({ id: 'b', name: 'B', appleId: '654321', siteId: 'acme' });
      expect(await store.listAppConfigs()).toEqual([
        { id: 'a', name: 'A2', playPackage: 'com.a.app' },
        { id: 'b', name: 'B', appleId: '654321', siteId: 'acme' },
      ]);
      expect(await store.deleteAppConfig('a')).toBe(true);
      expect(await store.deleteAppConfig('a')).toBe(false);
      const cfg = withStoredApps(config(), await store.listAppConfigs());
      expect(cfg.apps.map((a) => [a.id, a.origin])).toEqual([
        ['acme-app', 'secret'],
        ['b', 'dashboard'],
      ]);
    });

    it('replaces a day of store funnel rows, metric by metric, and skips unchanged rows', async () => {
      const day = '2026-10-01';
      const w = {
        metrics: ['impressions', 'pageViews'] as const,
        shape: 'cross' as const,
        dates: [day],
        rows: [
          { date: day, territory: 'US', source: 'search', impressions: 100, pageViews: 10 },
          { date: day, territory: 'US', source: 'search', impressions: 1, pageViews: 1 },
          { date: day, territory: 'GB', source: 'browse', impressions: 50, pageViews: 5 },
        ],
      };
      expect(await store.writeAppStoreDaily('x', 'apple', { ...w, metrics: [...w.metrics] })).toBe(2);
      expect(await store.writeAppStoreDaily('x', 'apple', { ...w, metrics: [...w.metrics] })).toBe(0);
      // Another report sets downloads on the same rows without touching impressions.
      await store.writeAppStoreDaily('x', 'apple', {
        metrics: ['downloads'],
        shape: 'cross',
        dates: [day],
        rows: [{ date: day, territory: 'US', source: 'search', downloads: 3 }],
      });
      // A newer instance no longer mentions GB: its impressions drop to 0, its downloads stay.
      await store.writeAppStoreDaily('x', 'apple', {
        metrics: ['impressions', 'pageViews'],
        shape: 'cross',
        dates: [day],
        rows: [{ date: day, territory: 'US', source: 'search', impressions: 120, pageViews: 11 }],
      });
      const bySource = await store.queryAppStore({
        appId: 'x',
        range: { start: day, end: day },
        dimensions: ['territory', 'source'],
        orderBy: 'impressions',
      });
      expect(bySource.map((r) => [r.territory, r.source, r.impressions, r.pageViews, r.downloads])).toEqual([
        ['US', 'search', 120, 11, 3],
        ['GB', 'browse', 0, 0, 0],
      ]);
      expect(await store.latestAppDate('x')).toBe(day);
      expect(await store.latestAppDate('x', 'play')).toBeNull();
      expect(await store.queryAppStore({ appId: 'x', range: { start: '2026-09-01', end: '2026-09-02' }, dimensions: [] })).toEqual([]);
    });

    it("counts Google Play's separate territory and source breakdowns once", async () => {
      const day = '2026-10-02';
      await store.writeAppStoreDaily('p', 'play', {
        metrics: ['pageViewsUnique', 'downloads'],
        shape: 'territory',
        dates: [day],
        rows: [
          { date: day, territory: 'US', source: '*', pageViewsUnique: 40, downloads: 10 },
          { date: day, territory: 'DE', source: '*', pageViewsUnique: 10, downloads: 5 },
        ],
      });
      await store.writeAppStoreDaily('p', 'play', {
        metrics: ['pageViewsUnique', 'downloads'],
        shape: 'source',
        dates: [day],
        rows: [
          { date: day, territory: '*', source: 'search', pageViewsUnique: 45, downloads: 9 },
          { date: day, territory: '*', source: 'referral', pageViewsUnique: 5, downloads: 6 },
        ],
      });
      const range = { start: day, end: day };
      const [total] = await store.queryAppStore({ appId: 'p', range, dimensions: [] });
      expect([total!.pageViewsUnique, total!.downloads]).toEqual([50, 15]);
      const sources = await store.queryAppStore({ appId: 'p', range, dimensions: ['source'] });
      expect(sources.map((r) => [r.source, r.pageViewsUnique])).toEqual([
        ['search', 45],
        ['referral', 5],
      ]);
      const territories = await store.queryAppStore({ appId: 'p', range, dimensions: ['territory'], orderBy: 'downloads' });
      expect(territories.map((r) => [r.territory, r.downloads])).toEqual([
        ['US', 10],
        ['DE', 5],
      ]);
      // Rewriting the source breakdown leaves the territory rows alone.
      await store.writeAppStoreDaily('p', 'play', { metrics: ['pageViewsUnique', 'downloads'], shape: 'source', dates: [day], rows: [] });
      const [after] = await store.queryAppStore({ appId: 'p', range, dimensions: [] });
      expect(after!.downloads).toBe(15);
    });

    it('stores search terms, referrers, ratings, reviews, vitals and chart ranks', async () => {
      const d1 = '2026-10-03';
      const d2 = '2026-10-04';
      await store.writeAppSearchTerms(
        'p',
        [
          { date: d1, term: 'Acme', visitors: 10, acquisitions: 2 },
          { date: d2, term: 'acme', visitors: 5, acquisitions: 1 },
          { date: d2, term: 'old', visitors: 1, acquisitions: 0 },
        ],
        [d1, d2],
      );
      // The next file for d2 has no "old" any more.
      await store.writeAppSearchTerms('p', [{ date: d2, term: 'acme', visitors: 6, acquisitions: 1 }], [d2]);
      const range = { start: d1, end: d2 };
      expect(await store.queryAppSearchTerms({ appId: 'p', range })).toEqual([{ term: 'Acme', visitors: 16, acquisitions: 3 }]);
      expect(await store.queryAppSearchTerms({ appId: 'p', range, termContains: 'zzz' })).toEqual([]);

      await store.writeAppReferrers('p', 'apple', {
        metrics: ['downloads'],
        dates: [d1],
        rows: [
          { date: d1, kind: 'web', referrer: 'acme.com', downloads: 3 },
          { date: d1, kind: 'web', referrer: 'gone.example', downloads: 1 },
        ],
      });
      await store.writeAppReferrers('p', 'apple', {
        metrics: ['pageViews'],
        dates: [d1],
        rows: [{ date: d1, kind: 'web', referrer: 'acme.com', pageViews: 9 }],
      });
      await store.writeAppReferrers('p', 'apple', {
        metrics: ['downloads'],
        dates: [d1],
        rows: [{ date: d1, kind: 'web', referrer: 'acme.com', downloads: 4 }],
      });
      expect(await store.queryAppReferrers({ appId: 'p', range })).toEqual([
        { store: 'apple', kind: 'web', referrer: 'acme.com', pageViews: 9, downloads: 4 },
      ]);

      expect(await store.writeAppRatings('p', 'play', [{ date: d1, territory: '*', average: 4.3, dailyAverage: 4 }])).toBe(1);
      expect(await store.writeAppRatings('p', 'play', [{ date: d1, territory: '*', average: 4.3, dailyAverage: 4 }])).toBe(0);
      expect(await store.queryAppRatings({ appId: 'p', range })).toEqual([
        { store: 'play', date: d1, territory: '*', average: 4.3, count: null, dailyAverage: 4 },
      ]);

      const review = {
        id: 'x1',
        createdAt: `${d1}T10:00:00.000Z`,
        rating: 2,
        title: null,
        body: 'Too slow',
        territory: 'USA',
        language: 'en',
        version: '1.0',
        replied: false,
      };
      expect(await store.writeAppReviews('p', 'apple', [review])).toBe(1);
      expect(await store.writeAppReviews('p', 'apple', [review])).toBe(0);
      expect(await store.writeAppReviews('p', 'apple', [{ ...review, rating: 4, replied: true }])).toBe(1);
      await store.writeAppReviews('p', 'play', [{ ...review, id: 'y1', rating: 5, body: 'Great' }]);
      expect(
        (await store.listAppReviews({ appId: 'p', range, contains: 'slow' })).map((r) => [r.store, r.id, r.rating, r.replied]),
      ).toEqual([['apple', 'x1', 4, true]]);
      expect(await store.listAppReviews({ appId: 'p', range, ratings: [1, 2] })).toEqual([]);
      expect(await store.appReviewStats('p', range)).toEqual([
        { store: 'apple', rating: 4, reviews: 1 },
        { store: 'play', rating: 5, reviews: 1 },
      ]);

      await store.writeAppVitals('p', 'play', {
        metrics: ['crashRate', 'distinctUsers'],
        rows: [
          { date: d1, version: '', crashRate: 0.01, distinctUsers: 100 },
          { date: d2, version: '', crashRate: 0.04, distinctUsers: 300 },
          { date: d1, version: '7', crashRate: 0.02, distinctUsers: 50 },
        ],
      });
      await store.writeAppVitals('p', 'play', { metrics: ['anrRate'], rows: [{ date: d1, version: '', anrRate: 0.001 }] });
      const byDate = await store.queryAppVitals({ appId: 'p', range, groupBy: 'date' });
      expect(byDate.map((r) => [r.date, r.crashRate, r.anrRate])).toEqual([
        [d1, 0.01, 0.001],
        [d2, 0.04, null],
      ]);
      const byVersion = await store.queryAppVitals({ appId: 'p', range, groupBy: 'version' });
      expect(byVersion.find((r) => r.version === '')!.crashRate).toBeCloseTo(0.0325, 6);

      await store.writeAppChartRanks('p', [{ date: d1, territory: 'US', chart: 'top-free', genre: '', rank: 12 }]);
      expect(await store.queryAppChartRanks('p', range)).toEqual([{ date: d1, territory: 'US', chart: 'top-free', genre: '', rank: 12 }]);

      const cov = await store.appCoverage('p');
      expect(cov.find((c) => c.dataset === 'search_terms')).toMatchObject({ store: 'play', firstDate: d1, lastDate: d2 });
      expect(cov.find((c) => c.dataset === 'reviews' && c.store === 'apple')).toMatchObject({ firstDate: d1 });
    });

    describe('sync', () => {
      const clients = (asc = fakeAsc(), play = fakePlay()): SourceClients => ({
        asc: asc.client,
        play: play.client,
        appStore: fakePublic(),
      });

      it('syncs App Store reports oldest instance first, history only before them, and Google Play files once', async () => {
        const cfg = config();
        const asc = fakeAsc();
        const play = fakePlay();
        const run = await runSync({
          store,
          config: cfg,
          clients: clients(asc, play),
          trigger: 'manual',
          now: NOW,
          pacing: {},
          timeBudgetMs: 60_000,
        });
        expect(run.status).toBe('ok');
        expect(run.details!.every((d) => d.siteId === 'app:acme-app')).toBe(true);

        // Ongoing: the newest instance wins for each day; a territory a newer instance dropped is zeroed.
        const days = await store.queryAppStore({
          appId: APP.id,
          store: 'apple',
          range: { start: '2026-10-15', end: '2026-10-18' },
          dimensions: ['date'],
          source: 'search',
          orderBy: 'date',
          order: 'asc',
        });
        expect(days.map((r) => [r.date, r.impressions])).toEqual([
          ['2026-10-15', 20],
          ['2026-10-16', 20],
          ['2026-10-17', 20],
          ['2026-10-18', 10],
        ]);
        const gb = await store.queryAppStore({
          appId: APP.id,
          store: 'apple',
          range: { start: '2026-10-16', end: '2026-10-16' },
          dimensions: [],
          territory: 'GB',
        });
        expect(gb[0]?.impressions ?? 0).toBe(0);
        // The snapshot filled only the days before the ongoing report's first day (Oct 15).
        const history = await store.queryAppStore({
          appId: APP.id,
          store: 'apple',
          range: { start: '2026-09-01', end: '2026-10-14' },
          dimensions: [],
        });
        expect(history[0]!.impressions).toBe(999 * 44);
        const perf = await appPerformance(
          { store, config: cfg, clients: clients(), now: () => NOW },
          { app: APP.id, store: 'apple', start: '2026-10-18', end: '2026-10-18', groupBy: ['source'] },
        );
        expect(perf.stores[0]!.current).toMatchObject({ impressions: 10, pageViews: 8, downloads: 4, redownloads: 1 });
        expect(perf.rows!.map((r) => r.source)).toEqual(['search', 'browse']);
        expect(perf.charts).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ chart: 'top-free', genre: '', rank: 2 }),
            expect.objectContaining({ chart: 'top-paid', rank: null }),
            expect.objectContaining({ chart: 'top-free', genre: '6007', rank: 4 }),
          ]),
        );

        // Google Play: per territory and per source, search terms, UTM referrers, installs, ratings, reviews.
        const ctx = { store, config: cfg, clients: clients(), now: () => NOW };
        const playPerf = await appPerformance(ctx, {
          app: APP.id,
          store: 'play',
          start: '2026-10-01',
          end: '2026-10-19',
          groupBy: ['referrer'],
        });
        expect(playPerf.stores[0]!.current).toMatchObject({
          pageViewsUnique: 50,
          downloads: 15,
          installs: 16,
          deletions: 3,
          activeDevices: 127,
        });
        expect(playPerf.referrers).toEqual([
          { store: 'play', kind: 'utm', referrer: 'acme.com', pageViews: 5, downloads: 6, ownSite: false },
        ]);
        const terms = await appSearchTerms(ctx, { app: APP.id, start: '2026-10-01', end: '2026-10-19', minVisitors: 5 });
        expect(terms.terms.map((t) => [t.term, t.visitors, t.acquisitions])).toEqual([
          ['widgets', 25, 1],
          ['acme', 20, 8],
        ]);
        expect(terms.lowConverting.map((t) => t.term)).toEqual(['widgets']);
        const reviews = await appReviews(ctx, { app: APP.id, start: '2026-10-01', end: '2026-10-19' });
        expect(reviews.reviews.map((r) => [r.store, r.id, r.rating])).toEqual([
          ['apple', 'r1', 5],
          ['apple', 'r2', 1],
          ['play', 'gp-1', 2],
        ]);
        expect(reviews.reviews.find((r) => r.id === 'gp-1')).toMatchObject({ replied: true, version: '3.1', language: 'en' });
        expect(reviews.summary.find((s) => s.store === 'play')!.rating).toMatchObject({ average: 4.31 });
        expect(reviews.summary.find((s) => s.store === 'apple')!.rating).toMatchObject({ average: 4.6, count: 1234, territory: 'US' });
        const stability = await appStability(ctx, { app: APP.id, start: '2026-10-01', end: '2026-10-19', groupBy: 'version' });
        expect(stability.summary.find((s) => s.store === 'play')!.crashRate).toBeCloseTo(0.008, 6);
        expect(stability.summary.find((s) => s.store === 'apple')).toMatchObject({ crashes: 4, crashDevices: 3 });
        expect(stability.rows.map((r) => `${r.store}:${r.version}`).sort()).toEqual(['apple:2.0', 'apple:2.1', 'play:31', 'play:32']);

        // Files of other packages are never read; the August file is history.
        expect(play.calls.some((c) => c.includes('com.other.app'))).toBe(false);
        expect(play.calls.filter((c) => c.startsWith('read:'))).toHaveLength(6);

        const progress = await syncProgress({ store, config: cfg, clients: clients(), now: () => NOW });
        expect(progress.summary).toMatchObject({ apps: 1, appsWithRecentData: 1, issues: 0 });
        expect(progress.apps[0]!.datasets.map((d) => [d.dataset, d.state])).toEqual([
          ['app_store', 'done'],
          ['google_play', 'done'],
          ['app_store_public', 'done'],
        ]);
        const apps = await listApps({ store, config: cfg, clients: clients() });
        expect(apps.apps[0]).toMatchObject({
          id: APP.id,
          stores: { appStore: true, googlePlay: true, appStorePublic: true },
          appStoreReports: { started: true },
        });

        // A second pass the same day has nothing due; unchanged files are not read again.
        const again = await runSync({ store, config: cfg, clients: clients(asc, play), trigger: 'cron', now: NOW, pacing: {} });
        expect(again.status).toBe('skipped');
        const nextDay = new Date(NOW.getTime() + 86_400_000);
        const reads = play.calls.length;
        await runSync({ store, config: cfg, clients: clients(asc, play), trigger: 'cron', now: nextDay, pacing: {} });
        expect(play.calls.slice(reads).filter((c) => c.startsWith('read:'))).toEqual([]);
        // Instances already read are not read again.
        expect(asc.calls.filter((c) => c === 'segments:eng-2026-10-19')).toHaveLength(1);
      });

      it('continues across runs when the call budget runs out', async () => {
        const cfg = config({ SYNC_MAX_CALLS_PER_RUN: '5' });
        const c = clients();
        let runs = 0;
        for (; runs < 30; runs++) {
          const r = await runSync({ store, config: cfg, clients: c, trigger: 'cron', now: NOW, pacing: {} });
          if (r.status === 'skipped') break;
        }
        expect(runs).toBeGreaterThan(3);
        expect(runs).toBeLessThan(30);
        const [apple] = await store.queryAppStore({
          appId: APP.id,
          store: 'apple',
          range: { start: '2026-10-18', end: '2026-10-18' },
          dimensions: [],
        });
        expect(apple!.downloads).toBe(4);
      });

      it('asks to start App Store reports when there is no request, and uses stored ids when the key may not list them', async () => {
        const cfg = config({ APP_STORE_PUBLIC_DATA: 'false' });
        const none = fakeAsc({ requests: [] });
        await runSync({ store, config: cfg, clients: { asc: none.client }, trigger: 'manual', now: NOW, pacing: {} });
        const progress = await syncProgress({ store, config: cfg, clients: { asc: none.client }, now: () => NOW });
        expect(progress.apps[0]!.datasets[0]).toMatchObject({
          dataset: 'app_store',
          state: 'error',
          message: expect.stringContaining('Start them in Settings'),
        });

        // The one-time action with an Admin key creates both requests and stores only their ids.
        const admin = fakeAsc({ requests: [{ id: 'old', accessType: 'ONGOING', stoppedDueToInactivity: true }] });
        const res = await startAppStoreReports({ store, config: cfg, clients: {}, now: () => NOW }, { app: APP.id }, admin.client);
        expect(admin.calls).toEqual(['listReportRequests', 'delete:old', 'create:ONGOING', 'create:ONE_TIME_SNAPSHOT']);
        expect(res).toMatchObject({
          ongoing: { id: 'new-ONGOING', created: true },
          snapshot: { id: 'new-ONE_TIME_SNAPSHOT', created: true },
        });
        expect(JSON.parse((await store.getMeta(syncKeys.ascRequests(APP.id)))!)).toEqual({
          ongoing: 'new-ONGOING',
          snapshot: 'new-ONE_TIME_SNAPSHOT',
          snapshotRequestedOn: '2026-10-20',
        });

        // A Sales and Reports key that may not list requests checks the stored one directly.
        const limited = fakeAsc({ listForbidden: true });
        await runSync({ store, config: cfg, clients: { asc: limited.client }, trigger: 'manual', now: NOW, pacing: {} });
        expect(limited.calls.slice(0, 2)).toEqual(['listReportRequests', 'get:new-ONGOING']);
        expect(limited.calls).toContain('listReports:new-ONGOING');
      });
    });
  });
}
