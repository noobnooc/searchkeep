/**
 * Cloudflare adapter: GraphQL Analytics (AI crawler requests, Web Analytics
 * page loads and Web Vitals) and the Access API (used to check that the
 * deployment is protected correctly). Plain fetch; no Workers bindings.
 */
import {
  addDays,
  requestJson,
  SourceError,
  type CloudflareAnalyticsClient,
  type CloudflareCrawlerRow,
  type CloudflareRumRow,
  type CloudflareVitalsRow,
  type DateRange,
  type RangeResult,
} from '@searchkeep/core';

const API = 'https://api.cloudflare.com/client/v4';

export interface CloudflareClientOptions {
  apiToken: string;
  accountId?: string | null;
  fetch?: typeof fetch;
}

interface Envelope<T> {
  success: boolean;
  result: T;
  errors?: Array<{ code: number; message: string }>;
  result_info?: { page: number; total_pages: number };
}

function describe(status: number, body: string): string {
  try {
    const j = JSON.parse(body) as { errors?: Array<{ code: number; message: string }> };
    const e = j.errors?.[0];
    if (e) return `HTTP ${status}: ${e.message} (code ${e.code})`;
  } catch {
    // ignore
  }
  return `HTTP ${status}`;
}

/** The days of `range`, both ends included, as the [start, end) instants GraphQL expects. */
function rangeBounds(range: DateRange) {
  return { start: `${range.start}T00:00:00Z`, end: `${addDays(range.end, 1)}T00:00:00Z` };
}

/** Rows per GraphQL query (the datasets' maxPageSize). A full page means the range has more. */
const PAGE = 10_000;

/** GraphQL reports its rate limit as an error (code `budget`): 300 queries per 5 minutes per user. */
function isBudgetError(e: { message?: string; extensions?: { code?: string } }): boolean {
  return e.extensions?.code === 'budget' || /rate limit|budget depleted/i.test(e.message ?? '');
}

/** Web Vitals quantiles arrive in microseconds; -1 means "no sample". */
function micros(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n / 1000) : null;
}

function cls(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 1000) / 1000 : null;
}

