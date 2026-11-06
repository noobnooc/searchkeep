/**
 * Google Search Console adapter. Authenticates as a service account with a
 * self-signed RS256 JWT (WebCrypto) exchanged for an access token. Also reads
 * the site's own sitemaps (plain GET) for the index coverage snapshot.
 */
import {
  requestJson,
  SourceError,
  type GscClient,
  type GscRow,
  type GscSearchAnalyticsRequest,
  type GscUrlInspection,
  type RichResultIssue,
  type SitemapRecord,
} from '@searchkeep/core';

export { createSitemapReader, parseSitemap } from './sitemaps.js';

export const GSC_READONLY_SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';
export const GSC_FULL_SCOPE = 'https://www.googleapis.com/auth/webmasters';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API = 'https://www.googleapis.com/webmasters/v3';
const INSPECT_URL = 'https://searchconsole.googleapis.com/v1/urlInspection/index:inspect';

export interface GscClientOptions {
  clientEmail: string;
  privateKey: string;
  /** Request the full scope (needed only for submitting sitemaps). */
  allowWrites?: boolean;
  fetch?: typeof fetch;
}

/** Access tokens are cached per isolate; they live one hour. */
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

function b64url(bytes: ArrayBuffer | Uint8Array | string): string {
  const arr = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = '';
  for (const b of arr) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const body = pem
    .replace(/\\n/g, '\n')
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----/, '')
    .replace(/-----END [A-Z ]*PRIVATE KEY-----/, '')
    .replace(/\s+/g, '');
  let der: Uint8Array<ArrayBuffer>;
  try {
    const bin = atob(body);
    der = new Uint8Array(new ArrayBuffer(bin.length));
    for (let i = 0; i < bin.length; i++) der[i] = bin.charCodeAt(i);
  } catch {
    throw new SourceError('gsc', 0, 'GSC_PRIVATE_KEY is not a valid PEM private key');
  }
  try {
    return await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  } catch {
    throw new SourceError(
      'gsc',
      0,
      'GSC_PRIVATE_KEY could not be imported (expected the PKCS#8 "private_key" from the service-account JSON)',
    );
  }
}

