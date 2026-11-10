/**
 * Finds an app's own icon, for the dashboard's app switcher (ADR 0009). Tried in order:
 *
 * 1. App Store: the icon of the app's newest build, read from App Store Connect with the stored
 *    read-only key and downloaded from Apple's image CDN (`*.mzstatic.com`), which is where App
 *    Store Connect serves it.
 * 2. The app's linked site: that site's own icon (see `findSiteIcon`), which for most apps is the
 *    same artwork.
 *
 * Google Play has no API that returns the icon with read-only access, and store pages are never
 * read (charter), so a Google Play app shows its linked site's icon or its first letter.
 */
import type { AscClient, AscImageAsset } from './sources.js';
import { fetchIconImage, findSiteIcon, type SiteIcon } from './site-icon.js';
import type { AppConfig } from './types.js';

export interface AppIconOptions {
  /** App Store Connect client (the stored Sales and Reports key), when it is set up. */
  asc?: AscClient;
  /** Domain of the app's linked site, when it has one. */
  siteDomain?: string | null;
  fetch?: typeof fetch;
  /** Gives up after this long in total. Default 8 s. */
  timeoutMs?: number;
  /** Largest icon accepted, in bytes. Default 512 KB. */
  maxBytes?: number;
}

/** Pixel size requested from Apple's image CDN: sharp at the switcher's sizes on 2× screens. */
export const APP_ICON_SIZE = 128;
const DEFAULT_TIMEOUT_MS = 8_000;

/** True for https URLs on Apple's image CDN, the only host an App Store icon is downloaded from. */
export function onAppleImageCdn(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && (u.hostname === 'mzstatic.com' || u.hostname.endsWith('.mzstatic.com'));
  } catch {
    return false;
  }
}

/**
 * The URL of `asset` at `size` pixels (never larger than the original) as PNG, or null when the
 * template is not on Apple's image CDN.
 */
export function appleImageUrl(asset: AscImageAsset, size = APP_ICON_SIZE): string | null {
  const side = (original: number) => String(Math.max(1, Math.min(size, original > 0 ? original : size)));
  const url = asset.templateUrl.replace('{w}', side(asset.width)).replace('{h}', side(asset.height)).replace('{f}', 'png');
  return /[{}]/.test(url) || !onAppleImageCdn(url) ? null : url;
}

/** `promise`, or a rejection once `signal` aborts (the API call itself takes no signal). */
function beforeAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

/** The app's icon, or null when none of the sources has one. Never throws. */
export async function findAppIcon(app: AppConfig, opts: AppIconOptions = {}): Promise<SiteIcon | null> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;
  const signal = AbortSignal.timeout(timeoutMs);
  if (app.appleId && opts.asc) {
    try {
      const asset = await beforeAbort(opts.asc.latestBuildIcon(app.appleId), signal);
      const url = asset ? appleImageUrl(asset) : null;
      const icon = url ? await fetchIconImage(url, onAppleImageCdn, { fetch: opts.fetch, maxBytes: opts.maxBytes, signal }) : null;
      if (icon) return icon;
    } catch {
      // No access to builds (key role), no builds yet, or Apple unreachable: try the next source.
    }
  }
  const left = deadline - Date.now();
  if (opts.siteDomain && left > 0) {
    // The two sources share one time budget.
    return findSiteIcon(opts.siteDomain, { fetch: opts.fetch, maxBytes: opts.maxBytes, timeoutMs: left });
  }
  return null;
}
