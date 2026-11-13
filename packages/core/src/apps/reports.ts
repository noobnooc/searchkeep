/**
 * Turns the rows of App Store Connect and Google Play report files into Store inputs. Columns are
 * looked up by name (Apple asks for this: column positions may change). Every collector
 * aggregates while rows stream in and writes once at the end.
 */
import { cellNumber, column, type DelimitedRow } from '../delimited.js';
import { isIsoDate } from '../dates.js';
import type { Store } from '../store.js';
import {
  ALL_KEY,
  type AppBreakdownDimension,
  type AppBreakdownInput,
  type AppBreakdownMetric,
  type AppBreakdownMetrics,
  type AppEarningsInput,
  type AppReferrerInput,
  type AppReviewInput,
  type AppStore,
  type AppStoreDailyInput,
  type AppStoreMetric,
  type AppSubscriptionInput,
  type AppSubscriptionMetricInput,
  type AppProductInput,
  type AppSalesInput,
  type AppSubscriptionMetricKind,
  type AppVitalsInput,
  type IsoDate,
} from '../types.js';

const SOURCE_TYPES: Record<string, string> = {
  'app store search': 'search',
  'app store browse': 'browse',
  'app referrer': 'app_referrer',
  'web referrer': 'web_referrer',
  'app clip': 'app_clip',
  notification: 'notification',
  'institutional purchase': 'institutional',
  unavailable: 'unavailable',
  'google play search': 'search',
  'google play explore': 'browse',
  'third-party referrals': 'referral',
  'third party referrals': 'referral',
  other: 'other',
};

/** Apple's "Source Type" and Google Play's traffic source as an `AppSourceType` (unknown values as a slug). */
export function normalizeAppSource(value: string): string {
  const v = value.trim().toLowerCase();
  if (!v) return 'unavailable';
  return (
    SOURCE_TYPES[v] ??
    (v
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 40) ||
      'other')
  );
}

/** Upper-case territory code as reported; `-` when missing. */
export function normalizeTerritory(value: string): string {
  const v = value.trim().toUpperCase();
  return v === '' || v === ALL_KEY ? '-' : v.slice(0, 60);
}

/** `2026-03-30`, `20260330`, `03/30/2026` or an ISO timestamp → `2026-03-30`. */
export function cellDate(value: string): IsoDate | null {
  const v = value.trim();
  if (isIsoDate(v.slice(0, 10))) return v.slice(0, 10);
  let m = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
  if (m && isIsoDate(`${m[1]}-${m[2]}-${m[3]}`)) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v);
  if (m) {
    const d = `${m[3]}-${m[1]!.padStart(2, '0')}-${m[2]!.padStart(2, '0')}`;
    if (isIsoDate(d)) return d;
  }
  // "Nov 1, 2026" (Google Play's financial reports).
  m = /^([A-Za-z]{3})[a-z]*\.? (\d{1,2}), (\d{4})$/.exec(v);
  if (m) {
    const month = MONTHS.indexOf(m[1]!.toLowerCase()) + 1;
    const d = `${m[3]}-${String(month).padStart(2, '0')}-${m[2]!.padStart(2, '0')}`;
    if (month > 0 && isIsoDate(d)) return d;
  }
  return null;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** Finds a column by exact name or prefix once, then reads it from every row. */
function columns() {
  const cache = new Map<string, string | null>();
  return (row: DelimitedRow, ...names: string[]): string => {
    const id = names.join('|');
    let key = cache.get(id);
    if (key === undefined) {
      const keys = Object.keys(row);
      key = names.map((n) => keys.find((k) => k === n) ?? keys.find((k) => k.startsWith(n))).find((k) => k !== undefined) ?? null;
      cache.set(id, key);
    }
    return key === null ? '' : (row[key] ?? '');
  };
}

const lower = (v: string) => v.trim().toLowerCase();
const num = (v: string) => cellNumber(v) ?? 0;

export interface WriteResult {
  written: number;
  /** Oldest day written, or null when nothing was. */
  oldest: IsoDate | null;
}

export interface ReportCollector {
  add(row: DelimitedRow): void;
  /** Writes what was collected; with `before`, only days before it (the snapshot fills history only). */
  write(store: Store, appId: string, before?: IsoDate | null): Promise<WriteResult>;
}

function keep<T extends { date: IsoDate }>(rows: Iterable<T>, before?: IsoDate | null): T[] {
  const out: T[] = [];
  for (const r of rows) if (!before || r.date < before) out.push(r);
  return out;
}

const datesOf = (rows: Array<{ date: IsoDate }>) => [...new Set(rows.map((r) => r.date))].sort();
const oldestOf = (rows: Array<{ date: IsoDate }>) => (rows.length ? datesOf(rows)[0]! : null);
/** The days a report covers (every row with a date, also the rows a collector does not keep), before `before`. */
const coveredDays = (days: Set<IsoDate>, before?: IsoDate | null) => [...days].filter((d) => !before || d < before).sort();

/** Store funnel rows keyed by day, territory and source. */
class FunnelCollector implements ReportCollector {
  protected readonly rows = new Map<string, AppStoreDailyInput>();
  protected readonly days = new Set<IsoDate>();
  protected readonly col = columns();

  constructor(
    private readonly store: AppStore,
    private readonly shape: 'cross' | 'territory' | 'source',
    private readonly metrics: AppStoreMetric[],
    private readonly read: (row: DelimitedRow, col: ReturnType<typeof columns>) => Partial<Record<AppStoreMetric, number>> | null,
    private readonly keys: (row: DelimitedRow, col: ReturnType<typeof columns>) => { territory: string; source: string },
    private readonly dateColumns: string[] = ['date'],
  ) {}

  add(row: DelimitedRow): void {
    const date = cellDate(this.col(row, ...this.dateColumns));
    if (!date) return;
    this.days.add(date);
    const values = this.read(row, this.col);
    if (!values) return;
    const { territory, source } = this.keys(row, this.col);
    const key = `${date}|${territory}|${source}`;
    let e = this.rows.get(key);
    if (!e) {
      e = { date, territory, source };
      for (const m of this.metrics) e[m] = 0;
      this.rows.set(key, e);
    }
    for (const [m, v] of Object.entries(values) as Array<[AppStoreMetric, number]>) e[m] = (e[m] ?? 0) + v;
  }

