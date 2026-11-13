/**
 * Apple Ads Platform API adapter (read-only): the ad accounts and roles the credentials see, the
 * App Store campaigns that promote an app, their search term reports, and the app's impression
 * share per search term with Apple's search popularity. OAuth 2 client credentials: a client secret
 * (an ES256 JWT signed with WebCrypto, no dependency) is exchanged at appleid.apple.com for an
 * access token, cached per isolate for its lifetime. Nothing is created, changed or deleted.
 */
import {
  requestJson,
  SourceError,
  type AppleAdsClient,
  type AppleAdsImpressionShareRow,
  type AppleAdsSearchTermRow,
  type DateRange,
  type IsoDate,
} from '@searchkeep/core';

export const APPLE_ADS_API = 'https://api.ads.apple.com/v1';
const TOKEN_URL = 'https://appleid.apple.com/auth/oauth2/token';
/** Apple allows client secrets for up to 180 days; one is made per token request, so a short one is enough. */
const SECRET_SECONDS = 3600;
const MAX_PAGES = 10;
/** Roles that may change campaigns: the probe asks for a read-only one instead. */
export const APPLE_ADS_WRITE_ROLES = ['Admin', 'API Account Manager', 'Limited Access: API Read & Write'];

export interface AppleAdsClientOptions {
  clientId: string;
  teamId: string;
  keyId: string;
  /** PEM private key: `EC PRIVATE KEY` (as OpenSSL writes it) or PKCS#8 `PRIVATE KEY`. */
  privateKey: string;
  fetch?: typeof fetch;
}

const tokenCache = new Map<string, { token: string; expiresAt: number }>();

export function clearAppleAdsTokenCache(): void {
  tokenCache.clear();
}

function b64url(bytes: ArrayBuffer | Uint8Array | string): string {
  const arr = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = '';
  for (const b of arr) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** DER length bytes. */
function derLength(n: number): number[] {
  if (n < 0x80) return [n];
  const out: number[] = [];
  while (n > 0) {
    out.unshift(n & 0xff);
    n >>= 8;
  }
  return [0x80 | out.length, ...out];
}

/** SEC1 `ECPrivateKey` (P-256) → PKCS#8 `PrivateKeyInfo`, which WebCrypto imports. */
export function sec1ToPkcs8(sec1: Uint8Array): Uint8Array<ArrayBuffer> {
  // AlgorithmIdentifier: id-ecPublicKey with the prime256v1 curve.
  const algorithm = [
    0x30, 0x13, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01, 0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07,
  ];
  const octet = [0x04, ...derLength(sec1.length), ...sec1];
  const body = [0x02, 0x01, 0x00, ...algorithm, ...octet];
  const out = new Uint8Array(new ArrayBuffer(body.length + 1 + derLength(body.length).length));
  out.set([0x30, ...derLength(body.length), ...body]);
  return out;
}

async function importKey(pem: string): Promise<CryptoKey> {
  const text = pem.replace(/\\n/g, '\n');
  const sec1 = /BEGIN EC PRIVATE KEY/.test(text);
  const body = text.replace(/-----(BEGIN|END) [A-Z ]*PRIVATE KEY-----/g, '').replace(/\s+/g, '');
  let der: Uint8Array<ArrayBuffer>;
  try {
    const bin = atob(body);
    der = new Uint8Array(new ArrayBuffer(bin.length));
    for (let i = 0; i < bin.length; i++) der[i] = bin.charCodeAt(i);
  } catch {
    throw new SourceError('appleads', 0, 'APPLE_ADS_PRIVATE_KEY is not a valid PEM key');
  }
  try {
    return await crypto.subtle.importKey('pkcs8', sec1 ? sec1ToPkcs8(der) : der, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  } catch {
    throw new SourceError(
      'appleads',
      0,
      'APPLE_ADS_PRIVATE_KEY could not be imported (expected the P-256 private-key.pem made for Apple Ads)',
    );
  }
}

/** The client secret Apple Ads asks for: an ES256 JWT (WebCrypto signatures are already in the JWS r‖s form). */
export async function signAppleAdsSecret(
  o: Pick<AppleAdsClientOptions, 'clientId' | 'teamId' | 'keyId' | 'privateKey'>,
  nowSec = Math.floor(Date.now() / 1000),
): Promise<string> {
  const header = b64url(JSON.stringify({ alg: 'ES256', kid: o.keyId }));
  const claims = b64url(
    JSON.stringify({ sub: o.clientId, aud: 'https://appleid.apple.com', iat: nowSec, exp: nowSec + SECRET_SECONDS, iss: o.teamId }),
  );
  const key = await importKey(o.privateKey);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(`${header}.${claims}`));
  return `${header}.${claims}.${b64url(sig)}`;
}

/** `{"error":{"errors":[{"messageCode":"...","message":"..."}]}}` or `{"error":"invalid_client"}` → a short message. */
function describe(status: number, body: string): string {
  try {
    const j = JSON.parse(body) as {
      error?: string | { errors?: Array<{ messageCode?: string; message?: string }>; message?: string };
      error_description?: string;
    };
    if (typeof j.error === 'string')
      return `HTTP ${status}: ${j.error}${j.error_description ? `: ${j.error_description.slice(0, 200)}` : ''}`;
    const e = j.error?.errors?.[0];
    if (e) return `HTTP ${status}: ${[e.messageCode, e.message].filter(Boolean).join(': ').slice(0, 300)}`;
    if (j.error?.message) return `HTTP ${status}: ${j.error.message.slice(0, 300)}`;
  } catch {
    // not JSON
  }
  return `HTTP ${status}`;
}

const isoDay = (v: unknown): IsoDate | null => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);
const int = (v: unknown) => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? Math.round(n) : 0;
};
const cents = (m: unknown) => {
  const amount = typeof m === 'object' && m !== null ? Number((m as { amount?: string }).amount) : NaN;
  return Number.isFinite(amount) ? Math.round(amount * 100) : 0;
};
const currencyOf = (m: unknown) =>
  typeof m === 'object' && m !== null && typeof (m as { currency?: string }).currency === 'string'
    ? (m as { currency: string }).currency
    : '';

