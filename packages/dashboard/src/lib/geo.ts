import type { FunnelStage } from '../components/Funnel.svelte';
import { apiUrl, type Params } from './api';
import type { GeoFunnelResponse, GeoPage } from './types';

export type GeoStep = 'crawled' | 'cited' | 'aiVisits' | 'clicks';
/** What the per-page rows can be sorted by: any step, or search impressions. */
export type GeoSortKey = GeoStep | 'impressions';

export const GEO_STEPS: Array<{ key: GeoStep; label: string; unit: string; color: string }> = [
  { key: 'crawled', label: 'Crawled', unit: 'AI crawler requests', color: 'var(--stage-1)' },
  { key: 'cited', label: 'Cited', unit: 'citations in AI answers', color: 'var(--stage-2)' },
  { key: 'aiVisits', label: 'AI visits', unit: 'visits from AI assistants', color: 'var(--stage-3)' },
  { key: 'clicks', label: 'Clicks', unit: 'clicks from search', color: 'var(--stage-4)' },
];

/** The funnel request shared by the Overview card and the GEO view (same URL, one cached response). */
export function geoFunnelUrl(site: string, range: Params, opts: { sortBy?: GeoSortKey; pageContains?: string } = {}): string {
  return apiUrl('/api/geo-funnel', { site, ...range, sortBy: opts.sortBy ?? 'crawled', pageContains: opts.pageContains, limit: 500 });
}

/**
 * Follows pages through the steps: a page counts at a step only if it also
 * reached every earlier step. Steps without any data pass pages through.
 */
export function buildFunnel(d: GeoFunnelResponse): { stages: FunnelStage[]; base: number } {
  let set: GeoPage[] = d.pages;
  const stages: FunnelStage[] = GEO_STEPS.map((s) => {
    const known = d.totals[s.key] > 0;
    if (known) set = set.filter((p) => p[s.key] > 0);
    return { key: s.key, label: s.label, unit: s.unit, total: d.totals[s.key], pages: known ? set.length : null, color: s.color };
  });
  const first = GEO_STEPS.find((s) => d.totals[s.key] > 0);
  const base = first ? d.pages.filter((p) => p[first.key] > 0).length : d.pages.length;
  return { stages, base };
}
