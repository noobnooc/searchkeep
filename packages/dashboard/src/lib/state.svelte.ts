/** Global UI state: current site, filters and theme. Persisted per browser. */
import type { Params } from './api';
import { addDays } from './format';
import { load, save } from './storage';
import type { AppInfo, Brand, SiteInfo, Source, StatusResponse } from './types';

export type Preset = '7d' | '28d' | '90d' | '6m' | '12m' | '16m' | 'all' | 'custom';
export type ThemePref = 'system' | 'light' | 'dark';

export const PRESETS: Array<{ id: Exclude<Preset, 'custom'>; label: string; short: string; days?: number }> = [
  { id: '7d', label: 'Last 7 days', short: '7d', days: 7 },
  { id: '28d', label: 'Last 28 days', short: '28d', days: 28 },
  { id: '90d', label: 'Last 90 days', short: '90d', days: 90 },
  { id: '6m', label: 'Last 6 months', short: '6m', days: 183 },
  { id: '12m', label: 'Last 12 months', short: '12m', days: 365 },
  { id: '16m', label: 'Last 16 months', short: '16m', days: 486 },
  { id: 'all', label: 'All time', short: 'All' },
];

const PRESET_IDS = new Set<string>([...PRESETS.map((p) => p.id), 'custom']);
const isIso = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

class UiState {
  status = $state.raw<StatusResponse | null>(null);
  sites = $state.raw<SiteInfo[]>([]);
  siteId = $state<string>(load('site', '', (v) => typeof v === 'string'));
  /** Apps (ADR 0009). */
  apps = $state.raw<AppInfo[]>([]);
  appId = $state<string>(load('app', '', (v) => typeof v === 'string'));
  preset = $state<Preset>(load('range', '28d', (v) => typeof v === 'string' && PRESET_IDS.has(v)));
  customStart = $state<string>(load('customStart', '', isIso));
  customEnd = $state<string>(load('customEnd', '', isIso));
  source = $state<Source>(load('source', 'gsc', (v) => v === 'gsc' || v === 'bing'));
  brand = $state<Brand>(load('brand', 'all', (v) => v === 'all' || v === 'brand' || v === 'non_brand'));
  theme = $state<ThemePref>(load('theme', 'system', (v) => v === 'system' || v === 'light' || v === 'dark'));

  get site(): SiteInfo | undefined {
    return this.sites.find((s) => s.id === this.siteId);
  }

  setSites(sites: SiteInfo[]) {
    this.sites = sites;
    if (!sites.some((s) => s.id === this.siteId)) this.siteId = sites[0]?.id ?? '';
  }

  setSite(id: string) {
    this.siteId = id;
    save('site', id);
  }

  get app(): AppInfo | undefined {
    return this.apps.find((a) => a.id === this.appId);
  }

  setApps(apps: AppInfo[]) {
    this.apps = apps;
    if (!apps.some((a) => a.id === this.appId)) this.appId = apps[0]?.id ?? '';
  }

  setApp(id: string) {
    this.appId = id;
    save('app', id);
  }

  /** Query parameters for the selected range in the Apps area ("All time" as far back as stored). */
  appRangeParams(): Params {
    if (this.preset === 'custom' && this.customStart && this.customEnd) return { start: this.customStart, end: this.customEnd };
    if (this.preset === 'all') {
      const first = (this.app?.data ?? [])
        .filter((d) => d.dataset === 'store' && d.firstDate)
        .map((d) => d.firstDate!)
        .sort()[0];
      return first ? { start: first } : { days: 3660 };
    }
    const p = PRESETS.find((x) => x.id === this.preset) ?? PRESETS[1]!;
    return { days: p.days };
  }

  setPreset(p: Exclude<Preset, 'custom'>) {
    this.preset = p;
    save('range', p);
  }

  setCustom(start: string, end: string) {
    this.preset = 'custom';
    this.customStart = start;
    this.customEnd = end;
    save('range', 'custom');
    save('customStart', start);
    save('customEnd', end);
  }

  setSource(s: Source) {
    this.source = s;
    save('source', s);
  }

  setBrand(b: Brand) {
    this.brand = b;
    save('brand', b);
  }

  setTheme(t: ThemePref) {
    this.theme = t;
    save('theme', t);
    applyTheme(t);
  }

  get rangeLabel(): string {
    if (this.preset === 'custom') return 'Custom range';
    return PRESETS.find((p) => p.id === this.preset)?.label ?? 'Last 28 days';
  }

  /** Earliest date with search data for the current site. */
  get firstDate(): string | null {
    const dates = (this.site?.data ?? []).filter((d) => d.dataset === 'search' && d.firstDate).map((d) => d.firstDate!);
    return dates.length ? dates.sort()[0]! : null;
  }

  /** Latest date with search data for a source (what the API uses as the default end). */
  latestDate(source: Source = 'gsc'): string | null {
    return this.site?.data.find((d) => d.dataset === 'search' && d.source === source)?.lastDate ?? null;
  }

  /**
   * Query parameters for the selected range. `relativeAll` keeps "All time"
   * relative to each dataset's own latest date (AI crawler and referral views).
   */
  rangeParams(opts: { relativeAll?: boolean } = {}): Params {
    if (this.preset === 'custom' && this.customStart && this.customEnd) return { start: this.customStart, end: this.customEnd };
    if (this.preset === 'all') {
      const first = this.firstDate;
      return !opts.relativeAll && first ? { start: first } : { days: 3660 };
    }
    const p = PRESETS.find((x) => x.id === this.preset) ?? PRESETS[1]!;
    return { days: p.days };
  }

  /** The selected range as absolute dates, when it can be resolved client-side. */
  absoluteRange(source: Source = 'gsc'): { start: string; end: string } | null {
    if (this.preset === 'custom' && this.customStart && this.customEnd) return { start: this.customStart, end: this.customEnd };
    const end = this.latestDate(source);
    if (!end) return null;
    if (this.preset === 'all') return this.firstDate ? { start: this.firstDate, end } : null;
    const p = PRESETS.find((x) => x.id === this.preset) ?? PRESETS[1]!;
    return { start: addDays(end, -((p.days ?? 28) - 1)), end };
  }
}

export const ui = new UiState();

export function applyTheme(t: ThemePref = ui.theme): void {
  const root = document.documentElement;
  if (t === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', t);
}

/** The theme actually in effect (resolving "system"). */
export function effectiveTheme(): 'light' | 'dark' {
  if (ui.theme !== 'system') return ui.theme;
  try {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}
