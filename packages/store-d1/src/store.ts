import type {
  AiCitationInput,
  BreakdownInput,
  CrawlIssueInput,
  CrawlerQuery,
  CrawlerRequestInput,
  CrawlerRow,
  DataCoverage,
  DateRange,
  IsoDate,
  PageCount,
  PerformanceQuery,
  PerformanceRow,
  ReferralQuery,
  ReferralRow,
  SearchFactInput,
  SearchSource,
  SiteConfig,
  SitemapRecord,
  Store,
  SyncRunRecord,
  WebAnalyticsInput,
  WebVitalsInput,
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
const PERF_DIMS = ['date', 'week', 'month', 'query', 'page', 'country', 'device'] as const;
const PERF_ORDER = ['clicks', 'impressions', 'ctr', 'position', 'date'] as const;
const CRAWLER_GROUPS = ['crawler', 'operator', 'purpose', 'path', 'status', 'date'] as const;
const REFERRAL_GROUPS = ['path', 'refererHost', 'date'] as const;

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
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

  async writeSearchFacts(siteId: string, source: SearchSource, rows: SearchFactInput[]): Promise<number> {
    if (rows.length === 0) return 0;
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
        .bind(siteId, source, JSON.stringify(group)),
    );
    return dims + (await this.batch(facts));
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

  async writeCrawlerRequests(siteId: string, rows: CrawlerRequestInput[]): Promise<number> {
    if (rows.length === 0) return 0;
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
              `INSERT INTO ai_crawler_requests (site_id, date, crawler, operator, purpose, page_id, status, requests)
               SELECT ?1, j.value->>'d', j.value->>'cr', j.value->>'op', j.value->>'pu', ${D1Store.pageIdExpr()}, j.value->>'s', j.value->>'n'
               FROM json_each(?2) j WHERE true
               ON CONFLICT (site_id, date, crawler, page_id, status) DO UPDATE SET requests = excluded.requests
               WHERE ai_crawler_requests.requests != excluded.requests`,
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
    await this.batch(
      chunks(flags.map((f) => ({ id: f.id, b: f.isBrand ? 1 : 0 }))).map((group) =>
        this.db
          .prepare(
            "UPDATE queries SET is_brand = j.value->>'b', brand_version = ?2 FROM json_each(?3) j WHERE queries.site_id = ?1 AND queries.id = j.value->>'id'",
          )
          .bind(siteId, version, JSON.stringify(group)),
      ),
    );
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
    const brand = f.brand ?? 'all';
    const hasQuery = dims.includes('query') || Boolean(f.queryContains) || brand !== 'all';
    const hasPage = dims.includes('page') || Boolean(f.pageContains);
    if (breakdown && (hasQuery || hasPage)) throw new Error('country/device cannot be combined with query/page');

    const binds: Bind[] = [q.siteId, q.source, q.range.start, q.range.end];
    const where: string[] = ['f.site_id = ?1', 'f.source = ?2', 'f.date >= ?3', 'f.date <= ?4'];
    const joins: string[] = [];
    const table = breakdown ? 'search_breakdowns' : 'search_facts';
    if (!breakdown) {
      const kinds =
        hasQuery && hasPage ? ['query_page'] : hasQuery ? ['query_page', 'query'] : hasPage ? ['query_page', 'page'] : ['total'];
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
    };
    for (const d of dims) {
      select.push(`${dimExpr[d]} AS ${d}`);
      group.push(dimExpr[d]!);
    }
    select.push(
      'SUM(f.clicks) AS clicks',
      'SUM(f.impressions) AS impressions',
      'SUM(f.position_sum) AS position_sum',
      'SUM(CASE WHEN f.position_sum IS NULL THEN 0 ELSE f.impressions END) AS position_impressions',
    );
    const having: string[] = [];
    const h = q.having ?? {};
    const posExpr = 'SUM(f.position_sum) / NULLIF(SUM(CASE WHEN f.position_sum IS NULL THEN 0 ELSE f.impressions END), 0)';
    if (h.minImpressions !== undefined) having.push(`SUM(f.impressions) >= ${arg(h.minImpressions)}`);
    if (h.minClicks !== undefined) having.push(`SUM(f.clicks) >= ${arg(h.minClicks)}`);
    if (h.minPosition !== undefined) having.push(`${posExpr} >= ${arg(h.minPosition)}`);
    if (h.maxPosition !== undefined) having.push(`${posExpr} <= ${arg(h.maxPosition)}`);

    const dir = q.order === 'asc' ? 'ASC' : 'DESC';
    const timeDim = dims.find((d) => d === 'date' || d === 'week' || d === 'month');
    const orderCol =
      q.orderBy === 'date'
        ? (timeDim ?? null)
        : q.orderBy === 'ctr'
          ? 'CAST(SUM(f.clicks) AS REAL) / NULLIF(SUM(f.impressions), 0)'
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
    const sql = `SELECT ${[...select, 'SUM(c.requests) AS requests'].join(', ')} FROM ai_crawler_requests c
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
      const [gsc, bing, crawl, rum, cites] = await this.db.batch([
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
}