export async function signServiceAccountJwt(
  clientEmail: string,
  privateKey: string,
  scope: string,
  nowSec = Math.floor(Date.now() / 1000),
): Promise<string> {
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(JSON.stringify({ iss: clientEmail, scope, aud: TOKEN_URL, iat: nowSec, exp: nowSec + 3600 }));
  const key = await importPrivateKey(privateKey);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${header}.${claims}`));
  return `${header}.${claims}.${b64url(sig)}`;
}

export function createGscClient(opts: GscClientOptions): GscClient {
  const f = opts.fetch ?? fetch;
  const scope = opts.allowWrites ? GSC_FULL_SCOPE : GSC_READONLY_SCOPE;

  async function token(): Promise<string> {
    const key = `${opts.clientEmail}|${scope}`;
    const cached = tokenCache.get(key);
    if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
    const assertion = await signServiceAccountJwt(opts.clientEmail, opts.privateKey, scope);
    const res = await f(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString(),
    });
    const text = await res.text();
    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try {
        const j = JSON.parse(text) as { error?: string; error_description?: string };
        detail = `${j.error ?? detail}${j.error_description ? `: ${j.error_description}` : ''}`;
      } catch {
        // ignore
      }
      throw new SourceError('gsc', res.status, `token exchange failed (${detail})`);
    }
    const j = JSON.parse(text) as { access_token: string; expires_in: number };
    tokenCache.set(key, { token: j.access_token, expiresAt: Date.now() + j.expires_in * 1000 });
    return j.access_token;
  }

  async function call<T>(url: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
    return requestJson<T>('gsc', url, { ...init, headers: { authorization: `Bearer ${await token()}` }, fetch: f });
  }

  const site = (property: string) => `${API}/sites/${encodeURIComponent(property)}`;

  return {
    async searchAnalytics(req: GscSearchAnalyticsRequest): Promise<GscRow[]> {
      const body = {
        startDate: req.startDate,
        endDate: req.endDate,
        dimensions: req.dimensions,
        rowLimit: Math.min(25_000, Math.max(1, req.rowLimit)),
        startRow: req.startRow ?? 0,
        dataState: req.dataState ?? 'final',
        type: req.type ?? 'web',
        ...(req.searchAppearance
          ? {
              dimensionFilterGroups: [
                { groupType: 'and', filters: [{ dimension: 'searchAppearance', operator: 'equals', expression: req.searchAppearance }] },
              ],
            }
          : {}),
      };
      const res = await call<{ rows?: GscRow[] }>(`${site(req.property)}/searchAnalytics/query`, { method: 'POST', body });
      return res?.rows ?? [];
    },

    async listSitemaps(property: string): Promise<SitemapRecord[]> {
      interface Raw {
        path: string;
        lastSubmitted?: string;
        lastDownloaded?: string;
        isPending?: boolean;
        errors?: string | number;
        warnings?: string | number;
        contents?: Array<{ type?: string; submitted?: string | number; indexed?: string | number }>;
      }
      const res = await call<{ sitemap?: Raw[] }>(`${site(property)}/sitemaps`);
      return (res?.sitemap ?? []).map((s) => {
        const contents = s.contents ?? [];
        const vals = contents.map((c) => c.submitted).filter((v) => v !== undefined);
        return {
          path: s.path,
          lastSubmitted: s.lastSubmitted ?? null,
          lastDownloaded: s.lastDownloaded ?? null,
          isPending: Boolean(s.isPending),
          errors: Number(s.errors ?? 0),
          warnings: Number(s.warnings ?? 0),
          submitted: vals.length ? vals.reduce<number>((t, v) => t + Number(v), 0) : null,
          // `contents[].indexed` is "Deprecated; do not use" and arrives as 0: the index coverage snapshot replaces it.
          indexed: null,
        };
      });
    },

    async submitSitemap(property: string, sitemapUrl: string): Promise<void> {
      if (!opts.allowWrites) throw new SourceError('gsc', 0, 'writes are disabled');
      await call<unknown>(`${site(property)}/sitemaps/${encodeURIComponent(sitemapUrl)}`, { method: 'PUT', body: '' });
    },

    async inspectUrl(property: string, url: string): Promise<GscUrlInspection> {
      interface Raw {
        inspectionResult?: {
          inspectionResultLink?: string;
          indexStatusResult?: Record<string, string | undefined>;
          mobileUsabilityResult?: { verdict?: string };
          richResultsResult?: {
            verdict?: string;
            detectedItems?: Array<{
              richResultType?: string;
              items?: Array<{ name?: string; issues?: Array<{ issueMessage?: string; severity?: string }> }>;
            }>;
          };
        };
      }
      const res = await call<Raw>(INSPECT_URL, { method: 'POST', body: { inspectionUrl: url, siteUrl: property } });
      const r = res?.inspectionResult ?? {};
      const i = r.indexStatusResult ?? {};
      return {
        url,
        verdict: i.verdict ?? null,
        coverageState: i.coverageState ?? null,
        indexingState: i.indexingState ?? null,
        robotsTxtState: i.robotsTxtState ?? null,
        pageFetchState: i.pageFetchState ?? null,
        lastCrawlTime: i.lastCrawlTime ?? null,
        googleCanonical: i.googleCanonical ?? null,
        userCanonical: i.userCanonical ?? null,
        crawledAs: i.crawledAs ?? null,
        mobileUsabilityVerdict: r.mobileUsabilityResult?.verdict ?? null,
        richResultsVerdict: r.richResultsResult?.verdict ?? null,
        ...richResults(r.richResultsResult?.detectedItems ?? []),
        inspectionResultLink: r.inspectionResultLink ?? null,
      };
    },

    async listProperties() {
      const res = await call<{ siteEntry?: Array<{ siteUrl: string; permissionLevel: string }> }>(`${API}/sites`);
      return res?.siteEntry ?? [];
    },
  };
}

/** Detected rich result types and their issues, one entry per distinct type, severity and message. */
function richResults(
  detected: Array<{ richResultType?: string; items?: Array<{ issues?: Array<{ issueMessage?: string; severity?: string }> }> }>,
): { richResultTypes: string[]; richResultIssues: RichResultIssue[] } {
  const types = new Set<string>();
  const issues = new Map<string, RichResultIssue>();
  for (const d of detected) {
    const type = d.richResultType ?? 'Unknown';
    types.add(type);
    for (const item of d.items ?? []) {
      for (const i of item.issues ?? []) {
        const issue = { type, severity: i.severity ?? 'SEVERITY_UNSPECIFIED', message: (i.issueMessage ?? '').slice(0, 300) };
        issues.set(`${issue.type}\u0000${issue.severity}\u0000${issue.message}`, issue);
      }
    }
  }
  return { richResultTypes: [...types], richResultIssues: [...issues.values()] };
}

/** Test helper. */
export function clearGscTokenCache(): void {
  tokenCache.clear();
}
