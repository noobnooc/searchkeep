/**
 * Opt-in plugin (ADR 0009, off by default: APP_STORE_PUBLIC_DATA=true): Apple's official public
 * App Store feeds. `lookup` gives an app's average rating and rating count in a storefront; the
 * chart feeds give the top 100 apps in rank order. The sync keeps only the user's own app's rating
 * and position; nothing about other apps is stored.
 */
import { requestJson, SourceError, type AppStoreChart, type AppStoreLookup, type AppStorePublicClient } from '@searchkeep/core';

const LOOKUP = 'https://itunes.apple.com/lookup';
/** Current feeds: top free and top paid, all apps, up to 100. */
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
  const request = <T>(url: string, f: typeof fetch) =>
    requestJson<T>('appstore', url, { headers: { 'user-agent': 'Searchkeep' }, fetch: f });
  async function get<T>(url: string): Promise<T> {
    if (!viaFallback || !opts.fallbackFetch) {
      try {
        return await request<T>(url, direct);
      } catch (err) {
        if (!opts.fallbackFetch || !(err instanceof SourceError && err.status === 403)) throw err;
        viaFallback = true;
        opts.onFallback?.();
      }
    }
    return request<T>(url, opts.fallbackFetch);
  }
  const country = (c: string) => {
    const v = c.trim().toLowerCase();
    if (!COUNTRY_RE.test(v)) throw new SourceError('appstore', 0, `invalid storefront "${v.slice(0, 10)}"`);
    return v;
  };

  return {
    async lookup(appleId, storefront): Promise<AppStoreLookup | null> {
      const res = await get<{
        results?: Array<{
          trackName?: string;
          averageUserRating?: number;
          userRatingCount?: number;
          version?: string;
          primaryGenreId?: number;
        }>;
      }>(`${LOOKUP}?id=${encodeURIComponent(appleId)}&country=${country(storefront)}&entity=software`);
      const r = res?.results?.[0];
      if (!r) return null;
      return {
        appleId,
        name: r.trackName ?? null,
        averageUserRating: typeof r.averageUserRating === 'number' ? r.averageUserRating : null,
        userRatingCount: typeof r.userRatingCount === 'number' ? r.userRatingCount : null,
        version: r.version ?? null,
        primaryGenreId: r.primaryGenreId !== undefined ? String(r.primaryGenreId) : null,
      };
    },

    async topChart(storefront, chart, genreId) {
      const cc = country(storefront);
      if (!genreId && chart !== 'top-grossing') {
        const res = await get<{ feed?: { results?: Array<{ id?: string }> } }>(`${MARKETING_FEED}/${cc}/apps/${chart}/100/apps.json`);
        return (res?.feed?.results ?? []).map((r) => String(r.id ?? '')).filter(Boolean);
      }
      const genre = genreId && /^\d{1,8}$/.test(genreId) ? `/genre=${genreId}` : '';
      const res = await get<{
        feed?: { entry?: Array<{ id?: { attributes?: Record<string, string> } }> | { id?: { attributes?: Record<string, string> } } };
      }>(`${ITUNES_FEED}/${cc}/rss/${LEGACY_CHARTS[chart]}/limit=100${genre}/json`);
      const entry = res?.feed?.entry;
      const list = Array.isArray(entry) ? entry : entry ? [entry] : [];
      return list.map((e) => e.id?.attributes?.['im:id'] ?? '').filter(Boolean);
    },
  };
}