  async write(store: Store, appId: string, before?: IsoDate | null): Promise<WriteResult> {
    // Every day the file covers is replaced, also a day none of whose rows were kept: its old values go.
    const dates = coveredDays(this.days, before);
    if (dates.length === 0) return { written: 0, oldest: null };
    const rows = keep(this.rows.values(), before);
    const written = await store.writeAppStoreDaily(appId, this.store, { metrics: this.metrics, shape: this.shape, dates, rows });
    return { written, oldest: dates[0]! };
  }
}

const appleKeys = (row: DelimitedRow, col: ReturnType<typeof columns>) => ({
  territory: normalizeTerritory(col(row, 'territory')),
  source: normalizeAppSource(col(row, 'source type')),
});

/** App Store Discovery and Engagement (Standard): impressions and product page views. */
export function engagementCollector(): ReportCollector {
  return new FunnelCollector(
    'apple',
    'cross',
    ['impressions', 'impressionsUnique', 'pageViews', 'pageViewsUnique'],
    (row, col) => {
      const event = lower(col(row, 'event'));
      const counts = num(col(row, 'counts'));
      const unique = num(col(row, 'unique counts', 'unique devices'));
      if (event === 'impression') return { impressions: counts, impressionsUnique: unique };
      if (event === 'page view' && lower(col(row, 'page type')) === 'product page') return { pageViews: counts, pageViewsUnique: unique };
      return null;
    },
    appleKeys,
  );
}

/** App Downloads (Standard): first-time downloads and redownloads. */
export function downloadsCollector(): ReportCollector {
  return new FunnelCollector(
    'apple',
    'cross',
    ['downloads', 'redownloads'],
    (row, col) => {
      const type = lower(col(row, 'download type'));
      const counts = num(col(row, 'counts'));
      if (type === 'first-time download') return { downloads: counts };
      if (type === 'redownload') return { redownloads: counts };
      return null;
    },
    appleKeys,
  );
}

/** App Store Installation and Deletion (Standard): installs (updates excluded) and deletions. */
export function installsCollector(): ReportCollector {
  return new FunnelCollector(
    'apple',
    'cross',
    ['installs', 'deletions'],
    (row, col) => {
      const event = lower(col(row, 'event'));
      const counts = num(col(row, 'counts'));
      if (event === 'delete') return { deletions: counts };
      if (event === 'install' && !/update/.test(lower(col(row, 'download type')))) return { installs: counts };
      return null;
    },
    appleKeys,
  );
}

/** App Store Purchases (Standard): paid app and in-app purchases, net of refunds, in USD (Apple's estimate). */
export function purchasesCollector(): ReportCollector {
  return both(
    new FunnelCollector(
      'apple',
      'cross',
      ['purchases', 'proceedsCents', 'salesCents', 'payingUsers'],
      (row, col) => ({
        purchases: num(col(row, 'purchases')),
        proceedsCents: Math.round(num(col(row, 'proceeds in usd', 'proceeds')) * 100),
        salesCents: Math.round(num(col(row, 'sales in usd', 'sales')) * 100),
        payingUsers: num(col(row, 'paying users')),
      }),
      appleKeys,
    ),
    productsCollector(),
  );
}

/**
 * App Store Purchases per product (Content Name), purchase type and territory, with refunds (rows
 * with negative purchases) kept apart so a refund day shows which product it was.
 */
export function productsCollector(): ReportCollector {
  const rows = new Map<string, AppProductInput>();
  const days = new Set<IsoDate>();
  const col = columns();
  return {
    add(row) {
      const date = cellDate(col(row, 'date'));
      if (!date) return;
      days.add(date);
      const purchases = num(col(row, 'purchases'));
      const proceeds = Math.round(num(col(row, 'proceeds in usd', 'proceeds')) * 100);
      const sales = Math.round(num(col(row, 'sales in usd', 'sales')) * 100);
      if (!purchases && !proceeds && !sales) return;
      const product = col(row, 'content name').trim().slice(0, 200) || '-';
      const purchaseType = slug(col(row, 'purchase type'));
      const territory = normalizeTerritory(col(row, 'territory'));
      const key = `${date}|${product}|${purchaseType}|${territory}`;
      const e = rows.get(key) ?? {
        date,
        product,
        purchaseType,
        territory,
        purchases: 0,
        refunds: 0,
        proceedsCents: 0,
        refundProceedsCents: 0,
        salesCents: 0,
      };
      const refund = purchases < 0 || (purchases === 0 && proceeds < 0);
      if (refund) {
        e.refunds += Math.abs(purchases);
        e.refundProceedsCents += Math.abs(proceeds);
      } else e.purchases += purchases;
      e.proceedsCents += proceeds;
      e.salesCents += sales;
      rows.set(key, e);
    },
    async write(store, appId, before) {
      const dates = coveredDays(days, before);
      if (dates.length === 0) return { written: 0, oldest: null };
      return { written: await store.writeAppProducts(appId, dates, keep(rows.values(), before)), oldest: dates[0]! };
    },
  };
}

/** Values kept per day and dimension; the rest are summed into `Other` (ADR 0010). */
export const BREAKDOWN_VALUES_PER_DAY = 50;
const COUNTED: AppBreakdownMetric[] = [
  'installs',
  'deletions',
  'activeDevices',
  'crashes',
  'anrs',
  'sessions',
  'sessionSeconds',
  'sessionDevices',
];

/**
 * An app's numbers per day and value of one dimension (app version, device or OS version). Counts
 * add up per value; ratings are averages and are not carried into `Other`.
 */
class BreakdownCollector implements ReportCollector {
  private readonly rows = new Map<string, AppBreakdownInput>();
  private readonly days = new Set<IsoDate>();
  private readonly col = columns();

  constructor(
    private readonly store: AppStore,
    private readonly dimension: AppBreakdownDimension,
    private readonly metrics: AppBreakdownMetric[],
    private readonly valueColumns: string[],
    private readonly read: (row: DelimitedRow, col: ReturnType<typeof columns>) => Partial<AppBreakdownMetrics> | null,
    /**
     * Keep the values the installs file kept for a day (Google Play ratings and crashes), so each
     * named value and `Other` describe the same devices; a day without installs keeps its own top.
     */
    private readonly followInstalls = false,
  ) {}

