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
  type AppReferrerInput,
  type AppReviewInput,
  type AppStore,
  type AppStoreDailyInput,
  type AppStoreMetric,
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
  return null;
}

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

/** Store funnel rows keyed by day, territory and source. */
class FunnelCollector implements ReportCollector {
  protected readonly rows = new Map<string, AppStoreDailyInput>();
  protected readonly col = columns();

  constructor(
    private readonly store: AppStore,
    private readonly shape: 'cross' | 'territory' | 'source',
    private readonly metrics: AppStoreMetric[],
    private readonly read: (row: DelimitedRow, col: ReturnType<typeof columns>) => Partial<Record<AppStoreMetric, number>> | null,
    private readonly keys: (row: DelimitedRow, col: ReturnType<typeof columns>) => { territory: string; source: string },
  ) {}

  add(row: DelimitedRow): void {
    const date = cellDate(this.col(row, 'date'));
    if (!date) return;
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
    const rows = keep(this.rows.values(), before);
    if (rows.length === 0) return { written: 0, oldest: null };
    const written = await store.writeAppStoreDaily(appId, this.store, {
      metrics: this.metrics,
      shape: this.shape,
      dates: datesOf(rows),
      rows,
    });
    return { written, oldest: oldestOf(rows) };
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

/** Referring websites and apps from the Detailed reports (`Source Info`). */
class ReferrerCollector implements ReportCollector {
  private readonly rows = new Map<string, AppReferrerInput>();
  private readonly col = columns();

  constructor(private readonly metric: 'pageViews' | 'downloads') {}

  add(row: DelimitedRow): void {
    const date = cellDate(this.col(row, 'date'));
    if (!date) return;
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
    const rows = keep(this.rows.values(), before);
    if (rows.length === 0) return { written: 0, oldest: null };
    const written = await store.writeAppReferrers(appId, 'apple', { metrics: [this.metric], dates: datesOf(rows), rows });
    return { written, oldest: oldestOf(rows) };
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

/** Installs by country: device installs, uninstalls and active devices. */
export function playInstallsCollector(): ReportCollector {
  return new FunnelCollector(
    'play',
    'territory',
    ['installs', 'deletions', 'activeDevices'],
    (row, col) => {
      const installs = cellNumber(col(row, 'daily device installs')) ?? cellNumber(col(row, 'install events')) ?? 0;
      const deletions = cellNumber(col(row, 'daily device uninstalls')) ?? cellNumber(col(row, 'uninstall events')) ?? 0;
      const active = cellNumber(col(row, 'active device installs')) ?? cellNumber(col(row, 'total user installs')) ?? 0;
      return { installs, deletions, activeDevices: active };
    },
    (row, col) => ({ territory: normalizeTerritory(col(row, 'country', 'territory')), source: ALL_KEY }),
  );
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

/** The Play Console report files the sync reads. */
export type PlayFileKind = 'store_country' | 'store_traffic' | 'installs' | 'ratings' | 'ratings_overall' | 'reviews';

export const PLAY_COLLECTORS: Record<PlayFileKind, () => ReportCollector> = {
  store_country: playCountryCollector,
  store_traffic: playTrafficCollector,
  installs: playInstallsCollector,
  ratings: () => playRatingsCollector(false),
  ratings_overall: () => playRatingsCollector(true),
  reviews: playReviewsCollector,
};

/** Where to list the Play Console files of a package. */
export function playPrefixes(pkg: string): string[] {
  return ['stats/store_performance/', `stats/installs/installs_${pkg}_`, `stats/ratings/ratings_${pkg}_`, `reviews/reviews_${pkg}_`];
}

/** What a Play Console file holds and the month it covers, or null for files the sync does not read. */
export function classifyPlayFile(name: string, pkg: string): { kind: PlayFileKind; month: string } | null {
  const base = name.slice(name.lastIndexOf('/') + 1);
  const escaped = pkg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let m = new RegExp(`^(?:[a-z]+_)?store_performance_${escaped}_(\\d{6})_(country|traffic_source)\\.csv$`).exec(base);
  if (m) return { kind: m[2] === 'country' ? 'store_country' : 'store_traffic', month: m[1]! };
  m = new RegExp(`^installs_${escaped}_(\\d{6})_country\\.csv$`).exec(base);
  if (m) return { kind: 'installs', month: m[1]! };
  m = new RegExp(`^ratings_${escaped}_(\\d{6})_(country|overview)\\.csv$`).exec(base);
  if (m) return { kind: m[2] === 'country' ? 'ratings' : 'ratings_overall', month: m[1]! };
  m = new RegExp(`^reviews_${escaped}_(\\d{6})\\.csv$`).exec(base);
  if (m) return { kind: 'reviews', month: m[1]! };
  return null;
}
