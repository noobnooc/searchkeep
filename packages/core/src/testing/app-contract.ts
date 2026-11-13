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
  appRevenue,
  appChanges,
  appFrameworkReport,
  appAds,
  replyReview,
  listApps,
  startAppStoreReports,
} from '../apps/analysis.js';
import {
  ASC_REPORTS,
  BREAKDOWN_VALUES_PER_DAY,
  crashesCollector,
  crashesExpandedCollector,
  downloadReferrersCollector,
  downloadsCollector,
  engagementCollector,
  engagementReferrersCollector,
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
import type { AppListingValue } from '../types.js';
import { SourceError } from '../http.js';
import type { AppleAdsClient, AscClient, AscReportRequest, PlayClient, AppStorePublicClient, SourceClients } from '../sources.js';
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
function fakeAsc(
  opts: {
    listForbidden?: boolean;
    requests?: AscReportRequest[];
    salesForbidden?: boolean;
    listing?: AppListingValue[] | 'forbidden';
    /** Installs reports: the snapshot's daily instance is not there yet, there, or there only as monthly instances. */
    installs?: 'waiting' | 'ready' | 'monthly';
    /** Lists the Mode Activity Notifications Framework Usage report with one instance. */
    framework?: boolean;
  } = {},
) {
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
    subst: [{ id: 'subst-2026-10-19', processingDate: '2026-10-19' }],
    subev: [{ id: 'subev-2026-10-19', processingDate: '2026-10-19' }],
    'snap-eng': [{ id: 'snap-eng-1', processingDate: '2026-10-19' }],
    inst: [{ id: 'inst-2026-10-19', processingDate: '2026-10-19' }],
    fw: [{ id: 'fw-2026-10-19', processingDate: '2026-10-19' }],
    ...(opts.installs === 'ready' ? { 'snap-inst': [{ id: 'snap-inst-1', processingDate: '2026-10-21' }] } : {}),
  };
  const rowsFor = (instanceId: string): DelimitedRow[] => {
    if (instanceId === 'snap-eng-1') {
      // History: every day from Sep 1 to Oct 17 (overlapping the ongoing report's days).
      const out: DelimitedRow[] = [];
      for (let d = '2026-09-01'; d <= '2026-10-17'; d = addDays(d, 1))
        out.push(eng(d, 'US', 'App Store search', 'Impression', 'No page', 999, 500));
      return out;
    }
    const ins = (date: string, counts: number): DelimitedRow => ({
      date,
      event: 'Install',
      'download type': 'First-time download',
      'source type': 'App Store search',
      territory: 'US',
      counts: String(counts),
    });
    if (instanceId === 'fw-2026-10-19') {
      const row = (date: string, territory: string, resolution: string, count: number, devices: number): DelimitedRow => ({
        count: String(count),
        territory,
        date,
        platform: 'iOS 26.1',
        device: 'iPhone',
        build: '23B85',
        'unique devices': String(devices),
        'release type': 'Production',
        'resolution type': resolution,
      });
      return [
        row('2026-10-17', 'US', 'Tapped', 10, 7),
        row('2026-10-18', 'US', 'Tapped', 12, 9),
        row('2026-10-18', 'DE', 'Cleared', 30, 20),
      ];
    }
    // Ongoing installs: Oct 17 and 18. History: every day from Oct 1 to Oct 18 (overlapping).
    if (instanceId === 'inst-2026-10-19') return [ins('2026-10-17', 5), ins('2026-10-18', 6)];
    if (instanceId === 'snap-inst-1') {
      const out: DelimitedRow[] = [];
      for (let d = '2026-10-01'; d <= '2026-10-18'; d = addDays(d, 1)) out.push(ins(d, 100));
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
    if (kind === 'subst') {
      // Columns of the App Store Subscription State report (Standard).
      const st = (date: string, metric: string, group: string, product: string, offer: string, territory: string, counts: number) => ({
        date,
        'app name': 'Acme',
        'app apple identifier': APP.appleId,
        'state metric': metric,
        'state metric grouping': group,
        'subscription name': product,
        'subscription identifier': product === 'Pro Monthly' ? '6450000001' : '6450000002',
        'subscription duration': product === 'Pro Monthly' ? '1 Month' : '1 Year',
        'offer type': offer,
        'auto-renew status': 'Auto-renew on',
        'family sharing': 'Individual',
        'app download source type': 'App Store search',
        'page type': 'Product page',
        territory,
        counts: String(counts),
      });
      return [
        st('2026-10-17', 'Full price', 'Paid plans', 'Pro Monthly', '', 'US', 10),
        st('2026-10-18', 'Full price', 'Paid plans', 'Pro Monthly', '', 'US', 11),
        st('2026-10-18', 'Full price', 'Paid plans', 'Pro Annual', '', 'DE', 4),
        st('2026-10-18', 'Free trials', 'Subscription offers', 'Pro Monthly', 'Free Trial', 'US', 3),
        st('2026-10-18', 'Billing retry', 'Billing issue', 'Pro Monthly', '', 'US', 1),
        st('2026-10-18', 'Voluntarily churned', 'Churned', 'Pro Monthly', '', 'US', 40),
      ];
    }
    if (kind === 'subev') {
      // Columns of the App Store Subscription Event report (Standard).
      const ev = (sub: string, group: string, offer: string, source: string, territory: string, counts: number) => ({
        'event date': '2026-10-18',
        'app name': 'Acme',
        'app apple identifier': APP.appleId,
        'event sub type': sub,
        'event grouping': group,
        'subscription name': 'Pro Monthly',
        'subscription identifier': '6450000001',
        'offer type': offer,
        'app download source type': source,
        'page type': 'Product page',
        territory,
        counts: String(counts),
      });
      return [
        ev('Free Trial Starts', 'Offer Starts', 'Free Trial', 'App Store search', 'US', 3),
        ev('Free Trial Starts', 'Offer Starts', 'Free Trial', 'Web referrer', 'US', 1),
        ev('Full Price from Free Trial', 'Paid Subscriptions from Offers', 'Free Trial', 'App Store search', 'US', 2),
        ev('Full Price Subscription Starts', 'Paid Subscription Starts', '', 'App Store browse', 'GB', 1),
        ev('Full Price Renewals', 'Renewals', '', 'App Store search', 'US', 5),
        ev('Voluntary Churn from Full Price', 'Voluntary Churn', '', 'App Store search', 'US', 2),
        ev('Involuntary Churn from Full Price', 'Involuntary Churn', '', 'App Store search', 'US', 1),
        ev('Refunds from Full Price', 'Refunds', '', 'App Store search', 'US', 1),
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
      calls.push('listApps');
      return [{ id: APP.appleId, name: 'Acme', bundleId: 'com.acme.app', sku: 'ACME' }];
    },
    async listingSnapshot() {
      calls.push('listingSnapshot');
      if (opts.listing === 'forbidden') throw new SourceError('asc', 403, 'HTTP 403: FORBIDDEN_ERROR');
      const values = opts.listing ?? [
        { entity: 'version:IOS', locale: '', field: 'live', value: '2.0' },
        { entity: 'listing:IOS', locale: 'en-US', field: 'keywords', value: 'alert,bell' },
        { entity: 'app_info', locale: 'en-US', field: 'subtitle', value: 'Alerts that ring' },
      ];
      return { scopes: ['version:IOS', 'listing:IOS', 'app_info'], values, calls: 4 };
    },
    async salesReport(vendor, date, onRow) {
      calls.push(`sales:${date}`);
      if (opts.salesForbidden) throw new SourceError('asc', 403, 'sales report: HTTP 403: FORBIDDEN_ERROR');
      if (date !== '2026-10-18') return null;
      // Summary Sales rows (columns as Apple names them), for this app and another app of the account.
      const sale = (
        sku: string,
        type: string,
        units: number,
        proceeds: string,
        cur: string,
        country: string,
        appleId: string,
        price: string,
        parent: string,
        sub: string,
      ) => ({
        provider: 'APPLE',
        sku,
        title: sku === 'ACME' ? 'Acme' : sku,
        'product type identifier': type,
        units: String(units),
        'developer proceeds': proceeds,
        'begin date': '10/18/2026',
        'end date': '10/18/2026',
        'customer currency': cur,
        'country code': country,
        'currency of proceeds': cur,
        'apple identifier': appleId,
        'customer price': price,
        'parent identifier': parent,
        subscription: sub,
        period: sub ? '1 Month' : '',
      });
      const rows = [
        sale('acme.pro', 'IAY', 3, '4.99', 'USD', 'US', '900001', '6.99', 'ACME', 'New'),
        sale('acme.pro', 'IAY', 5, '4.99', 'USD', 'US', '900001', '6.99', 'ACME', 'Renewal'),
        sale('acme.pro', 'IAY', -1, '4.99', 'USD', 'US', '900001', '-6.99', 'ACME', 'New'),
        sale('acme.pro', 'IAY', 2, '5.05', 'EUR', 'DE', '900001', '7.99', 'ACME', 'Renewal'),
        sale('ACME', '7', 30, '0', 'USD', 'US', APP.appleId, '0', '', ''),
        sale('other.tip', 'IA1', 4, '0.70', 'USD', 'US', '900002', '0.99', 'OTHER', ''),
      ];
      for (const r of rows) onRow(r);
      return rows.length;
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
      const installs = opts.installs
        ? [{ id: requestId === 'snap' ? 'snap-inst' : 'inst', name: 'App Store Installation and Deletion Standard', category: 'APP_USAGE' }]
        : [];
      return requestId === 'snap'
        ? [{ id: 'snap-eng', name: 'App Store Discovery and Engagement Standard', category: 'APP_STORE_ENGAGEMENT' }, ...installs]
        : [
            ...installs,
            ...(opts.framework ? [{ id: 'fw', name: 'Mode Activity Notifications', category: 'FRAMEWORK_USAGE' }] : []),
            { id: 'eng', name: 'App Store Discovery and Engagement Standard', category: 'APP_STORE_ENGAGEMENT' },
            { id: 'dl', name: 'App Downloads Standard', category: 'APP_STORE_COMMERCE' },
            { id: 'crash', name: 'App Crashes', category: 'APP_USAGE' },
            { id: 'other', name: 'App Crashes Expanded', category: 'PERFORMANCE' },
            { id: 'pur', name: 'App Store Purchases Standard', category: 'APP_STORE_COMMERCE' },
            { id: 'pre', name: 'App Store Pre-orders Standard', category: 'APP_STORE_COMMERCE' },
            { id: 'ses', name: 'App Sessions Standard', category: 'APP_USAGE' },
            { id: 'subst', name: 'App Store Subscription State Standard', category: 'APP_STORE_COMMERCE' },
            { id: 'subev', name: 'App Store Subscription Event Standard', category: 'APP_STORE_COMMERCE' },
            { id: 'subevd', name: 'App Store Subscription Event Detailed', category: 'APP_STORE_COMMERCE' },
          ];
    },
    async listInstances(reportId, granularity) {
      calls.push(`listInstances:${reportId}${granularity === 'DAILY' ? '' : `:${granularity}`}`);
      if (granularity === 'MONTHLY')
        return reportId === 'snap-inst' && opts.installs === 'monthly'
          ? [{ id: 'snap-inst-m1', granularity: 'MONTHLY', processingDate: '2026-10-21' }]
          : [];
      if (granularity !== 'DAILY') return [];
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
function fakePlay(
  opts: { financeDenied?: boolean; financeReadDenied?: boolean; vitals?: 'empty' | 'forbidden'; reviews?: 'ok' | 'forbidden' } = {},
) {
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
      if (opts.vitals === 'forbidden') throw new SourceError('play', 403, 'HTTP 403: PERMISSION_DENIED');
      if (opts.vitals === 'empty') return [];
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
    ...(opts.reviews
      ? {
          async listReviews() {
            calls.push('listReviews');
            if (opts.reviews === 'forbidden') throw new SourceError('play', 403, 'HTTP 403: The caller does not have permission');
            return {
              reviews: [
                {
                  id: 'gp:new1',
                  modifiedAt: '2026-10-19T08:00:00.000Z',
                  rating: 2,
                  text: 'Crashes on launch',
                  language: 'en',
                  version: '2.4.0',
                  replied: false,
                },
              ],
              next: null,
            };
          },
          async replyToReview(_pkg: string, id: string, text: string) {
            calls.push(`reply:${id}:${text}`);
          },
        }
      : {}),
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
        const subs = await appSubscriptions(ctx, { app: APP.id, store: 'play', start: '2026-10-01', end: '2026-10-19' });
        expect(subs.current).toEqual({ newSubscriptions: 6, canceledSubscriptions: 2, activeSubscriptions: 27, net: 4 });
        expect(subs.products).toEqual([
          { product: 'pro_monthly', newSubscriptions: 6, canceledSubscriptions: 2, activeSubscriptions: 27, net: 4 },
        ]);
        expect(subs.territories!.map((t) => [t.territory, t.activeSubscriptions, t.net])).toEqual([
          ['US', 22, 4],
          ['DE', 5, 0],
        ]);
        expect(subs.series!.map((d) => [d.date, d.activeSubscriptions])).toEqual([
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
        // Counted only when asked for.
        const all = await appPerformance(ctx, { ...p, includeVolumePurchases: true });
        expect(all.stores[0]!.current.downloads).toBe(100012);
        expect(all.notes.some((n) => n.startsWith('includeVolumePurchases'))).toBe(true);
      });

      it('flags days far above the 28 days before them, with the territory and source behind them', async () => {
        const cfg = config({ APP_STORE_PUBLIC_DATA: 'false' });
        const rows = [];
        for (let d = '2026-08-20'; d <= '2026-10-18'; d = addDays(d, 1))
          rows.push({ date: d, territory: 'US', source: 'search', pageViewsUnique: 40, downloads: 20 });
        rows.push({ date: '2026-09-15', territory: 'DE', source: 'institutional', pageViewsUnique: 0, downloads: 100000 });
        await store.writeAppStoreDaily(APP.id, 'apple', { metrics: ['pageViewsUnique', 'downloads'], shape: 'cross', dates: [], rows });
        const ctx = { store, config: cfg, clients: {}, now: () => NOW };
        const perf = await appPerformance(ctx, { app: APP.id, store: 'apple', start: '2026-07-21', end: '2026-10-18' });
        // 90 days: the institutional spike neither inflates the totals nor the conversion rate...
        expect(perf.stores[0]!.current).toMatchObject({ downloads: 60 * 20, pageConversion: 0.5 });
        // ...and is flagged, with what was behind it.
        expect(perf.anomalies).toEqual([
          {
            store: 'apple',
            date: '2026-09-15',
            metric: 'downloads',
            value: 100020,
            median28: 20,
            ratio: 5001,
            top: { territory: 'DE', source: 'institutional', value: 100000, share: 0.9998 },
          },
        ]);
        expect(perf.notes.some((n) => n.startsWith('Anomalies: 1 day') && n.includes('institutional'))).toBe(true);
        // A steady app has none.
        const quiet = await appPerformance(ctx, { app: APP.id, store: 'apple', start: '2026-10-01', end: '2026-10-18' });
        expect(quiet).not.toHaveProperty('anomalies');
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

      it('syncs App Store subscription states and events and summarizes them per subscription, offer, storefront and source', async () => {
        const cfg = config({ APP_STORE_PUBLIC_DATA: 'false' });
        const asc = fakeAsc();
        const run = await runSync({ store, config: cfg, clients: { asc: asc.client }, trigger: 'manual', now: NOW, pacing: {} });
        expect(run.status).toBe('ok');
        expect(asc.calls).toContain('listInstances:subst');
        expect(asc.calls).toContain('listInstances:subev');
        // The Detailed event report is not read.
        expect(asc.calls).not.toContain('listInstances:subevd');
        const ctx = { store, config: cfg, clients: {}, now: () => NOW };
        const subs = await appSubscriptions(ctx, { app: APP.id, store: 'apple', start: '2026-10-12', end: '2026-10-18' });
        expect(subs).not.toHaveProperty('current');
        const apple = subs.appStore!;
        // Levels on the last day: 11 + 4 paid plans and 3 trials; billing retry apart; churned left out.
        expect(apple.current).toMatchObject({
          activeSubscriptions: 18,
          paidPlans: 15,
          freeTrials: 3,
          billingRetry: 1,
          trialStarts: 4,
          trialConversions: 2,
          paidStarts: 1,
          renewals: 5,
          voluntaryChurn: 2,
          involuntaryChurn: 1,
          churn: 3,
          refunds: 1,
          trialConversionRate: 0.5,
        });
        expect(apple.previous).toMatchObject({ activeSubscriptions: 0, trialStarts: 0 });
        expect(apple.products.map((x) => [x.product, x.activeSubscriptions, x.trialStarts])).toEqual([
          ['Pro Monthly', 14, 4],
          ['Pro Annual', 4, 0],
        ]);
        expect(apple.offerTypes.map((x) => [x.offerType, x.activeSubscriptions])).toEqual([
          ['none', 15],
          ['free_trial', 3],
        ]);
        expect(apple.territories.map((x) => [x.territory, x.activeSubscriptions, x.paidStarts])).toEqual([
          ['US', 14, 0],
          ['DE', 4, 0],
          ['GB', 0, 1],
        ]);
        expect(apple.sources.find((x) => x.source === 'search')).toMatchObject({ trialStarts: 3, trialConversions: 2, renewals: 5 });
        expect(apple.sources.find((x) => x.source === 'web_referrer')).toMatchObject({ trialStarts: 1 });
        expect(apple.series.map((x) => [x.date, x.activeSubscriptions, x.trialStarts])).toEqual([
          ['2026-10-17', 10, 0],
          ['2026-10-18', 18, 4],
        ]);
        // Filters: an offer type and a storefront.
        const trials = await appSubscriptions(ctx, {
          app: APP.id,
          store: 'apple',
          start: '2026-10-12',
          end: '2026-10-18',
          offerType: 'free_trial',
        });
        expect(trials.appStore!.current).toMatchObject({ activeSubscriptions: 3, trialStarts: 4, renewals: 0 });
        const gb = await appSubscriptions(ctx, { app: APP.id, store: 'apple', start: '2026-10-12', end: '2026-10-18', territory: 'gb' });
        expect(gb.appStore!.current).toMatchObject({ activeSubscriptions: 0, paidStarts: 1 });
        // Both stores: Google Play keeps its top-level fields, the App Store is under appStore.
        const both = await appSubscriptions(ctx, { app: APP.id, start: '2026-10-12', end: '2026-10-18' });
        expect(both.current).toBeDefined();
        expect(both.appStore!.current.activeSubscriptions).toBe(18);
        // A newer instance replaces the days it covers as a whole.
        await store.writeAppSubscriptionMetrics(APP.id, {
          kind: 'state',
          dates: ['2026-10-18'],
          rows: [
            {
              date: '2026-10-18',
              metric: 'full_price',
              metricGroup: 'paid_plans',
              product: 'Pro Monthly',
              offerType: '',
              territory: 'US',
              source: '*',
              count: 12,
            },
          ],
        });
        const again = await appSubscriptions(ctx, { app: APP.id, store: 'apple', start: '2026-10-12', end: '2026-10-18' });
        expect(again.appStore!.current).toMatchObject({ activeSubscriptions: 12, freeTrials: 0, billingRetry: 0, trialStarts: 4 });
      });

      it('reads Sales and Trends per day for the vendor account, history back a year, and splits revenue per product and currency', async () => {
        const cfg = config({ APP_STORE_PUBLIC_DATA: 'false', ASC_VENDOR_NUMBER: '85000000' });
        const asc = fakeAsc();
        const run = await runSync({ store, config: cfg, clients: { asc: asc.client }, trigger: 'manual', now: NOW, pacing: {} });
        expect(run.status).toBe('ok');
        // Three days back to yesterday; yesterday is not out yet, so it is asked again later, not now.
        expect(asc.calls.filter((c) => c.startsWith('sales:'))).toEqual(['sales:2026-10-17', 'sales:2026-10-18', 'sales:2026-10-19']);
        const state = JSON.parse((await store.getMeta(syncKeys.ascSales))!);
        expect(state).toMatchObject({ through: '2026-10-18', from: '2026-10-17' });
        expect(Date.parse(state.waitUntil)).toBeGreaterThan(NOW.getTime());

        // The next run: no daily call while waiting; history goes back from the oldest day read.
        const next = fakeAsc();
        await runSync({
          store,
          config: cfg,
          clients: { asc: next.client },
          trigger: 'manual',
          now: new Date('2026-10-20T05:00:00Z'),
          pacing: {},
        });
        const sales = next.calls.filter((c) => c.startsWith('sales:'));
        expect(sales[0]).toBe('sales:2026-10-16');
        expect(sales).not.toContain('sales:2026-10-19');
        expect(JSON.parse((await store.getMeta(syncKeys.ascSales))!).from < '2026-10-16').toBe(true);

        const ctx = { store, config: cfg, clients: {}, now: () => NOW };
        const rev = await appRevenue(ctx, { app: APP.id, start: '2026-10-12', end: '2026-10-18' });
        expect(rev.sales!.configured).toBe(true);
        // Never added across currencies; refunds kept apart; the other app's tip is not this app's.
        expect(rev.sales!.currencies).toEqual([
          {
            currency: 'EUR',
            current: { units: 2, refundUnits: 0, proceeds: 10.1, refundedProceeds: 0 },
            previous: { units: 0, refundUnits: 0, proceeds: 0, refundedProceeds: 0 },
            newSubscriptionProceeds: 0,
            renewalProceeds: 10.1,
          },
          {
            currency: 'USD',
            current: { units: 8, refundUnits: 1, proceeds: 34.93, refundedProceeds: 4.99 },
            previous: { units: 0, refundUnits: 0, proceeds: 0, refundedProceeds: 0 },
            newSubscriptionProceeds: 9.98,
            renewalProceeds: 24.95,
          },
        ]);
        expect(rev.sales!.rows.find((x) => x.sku === 'acme.pro' && x.currency === 'USD')).toMatchObject({ units: 8, refundUnits: 1 });
        // Analytics: App Store Purchases per product, the refund kept apart.
        expect(rev.analytics.rows).toEqual([
          { product: 'Pro', purchases: 4, refunds: 1, proceeds: 18.97, refundedProceeds: 6.99, sales: 26.97 },
        ]);
        expect(rev.refunds).toEqual([
          expect.objectContaining({
            source: 'analytics',
            date: '2026-10-18',
            product: 'Pro',
            refunds: 1,
            refundedProceeds: 6.99,
            currency: 'USD',
          }),
          expect.objectContaining({
            source: 'sales',
            date: '2026-10-18',
            sku: 'acme.pro',
            refunds: 1,
            refundedProceeds: 4.99,
            currency: 'USD',
          }),
        ]);
        const byDay = await appRevenue(ctx, { app: APP.id, start: '2026-10-12', end: '2026-10-18', groupBy: ['date', 'product'] });
        expect(byDay.analytics.rows[0]).toMatchObject({ date: '2026-10-18', product: 'Pro' });
        // app_subscriptions splits subscription proceeds into first payments and renewals.
        const subs = await appSubscriptions(ctx, { app: APP.id, store: 'apple', start: '2026-10-12', end: '2026-10-18' });
        expect(subs.appStore!.proceeds).toEqual([
          { currency: 'EUR', newSubscriptions: 0, renewals: 10.1, newUnits: 0, renewalUnits: 2 },
          { currency: 'USD', newSubscriptions: 9.98, renewals: 24.95, newUnits: 3, renewalUnits: 5 },
        ]);
      });

      it('warns in setup_status when Sales and Trends is not set up or the key may not read it', async () => {
        const readiness = evaluateReadiness({
          configured: true,
          identityOk: true,
          inspection: { appFound: true, managedOAuthEnabled: true, broadPolicyReasons: [] },
        });
        const status = async (cfg: SearchkeepConfig, asc: AscClient) =>
          (await setupStatus({ store, config: cfg, clients: { asc }, now: () => NOW }, { readiness })).checks;
        const without = await status(config({ APP_STORE_PUBLIC_DATA: 'false' }), fakeAsc().client);
        expect(without.find((c) => c.id === 'config.asc_vendor')).toMatchObject({
          status: 'warn',
          detail: expect.stringContaining('ASC_VENDOR_NUMBER'),
        });
        expect(without.find((c) => c.id === 'probe.asc_sales')).toBeUndefined();
        const cfg = config({ APP_STORE_PUBLIC_DATA: 'false', ASC_VENDOR_NUMBER: '85000000' });
        const ok = await status(cfg, fakeAsc().client);
        expect(ok.find((c) => c.id === 'config.asc_vendor')!.status).toBe('ok');
        expect(ok.find((c) => c.id === 'probe.asc_sales')!.status).toBe('ok');
        const denied = await status(cfg, fakeAsc({ salesForbidden: true }).client);
        expect(denied.find((c) => c.id === 'probe.asc_sales')).toMatchObject({
          status: 'warn',
          detail: expect.stringContaining('Sales and Reports'),
        });
        expect(config({ ASC_VENDOR_NUMBER: 'abc' }).errors.join(' ')).toContain('ASC_VENDOR_NUMBER');
      });

      it('records store changes between daily snapshots, from a baseline, and attaches them to the funnel', async () => {
        const v = (entity: string, locale: string, field: string, value: string): AppListingValue => ({ entity, locale, field, value });
        // The first snapshot of a scope is the baseline: nothing changed.
        expect(
          await store.snapshotAppListing(
            APP.id,
            'apple',
            '2026-10-16',
            ['version:IOS', 'listing:IOS'],
            [
              v('version:IOS', '', 'live', '2.0'),
              v('listing:IOS', 'en-US', 'keywords', 'alert,bell'),
              v('listing:IOS', 'de-DE', 'keywords', 'alarm'),
            ],
          ),
        ).toBe(0);
        // Changed, added and removed fields; a scope not read today keeps its values.
        expect(
          await store.snapshotAppListing(
            APP.id,
            'apple',
            '2026-10-18',
            ['listing:IOS'],
            [v('listing:IOS', 'en-US', 'keywords', 'alert,bell,ring'), v('listing:IOS', 'en-US', 'promotional_text', 'New!')],
          ),
        ).toBe(3);
        // Twice the same day: the first value before, the last after.
        await store.snapshotAppListing(
          APP.id,
          'apple',
          '2026-10-18',
          ['listing:IOS'],
          [v('listing:IOS', 'en-US', 'keywords', 'alert,ring'), v('listing:IOS', 'en-US', 'promotional_text', 'New!')],
        );
        // Another store is separate; its first snapshot is its baseline.
        expect(await store.snapshotAppListing(APP.id, 'play', '2026-10-18', ['listing'], [v('listing', 'en-US', 'title', 'Acme')])).toBe(0);
        // Unchanged: nothing recorded.
        expect(await store.snapshotAppListing(APP.id, 'apple', '2026-10-18', ['version:IOS'], [v('version:IOS', '', 'live', '2.0')])).toBe(
          0,
        );

        const cfg = config({ APP_STORE_PUBLIC_DATA: 'false' });
        const ctx = { store, config: cfg, clients: {}, now: () => NOW };
        const res = await appChanges(ctx, { app: APP.id, store: 'apple' });
        expect(res.range.end).toBe('2026-10-20');
        expect(res.changes.map((c) => [c.date, c.locale, c.field, c.kind, c.before, c.after])).toEqual([
          ['2026-10-18', 'de-DE', 'keywords', 'removed', 'alarm', null],
          ['2026-10-18', 'en-US', 'keywords', 'changed', 'alert,bell', 'alert,ring'],
          ['2026-10-18', 'en-US', 'promotional_text', 'added', null, 'New!'],
        ]);
        expect(res.days).toEqual([{ store: 'apple', date: '2026-10-18', changes: 3 }]);
        expect((await appChanges(ctx, { app: APP.id, field: 'keywords', locale: 'en-US' })).changes).toHaveLength(1);
        expect((await appChanges(ctx, { app: APP.id, entity: 'version' })).changes).toHaveLength(0);

        // The funnel's series lists the day's changes (and can leave them out).
        await store.writeAppStoreDaily(APP.id, 'apple', {
          metrics: ['impressions'],
          shape: 'cross',
          dates: ['2026-10-17', '2026-10-18'],
          rows: [
            { date: '2026-10-17', territory: 'US', source: 'search', impressions: 100 },
            { date: '2026-10-18', territory: 'US', source: 'search', impressions: 160 },
          ],
        });
        const perf = await appPerformance(ctx, { app: APP.id, store: 'apple', start: '2026-10-17', end: '2026-10-18' });
        expect(perf.stores[0]!.series.map((x) => [x.date, x.changes?.length ?? 0])).toEqual([
          ['2026-10-17', 0],
          ['2026-10-18', 3],
        ]);
        expect(perf.notes.some((n) => n.startsWith('Store changes'))).toBe(true);
        const without = await appPerformance(ctx, {
          app: APP.id,
          store: 'apple',
          start: '2026-10-17',
          end: '2026-10-18',
          includeChanges: false,
        });
        expect(without.stores[0]!.series.some((x) => 'changes' in x)).toBe(false);
      });

      it('snapshots the store listing once a day in the sync, and notes a key that may not read it', async () => {
        const cfg = config({ APP_STORE_PUBLIC_DATA: 'false' });
        const asc = fakeAsc();
        await runSync({ store, config: cfg, clients: { asc: asc.client }, trigger: 'manual', now: NOW, pacing: {} });
        expect(asc.calls.filter((c) => c === 'listingSnapshot')).toHaveLength(1);
        const next = fakeAsc({
          listing: [
            { entity: 'version:IOS', locale: '', field: 'live', value: '2.1' },
            { entity: 'listing:IOS', locale: 'en-US', field: 'keywords', value: 'alert,bell' },
            { entity: 'app_info', locale: 'en-US', field: 'subtitle', value: 'Alerts that ring' },
          ],
        });
        // Same day: not read again. Next day: the new version on sale is a change.
        await runSync({ store, config: cfg, clients: { asc: next.client }, trigger: 'manual', now: NOW, pacing: {} });
        expect(next.calls).not.toContain('listingSnapshot');
        await runSync({
          store,
          config: cfg,
          clients: { asc: next.client },
          trigger: 'manual',
          now: new Date('2026-10-21T04:00:00Z'),
          pacing: {},
        });
        const ctx = { store, config: cfg, clients: {}, now: () => new Date('2026-10-21T04:00:00Z') };
        const res = await appChanges(ctx, { app: APP.id, store: 'apple' });
        expect(res.changes).toEqual([
          expect.objectContaining({
            date: '2026-10-21',
            entity: 'version:IOS',
            field: 'live',
            before: '2.0',
            after: '2.1',
            kind: 'changed',
          }),
        ]);
        // A key that may not read app metadata: noted, the sync goes on, setup_status warns.
        const denied = fakeAsc({ listing: 'forbidden' });
        const run = await runSync({
          store,
          config: cfg,
          clients: { asc: denied.client },
          trigger: 'manual',
          now: new Date('2026-10-22T04:00:00Z'),
          pacing: {},
        });
        expect(run.status).toBe('ok');
        const noted = await appChanges({ ...ctx, now: () => new Date('2026-10-22T04:00:00Z') }, { app: APP.id, store: 'apple' });
        expect(noted.notes.some((n) => n.includes('may not read'))).toBe(true);
        const readiness = evaluateReadiness({
          configured: true,
          identityOk: true,
          inspection: { appFound: true, managedOAuthEnabled: true, broadPolicyReasons: [] },
        });
        const checks = (await setupStatus({ store, config: cfg, clients: { asc: denied.client }, now: () => NOW }, { readiness })).checks;
        expect(checks.find((c) => c.id === 'probe.asc_metadata')).toMatchObject({
          status: 'warn',
          detail: expect.stringContaining('App Information'),
        });
        expect(checks.find((c) => c.id === 'config.play_metadata')).toMatchObject({ status: 'skipped' });
      });

      it('keeps the App Store funnel per page type and per custom product page', async () => {
        const cfg = config({ APP_STORE_PUBLIC_DATA: 'false' });
        const ctx = { store, config: cfg, clients: {}, now: () => NOW };
        const add = async (collector: ReturnType<typeof engagementCollector>, rows: DelimitedRow[]) => {
          for (const r of rows) collector.add(r);
          await collector.write(store, APP.id);
        };
        const ev = (event: string, pageType: string, title: string | null, counts: number, unique: number): DelimitedRow => ({
          date: '2026-10-18',
          event,
          'page type': pageType,
          ...(title !== null ? { 'page title': title } : {}),
          'source type': 'App Store search',
          territory: 'US',
          counts: String(counts),
          'unique counts': String(unique),
        });
        const dl = (pageType: string, title: string | null, counts: number): DelimitedRow => ({
          date: '2026-10-18',
          'download type': 'First-time download',
          'page type': pageType,
          ...(title !== null ? { 'page title': title } : {}),
          'source type': 'App Store search',
          territory: 'US',
          counts: String(counts),
        });
        // Standard: per page type.
        await add(engagementCollector(), [
          ev('Impression', 'No page', null, 500, 400),
          ev('Page view', 'Product page', null, 80, 60),
          ev('Page view', 'Product page', null, 20, 15),
          ev('Page view', 'In-app event', null, 12, 10),
        ]);
        await add(downloadsCollector(), [dl('Product page', null, 30), dl('No page', null, 25), dl('In-app event', null, 2)]);
        // Detailed: per page title.
        await add(engagementReferrersCollector(), [
          ev('Page view', 'Product page', 'Default Product Page', 70, 55),
          ev('Page view', 'Product page', 'Alarm lovers', 30, 20),
        ]);
        await add(downloadReferrersCollector(), [dl('Product page', 'Default Product Page', 18), dl('Product page', 'Alarm lovers', 12)]);
        const byType = await appPerformance(ctx, {
          app: APP.id,
          store: 'apple',
          start: '2026-10-12',
          end: '2026-10-18',
          groupBy: ['page_type'],
        });
        expect(byType.pages).toEqual([
          {
            pageType: 'product_page',
            impressions: 0,
            impressionsUnique: 0,
            pageViews: 100,
            pageViewsUnique: 75,
            downloads: 30,
            pageConversion: 0.4,
          },
          {
            pageType: 'in_app_event',
            impressions: 0,
            impressionsUnique: 0,
            pageViews: 12,
            pageViewsUnique: 10,
            downloads: 2,
            pageConversion: 0.2,
          },
          {
            pageType: 'no_page',
            impressions: 500,
            impressionsUnique: 400,
            pageViews: 0,
            pageViewsUnique: 0,
            downloads: 25,
            pageConversion: null,
          },
        ]);
        const byTitle = await appPerformance(ctx, {
          app: APP.id,
          store: 'apple',
          start: '2026-10-12',
          end: '2026-10-18',
          groupBy: ['page_title'],
        });
        expect(byTitle.pages!.map((x) => [x.pageTitle, x.pageViewsUnique, x.downloads, x.pageConversion])).toEqual([
          ['Default Product Page', 55, 18, 0.3273],
          ['Alarm lovers', 20, 12, 0.6],
        ]);
        // A newer instance replaces the day: a custom page it no longer lists drops to zero.
        await add(engagementReferrersCollector(), [ev('Page view', 'Product page', 'Default Product Page', 90, 70)]);
        const again = await appPerformance(ctx, {
          app: APP.id,
          store: 'apple',
          start: '2026-10-12',
          end: '2026-10-18',
          groupBy: ['page_title'],
        });
        expect(again.pages!.find((x) => x.pageTitle === 'Alarm lovers')).toMatchObject({ pageViewsUnique: 0, downloads: 12 });
      });

      it('explains empty crash data, counts Play crashes from the monthly files and keeps App Crashes Expanded apart', async () => {
        const cfg = config({ APP_STORE_PUBLIC_DATA: 'false' });
        const play = fakePlay({ vitals: 'empty' });
        const run = await runSync({ store, config: cfg, clients: { play: play.client }, trigger: 'manual', now: NOW, pacing: {} });
        expect(run.status).toBe('ok');
        expect(JSON.parse((await store.getMeta(syncKeys.playVitals(APP.id)))!)).toMatchObject({ checkedOn: '2026-10-20', empty: true });
        const ctx = { store, config: cfg, clients: {}, now: () => NOW };
        const st = await appStability(ctx, { app: APP.id, start: '2026-10-01', end: '2026-10-19' });
        const p = st.summary.find((s) => s.store === 'play')!;
        expect(p.crashRate).toBeNull();
        expect(p.crashes).toBeGreaterThan(0);
        expect(st.notes.some((n) => n.includes('minimum number of daily users'))).toBe(true);
        // No App Crashes report from Apple yet: said plainly.
        expect(st.notes.some((n) => n.includes('at least five people'))).toBe(true);

        // App Crashes and App Crashes Expanded: each replaces the days it covers.
        const crash = (version: string, crashes: number): DelimitedRow => ({
          date: '2026-10-18',
          'app version': version,
          crashes: String(crashes),
          'unique devices': '1',
        });
        const exp = (version: string, count: number): DelimitedRow => ({
          date: '2026-10-18',
          'app version': version,
          count: String(count),
          'unique devices': '1',
          territory: 'US',
        });
        const write = async (c: ReturnType<typeof crashesCollector>, rows: DelimitedRow[]) => {
          for (const r of rows) c.add(r);
          await c.write(store, APP.id);
        };
        await write(crashesCollector(), [crash('2.0', 3), crash('2.1', 1)]);
        await write(crashesExpandedCollector(), [exp('2.1', 9)]);
        // A newer instance no longer lists 2.0: its count goes, the expanded counts stay.
        await write(crashesCollector(), [crash('2.1', 2)]);
        const apple = await appStability(ctx, { app: APP.id, store: 'apple', start: '2026-10-01', end: '2026-10-19', groupBy: 'version' });
        expect(apple.summary[0]).toMatchObject({ crashes: 2, crashesExpanded: 9 });
        expect(apple.rows.map((r) => [r.version, r.crashes, r.crashesExpanded])).toEqual([['2.1', 2, 9]]);

        // setup_status: rates refused → warn with the steps; readable but empty → ok with a note.
        const readiness = evaluateReadiness({
          configured: true,
          identityOk: true,
          inspection: { appFound: true, managedOAuthEnabled: true, broadPolicyReasons: [] },
        });
        const probe = async (client: PlayClient) =>
          (await setupStatus({ store, config: cfg, clients: { play: client }, now: () => NOW }, { readiness })).checks.find(
            (c) => c.id === 'probe.play_vitals',
          );
        expect(await probe(fakePlay({ vitals: 'forbidden' }).client)).toMatchObject({
          status: 'warn',
          detail: expect.stringContaining('Reporting API'),
        });
        expect(await probe(fakePlay({ vitals: 'empty' }).client)).toMatchObject({
          status: 'ok',
          detail: expect.stringContaining('minimum number'),
        });
        expect(await probe(fakePlay().client)).toMatchObject({ status: 'ok' });
      });

      it('reads the App Store Opt-in report and gives the analytics sharing rate with the funnel', async () => {
        const cfg = config({ APP_STORE_PUBLIC_DATA: 'false' });
        const ctx = { store, config: cfg, clients: {}, now: () => NOW };
        expect(ASC_REPORTS.filter((s) => s.match('App Store Opt-in')).map((s) => s.key)).toEqual(['opt_in']);
        const c = ASC_REPORTS.find((s) => s.key === 'opt_in')!.collector();
        // Columns of the App Store Opt-in report.
        for (const [date, users, opting] of [
          ['2026-10-17', 40, 10],
          ['2026-10-18', 60, 15],
        ] as const)
          c.add({
            date,
            'app name': 'Acme',
            'app apple identifier': APP.appleId,
            'downloading users': String(users),
            'users opting-in': String(opting),
          });
        await c.write(store, APP.id);
        await store.writeAppStoreDaily(APP.id, 'apple', {
          metrics: ['downloads', 'installs'],
          shape: 'cross',
          dates: ['2026-10-18'],
          rows: [{ date: '2026-10-18', territory: 'US', source: 'search', downloads: 100, installs: 25 }],
        });
        const perf = await appPerformance(ctx, { app: APP.id, store: 'apple', start: '2026-10-12', end: '2026-10-18' });
        expect(perf.stores[0]!.analyticsSharing).toEqual({ downloadingUsers: 100, optingInUsers: 25, rate: 0.25 });
        expect(perf.notes.some((n) => n.includes('25% of first-time downloaders') && n.includes('divide those by 0.25'))).toBe(true);
        // A range without opt-in data has no rate.
        const old = await appPerformance(ctx, { app: APP.id, store: 'apple', start: '2026-09-01', end: '2026-09-07' });
        expect(old.stores[0]).not.toHaveProperty('analyticsSharing');
      });

      it('fills installs history when the snapshot arrives after the daily reports, without counting a day twice', async () => {
        const cfg = config({ APP_STORE_PUBLIC_DATA: 'false' });
        const sync = (installs: 'waiting' | 'ready' | 'monthly', now: string) =>
          runSync({
            store,
            config: cfg,
            clients: { asc: fakeAsc({ installs }).client },
            trigger: 'manual',
            now: new Date(now),
            pacing: {},
          });
        const installsOn = async () =>
          (
            await store.queryAppStore({
              appId: APP.id,
              store: 'apple',
              range: { start: '2026-09-25', end: '2026-10-19' },
              dimensions: ['date'],
              orderBy: 'date',
              order: 'asc',
            })
          )
            .filter((r) => r.installs > 0)
            .map((r) => [r.date, r.installs]);
        const ctx = (now: string) => ({ store, config: cfg, clients: {}, now: () => new Date(now) });

        // Day 1: the daily report starts on Oct 17; the snapshot's installs are not there yet.
        await sync('waiting', '2026-10-20T04:00:00Z');
        expect(await installsOn()).toEqual([
          ['2026-10-17', 5],
          ['2026-10-18', 6],
        ]);
        const apps = await listApps(ctx('2026-10-20T04:00:00Z'));
        expect(apps.apps[0]!.appStoreReports!.history.find((h) => h.report === 'installs')).toMatchObject({
          ongoingFrom: '2026-10-17',
          snapshot: 'waiting',
        });
        const perf = await appPerformance(ctx('2026-10-20T04:00:00Z'), {
          app: APP.id,
          store: 'apple',
          start: '2026-10-01',
          end: '2026-10-18',
        });
        expect(
          perf.notes.some((n) => n.includes('has not delivered daily history') && n.includes('installs and deletions from 2026-10-17')),
        ).toBe(true);

        // Day 2: the snapshot arrives, overlapping the daily report's days: only the days before are written.
        await sync('ready', '2026-10-21T04:00:00Z');
        const days = await installsOn();
        expect(days).toHaveLength(18);
        expect(days.slice(0, 2)).toEqual([
          ['2026-10-01', 100],
          ['2026-10-02', 100],
        ]);
        expect(days.slice(-2)).toEqual([
          ['2026-10-17', 5],
          ['2026-10-18', 6],
        ]);
        expect(
          (await listApps(ctx('2026-10-21T04:00:00Z'))).apps[0]!.appStoreReports!.history.find((h) => h.report === 'installs'),
        ).toMatchObject({ snapshot: 'filled' });
        // Another day's sync: still not doubled.
        await sync('ready', '2026-10-22T04:00:00Z');
        expect((await installsOn()).slice(-2)).toEqual([
          ['2026-10-17', 5],
          ['2026-10-18', 6],
        ]);
      });

      it("says so when Apple delivers a report's snapshot only as monthly instances", async () => {
        const cfg = config({ APP_STORE_PUBLIC_DATA: 'false' });
        const asc = fakeAsc({ installs: 'monthly' });
        await runSync({ store, config: cfg, clients: { asc: asc.client }, trigger: 'manual', now: NOW, pacing: {} });
        expect(asc.calls).toContain('listInstances:snap-inst:MONTHLY');
        const again = fakeAsc({ installs: 'monthly' });
        await runSync({
          store,
          config: cfg,
          clients: { asc: again.client },
          trigger: 'manual',
          now: new Date('2026-10-21T04:00:00Z'),
          pacing: {},
        });
        // Checked once.
        expect(again.calls).not.toContain('listInstances:snap-inst:MONTHLY');
        const ctx = { store, config: cfg, clients: {}, now: () => NOW };
        expect((await listApps(ctx)).apps[0]!.appStoreReports!.history.find((h) => h.report === 'installs')).toMatchObject({
          snapshot: 'monthly_only',
          monthlyInstances: 1,
        });
        const perf = await appPerformance(ctx, { app: APP.id, store: 'apple', start: '2026-10-01', end: '2026-10-18' });
        expect(perf.notes.some((n) => n.includes('only as monthly totals'))).toBe(true);
      });

      it('reads App Store reviews every 4 hours and Google Play reviews through the API when on', async () => {
        const cfg = config({ APP_STORE_PUBLIC_DATA: 'false', PLAY_REVIEWS_API: 'true' });
        const at = (iso: string) => new Date(iso);
        const asc = fakeAsc();
        const play = fakePlay({ reviews: 'ok' });
        await runSync({ store, config: cfg, clients: clients(asc, play), trigger: 'manual', now: at('2026-10-20T04:00:00Z'), pacing: {} });
        expect(asc.calls.filter((c) => c === 'listReviews')).toHaveLength(1);
        expect(play.calls.filter((c) => c === 'listReviews')).toHaveLength(1);
        // Three hours later: not yet; five hours later: again.
        const a2 = fakeAsc();
        const p2 = fakePlay({ reviews: 'ok' });
        await runSync({ store, config: cfg, clients: clients(a2, p2), trigger: 'manual', now: at('2026-10-20T07:00:00Z'), pacing: {} });
        expect(a2.calls).not.toContain('listReviews');
        expect(p2.calls).not.toContain('listReviews');
        const a3 = fakeAsc();
        await runSync({ store, config: cfg, clients: { asc: a3.client }, trigger: 'manual', now: at('2026-10-20T09:00:00Z'), pacing: {} });
        expect(a3.calls).toContain('listReviews');
        const ctx = { store, config: cfg, clients: {}, now: () => NOW };
        const reviews = await appReviews(ctx, { app: APP.id, store: 'play', start: '2026-10-01', end: '2026-10-20' });
        expect(reviews.reviews.find((r) => r.id === 'gp:new1')).toMatchObject({
          rating: 2,
          body: 'Crashes on launch',
          version: '2.4.0',
          replied: false,
        });
        expect(reviews.notes[0]).toContain('Android Publisher API every 4 hours');
        // Without the permission: noted, the rest goes on, setup_status says what to grant.
        const denied = fakePlay({ reviews: 'forbidden' });
        const run = await runSync({
          store,
          config: cfg,
          clients: { play: denied.client },
          trigger: 'manual',
          now: at('2026-10-21T04:00:00Z'),
          pacing: {},
        });
        expect(run.status).toBe('ok');
        const readiness = evaluateReadiness({
          configured: true,
          identityOk: true,
          inspection: { appFound: true, managedOAuthEnabled: true, broadPolicyReasons: [] },
        });
        const checks = (await setupStatus({ store, config: cfg, clients: { play: denied.client }, now: () => NOW }, { readiness })).checks;
        expect(checks.find((c) => c.id === 'probe.play_reviews')).toMatchObject({
          status: 'warn',
          detail: expect.stringContaining('Reply to reviews'),
        });
        expect(checks.find((c) => c.id === 'config.play_reviews_api')!.status).toBe('ok');
      });

      it('replies to a review only with writes on, after a preview, with a single-use token', async () => {
        await store.writeAppReviews(APP.id, 'apple', [
          {
            id: 'r9',
            createdAt: '2026-10-18T10:00:00.000Z',
            rating: 1,
            title: 'Crashes',
            body: 'Crashes on start',
            territory: 'US',
            language: null,
            version: null,
            replied: false,
          },
        ]);
        await store.writeAppReviews(APP.id, 'play', [
          {
            id: 'gp:9',
            createdAt: '2026-10-18T10:00:00.000Z',
            rating: 2,
            title: null,
            body: 'Slow',
            territory: null,
            language: 'en',
            version: null,
            replied: false,
          },
        ]);
        const posted: string[] = [];
        const replies = { replyToReview: async (id: string, text: string) => void posted.push(`${id}:${text}`) } as unknown as AscClient;
        const base = { app: APP.id, store: 'apple' as const, reviewId: 'r9', text: 'Sorry! Fixed in 2.1.' };
        // Writes off: refused.
        const off = { store, config: config({ APP_STORE_PUBLIC_DATA: 'false' }), clients: { ascReplies: replies }, now: () => NOW };
        await expect(replyReview(off, base)).rejects.toMatchObject({ code: 'writes_disabled' });
        // Writes on, but no reply key: says which key to create.
        const cfg = config({ APP_STORE_PUBLIC_DATA: 'false', ENABLE_WRITES: 'true', ASC_REPLY_KEY_ID: 'R', ASC_REPLY_PRIVATE_KEY: 'pk' });
        await expect(replyReview({ store, config: cfg, clients: {}, now: () => NOW }, base)).rejects.toMatchObject({
          code: 'not_configured',
        });
        const ctx = { store, config: cfg, clients: { ascReplies: replies }, now: () => NOW };
        // Step 1: preview only.
        const preview = await replyReview(ctx, base);
        expect(preview).toMatchObject({
          status: 'preview',
          review: { id: 'r9', rating: 1, alreadyReplied: false },
          reply: 'Sorry! Fixed in 2.1.',
        });
        expect(posted).toEqual([]);
        // A different text needs a new preview.
        await expect(replyReview(ctx, { ...base, text: 'Other', confirmToken: preview.confirmToken })).rejects.toMatchObject({
          code: 'bad_request',
        });
        // Step 2: posted, marked replied, and the token cannot be used again.
        const done = await replyReview(ctx, { ...base, confirmToken: preview.confirmToken });
        expect(done.status).toBe('posted');
        expect(posted).toEqual(['r9:Sorry! Fixed in 2.1.']);
        const after = await appReviews(ctx, { app: APP.id, store: 'apple', start: '2026-10-01', end: '2026-10-20' });
        expect(after.reviews.find((r) => r.id === 'r9')!.replied).toBe(true);
        await expect(replyReview(ctx, { ...base, confirmToken: preview.confirmToken })).rejects.toMatchObject({ code: 'bad_request' });
        // An expired preview is refused.
        const p2 = await replyReview(ctx, base);
        const late = { ...ctx, now: () => new Date(NOW.getTime() + 16 * 60_000) };
        await expect(replyReview(late, { ...base, confirmToken: p2.confirmToken })).rejects.toMatchObject({ code: 'bad_request' });
        // Google Play: at most 350 characters, through the API when PLAY_REVIEWS_API is on.
        const play = fakePlay({ reviews: 'ok' });
        const pcfg = config({ APP_STORE_PUBLIC_DATA: 'false', ENABLE_WRITES: 'true', PLAY_REVIEWS_API: 'true' });
        const pctx = { store, config: pcfg, clients: { play: play.client }, now: () => NOW };
        await expect(replyReview(pctx, { app: APP.id, store: 'play', reviewId: 'gp:9', text: 'x'.repeat(351) })).rejects.toMatchObject({
          code: 'bad_request',
        });
        const pp = await replyReview(pctx, { app: APP.id, store: 'play', reviewId: 'gp:9', text: 'Thanks, looking into it.' });
        await replyReview(pctx, {
          app: APP.id,
          store: 'play',
          reviewId: 'gp:9',
          text: 'Thanks, looking into it.',
          confirmToken: pp.confirmToken,
        });
        expect(play.calls).toContain('reply:gp:9:Thanks, looking into it.');
        await expect(replyReview(pctx, { app: APP.id, store: 'play', reviewId: 'nope', text: 'Hi' })).rejects.toMatchObject({
          code: 'not_found',
        });
      });

      it('reads the Framework Usage reports chosen for an app and groups them by any dimension', async () => {
        const app = { ...APP, frameworkReports: ['Mode Activity Notifications'] };
        const cfg = config({ APP_STORE_PUBLIC_DATA: 'false', APPS: JSON.stringify([app]) });
        expect(cfg.apps[0]!.frameworkReports).toEqual(['Mode Activity Notifications']);
        const asc = fakeAsc({ framework: true });
        await runSync({ store, config: cfg, clients: { asc: asc.client }, trigger: 'manual', now: NOW, pacing: {} });
        expect(asc.calls).toContain('listInstances:fw');
        const ctx = { store, config: cfg, clients: {}, now: () => NOW };
        const p = { app: APP.id, report: 'mode activity notifications', start: '2026-10-12', end: '2026-10-18' };
        const totals = await appFrameworkReport(ctx, p);
        expect(totals.report).toBe('Mode Activity Notifications');
        expect(totals.dimensions).toEqual(['build', 'device', 'platform', 'release type', 'resolution type', 'territory']);
        expect(totals.metrics).toEqual(['count', 'unique devices']);
        expect(totals.rows).toEqual([{ count: 52, 'unique devices': 36 }]);
        const byResolution = await appFrameworkReport(ctx, { ...p, groupBy: ['Resolution Type'] });
        expect(byResolution.rows).toEqual([
          { 'resolution type': 'Cleared', count: 30, 'unique devices': 20 },
          { 'resolution type': 'Tapped', count: 22, 'unique devices': 16 },
        ]);
        const usByDay = await appFrameworkReport(ctx, { ...p, groupBy: ['date'], filters: { territory: 'us' } });
        expect(usByDay.rows).toEqual([
          { date: '2026-10-17', count: 10, 'unique devices': 7 },
          { date: '2026-10-18', count: 12, 'unique devices': 9 },
        ]);
        await expect(appFrameworkReport(ctx, { ...p, groupBy: ['color'] })).rejects.toMatchObject({ code: 'bad_request' });
        await expect(appFrameworkReport(ctx, { ...p, report: 'App Added to Focus' })).rejects.toMatchObject({ code: 'bad_request' });
        // An app without the report does not read it.
        const plain = fakeAsc({ framework: true });
        await runSync({
          store,
          config: config({ APP_STORE_PUBLIC_DATA: 'false' }),
          clients: { asc: plain.client },
          trigger: 'manual',
          now: new Date('2026-10-28T04:00:00Z'),
          pacing: {},
        });
        expect(plain.calls).not.toContain('listInstances:fw');
        // Dashboard-managed apps keep the choice.
        await store.saveAppConfig({ id: 'other', name: 'Other', appleId: '7654321', frameworkReports: ['App Added to Focus'] });
        expect((await store.listAppConfigs()).find((a) => a.id === 'other')!.frameworkReports).toEqual(['App Added to Focus']);
      });

      it('reads Apple Ads search terms and impression share, and says so plainly when Apple Ads is not set up', async () => {
        const plain = config({ APP_STORE_PUBLIC_DATA: 'false' });
        const off = await appAds({ store, config: plain, clients: {}, now: () => NOW }, { app: APP.id });
        expect(off).toMatchObject({ configured: false });
        expect(off.notes[0]).toContain('API Account Read Only');
        const terms = await appSearchTerms({ store, config: plain, clients: {}, now: () => NOW }, { app: APP.id });
        expect(terms.notes.some((n) => n.includes('Apple Ads is not configured'))).toBe(true);

        const cfg = config({
          APP_STORE_PUBLIC_DATA: 'false',
          APPLE_ADS_CLIENT_ID: 'SEARCHADS.c',
          APPLE_ADS_TEAM_ID: 'SEARCHADS.t',
          APPLE_ADS_KEY_ID: 'k',
          APPLE_ADS_PRIVATE_KEY: 'pk',
        });
        const calls: string[] = [];
        let roles = ['API Account Read Only'];
        const ads: AppleAdsClient = {
          async accounts() {
            calls.push('accounts');
            return [{ id: '123', name: 'Acme Ads', roles }];
          },
          async campaigns(account, appleId) {
            calls.push(`campaigns:${account}:${appleId}`);
            return [{ id: '555', name: 'US Search' }];
          },
          async searchTerms(_a, campaignId, range) {
            calls.push(`terms:${campaignId}:${range.start}..${range.end}`);
            const row = (date: string, term: string, impressions: number, taps: number, installs: number, spendCents: number) => ({
              date,
              campaignId,
              term,
              keyword: term === 'alarm app' ? 'alarm' : '',
              impressions,
              taps,
              installs,
              newDownloads: installs,
              spendCents,
              currency: 'USD',
            });
            return [
              row('2026-10-18', 'alarm app', 200, 20, 5, 2500),
              row('2026-10-19', 'alarm app', 100, 10, 5, 1500),
              row('2026-10-19', 'bell', 50, 1, 0, 100),
            ];
          },
          async impressionShare(_a, _id, range) {
            calls.push(`share:${range.start}..${range.end}`);
            return [
              { date: '2026-10-18', territory: 'US', term: 'alarm app', lowShare: 0.1, highShare: 0.2, rank: 4, popularity: 4 },
              { date: '2026-10-19', territory: 'US', term: 'alarm app', lowShare: 0.3, highShare: 0.4, rank: 2, popularity: 4 },
              { date: '2026-10-19', territory: 'US', term: 'wake up', lowShare: 0.1, highShare: 0.2, rank: 7, popularity: 5 },
            ];
          },
        };
        await runSync({ store, config: cfg, clients: { appleAds: ads }, trigger: 'manual', now: NOW, pacing: {} });
        // First sync: 90 days of search terms, 30 days of impression share, ending yesterday.
        expect(calls).toContain('terms:555:2026-07-22..2026-10-19');
        expect(calls).toContain('share:2026-09-20..2026-10-19');
        const ctx = { store, config: cfg, clients: { appleAds: ads }, now: () => NOW };
        const res = await appAds(ctx, { app: APP.id, start: '2026-10-13', end: '2026-10-19' });
        if (!res.configured) throw new Error('expected configured');
        expect(res.currencies).toEqual([{ currency: 'USD', impressions: 350, taps: 31, installs: 10, spend: 41, costPerInstall: 4.1 }]);
        expect(res.terms[0]).toMatchObject({
          term: 'alarm app',
          keywords: ['alarm'],
          impressions: 300,
          taps: 30,
          installs: 10,
          spend: 40,
          tapThroughRate: 0.1,
          installRate: 0.3333,
          costPerInstall: 4,
          // The newest impression share of the term in the range.
          share: [{ territory: 'US', date: '2026-10-19', impressionShare: { low: 0.3, high: 0.4 }, rank: 2, popularity: 4 }],
        });
        expect(res.shareOnly).toEqual([expect.objectContaining({ term: 'wake up', popularity: 5 })]);
        const byPopularity = await appAds(ctx, { app: APP.id, start: '2026-10-13', end: '2026-10-19', sortBy: 'popularity' });
        expect(byPopularity.configured && byPopularity.terms[0]!.term).toBe('alarm app');
        // Next day: only the last days again (late attribution).
        calls.length = 0;
        await runSync({
          store,
          config: cfg,
          clients: { appleAds: ads },
          trigger: 'manual',
          now: new Date('2026-10-21T04:00:00Z'),
          pacing: {},
        });
        expect(calls).toContain('terms:555:2026-10-16..2026-10-20');
        // Re-reading a day does not double it.
        const again = await appAds(ctx, { app: APP.id, start: '2026-10-13', end: '2026-10-19' });
        if (!again.configured) throw new Error('expected configured');
        expect(again.currencies[0]!.impressions).toBe(350);
        // setup_status: read-only role ok; a role that can change campaigns is a warning.
        const readiness = evaluateReadiness({
          configured: true,
          identityOk: true,
          inspection: { appFound: true, managedOAuthEnabled: true, broadPolicyReasons: [] },
        });
        const probe = async () =>
          (await setupStatus({ store, config: cfg, clients: { appleAds: ads }, now: () => NOW }, { readiness })).checks.find(
            (c) => c.id === 'probe.apple_ads',
          );
        expect(await probe()).toMatchObject({ status: 'ok' });
        roles = ['API Account Manager'];
        expect(await probe()).toMatchObject({ status: 'warn', detail: expect.stringContaining('API Account Read Only') });
        expect(
          (await setupStatus({ store, config: plain, clients: {}, now: () => NOW }, { readiness })).checks.find(
            (c) => c.id === 'config.apple_ads',
          ),
        ).toMatchObject({ status: 'skipped' });
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
        expect(
          (await appSubscriptions(ctx, { app: APP.id, store: 'play', start: '2026-10-01', end: '2026-10-19' })).current!
            .activeSubscriptions,
        ).toBe(0);
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