export function createCloudflareClient(opts: CloudflareClientOptions): CloudflareAnalyticsClient & CloudflareAccessApi {
  const f = opts.fetch ?? fetch;
  const auth = { authorization: `Bearer ${opts.apiToken}` };

  async function graphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    const res = await requestJson<{ data?: T; errors?: Array<{ message: string; extensions?: { code?: string } }> | null }>(
      'cloudflare',
      `${API}/graphql`,
      { method: 'POST', headers: auth, body: { query, variables }, fetch: f },
      describe,
    );
    if (res.errors && res.errors.length > 0) {
      const limited = res.errors.some(isBudgetError);
      throw new SourceError(
        'cloudflare',
        200,
        `GraphQL: ${res.errors
          .map((e) => e.message)
          .join('; ')
          .slice(0, 300)}`,
        limited ? { rateLimited: true, retryAfterMs: 5 * 60_000 } : {},
      );
    }
    if (!res.data) throw new SourceError('cloudflare', 200, 'GraphQL: empty response');
    return res.data;
  }

  async function rest<T>(path: string): Promise<T> {
    const res = await requestJson<Envelope<T>>('cloudflare', `${API}${path}`, { headers: auth, fetch: f }, describe);
    if (!res.success) throw new SourceError('cloudflare', 200, res.errors?.[0]?.message ?? 'request failed');
    return res.result;
  }

  async function restAll<T>(path: string): Promise<T[]> {
    const out: T[] = [];
    for (let page = 1; page <= 20; page++) {
      const sep = path.includes('?') ? '&' : '?';
      const res = await requestJson<Envelope<T[]>>(
        'cloudflare',
        `${API}${path}${sep}page=${page}&per_page=50`,
        { headers: auth, fetch: f },
        describe,
      );
      if (!res.success) throw new SourceError('cloudflare', 200, res.errors?.[0]?.message ?? 'request failed');
      out.push(...(res.result ?? []));
      if (!res.result_info || res.result_info.page >= res.result_info.total_pages) break;
    }
    return out;
  }

  return {
    async crawlerRequests(zoneId, range, patterns): Promise<RangeResult<CloudflareCrawlerRow>> {
      const { start, end } = rangeBounds(range);
      const query = `query($zone: String!, $start: Time!, $end: Time!, $or: [ZoneHttpRequestsAdaptiveGroupsFilter_InputObject!]) {
        viewer { zones(filter: { zoneTag: $zone }) {
          httpRequestsAdaptiveGroups(limit: ${PAGE}, orderBy: [count_DESC],
            filter: { datetime_geq: $start, datetime_lt: $end, requestSource: "eyeball", OR: $or }) {
            count
            dimensions { date userAgent clientRequestHTTPHost clientRequestPath edgeResponseStatus }
          }
        } }
      }`;
      type Row = {
        count: number;
        dimensions: {
          date: string;
          userAgent: string;
          clientRequestHTTPHost: string;
          clientRequestPath: string;
          edgeResponseStatus: number;
        };
      };
      const data = await graphql<{ viewer: { zones: Array<{ httpRequestsAdaptiveGroups: Row[] }> } }>(query, {
        zone: zoneId,
        start,
        end,
        or: patterns.map((p) => ({ userAgent_like: `%${p}%` })),
      });
      const rows = data.viewer.zones[0]?.httpRequestsAdaptiveGroups ?? [];
      return {
        complete: rows.length < PAGE,
        rows: rows.map((r) => ({
          date: r.dimensions.date,
          userAgent: r.dimensions.userAgent,
          host: r.dimensions.clientRequestHTTPHost,
          path: r.dimensions.clientRequestPath,
          status: r.dimensions.edgeResponseStatus,
          requests: r.count,
        })),
      };
    },

    async webAnalytics(accountId, siteTag, range): Promise<RangeResult<CloudflareRumRow>> {
      const { start, end } = rangeBounds(range);
      const query = `query($acct: String!, $tag: String!, $start: Time!, $end: Time!) {
        viewer { accounts(filter: { accountTag: $acct }) {
          rumPageloadEventsAdaptiveGroups(limit: ${PAGE}, orderBy: [sum_visits_DESC],
            filter: { siteTag: $tag, datetime_geq: $start, datetime_lt: $end, bot: 0 }) {
            count
            sum { visits }
            dimensions { date requestHost requestPath refererHost }
          }
        } }
      }`;
      type Row = {
        count: number;
        sum: { visits: number };
        dimensions: { date: string; requestHost: string; requestPath: string; refererHost: string };
      };
      const data = await graphql<{ viewer: { accounts: Array<{ rumPageloadEventsAdaptiveGroups: Row[] }> } }>(query, {
        acct: accountId,
        tag: siteTag,
        start,
        end,
      });
      const rows = data.viewer.accounts[0]?.rumPageloadEventsAdaptiveGroups ?? [];
      return {
        complete: rows.length < PAGE,
        rows: rows.map((r) => ({
          date: r.dimensions.date,
          host: r.dimensions.requestHost,
          path: r.dimensions.requestPath,
          refererHost: r.dimensions.refererHost ?? '',
          visits: r.sum.visits,
          pageViews: r.count,
        })),
      };
    },

    async webVitals(accountId, siteTag, range): Promise<RangeResult<CloudflareVitalsRow>> {
      const { start, end } = rangeBounds(range);
      const query = `query($acct: String!, $tag: String!, $start: Time!, $end: Time!) {
        viewer { accounts(filter: { accountTag: $acct }) {
          rumWebVitalsEventsAdaptiveGroups(limit: ${PAGE}, orderBy: [count_DESC],
            filter: { siteTag: $tag, datetime_geq: $start, datetime_lt: $end }) {
            count
            quantiles { largestContentfulPaintP75 interactionToNextPaintP75 cumulativeLayoutShiftP75 }
            dimensions { date requestHost requestPath }
          }
        } }
      }`;
      type Row = {
        count: number;
        quantiles: { largestContentfulPaintP75: number; interactionToNextPaintP75: number; cumulativeLayoutShiftP75: number };
        dimensions: { date: string; requestHost: string; requestPath: string };
      };
      const data = await graphql<{ viewer: { accounts: Array<{ rumWebVitalsEventsAdaptiveGroups: Row[] }> } }>(query, {
        acct: accountId,
        tag: siteTag,
        start,
        end,
      });
      const rows = data.viewer.accounts[0]?.rumWebVitalsEventsAdaptiveGroups ?? [];
      return {
        complete: rows.length < PAGE,
        rows: rows.map((r) => ({
          date: r.dimensions.date,
          host: r.dimensions.requestHost,
          path: r.dimensions.requestPath,
          lcpP75: micros(r.quantiles.largestContentfulPaintP75),
          inpP75: micros(r.quantiles.interactionToNextPaintP75),
          clsP75: cls(r.quantiles.cumulativeLayoutShiftP75),
          samples: r.count,
        })),
      };
    },

    async verifyToken() {
      // User-owned tokens verify at /user/tokens/verify, account-owned ones at /accounts/:id/tokens/verify.
      const paths = ['/user/tokens/verify', ...(opts.accountId ? [`/accounts/${opts.accountId}/tokens/verify`] : [])];
      let lastMessage = 'Token could not be verified.';
      for (const p of paths) {
        try {
          const r = await rest<{ status: string }>(p);
          if (r.status === 'active') return { active: true };
          lastMessage = `Token status is "${r.status}".`;
        } catch (err) {
          lastMessage = err instanceof Error ? err.message : String(err);
        }
      }
      return { active: false, message: lastMessage };
    },

    async listZones(accountId) {
      const zones = await restAll<{ id: string; name: string; status?: string }>(`/zones?account.id=${encodeURIComponent(accountId)}`);
      return zones.filter((z) => z.status !== 'deleted').map((z) => ({ id: z.id, name: z.name }));
    },

    async listWebAnalyticsSites(accountId) {
      const sites = await restAll<{ site_tag: string; host?: string | null; ruleset?: { zone_name?: string | null } | null }>(
        `/accounts/${accountId}/rum/site_info/list`,
      );
      return sites.map((s) => ({ siteTag: s.site_tag, host: s.host ?? s.ruleset?.zone_name ?? null }));
    },

    async findAccessAppByAud(accountId, aud) {
      try {
        const apps = await rest<AccessApp[]>(`/accounts/${accountId}/access/apps?aud=${encodeURIComponent(aud)}`);
        const hit = (apps ?? []).find((a) => a.aud === aud);
        if (hit) return hit;
      } catch (err) {
        if (err instanceof SourceError && (err.status === 401 || err.status === 403)) throw err;
      }
      const all = await restAll<AccessApp>(`/accounts/${accountId}/access/apps`);
      return all.find((a) => a.aud === aud) ?? null;
    },

    async getAccessApp(accountId, appId) {
      return rest<AccessApp>(`/accounts/${accountId}/access/apps/${appId}`);
    },

    async listAccessAppPolicies(accountId, appId) {
      return restAll<AccessPolicy>(`/accounts/${accountId}/access/apps/${appId}/policies`);
    },

    async getReusablePolicy(accountId, policyId) {
      return rest<AccessPolicy>(`/accounts/${accountId}/access/policies/${policyId}`);
    },
  };
}