  add(row: DelimitedRow): void {
    const date = cellDate(this.col(row, 'date'));
    if (!date) return;
    this.days.add(date);
    const values = this.read(row, this.col);
    if (!values) return;
    const value =
      this.col(row, ...this.valueColumns)
        .trim()
        .slice(0, 120) || '-';
    const key = `${date}|${value}`;
    const e = this.rows.get(key) ?? { date, value };
    for (const [m, v] of Object.entries(values) as Array<[AppBreakdownMetric, number | null]>) {
      if (v === null || v === undefined) continue;
      e[m] = m === 'dailyRating' || m === 'totalRating' ? v : ((e[m] as number | undefined) ?? 0) + v;
    }
    this.rows.set(key, e);
  }

  async write(store: Store, appId: string, before?: IsoDate | null): Promise<WriteResult> {
    const dates = coveredDays(this.days, before);
    if (dates.length === 0) return { written: 0, oldest: null };
    const byDay = new Map<IsoDate, AppBreakdownInput[]>();
    for (const r of keep(this.rows.values(), before)) byDay.set(r.date, [...(byDay.get(r.date) ?? []), r]);
    const rows: AppBreakdownInput[] = [];
    const weight = (r: AppBreakdownInput) => COUNTED.reduce((t, m) => t + ((r[m] as number | undefined) ?? 0), 0);
    const kept = new Map<IsoDate, Set<string>>();
    if (this.followInstalls)
      for (const x of await store.appBreakdownValues(appId, this.store, this.dimension, dates))
        kept.set(x.date, (kept.get(x.date) ?? new Set()).add(x.value));
    for (const [date, list] of byDay) {
      list.sort((a, b) => weight(b) - weight(a) || a.value.localeCompare(b.value));
      const set = kept.get(date);
      const keep = set ? list.filter((r) => set.has(r.value)) : list.slice(0, BREAKDOWN_VALUES_PER_DAY);
      rows.push(...keep);
      const rest = set ? list.filter((r) => !set.has(r.value)) : list.slice(BREAKDOWN_VALUES_PER_DAY);
      if (rest.length) {
        const other: AppBreakdownInput = { date, value: 'Other' };
        for (const r of rest)
          for (const m of COUNTED) if (r[m] !== undefined) other[m] = ((other[m] as number | undefined) ?? 0) + (r[m] as number);
        rows.push(other);
      }
    }
    const written = await store.writeAppBreakdowns(appId, this.store, { dimension: this.dimension, metrics: this.metrics, dates, rows });
    return { written, oldest: dates[0]! };
  }
}

/** Collectors that all read the same rows and write in turn. */
function both(...collectors: ReportCollector[]): ReportCollector {
  return {
    add: (row) => collectors.forEach((c) => c.add(row)),
    async write(store, appId, before) {
      let written = 0;
      let oldest: IsoDate | null = null;
      for (const c of collectors) {
        const res = await c.write(store, appId, before);
        written += res.written;
        if (res.oldest && (!oldest || res.oldest < oldest)) oldest = res.oldest;
      }
      return { written, oldest };
    },
  };
}

/**
 * App Sessions (Standard): sessions, their total length and the devices behind them, per storefront
 * and source, and per app version and device (ADR 0010).
 */
export function sessionsCollector(): ReportCollector {
  const read = (row: DelimitedRow, col: ReturnType<typeof columns>) => ({
    sessions: num(col(row, 'sessions')),
    sessionSeconds: num(col(row, 'total session duration')),
    sessionDevices: num(col(row, 'unique devices')),
  });
  const metrics: AppBreakdownMetric[] = ['sessions', 'sessionSeconds', 'sessionDevices'];
  return both(
    new FunnelCollector('apple', 'cross', ['sessions', 'sessionSeconds', 'sessionDevices'], read, appleKeys),
    new BreakdownCollector('apple', 'app_version', metrics, ['app version'], read),
    new BreakdownCollector('apple', 'device', metrics, ['device'], read),
  );
}

/** Columns that name a dimension's value in the Play Console's breakdown files. */
const PLAY_DIMENSION_COLUMNS: Record<AppBreakdownDimension, string[]> = {
  app_version: ['app version code', 'app version'],
  device: ['device'],
  os_version: ['android os version', 'os version'],
};

/** Google Play installs, uninstalls and active devices per app version, device or OS version. */
export function playInstallsBreakdownCollector(dimension: AppBreakdownDimension): ReportCollector {
  // Uninstalls as for the installs by country: uninstall events when the device column stays 0.
  const make = (uninstalls: string[]) =>
    new BreakdownCollector(
      'play',
      dimension,
      ['installs', 'deletions', 'activeDevices'],
      PLAY_DIMENSION_COLUMNS[dimension],
      (row, col) => ({
        installs: cellNumber(col(row, 'daily device installs')) ?? cellNumber(col(row, 'install events')) ?? 0,
        deletions: uninstalls.reduce<number | null>((v, name) => v ?? cellNumber(col(row, name)), null) ?? 0,
        activeDevices: cellNumber(col(row, 'active device installs')) ?? cellNumber(col(row, 'total user installs')) ?? 0,
      }),
    );
  const device = make(['daily device uninstalls', 'uninstall events']);
  const events = make(['uninstall events', 'daily device uninstalls']);
  const col = columns();
  let deviceTotal = 0;
  let eventTotal = 0;
  return {
    add(row) {
      device.add(row);
      events.add(row);
      deviceTotal += cellNumber(col(row, 'daily device uninstalls')) ?? 0;
      eventTotal += cellNumber(col(row, 'uninstall events')) ?? 0;
    },
    write: (store, appId, before) => (deviceTotal === 0 && eventTotal > 0 ? events : device).write(store, appId, before),
  };
}

