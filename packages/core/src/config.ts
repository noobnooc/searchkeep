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
    if (typeof item !== 'object' || item === null) {
      errors.push(`SITES[${i}] must be an object.`);
      return;
    }
    const o = item as Record<string, unknown>;
    const domain = typeof o.domain === 'string' ? o.domain.trim().toLowerCase() : '';
    if (!domain || domain.includes('/')) {
      errors.push(`SITES[${i}].domain must be a bare hostname like "example.com".`);
      return;
    }
    const id =
      typeof o.id === 'string' && o.id.trim() !== ''
        ? o.id.trim()
        : domain.replace(/^www\./, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    if (!SITE_ID_RE.test(id)) {
      errors.push(`SITES[${i}].id "${id}" must use lowercase letters, digits and dashes.`);
      return;
    }
    if (seen.has(id)) {
      errors.push(`SITES[${i}].id "${id}" is duplicated.`);
      return;
    }
    seen.add(id);
    const opt = (k: string) => (typeof o[k] === 'string' && (o[k] as string).trim() !== '' ? (o[k] as string).trim() : undefined);
    const site: SiteConfig = { id, domain };
    const gscProperty = opt('gscProperty');
    if (gscProperty) site.gscProperty = gscProperty;
    const bingSiteUrl = opt('bingSiteUrl');
    if (bingSiteUrl) site.bingSiteUrl = bingSiteUrl;
    const zone = opt('cloudflareZoneId');
    if (zone) site.cloudflareZoneId = zone;
    const tag = opt('webAnalyticsSiteTag');
    if (tag) site.webAnalyticsSiteTag = tag;
    const brand = opt('brandRegex');
    if (brand) {
      if (compileBrandRegex(brand)) site.brandRegex = brand;
      else errors.push(`SITES[${i}].brandRegex is not a valid regular expression.`);
    }
    out.push(site);
  });
  return out;
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
  if (config.sites.length === 0) throw new SearchkeepError('not_configured', 'No sites configured. Set the SITES secret.');
  if (!siteId) {
    if (config.sites.length === 1) return config.sites[0]!;
    throw new SearchkeepError('bad_request', `Several sites are configured; pass "site" (one of: ${config.sites.map((s) => s.id).join(', ')}).`);
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
