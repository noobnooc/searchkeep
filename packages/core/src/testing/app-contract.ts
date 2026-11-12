/**
 * Store contract tests for apps (ADR 0009): the app tables, and the app sync and analysis on top
 * of a real store, with fake App Store Connect, Google Play and public feed clients.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  appBreakdown,
  appPerformance,
  appReviews,
  appSearchTerms,
  appStability,
  appSubscriptions,
  listApps,
  startAppStoreReports,
} from '../apps/analysis.js';
import {
  ASC_REPORTS,
  BREAKDOWN_VALUES_PER_DAY,
  downloadReferrersCollector,
  engagementCollector,
  playEarningsCollector,
  playCrashesBreakdownCollector,
  playInstallsBreakdownCollector,
  PLAY_LISTING_VERSION,
} from '../apps/reports.js';
import { appStorefronts } from '../apps/storefronts.js';
import { setupStatus } from '../analysis/ops.js';
import { evaluateReadiness } from '../auth/readiness.js';
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
    pur: [{ id: 'pur-2026-10-19', processingDate: '2026-10-19' }],
    ses: [{ id: 'ses-2026-10-19', processingDate: '2026-10-19' }],
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
    if (kind === 'pur') {
      const pur = (source: string, territory: string, purchases: number, proceeds: string, sales: string, payingUsers: number) => ({
        date: '2026-10-18',
        'purchase type': 'In-app purchases',
        'content name': 'Pro',
        'source type': source,
        territory,
        purchases: String(purchases),
        'proceeds in usd': proceeds,
        'sales in usd': sales,
        'paying users': String(payingUsers),
      });
      // Three purchases and one refund from search, one purchase from a website.
      return [
        pur('App Store search', 'US', 3, '20.97', '29.97', 2),
        pur('App Store search', 'US', -1, '-6.99', '-9.99', 0),
        pur('Web referrer', 'GB', 1, '4.99', '6.99', 1),
      ];
    }
    if (kind === 'ses') {
      const ses = (source: string, sessions: number, seconds: number, devices: number) => ({
        date: '2026-10-18',
        'app version': '2.1',
        'source type': source,
        territory: 'US',
        sessions: String(sessions),
        'total session duration': String(seconds),
        'unique devices': String(devices),
      });
      return [ses('App Store search', 40, 3600, 8), ses('App Store browse', 10, 600, 2)];
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
    async latestBuildIcon() {
      return null;
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
            { id: 'pur', name: 'App Store Purchases Standard', category: 'APP_STORE_COMMERCE' },
            { id: 'pre', name: 'App Store Pre-orders Standard', category: 'APP_STORE_COMMERCE' },
            { id: 'ses', name: 'App Sessions Standard', category: 'APP_USAGE' },
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

/**
 * `financeDenied`: listing the financial folders answers 403. `financeReadDenied`: they can be
 * listed, but reading a financial file answers 403 (what an account without "View financial data" sees).
 */