type Metrics = {
  date?: string;
  impressions?: number;
  taps?: number;
  totalInstalls?: number;
  totalNewDownloads?: number;
  localSpend?: unknown;
};

export function createAppleAdsClient(opts: AppleAdsClientOptions): AppleAdsClient {
  const f = opts.fetch ?? fetch;

  async function token(): Promise<string> {
    const key = `${opts.teamId}|${opts.clientId}|${opts.keyId}`;
    const cached = tokenCache.get(key);
    if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
    const secret = await signAppleAdsSecret(opts);
    const qs = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: opts.clientId,
      client_secret: secret,
      scope: 'searchadsorg',
    });
    let res: Response;
    try {
      res = await f(`${TOKEN_URL}?${qs.toString()}`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      });
    } catch (err) {
      throw new SourceError('appleads', 0, `token request failed (${err instanceof Error ? err.name : 'network error'})`);
    }
    const text = await res.text();
    // The client secret is never put into a message.
    if (!res.ok) throw new SourceError('appleads', res.status, `token exchange failed (${describe(res.status, text)})`);
    const j = JSON.parse(text) as { access_token: string; expires_in: number };
    tokenCache.set(key, { token: j.access_token, expiresAt: Date.now() + j.expires_in * 1000 });
    return j.access_token;
  }

  const call = async <T>(path: string, accountId: string | null, body?: unknown): Promise<T> =>
    requestJson<T>(
      'appleads',
      `${APPLE_ADS_API}${path}`,
      {
        ...(body === undefined ? {} : { method: 'POST', body }),
        headers: { authorization: `Bearer ${await token()}`, ...(accountId ? { 'x-ap-context': `adAccountId=${accountId}` } : {}) },
        fetch: f,
      },
      describe,
    );

  /** Pages through a POST query (offset and pageSize). */
  async function query<R>(path: string, accountId: string, body: Record<string, unknown>, pageSize: number, rowsOf: (res: unknown) => R[]) {
    const out: R[] = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const res = await call<{ pagination?: { totalCount?: number } }>(path, accountId, {
        ...body,
        pagination: { offset: page * pageSize, pageSize },
      });
      const rows = rowsOf(res);
      out.push(...rows);
      const total = res?.pagination?.totalCount;
      if (rows.length < pageSize || (typeof total === 'number' && out.length >= total)) break;
    }
    return out;
  }

  return {
    async accounts() {
      const res = await call<{ result?: { acls?: Array<{ adAccount?: { id?: number | string; name?: string }; roles?: string[] }> } }>(
        '/acls',
        null,
      );
      return (res?.result?.acls ?? [])
        .filter((a) => a.adAccount?.id !== undefined)
        .map((a) => ({ id: String(a.adAccount!.id), name: a.adAccount?.name ?? '', roles: a.roles ?? [] }));
    },

    async campaigns(accountId, appleId) {
      const rows = await query(
        '/campaigns/query',
        accountId,
        {
          filters: [
            { field: 'promotedObjectId', operator: 'EQUALS', value: appleId },
            { field: 'promotedObjectType', operator: 'EQUALS', value: 'APPSTORE_APP' },
          ],
        },
        1000,
        (res) =>
          ((res as { result?: Array<{ id?: number | string; name?: string; deleted?: boolean }> })?.result ?? []).filter(
            (c) => c.id !== undefined,
          ),
      );
      return rows.map((c) => ({ id: String(c.id), name: c.name ?? '' }));
    },

    async searchTerms(accountId, campaignId, range: DateRange) {
      type Row = {
        metadata?: { searchTermText?: string; keyword?: { text?: string } | null };
        totalMetrics?: Metrics;
        granularMetrics?: Metrics[];
      };
      const single = range.start === range.end;
      const rows = await query(
        '/reports/apps/searchterms/query',
        accountId,
        {
          // Search term reports take UTC.
          timeRange: { start: range.start, end: range.end, timeZone: 'UTC', ...(single ? {} : { granularity: 'DAILY' }) },
          filters: [{ field: 'campaignId', operator: 'EQUALS', value: Number(campaignId) }],
          sorting: [{ field: 'impressions', sortOrder: 'DESCENDING' }],
        },
        5000,
        (res) => (res as { result?: { rows?: Row[] } })?.result?.rows ?? [],
      );
      const out: AppleAdsSearchTermRow[] = [];
      for (const r of rows) {
        const term = r.metadata?.searchTermText?.trim();
        // Apple leaves out terms with few impressions: those rows have no text and are not kept.
        if (!term) continue;
        const keyword = r.metadata?.keyword?.text?.trim() ?? '';
        const days = single ? [{ ...r.totalMetrics, date: range.start }] : (r.granularMetrics ?? []);
        for (const m of days) {
          const date = isoDay(m.date);
          if (!date) continue;
          const row: AppleAdsSearchTermRow = {
            date,
            campaignId,
            term: term.slice(0, 200),
            keyword: keyword.slice(0, 200),
            impressions: int(m.impressions),
            taps: int(m.taps),
            installs: int(m.totalInstalls),
            newDownloads: int(m.totalNewDownloads),
            spendCents: cents(m.localSpend),
            currency: currencyOf(m.localSpend),
          };
          if (row.impressions || row.taps || row.installs || row.spendCents) out.push(row);
        }
      }
      return out;
    },

    async impressionShare(accountId, appleId, range: DateRange) {
      type Row = {
        day?: string;
        countryOrRegion?: string;
        searchTerm?: string;
        lowImpressionShare?: number;
        highImpressionShare?: number;
        rank?: number;
        searchPopularity1to5?: number;
      };
      const rows = await query(
        '/insights/apps/impression-share/query',
        accountId,
        {
          timeRange: { start: range.start, end: range.end, granularity: 'DAILY' },
          filters: [{ field: 'promotedObjectId', operator: 'EQUALS', value: appleId }],
          options: { impressionShareReportType: 'ALL_SLOTS' },
        },
        10000,
        (res) => (res as { result?: { rows?: Row[] } })?.result?.rows ?? [],
      );
      const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
      const out: AppleAdsImpressionShareRow[] = [];
      for (const r of rows) {
        const date = isoDay(r.day);
        const term = r.searchTerm?.trim();
        if (!date || !term) continue;
        out.push({
          date,
          territory: (r.countryOrRegion ?? '-').toUpperCase().slice(0, 10),
          term: term.slice(0, 200),
          lowShare: num(r.lowImpressionShare),
          highShare: num(r.highImpressionShare),
          rank: num(r.rank),
          popularity: num(r.searchPopularity1to5),
        });
      }
      return out;
    },
  };
}
