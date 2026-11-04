import type { SiteConfig } from './types.js';

/** Raw environment: Worker Secrets, process.env, etc. */
export type RawEnv = Record<string, unknown>;

export interface SearchkeepConfig {
  sites: SiteConfig[];
  access: {
    teamDomain: string | null;
    aud: string | null;
  };
  cloudflare: {
    accountId: string | null;
    apiToken: string | null;
  };
  gsc: {
    clientEmail: string | null;
    privateKey: string | null;
    /** Max query × page rows pulled per day. */
    rowsPerDay: number;
  };
  bing: {
    apiKey: string | null;
  };
  brandRegex: string | null;
  enableWrites: boolean;
  sync: {
    /** Max rows written per UTC day across all backfill work (D1 free tier: 100k). */
    dailyWriteBudget: number;
    /** Max outbound API calls per sync invocation (Workers free plan: 50 subrequests). */
    maxCallsPerRun: number;
    /** How many months of GSC history to backfill (GSC keeps 16). */
    backfillMonths: number;
  };
  /** Problems found while parsing; surfaced by setup_status, never thrown. */
  errors: string[];
}

const SITE_ID_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;

function str(env: RawEnv, key: string): string | null {
  const v = env[key];
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t === '' ? null : t;
}

function int(env: RawEnv, key: string, fallback: number, min: number, max: number): number {
  const v = str(env, key);
  if (v === null) return fallback;
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

const HOST_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,62}$/;

/** Accepts `example.com`, `https://www.example.com/path` etc. and returns the bare hostname. */
export function normalizeDomain(input: string): string {
  let d = input.trim().toLowerCase();
  d = d.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  d = d.split(/[/?#]/)[0] ?? '';
  d = d.replace(/:\d+$/, '').replace(/\.$/, '');
  return d;
}

export function siteIdFromDomain(domain: string): string {
  return domain
    .replace(/^www\./, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 63);
}

/**
 * Validates one site definition (from the SITES secret or the dashboard).
 * Returns the normalized site or a human-readable error.
 */
export function validateSite(input: unknown, label = 'site'): { site: SiteConfig } | { error: string } {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return { error: `${label} must be an object.` };
  const o = input as Record<string, unknown>;
  const domain = typeof o.domain === 'string' ? normalizeDomain(o.domain) : '';
  if (!domain || !HOST_RE.test(domain)) return { error: `${label}.domain must be a hostname like "example.com".` };
  const id = typeof o.id === 'string' && o.id.trim() !== '' ? o.id.trim() : siteIdFromDomain(domain);
  if (!SITE_ID_RE.test(id)) return { error: `${label}.id "${id}" must use lowercase letters, digits and dashes.` };
  const opt = (k: string) => (typeof o[k] === 'string' && (o[k] as string).trim() !== '' ? (o[k] as string).trim() : undefined);
  const site: SiteConfig = { id, domain };
  const gscProperty = opt('gscProperty');
  if (gscProperty) {
    if (!/^sc-domain:[a-z0-9.-]+$/i.test(gscProperty) && !/^https?:\/\/[^\s]+\/$/i.test(gscProperty)) {
      return { error: `${label}.gscProperty must look like "sc-domain:example.com" or "https://example.com/".` };
    }
    site.gscProperty = gscProperty;
  }
  const bingSiteUrl = opt('bingSiteUrl');
  if (bingSiteUrl) {
    const url = /^https?:\/\//i.test(bingSiteUrl) ? bingSiteUrl : `https://${normalizeDomain(bingSiteUrl)}/`;
    if (!/^https?:\/\/[^\s/]+(\/[^\s]*)?$/i.test(url)) return { error: `${label}.bingSiteUrl must be a URL like "https://example.com/".` };
    site.bingSiteUrl = url.endsWith('/') ? url : `${url}/`;
  }
  const zone = opt('cloudflareZoneId');
  if (zone) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(zone))
      return { error: `${label}.cloudflareZoneId must be the zone ID (32 characters, from the zone's Overview page).` };
    site.cloudflareZoneId = zone;
  }
  const tag = opt('webAnalyticsSiteTag');
  if (tag) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(tag))
      return { error: `${label}.webAnalyticsSiteTag must be the Web Analytics site tag (32 characters).` };
    site.webAnalyticsSiteTag = tag;
  }
  const brand = opt('brandRegex');
  if (brand) {
    if (!compileBrandRegex(brand)) return { error: `${label}.brandRegex is not a valid regular expression.` };
    site.brandRegex = brand;
  }
  return { site };
}