function fakePlay(opts: { financeDenied?: boolean; financeReadDenied?: boolean } = {}) {
  const financial = (name: string) => /^(financial-stats|earnings)\//.test(name);
  const calls: string[] = [];
  const pkg = APP.playPackage;
  const earning = (country: string, type: string, amount: string, product = pkg) => ({
    description: 'GPA.0000-1111-2222-33333',
    'transaction date': 'Oct 10, 2026',
    'transaction type': type,
    'package id': product,
    'buyer country': country,
    'buyer postal code': '94110',
    'merchant currency': 'EUR',
    'amount (merchant currency)': amount,
  });
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
    // Per app version: installs, ratings, crashes and ANRs (ADR 0010).
    [`stats/installs/installs_${pkg}_202610_app_version.csv`]: [
      {
        date: '2026-10-10',
        'app version code': '31',
        'daily device installs': '5',
        'daily device uninstalls': '1',
        'active device installs': '80',
      },
      {
        date: '2026-10-10',
        'app version code': '32',
        'daily device installs': '3',
        'daily device uninstalls': '0',
        'active device installs': '47',
      },
    ],
    [`stats/ratings/ratings_${pkg}_202610_app_version.csv`]: [
      { date: '2026-10-10', 'app version code': '31', 'daily average rating': '3.50', 'total average rating': '4.20' },
      { date: '2026-10-10', 'app version code': '32', 'daily average rating': '4.80', 'total average rating': '4.60' },
    ],
    [`stats/crashes/crashes_${pkg}_202610_app_version.csv`]: [
      { date: '2026-10-10', 'app version code': '31', 'daily crashes': '6', 'daily anrs': '1' },
      { date: '2026-10-10', 'app version code': '32', 'daily crashes': '1', 'daily anrs': '0' },
    ],
    [`financial-stats/subscriptions/subscriptions_${pkg}_pro_monthly_202610_country.csv`]: [
      {
        date: '2026-10-09',
        country: 'US',
        'base plan id': 'monthly',
        'new subscriptions': '3',
        'cancelled subscriptions': '1',
        'active subscriptions': '20',
      },
      {
        date: '2026-10-10',
        country: 'US',
        'base plan id': 'monthly',
        'new subscriptions': '2',
        'cancelled subscriptions': '0',
        'active subscriptions': '22',
      },
      {
        date: '2026-10-10',
        country: 'DE',
        'base plan id': 'monthly',
        'new subscriptions': '1',
        'cancelled subscriptions': '1',
        'active subscriptions': '5',
      },
    ],
    // The whole account's earnings: a charge with Google's fee and tax, a refunded charge, another app.
    'earnings/earnings_202610_1234567890-0.zip': [
      earning('US', 'Charge', '9.99'),
      earning('US', 'Google fee', '-1.50'),
      earning('US', 'Tax', '-1.60'),
      earning('DE', 'Charge', '4.99'),
      earning('DE', 'Google fee', '-0.75'),
      earning('DE', 'Charge refund', '-4.99'),
      earning('DE', 'Google fee refund', '0.75'),
      earning('US', 'Charge', '100.00', 'com.other.app'),
    ],
    // An adjustment file with one more charge on the same day: it adds to the month's file.
    'earnings/earnings_202610_1234567890-1.zip': [earning('US', 'Charge', '4.99'), earning('US', 'Google fee', '-0.75')],
  };
  const client: PlayClient = {
    async listObjects(_bucket, prefix) {
      calls.push(`list:${prefix}`);
      if (opts.financeDenied && financial(prefix))
        throw new SourceError('play', 403, 'HTTP 403: does not have storage.objects.list access');
      return Object.keys(files)
        .filter((n) => n.startsWith(prefix))
        .map((name) => ({ name, generation: '1', size: 10, updated: '2026-10-19T00:00:00Z' }));
    },
    async readCsv(_bucket, name, onRow) {
      calls.push(`read:${name}`);
      if (opts.financeReadDenied && financial(name)) throw new SourceError('play', 403, `could not read ${name} (HTTP 403)`);
      for (const r of files[name] ?? []) onRow(r);
      return files[name]?.length ?? 0;
    },
    async canRead(_bucket, name) {
      calls.push(`canRead:${name}`);
      return !((opts.financeReadDenied || opts.financeDenied) && financial(name));
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
    return {
      appleId: APP.appleId,
      name: 'Acme',
      averageUserRating: 4.6,
      userRatingCount: 1234,
      version: '2.1',
      primaryGenreId: '6007',
      price: 0,
    };
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

    it('leaves out the rows of excluded sources', async () => {
      const day = '2026-10-05';
      await store.writeAppStoreDaily('v', 'apple', {
        metrics: ['downloads'],
        shape: 'cross',
        dates: [day],
        rows: [
          { date: day, territory: 'US', source: 'search', downloads: 10 },
          { date: day, territory: 'DE', source: 'institutional', downloads: 100000 },
          { date: day, territory: 'DE', source: 'browse', downloads: 2 },
        ],
      });
      const range = { start: day, end: day };
      const q = { appId: 'v', range, excludeSources: ['institutional'] };
      const [total] = await store.queryAppStore({ ...q, dimensions: [] });
      expect(total!.downloads).toBe(12);
      const territories = await store.queryAppStore({ ...q, dimensions: ['territory'], orderBy: 'downloads' });
      expect(territories.map((r) => [r.territory, r.downloads])).toEqual([
        ['US', 10],
        ['DE', 2],
      ]);
      const [all] = await store.queryAppStore({ appId: 'v', range, dimensions: [] });
      expect(all!.downloads).toBe(100012);
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

    it('replaces every day a newer report covers, also days without kept rows or referrers', async () => {
      const day = '2026-10-05';
      const row = (extra: Record<string, string>): DelimitedRow => ({
        date: day,
        territory: 'US',
        counts: '4',
        'unique counts': '3',
        ...extra,
      });
      // An older instance: a website referrer, and impressions from search.
      const older = downloadReferrersCollector();
      older.add(row({ 'source type': 'Web referrer', 'source info': 'acme.com', 'download type': 'First-time download' }));
      await older.write(store, 'x');
      const olderFunnel = engagementCollector();
      olderFunnel.add(row({ 'source type': 'App Store search', event: 'Impression', 'page type': 'No page' }));
      await olderFunnel.write(store, 'x');
      // The newer instance still covers the day, but Apple left out the referrer and the impressions.
      const newer = downloadReferrersCollector();
      newer.add(row({ 'source type': 'App Store search', 'download type': 'First-time download' }));
      expect(await newer.write(store, 'x')).toMatchObject({ oldest: day });
      const newerFunnel = engagementCollector();
      newerFunnel.add(row({ 'source type': 'App Store search', event: 'Tap', 'page type': 'No page' }));
      await newerFunnel.write(store, 'x');
      const range = { start: day, end: day };
      expect(await store.queryAppReferrers({ appId: 'x', range })).toEqual([]);
      const [total] = await store.queryAppStore({ appId: 'x', range, dimensions: [] });
      expect(total!.impressions).toBe(0);
    });

    describe('sync', () => {
      const clients = (asc = fakeAsc(), play = fakePlay()): SourceClients => ({
        asc: asc.client,
        play: play.client,
        appStore: fakePublic(),
      });

      it('reads snapshot instances left pending by an earlier run oldest first, so the newer one wins', async () => {
        const cfg = config({ APP_STORE_PUBLIC_DATA: 'false' });
        const today = '2026-10-20';
        await store.setMeta(syncKeys.ascRequests(APP.id), JSON.stringify({ ongoing: 'ongoing', snapshot: 'snap', checkedOn: today }));
        await store.setMeta(syncKeys.ascReviews(APP.id), JSON.stringify({ historyDone: true, checkedOn: today }));
        const looked = ASC_REPORTS.map((r) => r.key);
        await store.setMeta(
          syncKeys.ascReports(APP.id, 'ongoing'),
          JSON.stringify({ requestId: 'ongoing', checkedOn: today, reports: {}, looked }),
        );
        await store.setMeta(
          syncKeys.ascReports(APP.id, 'snapshot'),
          JSON.stringify({ requestId: 'snap', checkedOn: today, reports: { engagement: 'snap-eng' }, looked }),
        );
        await store.setMeta(
          syncKeys.ascPending(APP.id, 'snapshot', 'engagement'),
          JSON.stringify({
            listedOn: today,
            instances: [
              { id: 's-old', processingDate: '2026-10-18' },
              { id: 's-new', processingDate: '2026-10-19' },
            ],
          }),
        );
        await store.setMeta(syncKeys.ascFrom(APP.id, 'engagement'), '2026-10-15');
        const read: string[] = [];
        const asc = fakeAsc();
        asc.client.listSegments = async (id) => [{ id: `${id}-0`, url: id, sizeInBytes: 1 }];
        asc.client.readSegment = async (segment, onRow) => {
          read.push(segment.url);
          onRow({
            date: '2026-10-01',
            event: 'Impression',
            'page type': 'No page',
            'source type': 'App Store search',
            territory: 'US',
            counts: segment.url === 's-new' ? '7' : '5',
            'unique counts': '1',
          });
          return 1;
        };
        await runSync({ store, config: cfg, clients: { asc: asc.client }, trigger: 'cron', now: NOW, pacing: {} });
        expect(read).toEqual(['s-old', 's-new']);
        const [day] = await store.queryAppStore({
          appId: APP.id,
          store: 'apple',
          range: { start: '2026-10-01', end: '2026-10-01' },
          dimensions: [],
        });
        expect(day!.impressions).toBe(7);
      });

      it('writes App Store history while the ongoing report of that kind has no day yet', async () => {
        const cfg = config({ APP_STORE_PUBLIC_DATA: 'false' });
        const today = '2026-10-20';
        await store.setMeta(syncKeys.ascRequests(APP.id), JSON.stringify({ ongoing: 'ongoing', snapshot: 'snap', checkedOn: today }));
        await store.setMeta(syncKeys.ascReviews(APP.id), JSON.stringify({ historyDone: true, checkedOn: today }));
        const looked = ASC_REPORTS.map((r) => r.key);
        // Apple made the ongoing downloads report but no daily instance of it yet (nobody downloaded the app since).
        await store.setMeta(
          syncKeys.ascReports(APP.id, 'ongoing'),
          JSON.stringify({ requestId: 'ongoing', checkedOn: today, reports: { downloads: 'dl' }, looked }),
        );
        await store.setMeta(syncKeys.ascPending(APP.id, 'ongoing', 'downloads'), JSON.stringify({ listedOn: today, instances: [] }));
        await store.setMeta(
          syncKeys.ascReports(APP.id, 'snapshot'),
          JSON.stringify({ requestId: 'snap', checkedOn: today, reports: { downloads: 'snap-dl' }, looked }),
        );
        await store.setMeta(
          syncKeys.ascPending(APP.id, 'snapshot', 'downloads'),
          JSON.stringify({ listedOn: today, instances: [{ id: 'snap-dl-1', processingDate: '2026-10-19' }] }),
        );
        const read: string[] = [];
        const asc = fakeAsc();
        asc.client.listSegments = async (id) => [{ id: `${id}-0`, url: id, sizeInBytes: 1 }];
        asc.client.readSegment = async (segment, onRow) => {
          read.push(segment.url);
          for (const date of ['2025-03-01', '2026-10-18'])
            onRow({ date, 'download type': 'First-time download', 'source type': 'App Store search', territory: 'US', counts: '3' });
          return 2;
        };
        await runSync({ store, config: cfg, clients: { asc: asc.client }, trigger: 'cron', now: NOW, pacing: {} });
        expect(read).toEqual(['snap-dl-1']);
        const days = await store.queryAppStore({
          appId: APP.id,
          store: 'apple',
          range: { start: '2025-03-01', end: '2026-10-18' },
          dimensions: ['date'],
          orderBy: 'date',
          order: 'asc',
        });
        expect(days.filter((d) => d.downloads > 0).map((d) => [d.date, d.downloads])).toEqual([
          ['2025-03-01', 3],
          ['2026-10-18', 3],
        ]);
        // The instance counts as read: a later run does not read it again.
        expect(JSON.parse((await store.getMeta(syncKeys.ascPending(APP.id, 'snapshot', 'downloads')))!)).toMatchObject({ instances: [] });
        await runSync({ store, config: cfg, clients: { asc: asc.client }, trigger: 'cron', now: NOW, pacing: {} });
        expect(read).toEqual(['snap-dl-1']);
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
        // Revenue (net of the refund) and sessions, attributed to how people found the app.
        expect(perf.stores[0]!.currency).toBe('USD');
        expect(perf.stores[0]!.current).toMatchObject({
          purchases: 3,
          proceeds: 18.97,
          sales: 26.97,
          payingUsers: 3,
          sessions: 50,
          sessionSeconds: 4200,
          sessionDevices: 10,
          averageSessionSeconds: 84,
          sessionsPerDevice: 5,
          proceedsPerDownload: 4.7425,
        });
        expect(perf.rows!.map((r) => r.source)).toEqual(['search', 'browse', 'web_referrer']);
        expect(perf.rows!.find((r) => r.source === 'search')).toMatchObject({ proceeds: 13.98, sessions: 40, proceedsPerDownload: 3.495 });
        expect(perf.rows!.find((r) => r.source === 'web_referrer')).toMatchObject({
          proceeds: 4.99,
          downloads: 0,
          proceedsPerDownload: null,
        });
        // A free app is checked in the free charts only, overall and in its category.
        expect(perf.charts!.filter((c) => c.territory === 'US').map((c) => [c.chart, c.genre, c.rank, c.genreName])).toEqual([
          ['top-free', '', 2, undefined],
          ['top-free', '6007', 4, 'Productivity'],
        ]);

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
          // Earnings of this app only: 9.99 charged, 1.50 fee and 1.60 tax kept, the refunded charge nets
          // out, and the adjustment file adds 4.99 charged and a 0.75 fee on the same day.
          purchases: 2,
          sales: 14.98,
          proceeds: 11.13,
        });
        expect(playPerf.stores[0]!.currency).toBe('EUR');
        const subs = await appSubscriptions(ctx, { app: APP.id, start: '2026-10-01', end: '2026-10-19' });
        expect(subs.current).toEqual({ newSubscriptions: 6, canceledSubscriptions: 2, activeSubscriptions: 27, net: 4 });
        expect(subs.products).toEqual([
          { product: 'pro_monthly', newSubscriptions: 6, canceledSubscriptions: 2, activeSubscriptions: 27, net: 4 },
        ]);
        expect(subs.territories.map((t) => [t.territory, t.activeSubscriptions, t.net])).toEqual([
          ['US', 22, 4],
          ['DE', 5, 0],
        ]);
        expect(subs.series.map((d) => [d.date, d.activeSubscriptions])).toEqual([
          ['2026-10-09', 20],
          ['2026-10-10', 27],
        ]);
        expect(playPerf.referrers).toEqual([
          { store: 'play', kind: 'utm', referrer: 'acme.com', pageViews: 5, downloads: 6, ownSite: true },
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
        expect(play.calls.filter((c) => c.startsWith('read:'))).toHaveLength(12);

        // Per app version: Google Play installs, ratings and crashes; App Store sessions and crash counts.
        const versions = await appBreakdown(ctx, { app: APP.id, store: 'play', start: '2026-10-01', end: '2026-10-19' });
        expect(
          versions.rows.map((v) => [v.value, v.installs, v.deletions, v.activeDevices, v.crashes, v.anrs, v.dailyRating, v.totalRating]),
        ).toEqual([
          ['31', 5, 1, 80, 6, 1, 3.5, 4.2],
          ['32', 3, 0, 47, 1, 0, 4.8, 4.6],
        ]);
        const apple = await appBreakdown(ctx, { app: APP.id, store: 'apple', start: '2026-10-18', end: '2026-10-18' });
        expect(apple.rows.map((v) => [v.value, v.sessions, v.crashes, v.crashesPerSession])).toEqual([
          ['2.1', 50, 1, 0.02],
          ['2.0', 0, 3, null],
        ]);
        expect(
          (await appBreakdown(ctx, { app: APP.id, store: 'apple', dimension: 'device', start: '2026-10-18', end: '2026-10-18' })).rows,
        ).toHaveLength(1);

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

      it('leaves institutional purchases out of the funnel and the storefronts, and lists them by source', async () => {
        const cfg = config();
        const day = '2026-10-15';
        await store.writeAppStoreDaily(APP.id, 'apple', {
          metrics: ['pageViewsUnique', 'downloads'],
          shape: 'cross',
          dates: [day],
          rows: [
            { date: day, territory: 'US', source: 'search', pageViewsUnique: 40, downloads: 10 },
            { date: day, territory: 'FR', source: 'search', pageViewsUnique: 8, downloads: 2 },
            // An organization took 100,000 licenses through Apple Business Manager.
            { date: day, territory: 'DE', source: 'institutional', pageViewsUnique: 0, downloads: 100000 },
          ],
        });
        const ctx = { store, config: cfg, clients: {}, now: () => NOW };
        const p = { app: APP.id, store: 'apple' as const, start: day, end: day };
        const perf = await appPerformance(ctx, { ...p, groupBy: ['territory'] });
        expect(perf.stores[0]!.current).toMatchObject({ downloads: 12, pageConversion: 0.25 });
        expect(perf.stores[0]!.series.map((x) => x.downloads)).toEqual([12]);
        expect(perf.stores[0]!.volumePurchaseDownloads).toBe(100000);
        expect(perf.notes.some((n) => n.includes('100,000 first-time downloads from institutional purchases'))).toBe(true);
        expect(perf.rows!.map((r) => r.territory)).toEqual(['US', 'FR']);
        // By source, they are a row of their own; asked for by source, they are the totals.
        const bySource = await appPerformance(ctx, { ...p, groupBy: ['source'] });
        expect(bySource.rows!.map((r) => [r.source, r.downloads])).toEqual([
          ['search', 12],
          ['institutional', 100000],
        ]);
        const only = await appPerformance(ctx, { ...p, source: 'institutional' });
        expect(only.stores[0]!.current.downloads).toBe(100000);
        expect(only.stores[0]!.volumePurchaseDownloads).toBeUndefined();
        // They do not make Germany one of the app's biggest storefronts.
        expect(await appStorefronts(store, APP, '2026-10-20')).toEqual(['us', 'fr', 'cn', 'jp', 'gb']);
      });

      it("checks the app's biggest storefronts first and only the charts it can be in", async () => {
        const cfg = config();
        const day = '2026-10-15';
        await store.writeAppStoreDaily(APP.id, 'apple', {
          metrics: ['downloads'],
          shape: 'territory',
          dates: [day],
          rows: [
            { date: day, territory: 'JP', source: '*', downloads: 40 },
            { date: day, territory: 'FR', source: '*', downloads: 9 },
            { date: day, territory: 'US', source: '*', downloads: 3 },
          ],
        });
        const looked: string[] = [];
        const charts: string[] = [];
        const paidApp: AppStorePublicClient = {
          async lookup(_id, country) {
            looked.push(country);
            // Not sold in China; no ratings yet in France.
            if (country === 'cn') return null;
            const none = country === 'fr';
            return {
              appleId: APP.appleId,
              name: 'Acme',
              averageUserRating: none ? null : 4.5,
              userRatingCount: none ? 0 : 20,
              version: '2.1',
              primaryGenreId: '6011',
              price: 2.99,
            };
          },
          async topChart(country, chart, genre) {
            charts.push(`${country}:${chart}:${genre ?? ''}`);
            return country === 'jp' && genre ? ['1', APP.appleId] : ['1'];
          },
        };
        const sync = (now: Date) => runSync({ store, config: cfg, clients: { appStore: paidApp }, trigger: 'manual', now, pacing: {} });
        await sync(new Date('2026-10-19T04:00:00Z'));
        // The app's own storefronts by downloads, then the largest ones, at most five.
        expect(looked).toEqual(['jp', 'fr', 'us', 'cn', 'gb']);
        // A paid app: the paid charts only, overall and in its category; none where it is not sold.
        expect(charts.filter((c) => c.startsWith('jp:'))).toEqual(['jp:top-paid:', 'jp:top-paid:6011']);
        expect(charts.some((c) => c.startsWith('cn:'))).toBe(false);

        // The next day JP drops out of the category chart; a chart checked before but no longer is gone.
        await store.writeAppChartRanks(APP.id, [{ date: '2026-10-19', territory: 'JP', chart: 'top-free', genre: '', rank: null }]);
        paidApp.topChart = async () => ['1'];
        await sync(NOW);
        const ctx = { store, config: cfg, clients: {}, now: () => NOW };
        const perf = await appPerformance(ctx, { app: APP.id, store: 'apple', start: '2026-10-15', end: '2026-10-15' });
        expect(perf.charts!.map((c) => c.territory)).toEqual(['JP', 'JP', 'FR', 'FR', 'US', 'US', 'GB', 'GB']);
        expect(perf.charts!.filter((c) => c.territory === 'JP')).toEqual([
          { date: '2026-10-20', territory: 'JP', chart: 'top-paid', genre: '', rank: null, previous: { date: '2026-10-19', rank: null } },
          {
            date: '2026-10-20',
            territory: 'JP',
            chart: 'top-paid',
            genre: '6011',
            genreName: 'Music',
            rank: null,
            previous: { date: '2026-10-19', rank: 2 },
          },
        ]);

        // The rating shown is the first storefront with ratings, in the same order.
        const reviews = await appReviews(ctx, { app: APP.id, store: 'apple' });
        expect(reviews.summary[0]!.rating).toMatchObject({ territory: 'JP', average: 4.5, count: 20 });
      });

      it('continues the public feeds storefront by storefront when a run has few calls', async () => {
        const cfg = config({ SYNC_MAX_CALLS_PER_RUN: '5' });
        const looked: string[] = [];
        const pub: AppStorePublicClient = {
          async lookup(_id, country) {
            looked.push(country);
            return { ...(await fakePublic().lookup(APP.appleId, country))!, price: 0 };
          },
          topChart: async () => [],
        };
        let runs = 0;
        while ((await store.getMeta(syncKeys.appStorePublic(APP.id))) !== '2026-10-20' && runs < 10) {
          await runSync({ store, config: cfg, clients: { appStore: pub }, trigger: 'manual', now: NOW, pacing: {} });
          runs += 1;
        }
        // Five storefronts of three calls each do not fit one run of five calls, but every run saves its storefronts.
        expect(runs).toBeGreaterThan(1);
        expect(runs).toBeLessThan(10);
        expect([...new Set(looked)]).toEqual(['us', 'cn', 'jp', 'gb', 'de']);
        expect(looked.filter((c) => c === 'us')).toHaveLength(1);
        const ranks = await store.queryAppChartRanks(APP.id, { start: '2026-10-20', end: '2026-10-20' });
        expect(new Set(ranks.map((r) => r.territory)).size).toBe(5);
      });

      it('reads Google Play installs files once more after their reader changed', async () => {
        const cfg = config({ APP_STORE_PUBLIC_DATA: 'false' });
        const installs = `stats/installs/installs_${APP.playPackage}_202610_country.csv`;
        const visitors = `stats/store_performance/store_performance_${APP.playPackage}_202608_country.csv`;
        // Read by the previous reader, which marked files with their generation only.
        await store.setMeta(syncKeys.playObject(APP.id, installs), '1');
        await store.setMeta(syncKeys.playObject(APP.id, visitors), '1');
        const play = fakePlay();
        const sync = (client: PlayClient) =>
          runSync({ store, config: cfg, clients: { play: client }, trigger: 'manual', now: NOW, pacing: {} });
        await sync(play.client);
        expect(play.calls).toContain(`read:${installs}`);
        expect(play.calls).not.toContain(`read:${visitors}`);
        expect(await store.getMeta(syncKeys.playObject(APP.id, installs))).toBe('1#2');
        const again = fakePlay();
        await sync(again.client);
        expect(again.calls.filter((c) => c.startsWith('read:'))).toEqual([]);
        const progress = await syncProgress({ store, config: cfg, clients: { play: play.client }, now: () => NOW });
        expect(progress.apps[0]!.datasets.find((d) => d.dataset === 'google_play')).toMatchObject({ complete: true });
      });

      it('looks for report kinds added since the last listing right away', async () => {
        const cfg = config({ APP_STORE_PUBLIC_DATA: 'false' });
        const today = '2026-10-20';
        await store.setMeta(syncKeys.ascRequests(APP.id), JSON.stringify({ ongoing: 'ongoing', checkedOn: today }));
        await store.setMeta(syncKeys.ascReviews(APP.id), JSON.stringify({ historyDone: true, checkedOn: today }));
        // Listed two days ago by a version that knew fewer reports: normally good for a week.
        await store.setMeta(
          syncKeys.ascReports(APP.id, 'ongoing'),
          JSON.stringify({
            requestId: 'ongoing',
            checkedOn: '2026-10-18',
            reports: { engagement: 'eng', downloads: 'dl', crashes: 'crash' },
          }),
        );
        const asc = fakeAsc();
        await runSync({ store, config: cfg, clients: { asc: asc.client }, trigger: 'manual', now: NOW, pacing: {} });
        expect(asc.calls).toContain('listReports:ongoing');
        expect(asc.calls).toContain('listInstances:pur');
        expect(asc.calls).toContain('listInstances:ses');
        const saved = JSON.parse((await store.getMeta(syncKeys.ascReports(APP.id, 'ongoing')))!);
        expect(saved.reports).toMatchObject({ purchases: 'pur', sessions: 'ses' });
        expect(saved.reports).not.toHaveProperty('pre');
        // Listed with every kind looked for: not listed again tomorrow.
        const next = fakeAsc();
        await store.setMeta(syncKeys.ascRequests(APP.id), JSON.stringify({ ongoing: 'ongoing', checkedOn: '2026-10-21' }));
        await store.setMeta(syncKeys.ascReviews(APP.id), JSON.stringify({ historyDone: true, checkedOn: '2026-10-21' }));
        await runSync({
          store,
          config: cfg,
          clients: { asc: next.client },
          trigger: 'manual',
          now: new Date('2026-10-21T04:00:00Z'),
          pacing: {},
        });
        expect(next.calls).not.toContain('listReports:ongoing');
      });

      it('syncs the rest of Google Play when the service account may not view financial data', async () => {
        const cfg = config({ APP_STORE_PUBLIC_DATA: 'false' });
        const play = fakePlay({ financeDenied: true });
        const run = await runSync({ store, config: cfg, clients: { play: play.client }, trigger: 'manual', now: NOW, pacing: {} });
        expect(run.status).toBe('ok');
        expect(play.calls).toContain(`read:stats/installs/installs_${APP.playPackage}_202610_country.csv`);
        expect(play.calls.some((c) => c.startsWith('read:earnings/') || c.startsWith('read:financial-stats/'))).toBe(false);
        expect(JSON.parse((await store.getMeta(syncKeys.playFinanceListing(APP.id)))!)).toMatchObject({ finance: 'denied', objects: [] });
        const ctx = { store, config: cfg, clients: {}, now: () => NOW };
        const perf = await appPerformance(ctx, { app: APP.id, store: 'play', start: '2026-10-01', end: '2026-10-19' });
        expect(perf.stores[0]).toMatchObject({ currency: null, current: { installs: 16, proceeds: 0 } });
        expect((await appSubscriptions(ctx, { app: APP.id, start: '2026-10-01', end: '2026-10-19' })).current.activeSubscriptions).toBe(0);
      });

      it('syncs the rest of Google Play when the financial files can be listed but not read', async () => {
        const cfg = config({ APP_STORE_PUBLIC_DATA: 'false' });
        const play = fakePlay({ financeReadDenied: true });
        const run = await runSync({ store, config: cfg, clients: { play: play.client }, trigger: 'manual', now: NOW, pacing: {} });
        expect(run.status).toBe('ok');
        expect(play.calls).toContain(`read:stats/installs/installs_${APP.playPackage}_202610_country.csv`);
        expect(play.calls).toContain(`read:stats/installs/installs_${APP.playPackage}_202610_app_version.csv`);
        // The first financial file answers 403; the others are not tried.
        const financialReads = (calls: string[]) =>
          calls.filter((c) => c.startsWith('read:earnings/') || c.startsWith('read:financial-stats/'));
        expect(financialReads(play.calls)).toHaveLength(1);
        expect(JSON.parse((await store.getMeta(syncKeys.playFinanceListing(APP.id)))!)).toMatchObject({ finance: 'denied', objects: [] });
        const progress = await syncProgress({ store, config: cfg, clients: { play: play.client }, now: () => NOW });
        expect(progress.apps[0]!.datasets.find((d) => d.dataset === 'google_play')).toMatchObject({ complete: true });
        // Not tried again the same day.
        const later = fakePlay({ financeReadDenied: true });
        await runSync({
          store,
          config: cfg,
          clients: { play: later.client },
          trigger: 'manual',
          now: new Date('2026-10-20T05:00:00Z'),
          pacing: {},
        });
        expect(financialReads(later.calls)).toHaveLength(0);
        // setup_status says which permission to turn on; listing alone would have looked fine.
        const readiness = evaluateReadiness({
          configured: true,
          identityOk: true,
          inspection: { appFound: true, managedOAuthEnabled: true, broadPolicyReasons: [] },
        });
        const check = async (client: PlayClient) =>
          (await setupStatus({ store, config: cfg, clients: { play: client } }, { readiness })).checks.find(
            (c) => c.id === 'probe.play_finance',
          );
        expect(await check(later.client)).toMatchObject({ status: 'warn', detail: expect.stringContaining('View financial data') });
        expect(later.calls).toContain('canRead:earnings/earnings_202610_1234567890-0.zip');
        expect(await check(fakePlay({ financeDenied: true }).client)).toMatchObject({ status: 'warn' });
        expect(await check(fakePlay().client)).toMatchObject({ status: 'ok' });
      });

      it('lists the Play files again when today’s listing was made by an older version', async () => {
        const cfg = config({ APP_STORE_PUBLIC_DATA: 'false' });
        // Listed earlier today by a version that did not look for files per app version yet.
        await store.setMeta(syncKeys.playListing(APP.id), JSON.stringify({ day: '2026-10-20', objects: [] }));
        const play = fakePlay();
        await runSync({ store, config: cfg, clients: { play: play.client }, trigger: 'manual', now: NOW, pacing: {} });
        expect(play.calls).toContain(`list:stats/crashes/crashes_${APP.playPackage}_`);
        expect(play.calls).toContain(`read:stats/installs/installs_${APP.playPackage}_202610_app_version.csv`);
        expect(JSON.parse((await store.getMeta(syncKeys.playListing(APP.id)))!)).toMatchObject({ v: PLAY_LISTING_VERSION });
        // Listed by this version: not listed again the same day.
        const later = fakePlay();
        await runSync({
          store,
          config: cfg,
          clients: { play: later.client },
          trigger: 'manual',
          now: new Date('2026-10-20T05:00:00Z'),
          pacing: {},
        });
        expect(later.calls.filter((c) => c.startsWith('list:'))).toHaveLength(0);
      });

      it('keeps each earnings file apart, so a file read again changes only its own part of a day', async () => {
        const read = async (file: string, rows: DelimitedRow[]) => {
          const c = playEarningsCollector(APP.playPackage, file);
          for (const r of rows) c.add(r);
          await c.write(store, APP.id);
        };
        const row = (country: string, amount: string): DelimitedRow => ({
          'transaction date': 'Oct 10, 2026',
          'transaction type': 'Charge',
          'package id': APP.playPackage,
          'buyer country': country,
          'merchant currency': 'EUR',
          'amount (merchant currency)': amount,
        });
        const byCountry = async () =>
          (
            await store.queryAppStore({
              appId: APP.id,
              store: 'play',
              range: { start: '2026-10-10', end: '2026-10-10' },
              dimensions: ['territory'],
              orderBy: 'proceedsCents',
            })
          )
            .filter((r) => r.proceedsCents !== 0)
            .map((r) => [r.territory, r.proceedsCents]);
        await read('earnings/earnings_202610.zip', [row('US', '9.99')]);
        await read('earnings/earnings_202610_adjustments.zip', [row('US', '4.99')]);
        expect(await byCountry()).toEqual([['US', 1498]]);
        // The adjustment file changed: its US charge is gone and a German one came in.
        await read('earnings/earnings_202610_adjustments.zip', [row('DE', '1.00')]);
        expect(await byCountry()).toEqual([
          ['US', 999],
          ['DE', 100],
        ]);
      });

      it('syncs Google Play within the smallest call budget', async () => {
        const cfg = config({ APP_STORE_PUBLIC_DATA: 'false', SYNC_MAX_CALLS_PER_RUN: '5' });
        const play = fakePlay();
        for (let i = 0; i < 6; i++)
          await runSync({ store, config: cfg, clients: { play: play.client }, trigger: 'manual', now: NOW, pacing: {} });
        expect(play.calls).toContain('list:stats/store_performance/');
        expect(play.calls).toContain('list:earnings/earnings_');
        expect(play.calls).toContain(`read:stats/installs/installs_${APP.playPackage}_202610_country.csv`);
      });

      it('keeps the biggest values of a breakdown per day and sums the rest into Other', async () => {
        const c = playInstallsBreakdownCollector('device');
        for (let i = 0; i < BREAKDOWN_VALUES_PER_DAY + 5; i++)
          c.add({
            date: '2026-10-10',
            device: `phone-${String(i).padStart(2, '0')}`,
            'daily device installs': String(100 - i),
            'active device installs': '1',
          });
        await c.write(store, APP.id);
        const rows = await store.queryAppBreakdowns({
          appId: APP.id,
          dimension: 'device',
          range: { start: '2026-10-10', end: '2026-10-10' },
          limit: 500,
        });
        expect(rows).toHaveLength(BREAKDOWN_VALUES_PER_DAY + 1);
        expect(rows.find((r) => r.value === 'phone-00')).toMatchObject({ installs: 100 });
        expect(rows.some((r) => r.value === 'phone-50')).toBe(false);
        // The five smallest (50 down to 46 installs) are one row.
        expect(rows.find((r) => r.value === 'Other')).toMatchObject({ installs: 50 + 49 + 48 + 47 + 46, activeDevices: 5 });
        // The crashes file follows the values the installs file kept: a device outside them goes to Other.
        const crashes = playCrashesBreakdownCollector('device');
        crashes.add({ date: '2026-10-10', device: 'phone-00', 'daily crashes': '5', 'daily anrs': '0' });
        crashes.add({ date: '2026-10-10', device: 'phone-54', 'daily crashes': '7', 'daily anrs': '1' });
        await crashes.write(store, APP.id);
        const after = await store.queryAppBreakdowns({
          appId: APP.id,
          dimension: 'device',
          range: { start: '2026-10-10', end: '2026-10-10' },
          limit: 500,
        });
        expect(after).toHaveLength(BREAKDOWN_VALUES_PER_DAY + 1);
        expect(after.find((r) => r.value === 'phone-00')).toMatchObject({ installs: 100, crashes: 5 });
        expect(after.find((r) => r.value === 'Other')).toMatchObject({ crashes: 7, anrs: 1 });
        // Installs read again without some values clear their installs; the crashes stay until their file is read again.
        const again = playInstallsBreakdownCollector('device');
        again.add({ date: '2026-10-10', device: 'phone-00', 'daily device installs': '7' });
        await again.write(store, APP.id);
        expect(
          (await store.queryAppBreakdowns({ appId: APP.id, dimension: 'device', range: { start: '2026-10-10', end: '2026-10-10' } })).map(
            (r) => [r.value, r.installs, r.crashes],
          ),
        ).toEqual([
          ['phone-00', 7, 5],
          ['Other', 0, 7],
        ]);
      });

      it('merges App Store crash counts into their versions before limiting the breakdown', async () => {
        const cfg = config();
        const day = '2026-10-10';
        await store.writeAppBreakdowns(APP.id, 'apple', {
          dimension: 'app_version',
          metrics: ['sessions'],
          dates: [day],
          rows: [
            { date: day, value: '3.0', sessions: 100 },
            { date: day, value: '2.9', sessions: 10 },
          ],
        });
        await store.writeAppVitals(APP.id, 'apple', { metrics: ['crashes'], rows: [{ date: day, version: '2.9', crashes: 4 }] });
        const ctx = { store, config: cfg, clients: {}, now: () => NOW };
        const top = await appBreakdown(ctx, { app: APP.id, store: 'apple', start: day, end: day, limit: 1 });
        expect(top.rows.map((r) => [r.value, r.sessions, r.crashes])).toEqual([['3.0', 100, 0]]);
        const both = await appBreakdown(ctx, { app: APP.id, store: 'apple', start: day, end: day, limit: 2 });
        expect(both.rows.map((r) => [r.value, r.sessions, r.crashes, r.crashesPerSession])).toEqual([
          ['3.0', 100, 0, null],
          ['2.9', 10, 4, 0.4],
        ]);
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
