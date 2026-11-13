/**
 * App Store Connect adapter (ADR 0009). Authenticates with an API key: an ES256 JWT signed with
 * WebCrypto (no dependency), valid for 19 minutes and cached per isolate. The sync uses a key with
 * the Sales and Reports role; the one-time "start App Store reports" action builds a client from a
 * temporary Admin key that is never stored.
 *
 * Report segments are downloaded from presigned URLs that carry credentials: they are never
 * logged or put into error messages.
 */
import {
  readDelimited,
  requestJson,
  SourceError,
  type AscAccessType,
  type AscClient,
  type AscReport,
  type AscReportInstance,
  type AscReportRequest,
  type AscReview,
  type AscSegment,
  type AppListingValue,
  type DelimitedRow,
} from '@searchkeep/core';

export const ASC_API = 'https://api.appstoreconnect.apple.com';
/** Apple allows at most 20 minutes. */
const TOKEN_SECONDS = 19 * 60;
const MAX_PAGES = 10;

export interface AscClientOptions {
  keyId: string;
  issuerId: string;
  /** The `.p8` private key (PKCS#8 PEM). */
  privateKey: string;
  /** Keep the token for its lifetime in this isolate (default). Off for the one-time Admin key. */
  cacheToken?: boolean;
  fetch?: typeof fetch;
}

const tokenCache = new Map<string, { token: string; expiresAt: number }>();

export function clearAscTokenCache(): void {
  tokenCache.clear();
}

function b64url(bytes: ArrayBuffer | Uint8Array | string): string {
  const arr = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = '';
  for (const b of arr) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function importKey(pem: string): Promise<CryptoKey> {
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
    throw new SourceError('asc', 0, 'the App Store Connect private key is not a valid .p8 (PEM) key');
  }
  try {
    return await crypto.subtle.importKey('pkcs8', der, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  } catch {
    throw new SourceError(
      'asc',
      0,
      'the App Store Connect private key could not be imported (expected the contents of the AuthKey_….p8 file)',
    );
  }
}

/** An App Store Connect API token (ES256; WebCrypto signatures are already in the JWS r‖s form). */
export async function signAscJwt(
  keyId: string,
  issuerId: string,
  privateKey: string,
  nowSec = Math.floor(Date.now() / 1000),
): Promise<string> {
  const header = b64url(JSON.stringify({ alg: 'ES256', kid: keyId, typ: 'JWT' }));
  const claims = b64url(JSON.stringify({ iss: issuerId, iat: nowSec, exp: nowSec + TOKEN_SECONDS, aud: 'appstoreconnect-v1' }));
  const key = await importKey(privateKey);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(`${header}.${claims}`));
  return `${header}.${claims}.${b64url(sig)}`;
}

/** `{"errors":[{"status":"403","code":"FORBIDDEN_ERROR","detail":"..."}]}` → a short message. */
function describe(status: number, body: string): string {
  try {
    const j = JSON.parse(body) as { errors?: Array<{ code?: string; title?: string; detail?: string }> };
    const e = j.errors?.[0];
    if (e) return `HTTP ${status}: ${[e.code, e.detail ?? e.title].filter(Boolean).join(': ').slice(0, 300)}`;
  } catch {
    // not JSON
  }
  return `HTTP ${status}`;
}

interface Resource<A> {
  id: string;
  attributes?: A;
}
interface Page<A> {
  data?: Array<Resource<A>> | Resource<A>;
  links?: { next?: string };
}

type RequestAttrs = { accessType?: AscAccessType; stoppedDueToInactivity?: boolean };

const toRequest = (r: Resource<RequestAttrs>): AscReportRequest => ({
  id: r.id,
  accessType: r.attributes?.accessType ?? 'ONGOING',
  stoppedDueToInactivity: Boolean(r.attributes?.stoppedDueToInactivity),
});

