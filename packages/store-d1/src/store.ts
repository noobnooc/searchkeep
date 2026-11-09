import {
  ALL_KEY,
  APP_STORE_METRICS,
  APP_STORES,
  GSC_SEARCH_TYPES,
  type AiCitationInput,
  type AppChartRankInput,
  type AppConfig,
  type AppDataCoverage,
  type AppDimension,
  type AppRatingInput,
  type AppRatingQuery,
  type AppRatingRow,
  type AppReferrerQuery,
  type AppReferrerRow,
  type AppReferrerWrite,
  type AppReviewInput,
  type AppReviewQuery,
  type AppReviewRow,
  type AppReviewStat,
  type AppSearchTermInput,
  type AppSearchTermQuery,
  type AppSearchTermRow,
  type AppStore,
  type AppStoreMetric,
  type AppStoreQuery,
  type AppStoreRow,
  type AppStoreWrite,
  type AppVitalsMetric,
  type AppVitalsQuery,
  type AppVitalsRow,
  type AppVitalsWrite,
  type AppearanceInput,
  type BreakdownInput,
  type CrawlerKind,
  type CrawlIssueInput,
  type CrawlerQuery,
  type CrawlerRequestInput,
  type CrawlerRow,
  type DataCoverage,
  type DateRange,
  type GscSearchType,
  type IndexCoverageQuery,
  type IndexCoverageResult,
  type IndexStatusRow,
  type IsoDate,
  type PageCount,
  type PerformanceQuery,
  type PerformanceRow,
  type ReferralQuery,
  type ReferralRow,
  type RichResultIssue,
  type SearchFactInput,
  type SearchSource,
  type SegmentInput,
  type SiteConfig,
  type SitemapRecord,
  type Store,
  type SyncRunRecord,
  type UrlInspectionInput,
  type WebAnalyticsInput,
  type WebVitalsInput,
} from '@searchkeep/core';
import { desc, eq } from 'drizzle-orm';
import { drizzle, type DrizzleD1Database } from 'drizzle-orm/d1';
import * as schema from './schema.js';

/** Rows per bulk statement (each statement binds one JSON array). */
const CHUNK = 500;

type Bind = string | number | null;

function chunks<T>(xs: T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size));
  return out;
}

/** Identifiers interpolated into SQL are only ever taken from these allow-lists. */
function allow<T extends string>(values: readonly string[], allowed: readonly T[], what: string): T[] {
  for (const v of values) if (!(allowed as readonly string[]).includes(v)) throw new Error(`Unknown ${what} "${String(v).slice(0, 40)}"`);
  return values as T[];
}
const PERF_DIMS = ['date', 'week', 'month', 'query', 'page', 'country', 'device', 'appearance'] as const;
const PERF_ORDER = ['clicks', 'impressions', 'ctr', 'position', 'date'] as const;
const CRAWLER_GROUPS = ['crawler', 'operator', 'purpose', 'path', 'status', 'date'] as const;
const APP_DIMS = ['date', 'week', 'month', 'store', 'territory', 'source'] as const;
const APP_ORDER = [...APP_STORE_METRICS, 'date'] as const;
/** Store funnel metric → column. */
const APP_COLUMNS: Record<AppStoreMetric, string> = {
  impressions: 'impressions',
  impressionsUnique: 'impressions_unique',
  pageViews: 'page_views',
  pageViewsUnique: 'page_views_unique',
  downloads: 'downloads',
  redownloads: 'redownloads',
  installs: 'installs',
  deletions: 'deletions',
  activeDevices: 'active_devices',
};
const VITALS_COLUMNS: Record<AppVitalsMetric, string> = {
  crashRate: 'crash_rate',
  userPerceivedCrashRate: 'user_perceived_crash_rate',
  anrRate: 'anr_rate',
  userPerceivedAnrRate: 'user_perceived_anr_rate',
  distinctUsers: 'distinct_users',
  crashes: 'crashes',
  crashDevices: 'crash_devices',
};
/** Rows a write of each shape replaces. */
const SHAPE_WHERE = {
  cross: `territory != '${ALL_KEY}' AND source != '${ALL_KEY}'`,
  territory: `source = '${ALL_KEY}' AND territory != '${ALL_KEY}'`,
  source: `territory = '${ALL_KEY}' AND source != '${ALL_KEY}'`,
} as const;
const appStore = (store: string): AppStore => allow([store], APP_STORES, 'store')[0]!;
const REFERRAL_GROUPS = ['path', 'refererHost', 'date'] as const;

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

/** `source` as stored: web search is `gsc`, the other Search Console search types `gsc:<type>`. */
function storedSource(source: SearchSource, searchType: GscSearchType | undefined): string {
  if (searchType === undefined || searchType === 'web') return source;
  allow([searchType], GSC_SEARCH_TYPES, 'search type');
  if (source !== 'gsc') throw new Error('Search types other than web exist only for Search Console');
  return `gsc:${searchType}`;
}

const CRAWLER_TABLES: Record<CrawlerKind, string> = { ai: 'ai_crawler_requests', search: 'search_crawler_requests' };
function crawlerTable(kind: CrawlerKind | undefined): string {
  const table = CRAWLER_TABLES[kind ?? 'ai'];
  if (!table) throw new Error(`Unknown crawler kind "${String(kind).slice(0, 20)}"`);
  return table;
}

/** Stored as `[{"t": type, "i": [{"s": severity, "m": message}]}]`, or null when no rich result was detected. */
function richResultsJson(types: string[], issues: RichResultIssue[]): string | null {
  const all = [...new Set([...types, ...issues.map((i) => i.type)])];
  if (all.length === 0) return null;
  return JSON.stringify(all.map((t) => ({ t, i: issues.filter((i) => i.type === t).map((i) => ({ s: i.severity, m: i.message })) })));
}

function parseRichResults(json: unknown): { richResultTypes: string[]; richResultIssues: RichResultIssue[] } {
  if (typeof json !== 'string') return { richResultTypes: [], richResultIssues: [] };
  try {
    const list = JSON.parse(json) as Array<{ t: string; i?: Array<{ s: string; m: string }> }>;
    return {
      richResultTypes: list.map((x) => x.t),
      richResultIssues: list.flatMap((x) => (x.i ?? []).map((i) => ({ type: x.t, severity: i.s, message: i.m }))),
    };
  } catch {
    return { richResultTypes: [], richResultIssues: [] };
  }
}

/**
 * Cloudflare D1 implementation of the Store contract.
 *
 * Writes are idempotent upserts that skip unchanged rows (`DO UPDATE ... WHERE`),
 * so re-pulling recent days costs no D1 writes when nothing changed.
 */
export class D1Store implements Store {
  private readonly orm: DrizzleD1Database<typeof schema>;

  constructor(private readonly db: D1Database) {
    this.orm = drizzle(db, { schema });
  }

  // ---------------------------------------------------------------- helpers

  private async all<T>(sql: string, ...binds: Bind[]): Promise<T[]> {
    const res = await this.db
      .prepare(sql)
      .bind(...binds)
      .all<T>();
    return res.results ?? [];
  }

  private async first<T>(sql: string, ...binds: Bind[]): Promise<T | null> {
    return (
      (await this.db
        .prepare(sql)
        .bind(...binds)
        .first<T>()) ?? null
    );
  }

  private async batch(statements: D1PreparedStatement[]): Promise<number> {
    if (statements.length === 0) return 0;
    let changes = 0;
    // Keep batches moderate; each batch is one atomic round trip.
    for (const group of chunks(statements, 50)) {
      const results = await this.db.batch(group);
      for (const r of results) changes += r.meta?.changes ?? 0;
    }
    return changes;
  }

  private ensurePagesStatements(siteId: string, paths: Iterable<string>): D1PreparedStatement[] {
    const unique = [...new Set(paths)].filter((p) => p !== '');
    return chunks(unique).map((group) =>
      this.db
        .prepare('INSERT INTO pages (site_id, path) SELECT ?1, value FROM json_each(?2) WHERE true ON CONFLICT (site_id, path) DO NOTHING')
        .bind(siteId, JSON.stringify(group)),
    );
  }

  private ensureQueriesStatements(siteId: string, texts: Iterable<string>): D1PreparedStatement[] {
    const unique = [...new Set(texts)].filter((q) => q !== '');
    return chunks(unique).map((group) =>
      this.db
        .prepare(
          'INSERT INTO queries (site_id, text) SELECT ?1, value FROM json_each(?2) WHERE true ON CONFLICT (site_id, text) DO NOTHING',
        )
        .bind(siteId, JSON.stringify(group)),
    );
  }

  private static pageIdExpr(site = '?1', field = "j.value->>'p'"): string {
    return `COALESCE((SELECT id FROM pages WHERE site_id = ${site} AND path = ${field}), 0)`;
  }

  /**
   * D1 answers "D1 DB is overloaded" when one database does too much work in a short window
   * ("Too many resources consumed within a 10 second window", "Too many requests queued").
   * Drizzle wraps it in its own "Failed query" error, so the cause chain is checked too.
   */
  isBusy(err: unknown): boolean {
    let e: unknown = err;
    for (let i = 0; e && i < 5; i++) {
      const message = e instanceof Error ? e.message : String(e);
      if (/D1 DB is overloaded/i.test(message)) return true;
      e = (e as { cause?: unknown }).cause;
    }
    return false;
  }

  // ------------------------------------------------------------------ meta

  async getMeta(key: string): Promise<string | null> {
    const row = await this.orm.select({ value: schema.meta.value }).from(schema.meta).where(eq(schema.meta.key, key)).get();
    return row?.value ?? null;
  }

  async setMeta(key: string, value: string): Promise<void> {
    await this.db
      .prepare(
        "INSERT INTO meta (key, value) VALUES (?1, ?2) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE meta.value != excluded.value",
      )
      .bind(key, value)
      .run();
  }

  async deleteMeta(key: string): Promise<void> {
    await this.orm.delete(schema.meta).where(eq(schema.meta.key, key)).run();
  }

  async listMeta(prefix: string): Promise<Record<string, string>> {
    // A primary-key range instead of LIKE: LIKE is case-insensitive and treats `_` and `%` as wildcards.
    const rows =
      prefix === ''
        ? await this.all<{ key: string; value: string }>('SELECT key, value FROM meta')
        : await this.all<{ key: string; value: string }>(
            'SELECT key, value FROM meta WHERE key >= ?1 AND key < ?2',
            prefix,
            prefix.slice(0, -1) + String.fromCharCode(prefix.charCodeAt(prefix.length - 1) + 1),
          );
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  }

  // ----------------------------------------------------------------- sites

