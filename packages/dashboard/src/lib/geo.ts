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
 * The steps to show. "Cited" only comes from an optional CSV import, so it is
 * hidden until there are citations in the range.
 */
export function visibleSteps(d: GeoFunnelResponse | null | undefined): typeof GEO_STEPS {
  return GEO_STEPS.filter((s) => s.key !== 'cited' || (d?.totals.cited ?? 0) > 0);
}

/**
 * The funnel as the server follows it: a page counts at a step only if it also
 * reached every earlier step, so each step's total covers only those pages.
 * Steps without any data pass pages through.
 */
export function buildFunnel(d: GeoFunnelResponse): { stages: FunnelStage[]; base: number } {
  const stages: FunnelStage[] = visibleSteps(d).map((s) => {
    const f = d.funnel.find((x) => x.step === s.key);
    return {
      key: s.key,
      label: s.label,
      unit: s.unit,
      total: f?.total ?? 0,
      overall: d.totals[s.key],
      pages: f?.pages ?? null,
      color: s.color,
    };
  });
  const first = d.funnel.find((x) => x.pages !== null);
  return { stages, base: first?.pages ?? d.pages.length };
}