export function createAscClient(opts: AscClientOptions): AscClient {
  const f = opts.fetch ?? fetch;

  let own: { token: string; expiresAt: number } | null = null;
  async function token(): Promise<string> {
    const key = `${opts.issuerId}|${opts.keyId}`;
    const cached = opts.cacheToken === false ? own : tokenCache.get(key);
    if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
    const t = await signAscJwt(opts.keyId, opts.issuerId, opts.privateKey);
    const entry = { token: t, expiresAt: Date.now() + TOKEN_SECONDS * 1000 };
    if (opts.cacheToken === false) own = entry;
    else tokenCache.set(key, entry);
    return t;
  }

  async function call<T>(pathOrUrl: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
    const url = pathOrUrl.startsWith('https://') ? pathOrUrl : `${ASC_API}${pathOrUrl}`;
    // Pagination links must stay on the API host (they are followed with the token).
    if (!url.startsWith(`${ASC_API}/`)) throw new SourceError('asc', 0, 'unexpected pagination link');
    return requestJson<T>('asc', url, { ...init, headers: { authorization: `Bearer ${await token()}` }, fetch: f }, describe);
  }

  async function all<A>(path: string, maxPages = MAX_PAGES): Promise<Array<Resource<A>>> {
    const out: Array<Resource<A>> = [];
    let next: string | undefined = path;
    for (let i = 0; next && i < maxPages; i++) {
      const page: Page<A> = await call<Page<A>>(next);
      const data = page?.data;
      if (Array.isArray(data)) out.push(...data);
      next = page?.links?.next;
    }
    return out;
  }

  return {
    async listApps() {
      const apps = await all<{ name?: string; bundleId?: string; sku?: string }>('/v1/apps?limit=200&fields[apps]=name,bundleId,sku', 5);
      return apps.map((a) => ({
        id: a.id,
        name: a.attributes?.name ?? a.id,
        bundleId: a.attributes?.bundleId ?? '',
        ...(a.attributes?.sku ? { sku: a.attributes.sku } : {}),
      }));
    },

    async latestBuildIcon(appleId) {
      // A build that is still processing has no icon yet, so a few recent builds are read.
      const page = await call<Page<{ iconAssetToken?: { templateUrl?: unknown; width?: unknown; height?: unknown } | null }>>(
        `/v1/builds?filter%5Bapp%5D=${encodeURIComponent(appleId)}&sort=-uploadedDate&limit=5&fields%5Bbuilds%5D=iconAssetToken`,
      );
      const builds = Array.isArray(page?.data) ? page.data : [];
      for (const b of builds) {
        const icon = b.attributes?.iconAssetToken;
        if (typeof icon?.templateUrl !== 'string' || icon.templateUrl === '') continue;
        const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
        return { templateUrl: icon.templateUrl, width: n(icon.width), height: n(icon.height) };
      }
      return null;
    },

    async listReportRequests(appleId) {
      return (await all<RequestAttrs>(`/v1/apps/${encodeURIComponent(appleId)}/analyticsReportRequests?limit=200`)).map(toRequest);
    },

    async createReportRequest(appleId, accessType) {
      const res = await call<{ data: Resource<RequestAttrs> }>('/v1/analyticsReportRequests', {
        method: 'POST',
        body: {
          data: {
            type: 'analyticsReportRequests',
            attributes: { accessType },
            relationships: { app: { data: { type: 'apps', id: appleId } } },
          },
        },
      });
      return toRequest(res.data);
    },

    async deleteReportRequest(requestId) {
      await call<unknown>(`/v1/analyticsReportRequests/${encodeURIComponent(requestId)}`, { method: 'DELETE' });
    },

    async getReportRequest(requestId) {
      const res = await call<{ data: Resource<RequestAttrs> }>(`/v1/analyticsReportRequests/${encodeURIComponent(requestId)}`);
      return toRequest(res.data);
    },

    async listReports(requestId): Promise<AscReport[]> {
      const reports = await all<{ name?: string; category?: string }>(
        `/v1/analyticsReportRequests/${encodeURIComponent(requestId)}/reports?limit=200`,
      );
      return reports.map((r) => ({ id: r.id, name: r.attributes?.name ?? '', category: r.attributes?.category ?? '' }));
    },

    async listInstances(reportId, granularity): Promise<AscReportInstance[]> {
      const list = await all<{ granularity?: string; processingDate?: string }>(
        `/v1/analyticsReports/${encodeURIComponent(reportId)}/instances?limit=200&filter%5Bgranularity%5D=${granularity}`,
      );
      return list
        .filter((i) => typeof i.attributes?.processingDate === 'string')
        .map((i) => ({
          id: i.id,
          granularity: i.attributes?.granularity ?? granularity,
          processingDate: i.attributes!.processingDate!.slice(0, 10),
        }));
    },

    async listSegments(instanceId): Promise<AscSegment[]> {
      const list = await all<{ url?: string; sizeInBytes?: number }>(
        `/v1/analyticsReportInstances/${encodeURIComponent(instanceId)}/segments?limit=200`,
      );
      return list
        .filter((s) => typeof s.attributes?.url === 'string')
        .map((s) => ({ id: s.id, url: s.attributes!.url!, sizeInBytes: s.attributes?.sizeInBytes ?? null }));
    },

    async readSegment(segment, onRow: (row: DelimitedRow) => void) {
      if (!/^https:\/\//i.test(segment.url)) throw new SourceError('asc', 0, 'unexpected report segment URL');
      let res: Response;
      try {
        // A presigned URL: no Authorization header, and never logged.
        res = await f(segment.url);
      } catch (err) {
        throw new SourceError('asc', 0, `report segment download failed (${err instanceof Error ? err.name : 'network error'})`);
      }
      if (!res.ok || !res.body) {
        await res.body?.cancel().catch(() => undefined);
        throw new SourceError('asc', res.status, `report segment download failed (HTTP ${res.status})`, {
          rateLimited: res.status === 429,
        });
      }
      return readDelimited(res.body, onRow);
    },

    async salesReport(vendorNumber, date, onRow: (row: DelimitedRow) => void) {
      const qs = new URLSearchParams({
        'filter[frequency]': 'DAILY',
        'filter[reportDate]': date,
        'filter[reportSubType]': 'SUMMARY',
        'filter[reportType]': 'SALES',
        'filter[vendorNumber]': vendorNumber,
      });
      let res: Response;
      try {
        res = await f(`${ASC_API}/v1/salesReports?${qs.toString()}`, {
          headers: { authorization: `Bearer ${await token()}`, accept: 'application/a-gzip, application/json' },
        });
      } catch (err) {
        throw new SourceError('asc', 0, `sales report download failed (${err instanceof Error ? err.name : 'network error'})`);
      }
      // No sales that day, or the day's report is not out yet.
      if (res.status === 404) {
        await res.body?.cancel().catch(() => undefined);
        return null;
      }
      if (!res.ok || !res.body) {
        const text = await res.text().catch(() => '');
        throw new SourceError('asc', res.status, `sales report: ${describe(res.status, text)}`, { rateLimited: res.status === 429 });
      }
      return readDelimited(res.body, onRow);
    },

    async listingSnapshot(appleId) {
      const values: AppListingValue[] = [];
      const scopes: string[] = [];
      let calls = 0;
      const get = async <T>(path: string) => {
        calls++;
        return call<T>(path);
      };
      const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
      const put = (entity: string, locale: string, field: string, v: unknown) => {
        const value = text(v).slice(0, 4000);
        if (value) values.push({ entity, locale, field, value });
      };

      // Versions: the newest few per platform, with their phased release.
      type V = {
        platform?: string;
        versionString?: string;
        appStoreState?: string;
        appVersionState?: string;
        releaseType?: string;
        earliestReleaseDate?: string;
        createdDate?: string;
      };
      const versions = await get<{
        data?: Array<Resource<V> & { relationships?: { appStoreVersionPhasedRelease?: { data?: { id: string } | null } } }>;
        included?: Array<Resource<{ phasedReleaseState?: string }>>;
      }>(
        `/v1/apps/${encodeURIComponent(appleId)}/appStoreVersions?limit=20&fields%5BappStoreVersions%5D=platform,versionString,appStoreState,appVersionState,releaseType,earliestReleaseDate,createdDate,appStoreVersionPhasedRelease&include=appStoreVersionPhasedRelease&fields%5BappStoreVersionPhasedReleases%5D=phasedReleaseState`,
      );
      const phased = new Map((versions.included ?? []).map((x) => [x.id, x.attributes?.phasedReleaseState ?? '']));
      const live = (v: V) => v.appVersionState === 'READY_FOR_DISTRIBUTION' || v.appStoreState === 'READY_FOR_SALE';
      const onSale = new Map<string, string>();
      const byPlatform = new Map<string, Array<(typeof versions.data & object)[number]>>();
      for (const v of versions.data ?? []) {
        const platform = v.attributes?.platform ?? 'IOS';
        byPlatform.set(platform, [...(byPlatform.get(platform) ?? []), v]);
      }
      for (const [platform, list] of byPlatform) {
        const entity = `version:${platform}`;
        const created = (v: (typeof list)[number]) => v.attributes?.createdDate ?? '';
        list.sort((a, b) => created(b).localeCompare(created(a)));
        const current = list.find((v) => live(v.attributes ?? {}));
        // The newest version created after the one on sale is the one in the works.
        const next = list.find((v) => v !== current && !live(v.attributes ?? {}) && (!current || created(v) > created(current)));
        if (current) {
          onSale.set(platform, current.id);
          put(entity, '', 'live', current.attributes?.versionString);
          const pr = current.relationships?.appStoreVersionPhasedRelease?.data?.id;
          if (pr && phased.get(pr)) put(entity, '', 'live_phased_release', phased.get(pr));
        }
        if (next) {
          put(entity, '', 'next', next.attributes?.versionString);
          put(entity, '', 'next_state', next.attributes?.appVersionState ?? next.attributes?.appStoreState);
          put(entity, '', 'next_release_type', next.attributes?.releaseType);
          put(entity, '', 'next_earliest_release', next.attributes?.earliestReleaseDate);
        }
        scopes.push(entity);
      }

      // The on-sale version's text per locale.
      for (const [platform, id] of onSale) {
        const locs = await get<
          Page<{ locale?: string; description?: string; keywords?: string; promotionalText?: string; whatsNew?: string }>
        >(
          `/v1/appStoreVersions/${encodeURIComponent(id)}/appStoreVersionLocalizations?limit=50&fields%5BappStoreVersionLocalizations%5D=locale,description,keywords,promotionalText,whatsNew`,
        );
        const entity = `listing:${platform}`;
        for (const l of Array.isArray(locs.data) ? locs.data : []) {
          const locale = text(l.attributes?.locale);
          if (!locale) continue;
          put(entity, locale, 'description', l.attributes?.description);
          put(entity, locale, 'keywords', l.attributes?.keywords);
          put(entity, locale, 'promotional_text', l.attributes?.promotionalText);
          put(entity, locale, 'whats_new', l.attributes?.whatsNew);
        }
        scopes.push(entity);
      }

      // The live app info's name and subtitle per locale.
      const infos = await get<Page<{ state?: string; appStoreState?: string }>>(
        `/v1/apps/${encodeURIComponent(appleId)}/appInfos?limit=10&fields%5BappInfos%5D=state,appStoreState`,
      );
      const infoList = Array.isArray(infos.data) ? infos.data : [];
      const liveInfo =
        infoList.find((x) => x.attributes?.state === 'READY_FOR_DISTRIBUTION' || x.attributes?.appStoreState === 'READY_FOR_SALE') ??
        infoList.at(-1);
      if (liveInfo) {
        const locs = await get<Page<{ locale?: string; name?: string; subtitle?: string }>>(
          `/v1/appInfos/${encodeURIComponent(liveInfo.id)}/appInfoLocalizations?limit=50&fields%5BappInfoLocalizations%5D=locale,name,subtitle`,
        );
        for (const l of Array.isArray(locs.data) ? locs.data : []) {
          const locale = text(l.attributes?.locale);
          if (!locale) continue;
          put('app_info', locale, 'name', l.attributes?.name);
          put('app_info', locale, 'subtitle', l.attributes?.subtitle);
        }
        scopes.push('app_info');
      }
      return { scopes, values, calls };
    },

    async listReviews(appleId, o) {
      const path =
        o.cursor ??
        `/v1/apps/${encodeURIComponent(appleId)}/customerReviews?sort=-createdDate&limit=${Math.min(200, Math.max(1, o.limit))}&include=response&fields%5BcustomerReviewResponses%5D=state`;
      const page = await call<
        Page<{ rating?: number; title?: string; body?: string; createdDate?: string; territory?: string }> & {
          data?: Array<{ relationships?: { response?: { data?: { id: string } | null } } }>;
        }
      >(path);
      const data = (Array.isArray(page?.data) ? page.data : []) as Array<
        Resource<{ rating?: number; title?: string; body?: string; createdDate?: string; territory?: string }> & {
          relationships?: { response?: { data?: { id: string } | null } };
        }
      >;
      const reviews: AscReview[] = data
        .filter((r) => typeof r.attributes?.createdDate === 'string')
        .map((r) => ({
          id: r.id,
          rating: Number(r.attributes?.rating ?? 0),
          title: r.attributes?.title ?? null,
          body: r.attributes?.body ?? null,
          createdDate: r.attributes!.createdDate!,
          territory: r.attributes?.territory ?? null,
          replied: Boolean(r.relationships?.response?.data),
        }));
      return { reviews, next: page?.links?.next ?? null };
    },

    async replyToReview(reviewId, text) {
      await call<unknown>('/v1/customerReviewResponses', {
        method: 'POST',
        body: {
          data: {
            type: 'customerReviewResponses',
            attributes: { responseBody: text },
            relationships: { review: { data: { type: 'customerReviews', id: reviewId } } },
          },
        },
      });
    },
  };
}