/** Google Play daily and total average rating per app version, device or OS version. */
export function playRatingsBreakdownCollector(dimension: AppBreakdownDimension): ReportCollector {
  const rating = (v: string) => {
    const n = cellNumber(v);
    return n !== null && n > 0 && n <= 5 ? n : null;
  };
  return new BreakdownCollector(
    'play',
    dimension,
    ['dailyRating', 'totalRating'],
    PLAY_DIMENSION_COLUMNS[dimension],
    (row, col) => ({
      dailyRating: rating(col(row, 'daily average rating')),
      totalRating: rating(col(row, 'total average rating')),
    }),
    true,
  );
}

/** Google Play crashes and ANRs per app version, device or OS version. */
export function playCrashesBreakdownCollector(dimension: AppBreakdownDimension): ReportCollector {
  return new BreakdownCollector(
    'play',
    dimension,
    ['crashes', 'anrs'],
    PLAY_DIMENSION_COLUMNS[dimension],
    (row, col) => ({
      crashes: num(col(row, 'daily crashes')),
      anrs: num(col(row, 'daily anrs')),
    }),
    true,
  );
}

/** Referring websites and apps from the Detailed reports (`Source Info`). */
class ReferrerCollector implements ReportCollector {
  private readonly rows = new Map<string, AppReferrerInput>();
  private readonly days = new Set<IsoDate>();
  private readonly col = columns();

  constructor(private readonly metric: 'pageViews' | 'downloads') {}

  add(row: DelimitedRow): void {
    const date = cellDate(this.col(row, 'date'));
    if (!date) return;
    this.days.add(date);
    const source = normalizeAppSource(this.col(row, 'source type'));
    if (source !== 'web_referrer' && source !== 'app_referrer') return;
    const info = this.col(row, 'source info').trim();
    if (!info) return;
    if (this.metric === 'pageViews') {
      if (lower(this.col(row, 'event')) !== 'page view' || lower(this.col(row, 'page type')) !== 'product page') return;
    } else if (lower(this.col(row, 'download type')) !== 'first-time download') return;
    const kind = source === 'web_referrer' ? 'web' : 'app';
    const referrer = (kind === 'web' ? info.toLowerCase().replace(/^www\./, '') : info).slice(0, 200);
    const key = `${date}|${kind}|${referrer}`;
    const e = this.rows.get(key) ?? { date, kind, referrer, [this.metric]: 0 };
    e[this.metric] = (e[this.metric] ?? 0) + num(this.col(row, 'counts'));
    this.rows.set(key, e);
  }

  async write(store: Store, appId: string, before?: IsoDate | null): Promise<WriteResult> {
    // A day the report covers without referrers any more (Apple leaves out small numbers) loses its old ones.
    const dates = coveredDays(this.days, before);
    if (dates.length === 0) return { written: 0, oldest: null };
    const written = await store.writeAppReferrers(appId, 'apple', {
      metrics: [this.metric],
      dates,
      rows: keep(this.rows.values(), before),
    });
    return { written, oldest: dates[0]! };
  }
}

export const engagementReferrersCollector = (): ReportCollector => new ReferrerCollector('pageViews');
export const downloadReferrersCollector = (): ReportCollector => new ReferrerCollector('downloads');

/** App Crashes: crashes and crashing devices per day and app version (and for all versions). */
export function crashesCollector(): ReportCollector {
  const rows = new Map<string, AppVitalsInput>();
  const col = columns();
  const bump = (date: IsoDate, version: string, crashes: number, devices: number) => {
    const key = `${date}|${version}`;
    const e = rows.get(key) ?? { date, version, crashes: 0, crashDevices: 0 };
    e.crashes = (e.crashes ?? 0) + crashes;
    e.crashDevices = (e.crashDevices ?? 0) + devices;
    rows.set(key, e);
  };
  return {
    add(row) {
      const date = cellDate(col(row, 'date'));
      if (!date) return;
      const crashes = num(col(row, 'crashes', 'counts'));
      const devices = num(col(row, 'unique devices'));
      bump(date, col(row, 'app version').slice(0, 60) || '-', crashes, devices);
      bump(date, '', crashes, devices);
    },
    async write(store, appId, before) {
      const list = keep(rows.values(), before);
      if (list.length === 0) return { written: 0, oldest: null };
      return {
        written: await store.writeAppVitals(appId, 'apple', { metrics: ['crashes', 'crashDevices'], rows: list }),
        oldest: oldestOf(list),
      };
    },
  };
}

/** `Free Trial Starts` → `free_trial_starts` (Apple's metric names, offer types and groupings). */
export function slug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 80);
}

/**
 * App Store Subscription State or Event (Standard): counts per day, metric, subscription, offer
 * type, territory and (events only) download source. States are kept without the source: they are
 * levels of every subscription, many rows a day, and the events already tie starts and churn to it.
 */
export function subscriptionMetricsCollector(kind: AppSubscriptionMetricKind): ReportCollector {
  const rows = new Map<string, AppSubscriptionMetricInput>();
  const days = new Set<IsoDate>();
  const col = columns();
  return {
    add(row) {
      const date = cellDate(kind === 'event' ? col(row, 'event date', 'date') : col(row, 'date'));
      if (!date) return;
      days.add(date);
      const metric = slug(kind === 'event' ? col(row, 'event sub type') : col(row, 'state metric'));
      if (!metric) return;
      const count = num(col(row, 'counts', 'count'));
      if (!count) return;
      const metricGroup = slug(kind === 'event' ? col(row, 'event grouping') : col(row, 'state metric grouping'));
      const product = (col(row, 'subscription name').trim() || col(row, 'subscription identifier').trim() || '-').slice(0, 120);
      const offerType = slug(col(row, 'offer type'));
      const territory = normalizeTerritory(col(row, 'territory'));
      const source = kind === 'event' ? normalizeAppSource(col(row, 'app download source type')) : ALL_KEY;
      const key = [date, metric, metricGroup, product, offerType, territory, source].join('|');
      const e = rows.get(key) ?? { date, metric, metricGroup, product, offerType, territory, source, count: 0 };
      e.count += count;
      rows.set(key, e);
    },
    async write(store, appId, before) {
      const dates = coveredDays(days, before);
      if (dates.length === 0) return { written: 0, oldest: null };
      const written = await store.writeAppSubscriptionMetrics(appId, { kind, dates, rows: keep(rows.values(), before) });
      return { written, oldest: dates[0]! };
    },
  };
}