  async syncSites(sites: SiteConfig[]): Promise<void> {
    if (sites.length === 0) return;
    await this.db
      .prepare(
        "INSERT INTO sites (id, domain) SELECT j.value->>'id', j.value->>'domain' FROM json_each(?1) j WHERE true ON CONFLICT (id) DO UPDATE SET domain = excluded.domain WHERE sites.domain != excluded.domain",
      )
      .bind(JSON.stringify(sites.map((s) => ({ id: s.id, domain: s.domain }))))
      .run();
  }

  async listSiteConfigs(): Promise<SiteConfig[]> {
    const rows = await this.orm.select().from(schema.siteConfigs).orderBy(schema.siteConfigs.id).all();
    return rows.map((r) => {
      const site: SiteConfig = { id: r.id, domain: r.domain };
      if (r.gscProperty) site.gscProperty = r.gscProperty;
      if (r.bingSiteUrl) site.bingSiteUrl = r.bingSiteUrl;
      if (r.cloudflareZoneId) site.cloudflareZoneId = r.cloudflareZoneId;
      if (r.webAnalyticsSiteTag) site.webAnalyticsSiteTag = r.webAnalyticsSiteTag;
      if (r.brandRegex) site.brandRegex = r.brandRegex;
      return site;
    });
  }

  async saveSiteConfig(site: SiteConfig): Promise<void> {
    const values = {
      domain: site.domain,
      gscProperty: site.gscProperty ?? null,
      bingSiteUrl: site.bingSiteUrl ?? null,
      cloudflareZoneId: site.cloudflareZoneId ?? null,
      webAnalyticsSiteTag: site.webAnalyticsSiteTag ?? null,
      brandRegex: site.brandRegex ?? null,
    };
    await this.orm
      .insert(schema.siteConfigs)
      .values({ id: site.id, ...values })
      .onConflictDoUpdate({ target: schema.siteConfigs.id, set: { ...values, updatedAt: new Date().toISOString() } })
      .run();
  }

  async deleteSiteConfig(id: string): Promise<boolean> {
    const res = await this.db.prepare('DELETE FROM site_configs WHERE id = ?1').bind(id).run();
    return (res.meta?.changes ?? 0) > 0;
  }

  // ---------------------------------------------------------------- writes

  async writeSearchFacts(siteId: string, source: SearchSource, rows: SearchFactInput[], searchType?: GscSearchType): Promise<number> {
    if (rows.length === 0) return 0;
    const stored = storedSource(source, searchType);
    // Aggregate duplicates (e.g. URLs that normalize to the same page).
    const agg = new Map<string, { k: string; d: string; p: string; q: string; c: number; i: number; ps: number | null }>();
    for (const r of rows) {
      const p = r.page ?? '';
      const q = r.query ?? '';
      const key = `${r.kind}\u0000${r.date}\u0000${p}\u0000${q}`;
      const ps = r.position != null && Number.isFinite(r.position) ? r.position * r.impressions : null;
      const prev = agg.get(key);
      if (prev) {
        prev.c += r.clicks;
        prev.i += r.impressions;
        prev.ps = prev.ps === null && ps === null ? null : (prev.ps ?? 0) + (ps ?? 0);
      } else {
        agg.set(key, { k: r.kind, d: r.date, p, q, c: r.clicks, i: r.impressions, ps });
      }
    }
    const items = [...agg.values()].map((x) => ({ ...x, ps: x.ps === null ? null : round6(x.ps) }));
    const statements = [
      ...this.ensurePagesStatements(
        siteId,
        items.map((x) => x.p),
      ),
      ...this.ensureQueriesStatements(
        siteId,
        items.map((x) => x.q),
      ),
    ];
    const dims = await this.batch(statements);
    const facts = chunks(items).map((group) =>
      this.db
        .prepare(
          `INSERT INTO search_facts (site_id, source, kind, date, page_id, query_id, clicks, impressions, position_sum)
           SELECT ?1, ?2, j.value->>'k', j.value->>'d',
             ${D1Store.pageIdExpr()},
             COALESCE((SELECT id FROM queries WHERE site_id = ?1 AND text = j.value->>'q'), 0),
             j.value->>'c', j.value->>'i', j.value->>'ps'
           FROM json_each(?3) j WHERE true
           ON CONFLICT (site_id, source, kind, date, page_id, query_id) DO UPDATE SET
             clicks = excluded.clicks, impressions = excluded.impressions, position_sum = excluded.position_sum
           WHERE search_facts.clicks != excluded.clicks OR search_facts.impressions != excluded.impressions
             OR search_facts.position_sum IS NOT excluded.position_sum`,
        )
        .bind(siteId, stored, JSON.stringify(group)),
    );
    return dims + (await this.batch(facts));
  }

  async writeSearchAppearances(siteId: string, searchType: GscSearchType, rows: AppearanceInput[]): Promise<number> {
    if (rows.length === 0) return 0;
    const source = storedSource('gsc', searchType);
    const items = rows.map((r) => ({
      d: r.date,
      a: r.appearance,
      c: r.clicks,
      i: r.impressions,
      ps: r.position != null && Number.isFinite(r.position) && r.position > 0 ? round6(r.position * r.impressions) : null,
    }));
    return this.batch(
      chunks(items).map((group) =>
        this.db
          .prepare(
            `INSERT INTO search_appearances (site_id, source, date, appearance, clicks, impressions, position_sum)
             SELECT ?1, ?2, j.value->>'d', j.value->>'a', j.value->>'c', j.value->>'i', j.value->>'ps'
             FROM json_each(?3) j WHERE true
             ON CONFLICT (site_id, source, date, appearance) DO UPDATE SET
               clicks = excluded.clicks, impressions = excluded.impressions, position_sum = excluded.position_sum
             WHERE search_appearances.clicks != excluded.clicks OR search_appearances.impressions != excluded.impressions
               OR search_appearances.position_sum IS NOT excluded.position_sum`,
          )
          .bind(siteId, source, JSON.stringify(group)),
      ),
    );
  }

  async writeSearchSegments(siteId: string, rows: SegmentInput[]): Promise<number> {
    if (rows.length === 0) return 0;
    // Aggregate duplicates (URLs that normalize to the same page).
    const agg = new Map<string, { k: string; d: string; x: string; co: string; de: string; c: number; i: number; ps: number | null }>();
    for (const r of rows) {
      const co = r.country.toLowerCase();
      const de = r.device.toUpperCase();
      const key = `${r.kind}\u0000${r.date}\u0000${r.key}\u0000${co}\u0000${de}`;
      const ps = r.position != null && Number.isFinite(r.position) ? r.position * r.impressions : null;
      const prev = agg.get(key);
      if (prev) {
        prev.c += r.clicks;
        prev.i += r.impressions;
        prev.ps = prev.ps === null && ps === null ? null : (prev.ps ?? 0) + (ps ?? 0);
      } else agg.set(key, { k: r.kind, d: r.date, x: r.key, co, de, c: r.clicks, i: r.impressions, ps });
    }
    const items = [...agg.values()].map((x) => ({ ...x, ps: x.ps === null ? null : round6(x.ps) }));
    const dims = await this.batch([
      ...this.ensurePagesStatements(
        siteId,
        items.filter((x) => x.k === 'page').map((x) => x.x),
      ),
      ...this.ensureQueriesStatements(
        siteId,
        items.filter((x) => x.k === 'query').map((x) => x.x),
      ),
    ]);
    const statements = chunks(items).map((group) =>
      this.db
        .prepare(
          `INSERT INTO search_segments (site_id, source, kind, date, item_id, country, device, clicks, impressions, position_sum)
           SELECT ?1, 'gsc', j.value->>'k', j.value->>'d',
             CASE WHEN j.value->>'k' = 'page'
               THEN COALESCE((SELECT id FROM pages WHERE site_id = ?1 AND path = j.value->>'x'), 0)
               ELSE COALESCE((SELECT id FROM queries WHERE site_id = ?1 AND text = j.value->>'x'), 0) END,
             j.value->>'co', j.value->>'de', j.value->>'c', j.value->>'i', j.value->>'ps'
           FROM json_each(?2) j WHERE true
           ON CONFLICT (site_id, source, kind, date, item_id, country, device) DO UPDATE SET
             clicks = excluded.clicks, impressions = excluded.impressions, position_sum = excluded.position_sum
           WHERE search_segments.clicks != excluded.clicks OR search_segments.impressions != excluded.impressions
             OR search_segments.position_sum IS NOT excluded.position_sum`,
        )
        .bind(siteId, JSON.stringify(group)),
    );
    return dims + (await this.batch(statements));
  }

  async writeBreakdowns(siteId: string, source: SearchSource, rows: BreakdownInput[]): Promise<number> {
    const items = rows.map((r) => ({
      d: r.date,
      co: r.country.toLowerCase(),
      de: r.device.toUpperCase(),
      c: r.clicks,
      i: r.impressions,
      ps: r.position != null ? round6(r.position * r.impressions) : null,
    }));
    return this.batch(
      chunks(items).map((group) =>
        this.db
          .prepare(
            `INSERT INTO search_breakdowns (site_id, source, date, country, device, clicks, impressions, position_sum)
             SELECT ?1, ?2, j.value->>'d', j.value->>'co', j.value->>'de', j.value->>'c', j.value->>'i', j.value->>'ps'
             FROM json_each(?3) j WHERE true
             ON CONFLICT (site_id, source, date, country, device) DO UPDATE SET
               clicks = excluded.clicks, impressions = excluded.impressions, position_sum = excluded.position_sum
             WHERE search_breakdowns.clicks != excluded.clicks OR search_breakdowns.impressions != excluded.impressions
               OR search_breakdowns.position_sum IS NOT excluded.position_sum`,
          )
          .bind(siteId, source, JSON.stringify(group)),
      ),
    );
  }

  async writeCrawlerRequests(siteId: string, rows: CrawlerRequestInput[], kind?: CrawlerKind): Promise<number> {
    if (rows.length === 0) return 0;
    const table = crawlerTable(kind);
    const dims = await this.batch(
      this.ensurePagesStatements(
        siteId,
        rows.map((r) => r.path),
      ),
    );
    const items = rows.map((r) => ({ d: r.date, cr: r.crawler, op: r.operator, pu: r.purpose, p: r.path, s: r.status, n: r.requests }));
    return (
      dims +
      (await this.batch(
        chunks(items).map((group) =>
          this.db
            .prepare(
              `INSERT INTO ${table} (site_id, date, crawler, operator, purpose, page_id, status, requests)
               SELECT ?1, j.value->>'d', j.value->>'cr', j.value->>'op', j.value->>'pu', ${D1Store.pageIdExpr()}, j.value->>'s', j.value->>'n'
               FROM json_each(?2) j WHERE true
               ON CONFLICT (site_id, date, crawler, page_id, status) DO UPDATE SET requests = excluded.requests
               WHERE ${table}.requests != excluded.requests`,
            )
            .bind(siteId, JSON.stringify(group)),
        ),
      ))
    );
  }