export function parseSites(raw: string | null, errors: string[]): SiteConfig[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    errors.push('SITES is not valid JSON.');
    return [];
  }
  if (!Array.isArray(parsed)) {
    errors.push('SITES must be a JSON array.');
    return [];
  }
  const out: SiteConfig[] = [];
  const seen = new Set<string>();
  parsed.forEach((item, i) => {
    const res = validateSite(item, `SITES[${i}]`);
    if ('error' in res) {
      errors.push(res.error);
      return;
    }
    if (seen.has(res.site.id)) {
      errors.push(`SITES[${i}].id "${res.site.id}" is duplicated.`);
      return;
    }
    seen.add(res.site.id);
    out.push({ ...res.site, origin: 'secret' });
  });
  return out;
}

/**
 * Adds the sites managed in the dashboard (stored in the database) to the
 * configuration. Sites from the SITES secret win on id conflicts.
 */
export function withStoredSites(config: SearchkeepConfig, stored: SiteConfig[]): SearchkeepConfig {
  const ids = new Set(config.sites.map((s) => s.id));
  const extra = stored.filter((s) => !ids.has(s.id)).map((s) => ({ ...s, origin: 'dashboard' as const }));
  if (extra.length === 0) return config;
  return { ...config, sites: [...config.sites, ...extra] };
}

export function compileBrandRegex(source: string | null | undefined): RegExp | null {
  if (!source) return null;
  try {
    return new RegExp(source, 'i');
  } catch {
    return null;
  }
}

/** PEM keys pasted into secrets often arrive with literal `\n`. */
function normalizePem(key: string | null): string | null {
  if (!key) return null;
  return key.includes('\\n') ? key.replace(/\\n/g, '\n') : key;
}

export function loadConfig(env: RawEnv): SearchkeepConfig {
  const errors: string[] = [];
  const sites = parseSites(str(env, 'SITES'), errors);
  const brandRegex = str(env, 'BRAND_REGEX');
  if (brandRegex && !compileBrandRegex(brandRegex)) errors.push('BRAND_REGEX is not a valid regular expression.');
  const teamDomain = str(env, 'ACCESS_TEAM_DOMAIN');
  return {
    sites,
    access: {
      teamDomain: teamDomain ? teamDomain.replace(/^https?:\/\//, '').replace(/\/+$/, '') : null,
      aud: str(env, 'ACCESS_AUD'),
    },
    cloudflare: {
      accountId: str(env, 'CLOUDFLARE_ACCOUNT_ID'),
      apiToken: str(env, 'CLOUDFLARE_API_TOKEN'),
    },
    gsc: {
      clientEmail: str(env, 'GSC_CLIENT_EMAIL'),
      privateKey: normalizePem(str(env, 'GSC_PRIVATE_KEY')),
      rowsPerDay: int(env, 'GSC_ROWS_PER_DAY', 2500, 100, 100_000),
    },
    bing: { apiKey: str(env, 'BING_API_KEY') },
    brandRegex: brandRegex && compileBrandRegex(brandRegex) ? brandRegex : null,
    enableWrites: str(env, 'ENABLE_WRITES')?.toLowerCase() === 'true',
    sync: {
      dailyWriteBudget: int(env, 'SYNC_DAILY_WRITE_BUDGET', 80_000, 1_000, 100_000_000),
      maxCallsPerRun: int(env, 'SYNC_MAX_CALLS_PER_RUN', 20, 5, 900),
      backfillMonths: int(env, 'GSC_BACKFILL_MONTHS', 16, 0, 16),
    },
    errors,
  };
}

export function brandRegexFor(config: SearchkeepConfig, site: SiteConfig): string | null {
  return site.brandRegex ?? config.brandRegex;
}

export function findSite(config: SearchkeepConfig, siteId?: string): SiteConfig {
  if (config.sites.length === 0)
    throw new SearchkeepError(
      'not_configured',
      'No sites configured yet. Add one in the dashboard (Settings → Sites) or set the SITES secret.',
    );
  if (!siteId) {
    if (config.sites.length === 1) return config.sites[0]!;
    throw new SearchkeepError(
      'bad_request',
      `Several sites are configured; pass "site" (one of: ${config.sites.map((s) => s.id).join(', ')}).`,
    );
  }
  const site = config.sites.find((s) => s.id === siteId || s.domain === siteId.toLowerCase());
  if (!site) throw new SearchkeepError('not_found', `Unknown site "${siteId}". Known: ${config.sites.map((s) => s.id).join(', ')}.`);
  return site;
}

export type ErrorCode = 'bad_request' | 'not_found' | 'not_configured' | 'forbidden' | 'upstream' | 'writes_disabled';

export class SearchkeepError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'SearchkeepError';
  }
}
