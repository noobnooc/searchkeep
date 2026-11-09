/**
 * App definitions: validation shared by the APPS secret and the dashboard (ADR 0009).
 */
import type { AppConfig } from '../types.js';

const APP_ID_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;
/** App Store Apple IDs are numeric. */
const APPLE_ID_RE = /^\d{5,15}$/;
/** Android application ids: at least two dot-separated segments, each starting with a letter. */
const PACKAGE_RE = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/;
const TERRITORY_RE = /^[a-z]{2}$/;
/** Storefronts read per app by the opt-in public feeds (each costs calls every day). */
export const MAX_PUBLIC_TERRITORIES = 5;

export function appIdFrom(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 63);
}

/** Accepts `1476097583`, `id1476097583` or an apps.apple.com URL. */
export function normalizeAppleId(input: string): string {
  const t = input.trim();
  const m = /(?:^|\/|id)(\d{5,15})(?:[/?#]|$)/.exec(t);
  return m ? m[1]! : t;
}

/** Accepts a package name or a play.google.com URL with `?id=`. */
export function normalizePlayPackage(input: string): string {
  const t = input.trim();
  try {
    if (/^https?:\/\//i.test(t)) return new URL(t).searchParams.get('id') ?? t;
  } catch {
    // not a URL
  }
  return t;
}

/**
 * Validates one app definition (from the APPS secret or the dashboard).
 * Returns the normalized app or a human-readable error.
 */
export function validateApp(input: unknown, label = 'app'): { app: AppConfig } | { error: string } {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return { error: `${label} must be an object.` };
  const o = input as Record<string, unknown>;
  const opt = (k: string) => (typeof o[k] === 'string' && (o[k] as string).trim() !== '' ? (o[k] as string).trim() : undefined);
  const name = opt('name');
  if (!name || name.length > 100) return { error: `${label}.name is required (at most 100 characters).` };
  const id = opt('id') ?? appIdFrom(name);
  if (!APP_ID_RE.test(id)) return { error: `${label}.id "${id.slice(0, 70)}" must use lowercase letters, digits and dashes.` };
  const app: AppConfig = { id, name };
  const apple = opt('appleId');
  if (apple) {
    const v = normalizeAppleId(apple);
    if (!APPLE_ID_RE.test(v))
      return { error: `${label}.appleId must be the numeric Apple ID (App Store Connect → App Information → Apple ID).` };
    app.appleId = v;
  }
  const pkg = opt('playPackage');
  if (pkg) {
    const v = normalizePlayPackage(pkg);
    if (!PACKAGE_RE.test(v) || v.length > 150) return { error: `${label}.playPackage must be a package name like "com.example.app".` };
    app.playPackage = v;
  }
  if (!app.appleId && !app.playPackage) return { error: `${label} needs an App Store Apple ID, a Google Play package name, or both.` };
  const siteId = opt('siteId');
  if (siteId) {
    if (!APP_ID_RE.test(siteId)) return { error: `${label}.siteId must be the id of one of your sites.` };
    app.siteId = siteId;
  }
  const raw = o.territories;
  if (raw !== undefined && raw !== null && raw !== '') {
    const list = (Array.isArray(raw) ? raw : String(raw).split(/[\s,]+/)).map((t) => String(t).trim().toLowerCase()).filter(Boolean);
    const bad = list.find((t) => !TERRITORY_RE.test(t));
    if (bad !== undefined)
      return { error: `${label}.territories must be two-letter storefront codes like "us, gb" ("${bad.slice(0, 10)}").` };
    const unique = [...new Set(list)];
    if (unique.length > MAX_PUBLIC_TERRITORIES) return { error: `${label}.territories: at most ${MAX_PUBLIC_TERRITORIES} storefronts.` };
    if (unique.length) app.territories = unique;
  }
  return { app };
}

export function parseApps(raw: string | null, errors: string[]): AppConfig[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    errors.push('APPS is not valid JSON.');
    return [];
  }
  if (!Array.isArray(parsed)) {
    errors.push('APPS must be a JSON array.');
    return [];
  }
  const out: AppConfig[] = [];
  const seen = new Set<string>();
  parsed.forEach((item, i) => {
    const res = validateApp(item, `APPS[${i}]`);
    if ('error' in res) {
      errors.push(res.error);
      return;
    }
    if (seen.has(res.app.id)) {
      errors.push(`APPS[${i}].id "${res.app.id}" is duplicated.`);
      return;
    }
    seen.add(res.app.id);
    out.push({ ...res.app, origin: 'secret' });
  });
  return out;
}
