import { brandRegexFor, compileBrandRegex, type SearchkeepConfig } from './config.js';
import type { Store } from './store.js';
import type { SiteConfig } from './types.js';

const BRAND_BATCH = 2000;

/**
 * Re-computes brand flags for queries classified with an older regex (or never), at most
 * `maxQueries` of them; returns how many were classified. The sync passes a small cap, so new
 * queries are classified over the next runs instead of in one burst of writes.
 */
export async function classifyBrandQueries(
  store: Store,
  config: SearchkeepConfig,
  site: SiteConfig,
  maxQueries = 100_000,
): Promise<number> {
  const source = brandRegexFor(config, site);
  const version = source ?? '';
  const re = compileBrandRegex(source);
  let done = 0;
  while (done < maxQueries) {
    const size = Math.min(BRAND_BATCH, maxQueries - done);
    const batch = await store.listQueriesForBrandClassification(site.id, version, size);
    if (batch.length === 0) break;
    await store.setBrandFlags(
      site.id,
      version,
      batch.map((q) => ({ id: q.id, isBrand: re ? re.test(q.text) : false })),
    );
    done += batch.length;
    if (batch.length < size) break;
  }
  return done;
}