/** Apple's product type identifiers (Sales and Trends) → a product type; updates and redownloads are skipped. */
export function salesProductType(id: string): string | null {
  const v = id.trim().toUpperCase();
  if (!v) return null;
  if (/^(3|3F|7|7F|7T|F7|IA3)$/.test(v)) return null;
  if (/^(1|1F|1T|F1|1E|1EP|1EU|1-B|F1-B)$/.test(v)) return 'app';
  if (/^IAY(-M)?$/.test(v)) return 'subscription';
  if (/^(IA1|IA1-M|FI1|IA9|IA9-M)$/.test(v)) return 'in_app';
  return v.toLowerCase().slice(0, 20);
}

/** The apps a Sales and Trends report is split between: an app's own rows by Apple ID, its in-app purchases by the app's SKU. */
export interface SalesApp {
  appId: string;
  appleId: string;
  sku: string | null;
}

/**
 * Summary Sales (daily) of the whole vendor account, split per app while the rows stream in and
 * aggregated per product and price point. Updates, redownloads and restored purchases are skipped.
 */
export function salesSummaryCollector(apps: SalesApp[]) {
  const rows = new Map<string, Map<string, AppSalesInput>>();
  const days = new Set<IsoDate>();
  const col = columns();
  const cents = (v: string) => Math.round(num(v) * 100);
  return {
    add(row: DelimitedRow): void {
      const date = cellDate(col(row, 'begin date', 'date'));
      if (!date) return;
      days.add(date);
      const productType = salesProductType(col(row, 'product type identifier'));
      if (!productType) return;
      const appleId = col(row, 'apple identifier').trim();
      const parent = col(row, 'parent identifier').trim();
      const app = apps.find((a) => a.appleId === appleId || (parent !== '' && a.sku !== null && a.sku === parent));
      if (!app) return;
      const units = num(col(row, 'units'));
      if (!units) return;
      const perUnitProceeds = cents(col(row, 'developer proceeds'));
      const price = Math.abs(cents(col(row, 'customer price')));
      const subscription = lower(col(row, 'subscription'));
      const input: AppSalesInput = {
        date,
        sku: col(row, 'sku').trim().slice(0, 200) || appleId,
        title: col(row, 'title').trim().slice(0, 200),
        productType,
        subscription: subscription === 'new' || subscription === 'renewal' ? subscription : '',
        period: col(row, 'period').trim().slice(0, 30),
        territory: normalizeTerritory(col(row, 'country code')),
        proceedsCurrency: col(row, 'currency of proceeds').trim().toUpperCase().slice(0, 3) || '-',
        customerCurrency: col(row, 'customer currency').trim().toUpperCase().slice(0, 3) || '-',
        customerPriceCents: price,
        units: units > 0 ? units : 0,
        refundUnits: units < 0 ? -units : 0,
        proceedsCents: Math.round(units * Math.abs(perUnitProceeds)),
        refundProceedsCents: units < 0 ? Math.round(-units * Math.abs(perUnitProceeds)) : 0,
        salesCents: Math.round(units * price),
      };
      const key = [
        date,
        input.sku,
        productType,
        input.subscription,
        input.period,
        input.territory,
        input.proceedsCurrency,
        input.customerCurrency,
        price,
      ].join('|');
      const perApp = rows.get(app.appId) ?? new Map<string, AppSalesInput>();
      rows.set(app.appId, perApp);
      const e = perApp.get(key);
      if (!e) perApp.set(key, input);
      else {
        e.units += input.units;
        e.refundUnits += input.refundUnits;
        e.proceedsCents += input.proceedsCents;
        e.refundProceedsCents += input.refundProceedsCents;
        e.salesCents += input.salesCents;
      }
    },
    /** Writes every app's rows; each app's covered days are replaced, also with no rows (no sales that day). */
    async write(store: Store, extraDays: IsoDate[] = []): Promise<number> {
      const dates = [...new Set([...days, ...extraDays])].sort();
      if (dates.length === 0) return 0;
      let written = 0;
      for (const app of apps) written += await store.writeAppSales(app.appId, dates, [...(rows.get(app.appId)?.values() ?? [])]);
      return written;
    },
  };
}

// ------------------------------------------------------------------ Google Play

/** Store performance by country: store listing visitors and acquisitions per territory. */
export function playCountryCollector(): ReportCollector {
  return new FunnelCollector(
    'play',
    'territory',
    ['pageViewsUnique', 'downloads'],
    (row, col) => ({
      pageViewsUnique: num(col(row, 'store listing visitors', 'visitors')),
      downloads: num(col(row, 'store listing acquisitions', 'acquisitions')),
    }),
    (row, col) => ({ territory: normalizeTerritory(col(row, 'country', 'territory')), source: ALL_KEY }),
  );
}