  async writeWebAnalytics(siteId: string, rows: WebAnalyticsInput[]): Promise<number> {
    if (rows.length === 0) return 0;
    const agg = new Map<string, { d: string; p: string; h: string; v: number; pv: number }>();
    for (const r of rows) {
      const key = `${r.date}\u0000${r.path}\u0000${r.refererHost}`;
      const prev = agg.get(key);
      if (prev) {
        prev.v += r.visits;
        prev.pv += r.pageViews;
      } else agg.set(key, { d: r.date, p: r.path, h: r.refererHost, v: r.visits, pv: r.pageViews });
    }
    const items = [...agg.values()];
    const dims = await this.batch(
      this.ensurePagesStatements(
        siteId,
        items.map((r) => r.p),
      ),
    );
    return (
      dims +
      (await this.batch(
        chunks(items).map((group) =>
          this.db
            .prepare(
              `INSERT INTO web_analytics (site_id, date, page_id, referer_host, visits, page_views)
               SELECT ?1, j.value->>'d', ${D1Store.pageIdExpr()}, j.value->>'h', j.value->>'v', j.value->>'pv'
               FROM json_each(?2) j WHERE true
               ON CONFLICT (site_id, date, page_id, referer_host) DO UPDATE SET visits = excluded.visits, page_views = excluded.page_views
               WHERE web_analytics.visits != excluded.visits OR web_analytics.page_views != excluded.page_views`,
            )
            .bind(siteId, JSON.stringify(group)),
        ),
      ))
    );
  }

  async writeWebVitals(siteId: string, rows: WebVitalsInput[]): Promise<number> {
    if (rows.length === 0) return 0;
    const dims = await this.batch(
      this.ensurePagesStatements(
        siteId,
        rows.map((r) => r.path),
      ),
    );
    const items = rows.map((r) => ({ d: r.date, p: r.path, l: r.lcpP75 ?? null, n: r.inpP75 ?? null, c: r.clsP75 ?? null, s: r.samples }));
    return (
      dims +
      (await this.batch(
        chunks(items).map((group) =>
          this.db
            .prepare(
              `INSERT INTO web_vitals (site_id, date, page_id, lcp_p75, inp_p75, cls_p75, samples)
               SELECT ?1, j.value->>'d', ${D1Store.pageIdExpr()}, j.value->>'l', j.value->>'n', j.value->>'c', j.value->>'s'
               FROM json_each(?2) j WHERE true
               ON CONFLICT (site_id, date, page_id) DO UPDATE SET lcp_p75 = excluded.lcp_p75, inp_p75 = excluded.inp_p75, cls_p75 = excluded.cls_p75, samples = excluded.samples
               WHERE web_vitals.samples != excluded.samples OR web_vitals.lcp_p75 IS NOT excluded.lcp_p75
                 OR web_vitals.inp_p75 IS NOT excluded.inp_p75 OR web_vitals.cls_p75 IS NOT excluded.cls_p75`,
            )
            .bind(siteId, JSON.stringify(group)),
        ),
      ))
    );
  }

  async writeAiCitations(siteId: string, rows: AiCitationInput[]): Promise<number> {
    if (rows.length === 0) return 0;
    const dims = await this.batch(
      this.ensurePagesStatements(
        siteId,
        rows.map((r) => r.page),
      ),
    );
    const items = rows.map((r) => ({ d: r.date, p: r.page, s: r.surface, n: r.citations }));
    return (
      dims +
      (await this.batch(
        chunks(items).map((group) =>
          this.db
            .prepare(
              `INSERT INTO ai_citations (site_id, date, page_id, surface, citations)
               SELECT ?1, j.value->>'d', ${D1Store.pageIdExpr()}, j.value->>'s', j.value->>'n'
               FROM json_each(?2) j WHERE true
               ON CONFLICT (site_id, date, page_id, surface) DO UPDATE SET citations = excluded.citations
               WHERE ai_citations.citations != excluded.citations`,
            )
            .bind(siteId, JSON.stringify(group)),
        ),
      ))
    );
  }

