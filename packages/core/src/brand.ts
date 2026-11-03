import { brandRegexFor, compileBrandRegex, type SearchkeepConfig } from './config.js';
import type { Store } from './store.js';
import type { SiteConfig } from './types.js';

/** Re-computes brand flags for queries classified with an older regex. */
export async function classifyBrandQueries(store: Store, config: SearchkeepConfig, site: SiteConfig): Promise<void> {
  const source = brandRegexFor(config, site);
  const version = source ?? '';
  const re = compileBrandRegex(source);
  for (let i = 0; i < 50; i++) {
    const batch = await store.listQueriesForBrandClassification(site.id, version, 2000);
    if (batch.length === 0) return;
    await store.setBrandFlags(
      site.id,
      version,
      batch.map((q) => ({ id: q.id, isBrand: re ? re.test(q.text) : false })),
    );
    if (batch.length < 2000) return;
  }
}