/** Store performance by traffic source: per source, plus search terms and UTM sources. */
export function playTrafficCollector(): ReportCollector {
  const col = columns();
  const funnel = new FunnelCollector(
    'play',
    'source',
    ['pageViewsUnique', 'downloads'],
    (row, c) => ({
      pageViewsUnique: num(c(row, 'store listing visitors', 'visitors')),
      downloads: num(c(row, 'store listing acquisitions', 'acquisitions')),
    }),
    (row, c) => ({ territory: ALL_KEY, source: normalizeAppSource(c(row, 'traffic source')) }),
  );
  const terms = new Map<string, { date: IsoDate; term: string; visitors: number; acquisitions: number }>();
  const utm = new Map<string, AppReferrerInput>();
  const days = new Set<IsoDate>();
  return {
    add(row) {
      funnel.add(row);
      const date = cellDate(col(row, 'date'));
      if (!date) return;
      days.add(date);
      const source = normalizeAppSource(col(row, 'traffic source'));
      const visitors = num(col(row, 'store listing visitors', 'visitors'));
      const acquisitions = num(col(row, 'store listing acquisitions', 'acquisitions'));
      const term = col(row, 'search term').trim().slice(0, 200);
      if (source === 'search' && term) {
        const key = `${date}|${term.toLowerCase()}`;
        const e = terms.get(key) ?? { date, term, visitors: 0, acquisitions: 0 };
        e.visitors += visitors;
        e.acquisitions += acquisitions;
        terms.set(key, e);
      }
      const utmSource = col(row, 'utm source').trim().slice(0, 200);
      if (source === 'referral' && utmSource) {
        const key = `${date}|${utmSource.toLowerCase()}`;
        const e = utm.get(key) ?? { date, kind: 'utm', referrer: utmSource, pageViews: 0, downloads: 0 };
        e.pageViews = (e.pageViews ?? 0) + visitors;
        e.downloads = (e.downloads ?? 0) + acquisitions;
        utm.set(key, e);
      }
    },
    async write(store, appId, before) {
      const res = await funnel.write(store, appId, before);
      // Every day of the file is replaced: a day without search terms any more has none.
      const fileDays = [...days].filter((d) => !before || d < before).sort();
      if (fileDays.length === 0) return res;
      let written = res.written;
      written += await store.writeAppSearchTerms(appId, keep(terms.values(), before), fileDays);
      written += await store.writeAppReferrers(appId, 'play', {
        metrics: ['pageViews', 'downloads'],
        dates: fileDays,
        rows: keep(utm.values(), before),
      });
      return { written, oldest: res.oldest ?? fileDays[0]! };
    },
  };
}

/**
 * Installs by country: device installs, uninstalls and active devices. Some files carry a "Daily
 * Device Uninstalls" column that stays 0 while "Uninstall events" has the uninstalls; such a file
 * then uses the uninstall events for every row.
 */
export function playInstallsCollector(): ReportCollector {
  const collector = (uninstalls: string[]) =>
    new FunnelCollector(
      'play',
      'territory',
      ['installs', 'deletions', 'activeDevices'],
      (row, col) => ({
        installs: cellNumber(col(row, 'daily device installs')) ?? cellNumber(col(row, 'install events')) ?? 0,
        deletions: uninstalls.reduce<number | null>((v, name) => v ?? cellNumber(col(row, name)), null) ?? 0,
        activeDevices: cellNumber(col(row, 'active device installs')) ?? cellNumber(col(row, 'total user installs')) ?? 0,
      }),
      (row, col) => ({ territory: normalizeTerritory(col(row, 'country', 'territory')), source: ALL_KEY }),
    );
  const device = collector(['daily device uninstalls', 'uninstall events']);
  const events = collector(['uninstall events', 'daily device uninstalls']);
  const col = columns();
  let deviceTotal = 0;
  let eventTotal = 0;
  return {
    add(row) {
      device.add(row);
      events.add(row);
      deviceTotal += cellNumber(col(row, 'daily device uninstalls')) ?? 0;
      eventTotal += cellNumber(col(row, 'uninstall events')) ?? 0;
    },
    write: (store, appId, before) => (deviceTotal === 0 && eventTotal > 0 ? events : device).write(store, appId, before),
  };
}

/** Ratings by country (or overall, territory `*`): the average of the day's ratings and of all ratings. */
export function playRatingsCollector(overall = false): ReportCollector {
  const rows = new Map<string, { date: IsoDate; territory: string; average: number | null; dailyAverage: number | null }>();
  const col = columns();
  return {
    add(row) {
      const date = cellDate(col(row, 'date'));
      if (!date) return;
      const territory = overall ? ALL_KEY : normalizeTerritory(col(row, 'country', 'territory'));
      const rating = (v: string) => {
        const n = cellNumber(v);
        return n !== null && n > 0 && n <= 5 ? n : null;
      };
      rows.set(`${date}|${territory}`, {
        date,
        territory,
        average: rating(col(row, 'total average rating')),
        dailyAverage: rating(col(row, 'daily average rating')),
      });
    },
    async write(store, appId, before) {
      const list = keep(rows.values(), before);
      if (list.length === 0) return { written: 0, oldest: null };
      return { written: await store.writeAppRatings(appId, 'play', list), oldest: oldestOf(list) };
    },
  };
}

/** 32-bit FNV-1a, for ids of reviews that come without one. */
export function shortHash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

const MAX_TITLE = 300;
const MAX_BODY = 4_000;

/** Google Play reviews (monthly file): text, stars, language, version, whether the developer replied. */
export function playReviewsCollector(): ReportCollector {
  const rows = new Map<string, AppReviewInput>();
  const col = columns();
  return {
    add(row) {
      const rating = cellNumber(col(row, 'star rating'));
      if (rating === null || rating < 1 || rating > 5) return;
      const millis =
        cellNumber(col(row, 'review last update millis since epoch')) ?? cellNumber(col(row, 'review submit millis since epoch'));
      const stamp = col(row, 'review last update date and time', 'review submit date and time');
      const at = millis !== null ? new Date(millis) : new Date(stamp);
      if (Number.isNaN(at.getTime())) return;
      const body = col(row, 'review text').trim();
      const link = col(row, 'review link');
      const linkId = /reviewid=([^&\s]+)/i.exec(link)?.[1];
      const submitted = col(row, 'review submit millis since epoch', 'review submit date and time');
      const id = linkId ? decodeURIComponent(linkId).slice(0, 200) : `h${shortHash(`${submitted}|${body}`)}`;
      rows.set(id, {
        id,
        createdAt: at.toISOString(),
        rating: Math.round(rating),
        title: col(row, 'review title').trim().slice(0, MAX_TITLE) || null,
        body: body.slice(0, MAX_BODY) || null,
        territory: null,
        language: col(row, 'reviewer language').trim().slice(0, 20) || null,
        version: (col(row, 'app version name').trim() || col(row, 'app version code').trim()).slice(0, 60) || null,
        replied: col(row, 'developer reply text', 'developer reply date and time').trim() !== '',
      });
    },
    async write(store, appId) {
      const list = [...rows.values()];
      if (list.length === 0) return { written: 0, oldest: null };
      const oldest = list.map((r) => r.createdAt.slice(0, 10)).sort()[0]!;
      return { written: await store.writeAppReviews(appId, 'play', list), oldest };
    },
  };
}

