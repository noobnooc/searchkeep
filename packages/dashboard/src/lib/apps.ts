/** Labels and helpers shared by the Apps views (ADR 0009). */
import type { AppStore } from './types';

export const STORE_LABEL: Record<AppStore, string> = { apple: 'App Store', play: 'Google Play' };

export const APP_SOURCE_LABEL: Record<string, string> = {
  search: 'Search',
  browse: 'Browse',
  app_referrer: 'Other apps',
  web_referrer: 'Websites',
  referral: 'Third-party referrals',
  app_clip: 'App Clip',
  notification: 'Notifications',
  institutional: 'Institutional',
  unavailable: 'Unknown',
  other: 'Other',
};

export const sourceLabel = (s: string | undefined) => (s ? (APP_SOURCE_LABEL[s] ?? s.replace(/_/g, ' ')) : '');

/** Relative change (0.12 = +12%), or null when there is nothing to compare with. */
export function change(cur: number | null | undefined, prev: number | null | undefined): number | null {
  if (cur === null || cur === undefined || prev === null || prev === undefined || prev === 0) return null;
  return (cur - prev) / prev;
}

export const CHART_LABEL: Record<string, string> = { 'top-free': 'Top free', 'top-paid': 'Top paid', 'top-grossing': 'Top grossing' };

let regions: Intl.DisplayNames | null | undefined;
/** "United States" for `US`; the code itself when the browser has no name for it. */
export function regionName(code: string): string {
  if (regions === undefined) {
    try {
      regions = new Intl.DisplayNames(['en'], { type: 'region' });
    } catch {
      regions = null;
    }
  }
  try {
    return regions?.of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}

export function stars(n: number): string {
  const r = Math.max(0, Math.min(5, Math.round(n)));
  return '★'.repeat(r) + '☆'.repeat(5 - r);
}
