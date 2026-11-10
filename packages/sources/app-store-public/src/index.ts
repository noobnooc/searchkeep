/**
 * Opt-in plugin (ADR 0009, off by default: APP_STORE_PUBLIC_DATA=true): Apple's official public
 * App Store feeds. `lookup` gives an app's average rating and rating count in a storefront; the
 * chart feeds give the top 100 apps in rank order. The sync keeps only the user's own app's rating
 * and position; nothing about other apps is stored.
 */
import { requestJson, SourceError, type AppStoreChart, type AppStoreLookup, type AppStorePublicClient } from '@searchkeep/core';

const LOOKUP = 'https://itunes.apple.com/lookup';
/** Current feeds: top free and top paid, all apps, up to 100. They often time out; the older feeds then serve the same chart. */
const MARKETING_FEED = 'https://rss.marketingtools.apple.com/api/v2';
/** Older iTunes feeds: also top grossing and charts per genre (up to 100 entries). */
const ITUNES_FEED = 'https://itunes.apple.com';
const LEGACY_CHARTS: Record<AppStoreChart, string> = {
  'top-free': 'topfreeapplications',
  'top-paid': 'toppaidapplications',
  'top-grossing': 'topgrossingapplications',
};

export interface AppStorePublicOptions {
  fetch?: typeof fetch;
  /**
   * Used when Apple refuses the caller's IP address (HTTP 403; it refuses the egress IPs of
   * Workers), and for the rest of this client's life once it was needed. The Worker passes one
   * that goes through Cloudflare Browser Run, whose IPs Apple accepts.
   */
  fallbackFetch?: typeof fetch;
  /** Called once when the client switches to `fallbackFetch`. */
  onFallback?: () => void;
}

const COUNTRY_RE = /^[a-z]{2}$/;

export function createAppStorePublicClient(opts: AppStorePublicOptions = {}): AppStorePublicClient {
  const direct = opts.fetch ?? fetch;
  let viaFallback = false;
  const request = <T>(url: string, f: typeof fetch, retries?: number) =>
    requestJson<T>('appstore', url, { headers: { 'user-agent': 'Searchkeep' }, fetch: f, ...(retries !== undefined ? { retries } : {}) });
  async function get<T>(url: string, retries?: number): Promise<T> {
    if (!viaFallback || !opts.fallbackFetch) {
      try {
        return await request<T>(url, direct, retries);
      } catch (err) {
        if (!opts.fallbackFetch || !(err instanceof SourceError && err.status === 403)) throw err;
        viaFallback = true;
        opts.onFallback?.();
      }
    }
    return request<T>(url, opts.fallbackFetch, retries);
  }
  const country = (c: string) => {
    const v = c.trim().toLowerCase();
    if (!COUNTRY_RE.test(v)) throw new SourceError('appstore', 0, `invalid storefront "${v.slice(0, 10)}"`);
    return v;
  };

  const charts = new Map<string, Promise<string[]>>();
  async function readChart(cc: string, chart: AppStoreChart, genre: string | null): Promise<string[]> {
    if (!genre && chart !== 'top-grossing') {
      try {
        // No retry: on failure the older feed below has the same chart.
        const res = await get<{ feed?: { results?: Array<{ id?: string }> } }>(`${MARKETING_FEED}/${cc}/apps/${chart}/100/apps.json`, 0);
        return (res?.feed?.results ?? []).map((r) => String(r.id ?? '')).filter(Boolean);
      } catch (err) {
        // These feeds often time out (HTTP 504 after 30 s, for example China's top paid chart).
        if (!(err instanceof SourceError) || (err.status !== 0 && err.status < 500)) throw err;
      }
    }
    const res = await get<{
      feed?: { entry?: Array<{ id?: { attributes?: Record<string, string> } }> | { id?: { attributes?: Record<string, string> } } };
    }>(`${ITUNES_FEED}/${cc}/rss/${LEGACY_CHARTS[chart]}/limit=100${genre ? `/genre=${genre}` : ''}/json`);
    const entry = res?.feed?.entry;
    const list = Array.isArray(entry) ? entry : entry ? [entry] : [];
    return list.map((e) => e.id?.attributes?.['im:id'] ?? '').filter(Boolean);
  }

  return {
    async lookup(appleId, storefront): Promise<AppStoreLookup | null> {
      const res = await get<{
        results?: Array<{
          trackName?: string;
          averageUserRating?: number;
          userRatingCount?: number;
          version?: string;
          primaryGenreId?: number;
          price?: number;
        }>;
      }>(`${LOOKUP}?id=${encodeURIComponent(appleId)}&country=${country(storefront)}&entity=software`);
      const r = res?.results?.[0];
      if (!r) return null;
      return {
        appleId,
        name: r.trackName ?? null,
        // Ratings are 1 to 5; Apple answers 0 while there are none.
        averageUserRating: typeof r.averageUserRating === 'number' && r.averageUserRating > 0 ? r.averageUserRating : null,
        userRatingCount: typeof r.userRatingCount === 'number' ? r.userRatingCount : null,
        version: r.version ?? null,
        primaryGenreId: r.primaryGenreId !== undefined ? String(r.primaryGenreId) : null,
        price: typeof r.price === 'number' ? r.price : null,
      };
    },

    async topChart(storefront, chart, genreId) {
      const cc = country(storefront);
      const genre = genreId && /^\d{1,8}$/.test(genreId) ? genreId : null;
      // Every app of a run reads the same charts: each is fetched once per client (one sync run).
      const key = `${cc}|${chart}|${genre ?? ''}`;
      let ids = charts.get(key);
      if (!ids) {
        ids = readChart(cc, chart, genre);
        charts.set(key, ids);
        ids.catch(() => charts.delete(key));
      }
      return ids;
    },
  };
}