/** App Store customer reviews as Store inputs (reviewer names are dropped). */
export function ascReviewInput(r: {
  id: string;
  rating: number;
  title: string | null;
  body: string | null;
  createdDate: string;
  territory: string | null;
}): AppReviewInput | null {
  const at = new Date(r.createdDate);
  if (Number.isNaN(at.getTime()) || !(r.rating >= 1 && r.rating <= 5)) return null;
  return {
    id: r.id.slice(0, 200),
    createdAt: at.toISOString(),
    rating: Math.round(r.rating),
    title: r.title?.trim().slice(0, MAX_TITLE) || null,
    body: r.body?.trim().slice(0, MAX_BODY) || null,
    territory: r.territory?.trim().toUpperCase().slice(0, 10) || null,
    language: null,
    version: null,
    replied: false,
  };
}

/** The App Store reports the sync reads, recognized by name (Standard for counts, Detailed for referrers). */
export interface AscReportSpec {
  key: string;
  label: string;
  match: (name: string) => boolean;
  collector: () => ReportCollector;
}

const has = (name: string, ...parts: RegExp[]) => parts.every((p) => p.test(name));

export const ASC_REPORTS: readonly AscReportSpec[] = [
  {
    key: 'engagement',
    label: 'App Store Discovery and Engagement',
    match: (n) => has(n, /discovery and engagement/i, /standard/i),
    collector: engagementCollector,
  },
  {
    key: 'downloads',
    label: 'App Downloads',
    match: (n) => has(n, /\bdownloads?\b/i, /standard/i) && !/install|pre-?order|performance|platform/i.test(n),
    collector: downloadsCollector,
  },
  {
    key: 'installs',
    label: 'App Store Installation and Deletion',
    match: (n) => has(n, /install/i, /delet/i, /standard/i),
    collector: installsCollector,
  },
  {
    key: 'crashes',
    label: 'App Crashes',
    match: (n) => /^app crashes$/i.test(n.trim()),
    collector: crashesCollector,
  },
  {
    key: 'purchases',
    label: 'App Store Purchases',
    match: (n) => has(n, /\bpurchases\b/i, /standard/i) && !/pre-?order|subscription/i.test(n),
    collector: purchasesCollector,
  },
  {
    key: 'sessions',
    label: 'App Sessions',
    match: (n) => has(n, /\bsessions\b/i, /standard/i),
    collector: sessionsCollector,
  },
  {
    key: 'subscription_state',
    label: 'App Store Subscription State',
    match: (n) => has(n, /subscription state/i, /standard/i),
    collector: () => subscriptionMetricsCollector('state'),
  },
  {
    key: 'subscription_event',
    label: 'App Store Subscription Event',
    match: (n) => has(n, /subscription event/i, /standard/i),
    collector: () => subscriptionMetricsCollector('event'),
  },
  {
    key: 'engagement_referrers',
    label: 'App Store Discovery and Engagement (Detailed)',
    match: (n) => has(n, /discovery and engagement/i, /detailed/i),
    collector: engagementReferrersCollector,
  },
  {
    key: 'download_referrers',
    label: 'App Downloads (Detailed)',
    match: (n) => has(n, /\bdownloads?\b/i, /detailed/i) && !/install|pre-?order|performance|platform/i.test(n),
    collector: downloadReferrersCollector,
  },
];

/**
 * Google Play earnings (ADR 0010), one row per charge, fee, tax or refund of the whole developer
 * account. Only the app's own rows (`Package ID`) are kept, summed per day and buyer country in the
 * account's payout currency: net proceeds (charges, fees, taxes and refunds), sales (charges and
 * refunds of charges) and purchases (charges minus refunded charges). Order ids, postcodes and every
 * other per-order field are never read into what is stored. Each file's sums are kept apart, since
 * a month's file and Google's adjustment files can cover the same days, and a day's totals are
 * recomputed from all of them.
 */
export function playEarningsCollector(pkg: string, file: string): ReportCollector {
  const col = columns();
  const sums = new Map<string, AppEarningsInput>();
  let currency: string | null = null;
  return {
    add(row) {
      if (col(row, 'package id', 'product id').trim() !== pkg) return;
      const date = cellDate(col(row, 'transaction date', 'date'));
      if (!date) return;
      const territory = normalizeTerritory(col(row, 'buyer country'));
      const cents = Math.round(num(col(row, 'amount (merchant currency)')) * 100);
      const type = lower(col(row, 'transaction type'));
      const code = col(row, 'merchant currency').trim().toUpperCase();
      if (/^[A-Z]{3}$/.test(code)) currency = code;
      const charge = type === 'charge' ? 1 : type === 'charge refund' ? -1 : 0;
      const key = `${date}|${territory}`;
      const e = sums.get(key) ?? { date, territory, purchases: 0, proceedsCents: 0, salesCents: 0 };
      e.proceedsCents += cents;
      if (charge) {
        e.salesCents += cents;
        e.purchases += charge;
      }
      sums.set(key, e);
    },
    async write(store, appId) {
      const days = await store.writeAppEarningsFile(appId, file, [...sums.values()]);
      if (currency) await store.setMeta(playCurrencyKey(appId), currency);
      if (days.length === 0) return { written: 0, oldest: null };
      const totals = await store.sumAppEarnings(appId, days);
      const written = await store.writeAppStoreDaily(appId, 'play', {
        metrics: ['purchases', 'proceedsCents', 'salesCents'],
        shape: 'territory',
        dates: days,
        rows: totals.map((t) => ({ ...t, source: ALL_KEY })),
      });
      return { written, oldest: days[0]! };
    },
  };
}

/** Meta key of the payout currency of an app's Google Play amounts. */
export const playCurrencyKey = (appId: string) => `app:play:currency:${appId}`;

/**
 * Google Play subscription statistics of one product (ADR 0010): new, canceled and active per day
 * and country. Rows of another package (a file name like `com.acme.app_pro_x` is ambiguous) are skipped.
 */
