/**
 * Bing Webmaster Tools adapter (JSON API). The API returns all data it holds on
 * every call, in weekly buckets for query/page stats; there are no date params.
 * Bing AI Performance (Copilot citations) has no API yet — it is imported from
 * its CSV export instead (see the dashboard).
 */
import { requestJson, SourceError, toIsoDate, type BingClient, type BingCrawlIssue, type BingPageStat, type BingQueryStat, type BingTrafficStat } from '@searchkeep/core';

const API = 'https://ssl.bing.com/webmaster/api.svc/json';

export interface BingClientOptions {
  apiKey: string;
  fetch?: typeof fetch;
}

/** Parses `/Date(1316156400000-0700)/` into the calendar date in that offset. */
export function parseBingDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const m = /\/Date\((-?\d+)([+-]\d{4})?\)\//.exec(value);
  if (!m) {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : toIsoDate(d);
  }
  let ms = Number(m[1]);
  if (m[2]) {
    const sign = m[2][0] === '-' ? -1 : 1;
    const mins = Number(m[2].slice(1, 3)) * 60 + Number(m[2].slice(3, 5));
    ms += sign * mins * 60_000;
  }
  return toIsoDate(new Date(ms));
}

/** Bing `CrawlIssues` flags enum. */
const CRAWL_ISSUE_FLAGS: Array<[number, string]> = [
  [1, 'Code301'],
  [2, 'Code302'],
  [4, 'Code4xx'],
  [8, 'Code5xx'],
  [16, 'BlockedByRobotsTxt'],
  [32, 'ContainsMalware'],
  [64, 'ImportantUrlBlockedByRobotsTxt'],
  [128, 'DnsErrors'],
  [256, 'TimeOutErrors'],
];

export function crawlIssueNames(flags: unknown): string[] {
  if (typeof flags === 'string') return flags.split(/[,\s]+/).filter(Boolean);
  const n = Number(flags);
  if (!Number.isFinite(n) || n === 0) return ['Unknown'];
  const names = CRAWL_ISSUE_FLAGS.filter(([bit]) => (n & bit) !== 0).map(([, name]) => name);
  return names.length ? names : [`Flags${n}`];
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function pos(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function createBingClient(opts: BingClientOptions): BingClient {
  const f = opts.fetch ?? fetch;

  async function call<T>(method: string, params: Record<string, string> = {}): Promise<T[]> {
    const qs = new URLSearchParams({ ...params, apikey: opts.apiKey });
    const res = await requestJson<{ d?: T[] | T }>('bing', `${API}/${method}?${qs.toString()}`, { fetch: f }, (status, body) => {
      try {
        const j = JSON.parse(body) as { Message?: string; ErrorCode?: number };
        if (j.Message) return `HTTP ${status}: ${j.Message}${j.ErrorCode !== undefined ? ` (code ${j.ErrorCode})` : ''}`;
      } catch {
        // ignore
      }
      return status === 401 || status === 403 ? `HTTP ${status}: check BING_API_KEY` : `HTTP ${status}`;
    });
    const d = res?.d;
    if (d === undefined || d === null) return [];
    return Array.isArray(d) ? d : [d];
  }

  return {
    async getQueryStats(siteUrl): Promise<BingQueryStat[]> {
      const rows = await call<Record<string, unknown>>('GetQueryStats', { siteUrl });
      return rows.flatMap((r) => {
        const date = parseBingDate(r.Date);
        if (!date || typeof r.Query !== 'string') return [];
        return [{ date, query: r.Query, clicks: num(r.Clicks), impressions: num(r.Impressions), avgImpressionPosition: pos(r.AvgImpressionPosition) }];
      });
    },

    async getPageStats(siteUrl): Promise<BingPageStat[]> {
      const rows = await call<Record<string, unknown>>('GetPageStats', { siteUrl });
      return rows.flatMap((r) => {
        const date = parseBingDate(r.Date);
        if (!date || typeof r.Query !== 'string') return [];
        return [{ date, page: r.Query, clicks: num(r.Clicks), impressions: num(r.Impressions), avgImpressionPosition: pos(r.AvgImpressionPosition) }];
      });
    },

    async getRankAndTrafficStats(siteUrl): Promise<BingTrafficStat[]> {
      const rows = await call<Record<string, unknown>>('GetRankAndTrafficStats', { siteUrl });
      return rows.flatMap((r) => {
        const date = parseBingDate(r.Date);
        return date ? [{ date, clicks: num(r.Clicks), impressions: num(r.Impressions) }] : [];
      });
    },

    async getCrawlIssues(siteUrl): Promise<BingCrawlIssue[]> {
      const rows = await call<Record<string, unknown>>('GetCrawlIssues', { siteUrl });
      return rows.flatMap((r) =>
        typeof r.Url === 'string'
          ? crawlIssueNames(r.Issues).map((issue) => ({ url: r.Url as string, issue, httpCode: r.HttpCode == null ? null : num(r.HttpCode) }))
          : [],
      );
    },

    async getUserSites() {
      const rows = await call<Record<string, unknown>>('GetUserSites');
      return rows.filter((r) => typeof r.Url === 'string').map((r) => ({ url: r.Url as string, verified: Boolean(r.IsVerified) }));
    },
  };
}

export { SourceError };
