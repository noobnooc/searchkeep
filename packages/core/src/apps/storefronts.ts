/**
 * Storefronts the opt-in public App Store feeds check for an app, most important first: the ones
 * set on the app, or else the app's own biggest App Store storefronts by downloads, filled up with
 * the largest storefronts.
 */
import { addDays } from '../dates.js';
import type { Store } from '../store.js';
import type { AppConfig, IsoDate } from '../types.js';
import { MAX_PUBLIC_TERRITORIES } from './config.js';

/** The largest App Store storefronts, used until (and besides) the app's own data says otherwise. */
export const DEFAULT_STOREFRONTS = ['us', 'cn', 'jp', 'gb', 'de'] as const;

/** Lower-case storefront codes, at most `MAX_PUBLIC_TERRITORIES`, most important first. */
export async function appStorefronts(store: Store, app: AppConfig, today: IsoDate): Promise<string[]> {
  if (app.territories?.length) return app.territories;
  const rows = await store.queryAppStore({
    appId: app.id,
    store: 'apple',
    range: { start: addDays(today, -28), end: today },
    dimensions: ['territory'],
    orderBy: 'downloads',
    order: 'desc',
    limit: MAX_PUBLIC_TERRITORIES * 2,
  });
  const own = rows.filter((r) => r.downloads > 0 && r.territory && /^[A-Z]{2}$/.test(r.territory)).map((r) => r.territory!.toLowerCase());
  return [...new Set([...own, ...DEFAULT_STOREFRONTS])].slice(0, MAX_PUBLIC_TERRITORIES);
}

/** Sorts rows by the position of their territory in `order` (upper-case codes); others last, by code. */
export function byStorefront<T extends { territory: string }>(rows: T[], order: string[]): T[] {
  const rank = new Map(order.map((t, i) => [t.toUpperCase(), i]));
  const at = (t: string) => rank.get(t) ?? Number.MAX_SAFE_INTEGER;
  return [...rows].sort((a, b) => at(a.territory) - at(b.territory) || a.territory.localeCompare(b.territory));
}