export function playSubscriptionsCollector(product: string, pkg: string): ReportCollector {
  const col = columns();
  const rows: AppSubscriptionInput[] = [];
  const days = new Set<IsoDate>();
  return {
    add(row) {
      const date = cellDate(col(row, 'date'));
      if (!date) return;
      const owner = col(row, 'package name', 'package').trim();
      if (owner && owner !== pkg) return;
      days.add(date);
      rows.push({
        date,
        territory: normalizeTerritory(col(row, 'country', 'territory')),
        product,
        basePlan: col(row, 'base plan id', 'base plan').trim().slice(0, 100),
        newSubscriptions: num(col(row, 'new subscriptions')),
        canceledSubscriptions: num(col(row, 'cancelled subscriptions', 'canceled subscriptions')),
        activeSubscriptions: num(col(row, 'active subscriptions')),
      });
    },
    async write(store, appId, before) {
      const dates = coveredDays(days, before);
      if (dates.length === 0) return { written: 0, oldest: null };
      const written = await store.writeAppSubscriptions(appId, product, dates, keep(rows, before));
      return { written, oldest: dates[0]! };
    },
  };
}

/** The Play Console report files the sync reads. */
export type PlayFileKind =
  | 'store_country'
  | 'store_traffic'
  | 'installs'
  | 'ratings'
  | 'ratings_overall'
  | 'reviews'
  | 'subscriptions'
  | 'earnings'
  | 'installs_breakdown'
  | 'ratings_breakdown'
  | 'crashes_breakdown';

/** Kinds read only with the Play Console's "View financial data" permission. */
export const PLAY_FINANCIAL_KINDS: readonly PlayFileKind[] = ['subscriptions', 'earnings'];

export interface PlayFile {
  kind: PlayFileKind;
  /** yyyyMM. */
  month: string;
  /** Subscription product id (subscriptions files). */
  product?: string;
  /** What a breakdown file is broken down by. */
  dimension?: AppBreakdownDimension;
}

/**
 * Bumped when a kind of Play file is read differently, so files already read are read once more.
 * 2: installs files fall back to uninstall events.
 */
export const PLAY_READER_VERSION: Partial<Record<PlayFileKind, number>> = { installs: 2 };

/** What marks a Play file as read: its generation, plus the reader version of its kind. */
export function playReadMark(kind: PlayFileKind, generation: string): string {
  const version = PLAY_READER_VERSION[kind];
  return version ? `${generation}#${version}` : generation;
}

export const PLAY_COLLECTORS: Record<PlayFileKind, (file: PlayFile, pkg: string, name: string) => ReportCollector> = {
  store_country: playCountryCollector,
  store_traffic: playTrafficCollector,
  installs: playInstallsCollector,
  ratings: () => playRatingsCollector(false),
  ratings_overall: () => playRatingsCollector(true),
  reviews: playReviewsCollector,
  subscriptions: (file, pkg) => playSubscriptionsCollector(file.product ?? '', pkg),
  earnings: (_file, pkg, name) => playEarningsCollector(pkg, name),
  installs_breakdown: (file) => playInstallsBreakdownCollector(file.dimension ?? 'app_version'),
  ratings_breakdown: (file) => playRatingsBreakdownCollector(file.dimension ?? 'app_version'),
  crashes_breakdown: (file) => playCrashesBreakdownCollector(file.dimension ?? 'app_version'),
};

/**
 * Bumped when `playPrefixes`, `playFinancialPrefixes` or `classifyPlayFile` find files they did
 * not before, so a listing made earlier the same day by an older version is made again.
 * 2: files per app version, device and OS version, and crashes files (ADR 0010).
 */
export const PLAY_LISTING_VERSION = 2;

/** Where to list the Play Console files of a package. */
export function playPrefixes(pkg: string): string[] {
  return [
    'stats/store_performance/',
    `stats/installs/installs_${pkg}_`,
    `stats/ratings/ratings_${pkg}_`,
    `stats/crashes/crashes_${pkg}_`,
    `reviews/reviews_${pkg}_`,
  ];
}

/** Where to list the financial files (subscriptions of a package; earnings of the whole account). */
export function playFinancialPrefixes(pkg: string): string[] {
  return [`financial-stats/subscriptions/subscriptions_${pkg}_`, 'earnings/earnings_'];
}

/** What a Play Console file holds and the month it covers, or null for files the sync does not read. */
export function classifyPlayFile(name: string, pkg: string): PlayFile | null {
  const base = name.slice(name.lastIndexOf('/') + 1);
  const escaped = pkg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let m = new RegExp(`^(?:[a-z]+_)?store_performance_${escaped}_(\\d{6})_(country|traffic_source)\\.csv$`).exec(base);
  if (m) return { kind: m[2] === 'country' ? 'store_country' : 'store_traffic', month: m[1]! };
  m = new RegExp(`^installs_${escaped}_(\\d{6})_(country|app_version|device|os_version)\\.csv$`).exec(base);
  if (m)
    return m[2] === 'country'
      ? { kind: 'installs', month: m[1]! }
      : { kind: 'installs_breakdown', month: m[1]!, dimension: m[2] as AppBreakdownDimension };
  m = new RegExp(`^ratings_${escaped}_(\\d{6})_(country|overview|app_version|device|os_version)\\.csv$`).exec(base);
  if (m && (m[2] === 'country' || m[2] === 'overview')) return { kind: m[2] === 'country' ? 'ratings' : 'ratings_overall', month: m[1]! };
  if (m) return { kind: 'ratings_breakdown', month: m[1]!, dimension: m[2] as AppBreakdownDimension };
  m = new RegExp(`^crashes_${escaped}_(\\d{6})_(app_version|device|os_version)\\.csv$`).exec(base);
  if (m) return { kind: 'crashes_breakdown', month: m[1]!, dimension: m[2] as AppBreakdownDimension };
  m = new RegExp(`^reviews_${escaped}_(\\d{6})\\.csv$`).exec(base);
  if (m) return { kind: 'reviews', month: m[1]! };
  m = new RegExp(`^subscriptions_${escaped}_(.+)_(\\d{6})_country\\.csv$`).exec(base);
  if (m && name.startsWith('financial-stats/')) return { kind: 'subscriptions', month: m[2]!, product: m[1]! };
  m = /^earnings_(\d{6})(?:_[\w.-]+)?\.zip$/.exec(base);
  if (m && name.startsWith('earnings/')) return { kind: 'earnings', month: m[1]! };
  return null;
}