  async replaceCrawlIssues(siteId: string, source: SearchSource, rows: CrawlIssueInput[]): Promise<number> {
    const statements = [this.db.prepare('DELETE FROM crawl_issues WHERE site_id = ?1 AND source = ?2').bind(siteId, source)];
    const seen = new Set<string>();
    const items = rows
      .filter((r) => {
        const k = `${r.url}\u0000${r.issue}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .map((r) => ({ u: r.url, i: r.issue, h: r.httpCode ?? null, d: r.detectedAt ?? null }));
    for (const group of chunks(items)) {
      statements.push(
        this.db
          .prepare(
            "INSERT INTO crawl_issues (site_id, source, url, issue, http_code, detected_at) SELECT ?1, ?2, j.value->>'u', j.value->>'i', j.value->>'h', j.value->>'d' FROM json_each(?3) j",
          )
          .bind(siteId, source, JSON.stringify(group)),
      );
    }
    await this.db.batch(statements);
    return items.length;
  }

  async replaceSitemaps(siteId: string, source: SearchSource, rows: SitemapRecord[]): Promise<number> {
    const statements = [this.db.prepare('DELETE FROM sitemaps WHERE site_id = ?1 AND source = ?2').bind(siteId, source)];
    for (const r of rows) {
      statements.push(
        this.db
          .prepare(
            'INSERT OR REPLACE INTO sitemaps (site_id, source, path, last_submitted, last_downloaded, is_pending, errors, warnings, submitted, indexed) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)',
          )
          .bind(
            siteId,
            source,
            r.path,
            r.lastSubmitted ?? null,
            r.lastDownloaded ?? null,
            r.isPending ? 1 : 0,
            r.errors ?? 0,
            r.warnings ?? 0,
            r.submitted ?? null,
            r.indexed ?? null,
          ),
      );
    }
    await this.db.batch(statements);
    return rows.length;
  }

  // --------------------------------------------------------- index coverage

  async addIndexUrls(siteId: string, urls: string[], day: IsoDate, maxUrls: number): Promise<number> {
    const unique = [...new Set(urls)];
    if (unique.length === 0) return 0;
    // A URL listed again is touched at most once a week: `last_seen` only has to stay within 7 days.
    const weekAgo = new Date(Date.parse(`${day}T00:00:00Z`) - 6 * 86_400_000).toISOString().slice(0, 10);
    let changes = await this.batch(
      chunks(unique).map((group) =>
        this.db
          .prepare(
            'UPDATE index_status SET last_seen = ?2 WHERE site_id = ?1 AND url IN (SELECT value FROM json_each(?4)) AND last_seen < ?3',
          )
          .bind(siteId, day, weekAgo, JSON.stringify(group)),
      ),
    );
    const existing = new Set<string>();
    for (const group of chunks(unique)) {
      const rows = await this.all<{ url: string }>(
        'SELECT url FROM index_status WHERE site_id = ?1 AND url IN (SELECT value FROM json_each(?2))',
        siteId,
        JSON.stringify(group),
      );
      for (const r of rows) existing.add(r.url);
    }
    const tracked = (await this.first<{ n: number }>('SELECT COUNT(*) AS n FROM index_status WHERE site_id = ?1', siteId))?.n ?? 0;
    const room = Math.max(0, Math.floor(maxUrls) - Number(tracked));
    const fresh = unique.filter((u) => !existing.has(u)).slice(0, room);
    changes += await this.batch(
      chunks(fresh).map((group) =>
        this.db
          .prepare(
            'INSERT INTO index_status (site_id, url, first_seen, last_seen) SELECT ?1, value, ?2, ?2 FROM json_each(?3) WHERE true ON CONFLICT (site_id, url) DO NOTHING',
          )
          .bind(siteId, day, JSON.stringify(group)),
      ),
    );
    return changes;
  }

  async pruneIndexUrls(siteId: string, seenBefore: IsoDate): Promise<number> {
    const res = await this.db.prepare('DELETE FROM index_status WHERE site_id = ?1 AND last_seen < ?2').bind(siteId, seenBefore).run();
    return res.meta?.changes ?? 0;
  }

  async listUrlsToInspect(siteId: string, inspectedBefore: string, limit: number): Promise<string[]> {
    // NULLs sort first: URLs never inspected come before the oldest inspections.
    const rows = await this.all<{ url: string }>(
      `SELECT url FROM index_status WHERE site_id = ?1 AND (inspected_at IS NULL OR inspected_at < ?2)
       ORDER BY inspected_at, url LIMIT ?3`,
      siteId,
      inspectedBefore,
      Math.max(1, Math.floor(limit)),
    );
    return rows.map((r) => r.url);
  }

  async writeUrlInspections(siteId: string, rows: UrlInspectionInput[]): Promise<number> {
    // Only tracked URLs are updated. A failed inspection keeps the URL's last known state.
    const ok = `UPDATE index_status SET
        previous_coverage_state = CASE WHEN inspected_at IS NOT NULL AND verdict IS NOT NULL AND coverage_state IS NOT ?4 THEN coverage_state ELSE previous_coverage_state END,
        changed_at = CASE WHEN inspected_at IS NOT NULL AND verdict IS NOT NULL AND coverage_state IS NOT ?4 THEN ?3 ELSE changed_at END,
        inspected_at = ?3, coverage_state = ?4, verdict = ?5, indexing_state = ?6, page_fetch_state = ?7, robots_txt_state = ?8,
        last_crawl_time = ?9, google_canonical = ?10, user_canonical = ?11, crawled_as = ?12, rich_results_verdict = ?13,
        rich_results = ?14, error = NULL
      WHERE site_id = ?1 AND url = ?2`;
    const failed = 'UPDATE index_status SET inspected_at = ?3, error = ?4 WHERE site_id = ?1 AND url = ?2';
    return this.batch(
      rows.map((r) =>
        r.error
          ? this.db.prepare(failed).bind(siteId, r.url, r.inspectedAt, r.error)
          : this.db
              .prepare(ok)
              .bind(
                siteId,
                r.url,
                r.inspectedAt,
                r.coverageState,
                r.verdict,
                r.indexingState,
                r.pageFetchState,
                r.robotsTxtState,
                r.lastCrawlTime,
                r.googleCanonical,
                r.userCanonical,
                r.crawledAs,
                r.richResultsVerdict,
                richResultsJson(r.richResultTypes, r.richResultIssues),
              ),
      ),
    );
  }

  async indexCoverage(q: IndexCoverageQuery): Promise<IndexCoverageResult> {
    const limit = Math.max(1, Math.min(Math.floor(q.limit) || 50, 5_000));
    const binds: Bind[] = [q.siteId];
    const where = ['site_id = ?1'];
    const arg = (v: Bind) => {
      binds.push(v);
      return `?${binds.length}`;
    };
    if (q.coverageState) where.push(`instr(lower(coverage_state), lower(${arg(q.coverageState)})) > 0`);
    const verdict = q.verdict?.toUpperCase();
    if (verdict === 'PENDING') where.push('inspected_at IS NULL');
    else if (verdict === 'ERROR') where.push('error IS NOT NULL');
    else if (verdict) where.push(`verdict = ${arg(verdict)}`);
    if (q.richResultIssues) where.push("EXISTS (SELECT 1 FROM json_each(rich_results) t WHERE json_array_length(t.value, '$.i') > 0)");
    const stateLabel =
      "CASE WHEN inspected_at IS NULL THEN 'PENDING' WHEN verdict IS NULL AND error IS NOT NULL THEN 'ERROR' ELSE verdict END";
    const [totals, states, verdicts, types, issues, urls, changes] = await this.db.batch([
      this.db
        .prepare(
          `SELECT COUNT(*) AS urls, COUNT(inspected_at) AS inspected, SUM(CASE WHEN error IS NULL THEN 0 ELSE 1 END) AS errors,
             MIN(inspected_at) AS oldest, MAX(inspected_at) AS newest FROM index_status WHERE site_id = ?1`,
        )
        .bind(q.siteId),
      this.db
        .prepare(
          `SELECT ${stateLabel} AS verdict, coverage_state, COUNT(*) AS urls FROM index_status WHERE site_id = ?1
           GROUP BY 1, 2 ORDER BY urls DESC, 1, 2 LIMIT 100`,
        )
        .bind(q.siteId),
      this.db
        .prepare(
          `SELECT rich_results_verdict AS verdict, COUNT(*) AS urls FROM index_status
           WHERE site_id = ?1 AND rich_results_verdict IS NOT NULL GROUP BY 1 ORDER BY urls DESC, 1`,
        )
        .bind(q.siteId),
      this.db
        .prepare(
          `SELECT t.value->>'t' AS type, COUNT(*) AS urls, SUM(CASE WHEN json_array_length(t.value, '$.i') > 0 THEN 1 ELSE 0 END) AS with_issues
           FROM index_status s, json_each(s.rich_results) t WHERE s.site_id = ?1 AND s.rich_results IS NOT NULL
           GROUP BY 1 ORDER BY urls DESC, 1 LIMIT 50`,
        )
        .bind(q.siteId),
      this.db
        .prepare(
          `SELECT t.value->>'t' AS type, i.value->>'s' AS severity, i.value->>'m' AS message, COUNT(DISTINCT s.url) AS urls
           FROM index_status s, json_each(s.rich_results) t, json_each(t.value, '$.i') i
           WHERE s.site_id = ?1 AND s.rich_results IS NOT NULL GROUP BY 1, 2, 3 ORDER BY urls DESC, 1, 2, 3 LIMIT 50`,
        )
        .bind(q.siteId),
      this.db
        .prepare(
          `SELECT * FROM index_status WHERE ${where.join(' AND ')}
           ORDER BY CASE WHEN verdict = 'PASS' THEN 2 WHEN inspected_at IS NULL THEN 1 ELSE 0 END, coverage_state, url LIMIT ${limit}`,
        )
        .bind(...binds),
      this.db
        .prepare(
          `SELECT url, previous_coverage_state, coverage_state, changed_at FROM index_status
           WHERE site_id = ?1 AND changed_at >= ?2 ORDER BY changed_at DESC, url LIMIT ?3`,
        )
        .bind(q.siteId, q.changedSince, limit),
    ]);
    const rows = <T>(r: D1Result | undefined) => (r?.results ?? []) as T[];
    const t = rows<{ urls: number; inspected: number; errors: number | null; oldest: string | null; newest: string | null }>(totals)[0];
    const str = (v: unknown) => (v == null ? null : String(v));
    return {
      totals: {
        urls: Number(t?.urls ?? 0),
        inspected: Number(t?.inspected ?? 0),
        errors: Number(t?.errors ?? 0),
        oldestInspectedAt: t?.oldest ?? null,
        newestInspectedAt: t?.newest ?? null,
      },
      states: rows<{ verdict: string | null; coverage_state: string | null; urls: number }>(states).map((r) => ({
        verdict: r.verdict ?? 'UNKNOWN',
        coverageState: r.coverage_state,
        urls: Number(r.urls),
      })),
      richResults: {
        verdicts: rows<{ verdict: string; urls: number }>(verdicts).map((r) => ({ verdict: r.verdict, urls: Number(r.urls) })),
        types: rows<{ type: string; urls: number; with_issues: number }>(types).map((r) => ({
          type: r.type,
          urls: Number(r.urls),
          urlsWithIssues: Number(r.with_issues ?? 0),
        })),
        issues: rows<{ type: string; severity: string; message: string; urls: number }>(issues).map((r) => ({
          type: r.type,
          severity: r.severity,
          message: r.message,
          urls: Number(r.urls),
        })),
      },
      urls: rows<Record<string, unknown>>(urls).map((r): IndexStatusRow => ({
        url: String(r.url),
        firstSeen: String(r.first_seen),
        lastSeen: String(r.last_seen),
        inspectedAt: str(r.inspected_at),
        verdict: str(r.verdict),
        coverageState: str(r.coverage_state),
        indexingState: str(r.indexing_state),
        pageFetchState: str(r.page_fetch_state),
        robotsTxtState: str(r.robots_txt_state),
        lastCrawlTime: str(r.last_crawl_time),
        googleCanonical: str(r.google_canonical),
        userCanonical: str(r.user_canonical),
        crawledAs: str(r.crawled_as),
        richResultsVerdict: str(r.rich_results_verdict),
        ...parseRichResults(r.rich_results),
        error: str(r.error),
        previousCoverageState: str(r.previous_coverage_state),
        changedAt: str(r.changed_at),
      })),
      changes: rows<{ url: string; previous_coverage_state: string | null; coverage_state: string | null; changed_at: string }>(
        changes,
      ).map((r) => ({ url: r.url, from: r.previous_coverage_state, to: r.coverage_state, changedAt: r.changed_at })),
    };
  }

  // ------------------------------------------------------------------ brand

  async listQueriesForBrandClassification(siteId: string, version: string, limit: number) {
    return this.all<{ id: number; text: string }>(
      'SELECT id, text FROM queries WHERE site_id = ?1 AND (brand_version IS NULL OR brand_version != ?2) LIMIT ?3',
      siteId,
      version,
      limit,
    );
  }

  async setBrandFlags(siteId: string, version: string, flags: Array<{ id: number; isBrand: boolean }>): Promise<void> {
    // One primary-key lookup per id. `UPDATE ... FROM json_each(...)` let SQLite, which has no
    // statistics on D1, scan all of the site's queries once per id: seconds per batch, and on
    // sites with many queries more CPU than D1 allows, which resets the database. The unary
    // `+` keeps the site check from being used as the index instead of the ids.
    const sql = 'UPDATE queries SET is_brand = ?3, brand_version = ?2 WHERE id IN (SELECT value FROM json_each(?4)) AND +site_id = ?1';
    const statements = [true, false].flatMap((isBrand) =>
      chunks(flags.filter((f) => f.isBrand === isBrand).map((f) => f.id)).map((ids) =>
        this.db.prepare(sql).bind(siteId, version, isBrand ? 1 : 0, JSON.stringify(ids)),
      ),
    );
    await this.batch(statements);
  }

  // ------------------------------------------------------------- sync runs

  async startSyncRun(run: SyncRunRecord): Promise<number> {
    const row = await this.orm
      .insert(schema.syncRuns)
      .values({
        startedAt: run.startedAt,
        trigger: run.trigger,
        status: run.status,
        rowsWritten: run.rowsWritten,
        message: run.message ?? null,
      })
      .returning({ id: schema.syncRuns.id })
      .get();
    // Keep the table small: drop runs older than the latest 500.
    await this.db.prepare('DELETE FROM sync_runs WHERE id <= (SELECT id FROM sync_runs ORDER BY id DESC LIMIT 1 OFFSET 500)').run();
    return row.id;
  }

  async finishSyncRun(id: number, patch: Partial<SyncRunRecord>): Promise<void> {
    const set: Partial<typeof schema.syncRuns.$inferInsert> = {};
    if (patch.finishedAt !== undefined) set.finishedAt = patch.finishedAt;
    if (patch.status !== undefined) set.status = patch.status;
    if (patch.rowsWritten !== undefined) set.rowsWritten = patch.rowsWritten;
    if (patch.message !== undefined) set.message = patch.message;
    if (patch.details !== undefined) set.details = JSON.stringify(patch.details);
    if (Object.keys(set).length === 0) return;
    await this.orm.update(schema.syncRuns).set(set).where(eq(schema.syncRuns.id, id)).run();
  }

  async listSyncRuns(limit: number): Promise<SyncRunRecord[]> {
    const rows = await this.orm.select().from(schema.syncRuns).orderBy(desc(schema.syncRuns.id)).limit(limit).all();
    return rows.map((r) => ({
      id: r.id,
      startedAt: r.startedAt,
      finishedAt: r.finishedAt,
      trigger: r.trigger as SyncRunRecord['trigger'],
      status: r.status as SyncRunRecord['status'],
      rowsWritten: r.rowsWritten,
      message: r.message,
      details: r.details ? (JSON.parse(r.details) as SyncRunRecord['details']) : [],
    }));
  }

  // ------------------------------------------------------------------ reads

  async queryPerformance(q: PerformanceQuery): Promise<PerformanceRow[]> {
    const f = q.filters ?? {};
    const dims = allow(q.dimensions, PERF_DIMS, 'dimension');
    if (q.orderBy !== undefined) allow([q.orderBy], PERF_ORDER, 'orderBy');
    const breakdown = dims.includes('country') || dims.includes('device') || Boolean(f.country) || Boolean(f.device);
    const appearance = dims.includes('appearance') || Boolean(f.appearance);
    const brand = f.brand ?? 'all';
    const hasQuery = dims.includes('query') || Boolean(f.queryContains) || brand !== 'all';
    const hasPage = dims.includes('page') || Boolean(f.pageContains);
    if (appearance && (breakdown || hasQuery || hasPage))
      throw new Error('appearance cannot be combined with query, page, country or device');
    if (breakdown && hasQuery && hasPage) throw new Error('country/device can be combined with query or page, not both');

    const binds: Bind[] = [q.siteId, storedSource(q.source, q.searchType), q.range.start, q.range.end];
    const where: string[] = ['f.site_id = ?1', 'f.source = ?2', 'f.date >= ?3', 'f.date <= ?4'];
    const joins: string[] = [];
    let table: string;
    // Bing reports no position for site totals: they take the impression-weighted position of its query rows.
    const bingTotals = q.source === 'bing' && !breakdown && !appearance && !hasQuery && !hasPage;
    if (appearance) {
      table = 'search_appearances';
    } else if (breakdown && (hasQuery || hasPage)) {
      table = 'search_segments';
      where.push(`f.kind = '${hasQuery ? 'query' : 'page'}'`);
      if (hasPage) joins.push('JOIN pages p ON p.id = f.item_id');
      if (hasQuery) joins.push('JOIN queries q ON q.id = f.item_id');
    } else if (breakdown) {
      table = 'search_breakdowns';
    } else {
      table = 'search_facts';
      const kinds = bingTotals
        ? ['total', 'query']
        : hasQuery && hasPage
          ? ['query_page']
          : hasQuery
            ? ['query_page', 'query']
            : hasPage
              ? ['query_page', 'page']
              : ['total'];
      where.push(`f.kind IN (${kinds.map((k) => `'${k}'`).join(', ')})`);
      if (hasPage) joins.push('JOIN pages p ON p.id = f.page_id');
      if (hasQuery) joins.push('JOIN queries q ON q.id = f.query_id');
    }
    const arg = (v: Bind) => {
      binds.push(v);
      return `?${binds.length}`;
    };
    if (f.queryContains) where.push(`instr(lower(q.text), lower(${arg(f.queryContains)})) > 0`);
    if (f.pageContains) where.push(`instr(lower(p.path), lower(${arg(f.pageContains)})) > 0`);
    if (brand === 'brand') where.push('q.is_brand = 1');
    if (brand === 'non_brand') where.push('q.is_brand = 0');
    if (f.country) where.push(`f.country = ${arg(f.country.toLowerCase())}`);
    if (f.device) where.push(`f.device = ${arg(f.device.toUpperCase())}`);
    if (f.appearance) where.push(`f.appearance = ${arg(f.appearance)}`);
    const clicks = bingTotals ? "CASE WHEN f.kind = 'total' THEN f.clicks END" : 'f.clicks';
    const impressions = bingTotals ? "CASE WHEN f.kind = 'total' THEN f.impressions END" : 'f.impressions';
    const positionSum = bingTotals ? "CASE WHEN f.kind = 'query' THEN f.position_sum END" : 'f.position_sum';
    const positionImpressions = bingTotals
      ? "CASE WHEN f.kind = 'query' AND f.position_sum IS NOT NULL THEN f.impressions ELSE 0 END"
      : 'CASE WHEN f.position_sum IS NULL THEN 0 ELSE f.impressions END';

    const select: string[] = [];
    const group: string[] = [];
    const dimExpr: Record<string, string> = {
      date: 'f.date',
      week: "date(f.date, '-6 days', 'weekday 1')",
      month: 'substr(f.date, 1, 7)',
      query: 'q.text',
      page: 'p.path',
      country: 'f.country',
      device: 'f.device',
      appearance: 'f.appearance',
    };
    for (const d of dims) {
      select.push(`${dimExpr[d]} AS ${d}`);
      group.push(dimExpr[d]!);
    }
    select.push(
      `SUM(${clicks}) AS clicks`,
      `SUM(${impressions}) AS impressions`,
      `SUM(${positionSum}) AS position_sum`,
      `SUM(${positionImpressions}) AS position_impressions`,
    );
    const having: string[] = [];
    const h = q.having ?? {};
    const posExpr = `SUM(${positionSum}) / NULLIF(SUM(${positionImpressions}), 0)`;
    // Bing's weekly query rows fall on days without totals; those days are not rows of their own.
    if (bingTotals) having.push(`SUM(${impressions}) IS NOT NULL`);
    if (h.minImpressions !== undefined) having.push(`SUM(${impressions}) >= ${arg(h.minImpressions)}`);
    if (h.minClicks !== undefined) having.push(`SUM(${clicks}) >= ${arg(h.minClicks)}`);
    if (h.minPosition !== undefined) having.push(`${posExpr} >= ${arg(h.minPosition)}`);
    if (h.maxPosition !== undefined) having.push(`${posExpr} <= ${arg(h.maxPosition)}`);

    const dir = q.order === 'asc' ? 'ASC' : 'DESC';
    const timeDim = dims.find((d) => d === 'date' || d === 'week' || d === 'month');
    const orderCol =
      q.orderBy === 'date'
        ? (timeDim ?? null)
        : q.orderBy === 'ctr'
          ? `CAST(SUM(${clicks}) AS REAL) / NULLIF(SUM(${impressions}), 0)`
          : q.orderBy === 'position'
            ? posExpr
            : (q.orderBy ?? 'clicks');
    const order = orderCol ? `ORDER BY ${orderCol} ${dir}${timeDim && orderCol !== timeDim ? `, ${timeDim} ASC` : ''}` : '';
    const limit = Math.max(1, Math.min(Math.floor(Number(q.limit ?? 1000)) || 1000, 50_000));

    const sql = `SELECT ${select.join(', ')} FROM ${table} f ${joins.join(' ')} WHERE ${where.join(' AND ')}
      ${group.length ? `GROUP BY ${group.join(', ')}` : ''} ${having.length && group.length ? `HAVING ${having.join(' AND ')}` : ''}
      ${order} LIMIT ${limit}`;
    const rows = await this.all<Record<string, unknown>>(sql, ...binds);
    return rows
      .filter((r) => dims.length > 0 || r.impressions !== null)
      .map((r) => {
        const clicks = Number(r.clicks ?? 0);
        const impressions = Number(r.impressions ?? 0);
        const pi = Number(r.position_impressions ?? 0);
        const out: PerformanceRow = {
          clicks,
          impressions,
          ctr: impressions > 0 ? Math.round((clicks / impressions) * 10_000) / 10_000 : 0,
          position: pi > 0 && r.position_sum != null ? Math.round((Number(r.position_sum) / pi) * 100) / 100 : null,
        };
        for (const d of dims) (out as unknown as Record<string, unknown>)[d] = r[d];
        return out;
      });
  }

  async queryCrawlers(q: CrawlerQuery): Promise<CrawlerRow[]> {
    const binds: Bind[] = [q.siteId, q.range.start, q.range.end];
    const where = ['c.site_id = ?1', 'c.date >= ?2', 'c.date <= ?3'];
    const arg = (v: Bind) => {
      binds.push(v);
      return `?${binds.length}`;
    };
    allow(q.groupBy, CRAWLER_GROUPS, 'groupBy');
    const needPage = q.groupBy.includes('path') || Boolean(q.pathContains);
    if (q.crawler) where.push(`lower(c.crawler) = lower(${arg(q.crawler)})`);
    if (q.pathContains) where.push(`instr(lower(p.path), lower(${arg(q.pathContains)})) > 0`);
    const cols: Record<string, string> = {
      crawler: 'c.crawler',
      operator: 'c.operator',
      purpose: 'c.purpose',
      path: 'p.path',
      status: 'c.status',
      date: 'c.date',
    };
    const select = q.groupBy.map((g) => `${cols[g]} AS ${g}`);
    const group = q.groupBy.map((g) => cols[g]!);
    const sql = `SELECT ${[...select, 'SUM(c.requests) AS requests'].join(', ')} FROM ${crawlerTable(q.kind)} c
      ${needPage ? 'JOIN pages p ON p.id = c.page_id' : ''} WHERE ${where.join(' AND ')}
      ${group.length ? `GROUP BY ${group.join(', ')}` : ''}
      ORDER BY ${q.groupBy.length === 1 && q.groupBy[0] === 'date' ? 'c.date ASC' : 'requests DESC'} LIMIT ${Math.max(1, Math.min(Math.floor(Number(q.limit ?? 100)) || 100, 50_000))}`;
    const rows = await this.all<Record<string, unknown>>(sql, ...binds);
    return rows.filter((r) => r.requests !== null).map((r) => ({ ...r, requests: Number(r.requests) }) as CrawlerRow);
  }

  async queryReferrals(q: ReferralQuery): Promise<ReferralRow[]> {
    const binds: Bind[] = [q.siteId, q.range.start, q.range.end];
    const where = ['w.site_id = ?1', 'w.date >= ?2', 'w.date <= ?3'];
    if (q.refererHosts) {
      binds.push(JSON.stringify(q.refererHosts));
      where.push(`w.referer_host IN (SELECT value FROM json_each(?${binds.length}))`);
    }
    allow(q.groupBy, REFERRAL_GROUPS, 'groupBy');
    const cols: Record<string, string> = { path: 'p.path', refererHost: 'w.referer_host', date: 'w.date' };
    const select = q.groupBy.map((g) => `${cols[g]} AS ${g}`);
    const group = q.groupBy.map((g) => cols[g]!);
    const sql = `SELECT ${[...select, 'SUM(w.visits) AS visits', 'SUM(w.page_views) AS page_views'].join(', ')} FROM web_analytics w
      ${q.groupBy.includes('path') ? 'JOIN pages p ON p.id = w.page_id' : ''} WHERE ${where.join(' AND ')}
      ${group.length ? `GROUP BY ${group.join(', ')}` : ''}
      ORDER BY ${q.groupBy.length === 1 && q.groupBy[0] === 'date' ? 'w.date ASC' : 'visits DESC'} LIMIT ${Math.max(1, Math.min(Math.floor(Number(q.limit ?? 100)) || 100, 50_000))}`;
    const rows = await this.all<Record<string, unknown>>(sql, ...binds);
    return rows
      .filter((r) => r.visits !== null)
      .map((r) => {
        const out: ReferralRow = { visits: Number(r.visits), pageViews: Number(r.page_views) };
        if ('path' in r) out.path = String(r.path);
        if ('refererHost' in r) out.refererHost = String(r.refererHost);
        if ('date' in r) out.date = String(r.date);
        return out;
      });
  }

  async queryAiCitations(siteId: string, range: DateRange, limit: number): Promise<PageCount[]> {
    const rows = await this.all<{ page: string; value: number }>(
      `SELECT p.path AS page, SUM(a.citations) AS value FROM ai_citations a JOIN pages p ON p.id = a.page_id
       WHERE a.site_id = ?1 AND a.date >= ?2 AND a.date <= ?3 GROUP BY p.path ORDER BY value DESC LIMIT ?4`,
      siteId,
      range.start,
      range.end,
      limit,
    );
    return rows.map((r) => ({ page: r.page, value: Number(r.value) }));
  }

  async queryWebVitals(siteId: string, range: DateRange, limit: number) {
    const rows = await this.all<{
      page: string;
      lcp: number | null;
      inp: number | null;
      cls: number | null;
      samples: number;
      date: string;
    }>(
      `SELECT p.path AS page, MAX(v.date) AS date,
         SUM(v.lcp_p75 * v.samples) / NULLIF(SUM(CASE WHEN v.lcp_p75 IS NULL THEN 0 ELSE v.samples END), 0) AS lcp,
         SUM(v.inp_p75 * v.samples) / NULLIF(SUM(CASE WHEN v.inp_p75 IS NULL THEN 0 ELSE v.samples END), 0) AS inp,
         SUM(v.cls_p75 * v.samples) / NULLIF(SUM(CASE WHEN v.cls_p75 IS NULL THEN 0 ELSE v.samples END), 0) AS cls,
         SUM(v.samples) AS samples
       FROM web_vitals v JOIN pages p ON p.id = v.page_id
       WHERE v.site_id = ?1 AND v.date >= ?2 AND v.date <= ?3 GROUP BY p.path ORDER BY samples DESC LIMIT ?4`,
      siteId,
      range.start,
      range.end,
      limit,
    );
    const r0 = (v: number | null) => (v == null ? null : Math.round(v));
    return rows.map((r) => ({
      page: r.page,
      path: r.page,
      date: r.date,
      lcpP75: r0(r.lcp),
      inpP75: r0(r.inp),
      clsP75: r.cls == null ? null : Math.round(r.cls * 1000) / 1000,
      samples: Number(r.samples),
    }));
  }

  async listCrawlIssues(siteId: string, source: SearchSource, limit: number): Promise<CrawlIssueInput[]> {
    const rows = await this.all<{ url: string; issue: string; http_code: number | null; detected_at: string | null }>(
      'SELECT url, issue, http_code, detected_at FROM crawl_issues WHERE site_id = ?1 AND source = ?2 ORDER BY url LIMIT ?3',
      siteId,
      source,
      limit,
    );
    return rows.map((r) => ({ url: r.url, issue: r.issue, httpCode: r.http_code, detectedAt: r.detected_at }));
  }

  async listSitemaps(siteId: string, source: SearchSource): Promise<SitemapRecord[]> {
    const rows = await this.all<Record<string, unknown>>(
      'SELECT * FROM sitemaps WHERE site_id = ?1 AND source = ?2 ORDER BY path',
      siteId,
      source,
    );
    return rows.map((r) => ({
      path: String(r.path),
      lastSubmitted: (r.last_submitted as string | null) ?? null,
      lastDownloaded: (r.last_downloaded as string | null) ?? null,
      isPending: Number(r.is_pending) === 1,
      errors: Number(r.errors ?? 0),
      warnings: Number(r.warnings ?? 0),
      submitted: r.submitted == null ? null : Number(r.submitted),
      indexed: r.indexed == null ? null : Number(r.indexed),
    }));
  }

  async coverage(siteId?: string): Promise<DataCoverage[]> {
    const sites = siteId ? [siteId] : (await this.all<{ id: string }>('SELECT id FROM sites ORDER BY id')).map((s) => s.id);
    const out: DataCoverage[] = [];
    for (const id of sites) {
      // Every query below is an index range seek (no full scans): D1 bills rows read.
      const [gsc, bing, crawl, rum, cites, searchCrawl] = await this.db.batch([
        this.db
          .prepare(
            "SELECT MIN(date) AS first, MAX(date) AS last, COUNT(*) AS days FROM search_facts WHERE site_id = ?1 AND source = 'gsc' AND kind = 'total'",
          )
          .bind(id),
        this.db
          .prepare(
            "SELECT MIN(date) AS first, MAX(date) AS last, COUNT(*) AS days FROM search_facts WHERE site_id = ?1 AND source = 'bing' AND kind = 'total'",
          )
          .bind(id),
        this.db.prepare('SELECT MIN(date) AS first, MAX(date) AS last FROM ai_crawler_requests WHERE site_id = ?1').bind(id),
        this.db.prepare('SELECT MIN(date) AS first, MAX(date) AS last FROM web_analytics WHERE site_id = ?1').bind(id),
        this.db.prepare('SELECT MIN(date) AS first, MAX(date) AS last FROM ai_citations WHERE site_id = ?1').bind(id),
        this.db.prepare('SELECT MIN(date) AS first, MAX(date) AS last FROM search_crawler_requests WHERE site_id = ?1').bind(id),
      ]);
      const push = (source: string, dataset: string, res: D1Result | undefined) => {
        const r = (res?.results?.[0] ?? {}) as { first?: string | null; last?: string | null; days?: number };
        out.push({
          siteId: id,
          source,
          dataset,
          firstDate: r.first ?? null,
          lastDate: r.last ?? null,
          days: r.days === undefined ? null : Number(r.days),
        });
      };
      push('gsc', 'search', gsc);
      push('bing', 'search', bing);
      push('cloudflare', 'ai_crawlers', crawl);
      push('cloudflare', 'search_crawlers', searchCrawl);
      push('cloudflare', 'web_analytics', rum);
      push('import', 'ai_citations', cites);
    }
    return out;
  }

  async latestDate(siteId: string, source: SearchSource): Promise<IsoDate | null> {
    const row = await this.first<{ d: string | null }>(
      "SELECT MAX(date) AS d FROM search_facts WHERE site_id = ?1 AND source = ?2 AND kind = 'total'",
      siteId,
      source,
    );
    return row?.d ?? null;
  }

  // ------------------------------------------------------------- apps (ADR 0009)

  async listAppConfigs(): Promise<AppConfig[]> {
    const rows = await this.orm.select().from(schema.appConfigs).orderBy(schema.appConfigs.id).all();
    return rows.map((r) => {
      const app: AppConfig = { id: r.id, name: r.name };
      if (r.appleId) app.appleId = r.appleId;
      if (r.playPackage) app.playPackage = r.playPackage;
      if (r.siteId) app.siteId = r.siteId;
      if (r.territories) app.territories = r.territories.split(',').filter(Boolean);
      return app;
    });
  }

  async saveAppConfig(app: AppConfig): Promise<void> {
    const values = {
      name: app.name,
      appleId: app.appleId ?? null,
      playPackage: app.playPackage ?? null,
      siteId: app.siteId ?? null,
      territories: app.territories?.length ? app.territories.join(',') : null,
    };
    await this.orm
      .insert(schema.appConfigs)
      .values({ id: app.id, ...values })
      .onConflictDoUpdate({ target: schema.appConfigs.id, set: { ...values, updatedAt: new Date().toISOString() } })
      .run();
  }

  async deleteAppConfig(id: string): Promise<boolean> {
    const res = await this.db.prepare('DELETE FROM app_configs WHERE id = ?1').bind(id).run();
    return (res.meta?.changes ?? 0) > 0;
  }

  async writeAppStoreDaily(appId: string, store: AppStore, w: AppStoreWrite): Promise<number> {
    appStore(store);
    const metrics = allow([...new Set(w.metrics)], APP_STORE_METRICS, 'metric');
    if (metrics.length === 0) return 0;
    const shape = SHAPE_WHERE[w.shape];
    if (!shape) throw new Error(`Unknown row shape "${String(w.shape).slice(0, 20)}"`);
    const cols = metrics.map((m) => APP_COLUMNS[m]);
    // Aggregate duplicate keys.
    const agg = new Map<string, Record<string, string | number>>();
    for (const r of w.rows) {
      const key = `${r.date}|${r.territory}|${r.source}`;
      const e = agg.get(key) ?? { d: r.date, t: r.territory, s: r.source, k: key };
      metrics.forEach((m, i) => {
        e[`m${i}`] = (Number(e[`m${i}`]) || 0) + Math.round(r[m] ?? 0);
      });
      agg.set(key, e);
    }
    const items = [...agg.values()];
    const upserts = chunks(items).map((group) =>
      this.db
        .prepare(
          `INSERT INTO app_store_daily (app_id, store, date, territory, source, ${cols.join(', ')})
           SELECT ?1, ?2, j.value->>'d', j.value->>'t', j.value->>'s', ${cols.map((_c, i) => `COALESCE(j.value->>'m${i}', 0)`).join(', ')}
           FROM json_each(?3) j WHERE true
           ON CONFLICT (app_id, store, date, territory, source) DO UPDATE SET ${cols.map((c) => `${c} = excluded.${c}`).join(', ')}
           WHERE ${cols.map((c) => `app_store_daily.${c} != excluded.${c}`).join(' OR ')}`,
        )
        .bind(appId, store, JSON.stringify(group)),
    );
    let changes = await this.batch(upserts);
    if (w.dates.length) {
      // Rows of the replaced days that the write no longer mentions: their metrics drop to 0.
      const res = await this.db
        .prepare(
          `UPDATE app_store_daily SET ${cols.map((c) => `${c} = 0`).join(', ')}
           WHERE app_id = ?1 AND store = ?2 AND date IN (SELECT value FROM json_each(?3)) AND ${shape}
             AND (${cols.map((c) => `${c} != 0`).join(' OR ')})
             AND (date || '|' || territory || '|' || source) NOT IN (SELECT value FROM json_each(?4))`,
        )
        .bind(appId, store, JSON.stringify([...new Set(w.dates)]), JSON.stringify(items.map((x) => x.k)))
        .run();
      changes += res.meta?.changes ?? 0;
    }
    return changes;
  }

  async writeAppSearchTerms(appId: string, rows: AppSearchTermInput[], dates: IsoDate[]): Promise<number> {
    const agg = new Map<string, { d: string; t: string; v: number; a: number; k: string }>();
    for (const r of rows) {
      const term = r.term.trim();
      if (!term) continue;
      const key = `${r.date}|${term.toLowerCase()}`;
      const e = agg.get(key) ?? { d: r.date, t: term, v: 0, a: 0, k: `${r.date}|${term}` };
      e.v += Math.round(r.visitors);
      e.a += Math.round(r.acquisitions);
      agg.set(key, e);
    }
    const items = [...agg.values()];
    let changes = await this.batch(
      chunks(items).map((group) =>
        this.db
          .prepare(
            `INSERT INTO app_search_terms (app_id, date, term, visitors, acquisitions)
             SELECT ?1, j.value->>'d', j.value->>'t', j.value->>'v', j.value->>'a' FROM json_each(?2) j WHERE true
             ON CONFLICT (app_id, date, term) DO UPDATE SET visitors = excluded.visitors, acquisitions = excluded.acquisitions
             WHERE app_search_terms.visitors != excluded.visitors OR app_search_terms.acquisitions != excluded.acquisitions`,
          )
          .bind(appId, JSON.stringify(group)),
      ),
    );
    if (dates.length) {
      const res = await this.db
        .prepare(
          `DELETE FROM app_search_terms WHERE app_id = ?1 AND date IN (SELECT value FROM json_each(?2))
             AND (date || '|' || term) NOT IN (SELECT value FROM json_each(?3))`,
        )
        .bind(appId, JSON.stringify([...new Set(dates)]), JSON.stringify(items.map((x) => x.k)))
        .run();
      changes += res.meta?.changes ?? 0;
    }
    return changes;
  }

  async writeAppReferrers(appId: string, store: AppStore, w: AppReferrerWrite): Promise<number> {
    appStore(store);
    const metrics = allow([...new Set(w.metrics)], ['pageViews', 'downloads'] as const, 'metric');
    if (metrics.length === 0) return 0;
    const cols = metrics.map((m) => (m === 'pageViews' ? 'page_views' : 'downloads'));
    const agg = new Map<string, Record<string, string | number>>();
    for (const r of w.rows) {
      allow([r.kind], ['web', 'app', 'utm'] as const, 'referrer kind');
      const key = `${r.date}|${r.kind}|${r.referrer}`;
      const e = agg.get(key) ?? { d: r.date, n: r.kind, r: r.referrer, k: key };
      metrics.forEach((m, i) => {
        e[`m${i}`] = (Number(e[`m${i}`]) || 0) + Math.round(r[m] ?? 0);
      });
      agg.set(key, e);
    }
    const items = [...agg.values()];
    let changes = await this.batch(
      chunks(items).map((group) =>
        this.db
          .prepare(
            `INSERT INTO app_referrers (app_id, store, date, kind, referrer, ${cols.join(', ')})
             SELECT ?1, ?2, j.value->>'d', j.value->>'n', j.value->>'r', ${cols.map((_c, i) => `COALESCE(j.value->>'m${i}', 0)`).join(', ')}
             FROM json_each(?3) j WHERE true
             ON CONFLICT (app_id, store, date, kind, referrer) DO UPDATE SET ${cols.map((c) => `${c} = excluded.${c}`).join(', ')}
             WHERE ${cols.map((c) => `app_referrers.${c} != excluded.${c}`).join(' OR ')}`,
          )
          .bind(appId, store, JSON.stringify(group)),
      ),
    );
    if (w.dates.length) {
      const dates = JSON.stringify([...new Set(w.dates)]);
      const keys = JSON.stringify(items.map((x) => x.k));
      const stale = `app_id = ?1 AND store = ?2 AND date IN (SELECT value FROM json_each(?3))
        AND (date || '|' || kind || '|' || referrer) NOT IN (SELECT value FROM json_each(?4))`;
      const [zeroed, removed] = await this.db.batch([
        this.db
          .prepare(
            `UPDATE app_referrers SET ${cols.map((c) => `${c} = 0`).join(', ')} WHERE ${stale} AND (${cols.map((c) => `${c} != 0`).join(' OR ')})`,
          )
          .bind(appId, store, dates, keys),
        this.db.prepare(`DELETE FROM app_referrers WHERE ${stale} AND page_views = 0 AND downloads = 0`).bind(appId, store, dates, keys),
      ]);
      changes += (zeroed?.meta?.changes ?? 0) + (removed?.meta?.changes ?? 0);
    }
    return changes;
  }

  async writeAppRatings(appId: string, store: AppStore, rows: AppRatingInput[]): Promise<number> {
    appStore(store);
    const items = rows.map((r) => ({
      d: r.date,
      t: r.territory,
      a: r.average === null || !Number.isFinite(r.average) ? null : round6(r.average),
      c: r.count ?? null,
      x: r.dailyAverage === undefined || r.dailyAverage === null || !Number.isFinite(r.dailyAverage) ? null : round6(r.dailyAverage),
    }));
    return this.batch(
      chunks(items).map((group) =>
        this.db
          .prepare(
            `INSERT INTO app_ratings (app_id, store, date, territory, average, count, daily_average)
             SELECT ?1, ?2, j.value->>'d', j.value->>'t', j.value->>'a', j.value->>'c', j.value->>'x' FROM json_each(?3) j WHERE true
             ON CONFLICT (app_id, store, date, territory) DO UPDATE SET
               average = excluded.average, count = excluded.count, daily_average = excluded.daily_average
             WHERE app_ratings.average IS NOT excluded.average OR app_ratings.count IS NOT excluded.count
               OR app_ratings.daily_average IS NOT excluded.daily_average`,
          )
          .bind(appId, store, JSON.stringify(group)),
      ),
    );
  }

  async writeAppReviews(appId: string, store: AppStore, rows: AppReviewInput[]): Promise<number> {
    appStore(store);
    const items = rows.map((r) => ({
      i: r.id,
      c: r.createdAt,
      d: r.createdAt.slice(0, 10),
      r: r.rating,
      ti: r.title,
      b: r.body,
      te: r.territory,
      l: r.language,
      v: r.version,
      rp: r.replied ? 1 : 0,
    }));
    const cols = ['created_at', 'date', 'rating', 'title', 'body', 'territory', 'language', 'version', 'replied'];
    // Review text can be long: smaller statements stay well under D1's statement size limit.
    return this.batch(
      chunks(items, 50).map((group) =>
        this.db
          .prepare(
            `INSERT INTO app_reviews (app_id, store, id, ${cols.join(', ')})
             SELECT ?1, ?2, j.value->>'i', j.value->>'c', j.value->>'d', j.value->>'r', j.value->>'ti', j.value->>'b',
               j.value->>'te', j.value->>'l', j.value->>'v', j.value->>'rp'
             FROM json_each(?3) j WHERE true
             ON CONFLICT (app_id, store, id) DO UPDATE SET ${cols.map((c) => `${c} = excluded.${c}`).join(', ')}
             WHERE ${cols.map((c) => `app_reviews.${c} IS NOT excluded.${c}`).join(' OR ')}`,
          )
          .bind(appId, store, JSON.stringify(group)),
      ),
    );
  }

  async writeAppVitals(appId: string, store: AppStore, w: AppVitalsWrite): Promise<number> {
    appStore(store);
    const metrics = allow([...new Set(w.metrics)], Object.keys(VITALS_COLUMNS) as AppVitalsMetric[], 'metric');
    if (metrics.length === 0 || w.rows.length === 0) return 0;
    const cols = metrics.map((m) => VITALS_COLUMNS[m]);
    const items = w.rows.map((r) => {
      const e: Record<string, string | number | null> = { d: r.date, v: r.version };
      metrics.forEach((m, i) => {
        const v = r[m];
        e[`m${i}`] = v === undefined || v === null || !Number.isFinite(v) ? null : round6(v);
      });
      return e;
    });
    return this.batch(
      chunks(items).map((group) =>
        this.db
          .prepare(
            `INSERT INTO app_vitals (app_id, store, date, version, ${cols.join(', ')})
             SELECT ?1, ?2, j.value->>'d', j.value->>'v', ${cols.map((_c, i) => `j.value->>'m${i}'`).join(', ')}
             FROM json_each(?3) j WHERE true
             ON CONFLICT (app_id, store, date, version) DO UPDATE SET ${cols.map((c) => `${c} = excluded.${c}`).join(', ')}
             WHERE ${cols.map((c) => `app_vitals.${c} IS NOT excluded.${c}`).join(' OR ')}`,
          )
          .bind(appId, store, JSON.stringify(group)),
      ),
    );
  }

  async writeAppChartRanks(appId: string, rows: AppChartRankInput[]): Promise<number> {
    const items = rows.map((r) => ({ d: r.date, t: r.territory, c: r.chart, g: r.genre, r: r.rank }));
    return this.batch(
      chunks(items).map((group) =>
        this.db
          .prepare(
            `INSERT INTO app_chart_ranks (app_id, date, territory, chart, genre, rank)
             SELECT ?1, j.value->>'d', j.value->>'t', j.value->>'c', j.value->>'g', j.value->>'r' FROM json_each(?2) j WHERE true
             ON CONFLICT (app_id, date, territory, chart, genre) DO UPDATE SET rank = excluded.rank
             WHERE app_chart_ranks.rank IS NOT excluded.rank`,
          )
          .bind(appId, JSON.stringify(group)),
      ),
    );
  }

  async queryAppStore(q: AppStoreQuery): Promise<AppStoreRow[]> {
    const dims = allow(q.dimensions, APP_DIMS, 'dimension') as AppDimension[];
    if (q.orderBy !== undefined) allow([q.orderBy], APP_ORDER, 'orderBy');
    const binds: Bind[] = [q.appId, q.range.start, q.range.end];
    const arg = (v: Bind) => {
      binds.push(v);
      return `?${binds.length}`;
    };
    const where = ['app_id = ?1', 'date >= ?2', 'date <= ?3'];
    if (q.store) where.push(`store = ${arg(appStore(q.store))}`);
    const bySource = dims.includes('source') || q.source !== undefined;
    const byTerritory = dims.includes('territory') || q.territory !== undefined;
    // Each store's rows counted once: per source, per territory, or (both) the cross rows only.
    if (bySource && byTerritory) where.push(`territory != '${ALL_KEY}' AND source != '${ALL_KEY}'`);
    else if (bySource) where.push(`source != '${ALL_KEY}'`);
    else where.push(`territory != '${ALL_KEY}'`);
    if (q.territory !== undefined) where.push(`territory = ${arg(q.territory)}`);
    if (q.source !== undefined) where.push(`source = ${arg(q.source)}`);
    const dimExpr: Record<AppDimension, string> = {
      date: 'date',
      week: "date(date, '-6 days', 'weekday 1')",
      month: 'substr(date, 1, 7)',
      store: 'store',
      territory: 'territory',
      source: 'source',
    };
    const select = dims.map((d) => `${dimExpr[d]} AS ${d}`);
    const group = dims.map((d) => dimExpr[d]);
    for (const m of APP_STORE_METRICS) select.push(`COALESCE(SUM(${APP_COLUMNS[m]}), 0) AS ${m}`);
    const orderBy = q.orderBy === 'date' ? (dims.find((d) => d === 'date' || d === 'week' || d === 'month') ?? null) : (q.orderBy ?? null);
    const order = q.order === 'asc' ? 'ASC' : 'DESC';
    const sql = `SELECT ${select.join(', ')} FROM app_store_daily WHERE ${where.join(' AND ')}
      ${group.length ? `GROUP BY ${group.join(', ')}` : 'HAVING COUNT(*) > 0'}
      ${orderBy ? `ORDER BY ${orderBy} ${order}` : group.length ? `ORDER BY pageViewsUnique DESC` : ''}
      LIMIT ${Math.max(1, Math.min(q.limit ?? 1000, 10_000))}`;
    const rows = await this.all<Record<string, string | number>>(sql, ...binds);
    return rows.map((r) => {
      const out = Object.fromEntries(APP_STORE_METRICS.map((m) => [m, Number(r[m]) || 0])) as unknown as AppStoreRow;
      for (const d of dims) (out as unknown as Record<string, unknown>)[d] = r[d];
      return out;
    });
  }

  async queryAppSearchTerms(q: AppSearchTermQuery): Promise<AppSearchTermRow[]> {
    const binds: Bind[] = [q.appId, q.range.start, q.range.end];
    let filter = '';
    if (q.termContains) {
      binds.push(q.termContains);
      filter = ' AND instr(lower(term), lower(?4)) > 0';
    }
    const order = q.orderBy === 'acquisitions' ? 'acquisitions DESC, visitors DESC' : 'visitors DESC, acquisitions DESC';
    const rows = await this.all<{ term: string; visitors: number; acquisitions: number }>(
      `SELECT MIN(term) AS term, SUM(visitors) AS visitors, SUM(acquisitions) AS acquisitions FROM app_search_terms
       WHERE app_id = ?1 AND date >= ?2 AND date <= ?3${filter} GROUP BY lower(term) ORDER BY ${order}
       LIMIT ${Math.max(1, Math.min(q.limit ?? 500, 5_000))}`,
      ...binds,
    );
    return rows.map((r) => ({ term: r.term, visitors: Number(r.visitors) || 0, acquisitions: Number(r.acquisitions) || 0 }));
  }

  async queryAppReferrers(q: AppReferrerQuery): Promise<AppReferrerRow[]> {
    const binds: Bind[] = [q.appId, q.range.start, q.range.end];
    const where = ['app_id = ?1', 'date >= ?2', 'date <= ?3'];
    if (q.store) {
      binds.push(appStore(q.store));
      where.push(`store = ?${binds.length}`);
    }
    if (q.kind) {
      binds.push(allow([q.kind], ['web', 'app', 'utm'] as const, 'kind')[0]!);
      where.push(`kind = ?${binds.length}`);
    }
    const rows = await this.all<AppReferrerRow>(
      `SELECT store, kind, referrer, SUM(page_views) AS pageViews, SUM(downloads) AS downloads FROM app_referrers
       WHERE ${where.join(' AND ')} GROUP BY store, kind, referrer ORDER BY downloads DESC, pageViews DESC
       LIMIT ${Math.max(1, Math.min(q.limit ?? 100, 1_000))}`,
      ...binds,
    );
    return rows.map((r) => ({ ...r, pageViews: Number(r.pageViews) || 0, downloads: Number(r.downloads) || 0 }));
  }

  async queryAppRatings(q: AppRatingQuery): Promise<AppRatingRow[]> {
    const binds: Bind[] = [q.appId, q.range.start, q.range.end];
    const where = ['app_id = ?1', 'date >= ?2', 'date <= ?3'];
    if (q.store) {
      binds.push(appStore(q.store));
      where.push(`store = ?${binds.length}`);
    }
    if (q.territory) {
      binds.push(q.territory);
      where.push(`territory = ?${binds.length}`);
    }
    const rows = await this.all<{
      store: AppStore;
      date: string;
      territory: string;
      average: number | null;
      count: number | null;
      daily_average: number | null;
    }>(
      `SELECT store, date, territory, average, count, daily_average FROM app_ratings WHERE ${where.join(' AND ')}
       ORDER BY date ASC, store, territory LIMIT 10000`,
      ...binds,
    );
    return rows.map((r) => ({
      store: r.store,
      date: r.date,
      territory: r.territory,
      average: r.average,
      count: r.count,
      dailyAverage: r.daily_average,
    }));
  }

  async listAppReviews(q: AppReviewQuery): Promise<AppReviewRow[]> {
    const binds: Bind[] = [q.appId, q.range.start, q.range.end];
    const arg = (v: Bind) => {
      binds.push(v);
      return `?${binds.length}`;
    };
    const where = ['app_id = ?1', 'date >= ?2', 'date <= ?3'];
    if (q.store) where.push(`store = ${arg(appStore(q.store))}`);
    if (q.ratings?.length)
      where.push(`rating IN (SELECT value FROM json_each(${arg(JSON.stringify(q.ratings.map((r) => Math.round(r))))}))`);
    if (q.territory) where.push(`territory = ${arg(q.territory)}`);
    if (q.version) where.push(`version = ${arg(q.version)}`);
    if (q.contains) where.push(`instr(lower(COALESCE(title, '') || ' ' || COALESCE(body, '')), lower(${arg(q.contains)})) > 0`);
    const rows = await this.all<Record<string, string | number | null>>(
      `SELECT store, id, created_at, rating, title, body, territory, language, version, replied FROM app_reviews
       WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT ${Math.max(1, Math.min(q.limit ?? 50, 500))}`,
      ...binds,
    );
    return rows.map((r) => ({
      store: r.store as AppStore,
      id: String(r.id),
      createdAt: String(r.created_at),
      rating: Number(r.rating),
      title: (r.title as string | null) ?? null,
      body: (r.body as string | null) ?? null,
      territory: (r.territory as string | null) ?? null,
      language: (r.language as string | null) ?? null,
      version: (r.version as string | null) ?? null,
      replied: Number(r.replied) === 1,
    }));
  }

  async appReviewStats(appId: string, range: DateRange, store?: AppStore): Promise<AppReviewStat[]> {
    const binds: Bind[] = [appId, range.start, range.end];
    if (store) binds.push(appStore(store));
    const rows = await this.all<AppReviewStat>(
      `SELECT store, rating, COUNT(*) AS reviews FROM app_reviews WHERE app_id = ?1 AND date >= ?2 AND date <= ?3
       ${store ? 'AND store = ?4' : ''} GROUP BY store, rating ORDER BY store, rating`,
      ...binds,
    );
    return rows.map((r) => ({ store: r.store, rating: Number(r.rating), reviews: Number(r.reviews) }));
  }

  async queryAppVitals(q: AppVitalsQuery): Promise<AppVitalsRow[]> {
    const binds: Bind[] = [q.appId, q.range.start, q.range.end];
    const where = ['app_id = ?1', 'date >= ?2', 'date <= ?3'];
    if (q.store) {
      binds.push(appStore(q.store));
      where.push(`store = ?${binds.length}`);
    }
    const limit = Math.max(1, Math.min(q.limit ?? 500, 5_000));
    // Rates of several days or versions: weighted by each row's distinct users.
    const rate = (c: string) =>
      `SUM(CASE WHEN ${c} IS NOT NULL THEN ${c} * COALESCE(distinct_users, 1) END) / NULLIF(SUM(CASE WHEN ${c} IS NOT NULL THEN COALESCE(distinct_users, 1) END), 0)`;
    const metrics = `${rate('crash_rate')} AS crashRate, ${rate('user_perceived_crash_rate')} AS userPerceivedCrashRate,
      ${rate('anr_rate')} AS anrRate, ${rate('user_perceived_anr_rate')} AS userPerceivedAnrRate,
      SUM(distinct_users) AS distinctUsers, SUM(crashes) AS crashes, SUM(crash_devices) AS crashDevices`;
    const sql =
      q.groupBy === 'version'
        ? `SELECT store, version, ${metrics} FROM app_vitals WHERE ${where.join(' AND ')} GROUP BY store, version
           ORDER BY store, distinctUsers DESC, crashes DESC LIMIT ${limit}`
        : `SELECT store, date, ${metrics} FROM app_vitals WHERE ${where.join(' AND ')} AND version = '' GROUP BY store, date
           ORDER BY date ASC, store LIMIT ${limit}`;
    const rows = await this.all<Record<string, string | number | null>>(sql, ...binds);
    const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
    return rows.map((r) => ({
      store: r.store as AppStore,
      ...(q.groupBy === 'version' ? { version: String(r.version ?? '') } : { date: String(r.date) }),
      crashRate: n(r.crashRate),
      userPerceivedCrashRate: n(r.userPerceivedCrashRate),
      anrRate: n(r.anrRate),
      userPerceivedAnrRate: n(r.userPerceivedAnrRate),
      distinctUsers: n(r.distinctUsers),
      crashes: n(r.crashes),
      crashDevices: n(r.crashDevices),
    }));
  }

  async queryAppChartRanks(appId: string, range: DateRange): Promise<AppChartRankInput[]> {
    const rows = await this.all<AppChartRankInput>(
      `SELECT date, territory, chart, genre, rank FROM app_chart_ranks WHERE app_id = ?1 AND date >= ?2 AND date <= ?3
       ORDER BY date ASC, territory, chart, genre LIMIT 5000`,
      appId,
      range.start,
      range.end,
    );
    return rows.map((r) => ({ ...r, rank: r.rank === null ? null : Number(r.rank) }));
  }

  async appCoverage(appId?: string): Promise<AppDataCoverage[]> {
    const ids = appId
      ? [appId]
      : (
          await this.all<{ id: string }>(
            'SELECT DISTINCT app_id AS id FROM app_store_daily UNION SELECT DISTINCT app_id FROM app_reviews UNION SELECT DISTINCT app_id FROM app_vitals UNION SELECT DISTINCT app_id FROM app_ratings',
          )
        ).map((r) => r.id);
    const out: AppDataCoverage[] = [];
    const datasets: Array<[string, string, boolean]> = [
      ['store', 'app_store_daily', true],
      ['search_terms', 'app_search_terms', false],
      ['referrers', 'app_referrers', true],
      ['ratings', 'app_ratings', true],
      ['reviews', 'app_reviews', true],
      ['vitals', 'app_vitals', true],
    ];
    for (const id of ids) {
      const results = await this.db.batch(
        datasets.map(([, table, hasStore]) =>
          this.db
            .prepare(
              hasStore
                ? `SELECT store, MIN(date) AS first, MAX(date) AS last FROM ${table} WHERE app_id = ?1 GROUP BY store`
                : `SELECT 'play' AS store, MIN(date) AS first, MAX(date) AS last FROM ${table} WHERE app_id = ?1 HAVING COUNT(*) > 0`,
            )
            .bind(id),
        ),
      );
      datasets.forEach(([dataset], i) => {
        for (const r of (results[i]?.results ?? []) as Array<{ store: AppStore; first: string | null; last: string | null }>) {
          out.push({ appId: id, store: r.store, dataset, firstDate: r.first ?? null, lastDate: r.last ?? null });
        }
      });
    }
    return out;
  }

  async latestAppDate(appId: string, store?: AppStore): Promise<IsoDate | null> {
    const row = store
      ? await this.first<{ d: string | null }>(
          'SELECT MAX(date) AS d FROM app_store_daily WHERE app_id = ?1 AND store = ?2',
          appId,
          appStore(store),
        )
      : await this.first<{ d: string | null }>('SELECT MAX(date) AS d FROM app_store_daily WHERE app_id = ?1', appId);
    return row?.d ?? null;
  }
}