// ----------------------------------------------------------------------------
// Access API
// ----------------------------------------------------------------------------

export type AccessRule = Record<string, Record<string, unknown> | undefined>;

export interface AccessPolicy {
  id: string;
  name?: string;
  decision: 'allow' | 'deny' | 'non_identity' | 'bypass' | string;
  include?: AccessRule[];
  exclude?: AccessRule[];
  require?: AccessRule[];
  precedence?: number;
}

export interface AccessApp {
  id: string;
  aud: string;
  name?: string;
  domain?: string;
  type?: string;
  oauth_configuration?: { enabled?: boolean; dynamic_client_registration?: { enabled?: boolean } } | null;
  policies?: Array<Partial<AccessPolicy> & { id: string }>;
}

export interface CloudflareAccessApi {
  findAccessAppByAud(accountId: string, aud: string): Promise<AccessApp | null>;
  getAccessApp(accountId: string, appId: string): Promise<AccessApp>;
  listAccessAppPolicies(accountId: string, appId: string): Promise<AccessPolicy[]>;
  getReusablePolicy(accountId: string, policyId: string): Promise<AccessPolicy>;
}

/** Managed OAuth counts as enabled when the object exists and `enabled` is not false. */
export function managedOAuthEnabled(app: AccessApp): boolean {
  const c = app.oauth_configuration;
  return Boolean(c) && c!.enabled !== false;
}

/**
 * Reasons an app's policies let in more than specific people. Allow/bypass
 * policies whose include rules match everyone, a public email domain, any
 * user of an identity provider, any IP, or a whole country are too broad.
 */
export function broadPolicyReasons(policies: AccessPolicy[], publicDomains: string[]): string[] {
  const reasons: string[] = [];
  const pub = new Set(publicDomains.map((d) => d.toLowerCase()));
  const active = policies.filter((p) => p.decision === 'allow' || p.decision === 'bypass' || p.decision === 'non_identity');
  if (active.length === 0) reasons.push('No Allow policy is attached to the application.');
  for (const p of active) {
    const name = p.name ? `"${p.name}"` : p.id;
    if (p.decision === 'bypass') {
      reasons.push(`Policy ${name} uses Bypass, which skips login.`);
      continue;
    }
    if (p.decision === 'non_identity') {
      reasons.push(`Policy ${name} is a Service Auth (non-identity) policy; use Allow with your email.`);
      continue;
    }
    for (const rule of p.include ?? []) {
      if ('everyone' in rule) reasons.push(`Policy ${name} includes Everyone.`);
      const dom = rule.email_domain?.domain;
      if (typeof dom === 'string' && pub.has(dom.toLowerCase())) reasons.push(`Policy ${name} allows every @${dom} address.`);
      if ('login_method' in rule) reasons.push(`Policy ${name} allows anyone who can sign in with an identity provider.`);
      if ('auth_method' in rule) reasons.push(`Policy ${name} allows by authentication method only.`);
      const ip = rule.ip?.ip;
      if (typeof ip === 'string' && /\/0$/.test(ip)) reasons.push(`Policy ${name} allows every IP address.`);
      if ('geo' in rule) reasons.push(`Policy ${name} allows a whole country.`);
      if ('any_valid_service_token' in rule) reasons.push(`Policy ${name} allows any service token.`);
    }
    if ((p.include ?? []).length === 0) reasons.push(`Policy ${name} has no include rules.`);
  }
  return [...new Set(reasons)];
}

export { SourceError };
