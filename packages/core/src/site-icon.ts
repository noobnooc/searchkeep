/**
 * Finds a site's own icon, for the dashboard's site switcher. Tried in order:
 * the `apple-touch-icon` links on the home page, the conventional
 * `/apple-touch-icon.png`, the `icon` links on the home page, then
 * `/favicon.ico`. Only URLs on the site's domain and its subdomains are
 * fetched, and a response counts only when its bytes are an image, so an HTML
 * "soft 404" is skipped.
 */
import { readCapped } from './http.js';
import { onSiteDomain } from './url.js';

export interface SiteIcon {
  /** Media type, read from the bytes (not from the server's header). */
  contentType: string;
  body: Uint8Array;
  /** Where the icon was found. */
  url: string;
}

export interface IconLink {
  url: string;
  kind: 'apple-touch-icon' | 'icon';
  /** Largest side in pixels from `sizes` (180 for an apple-touch-icon without it); Infinity for SVG or `any`; 0 when unknown. */
  size: number;
  /** The link applies only to some media, such as `(prefers-color-scheme: dark)`. */
  media: boolean;
}

export interface SiteIconOptions {
  fetch?: typeof fetch;
  /** Gives up after this long in total. Default 8 s. */
  timeoutMs?: number;
  /** Largest icon accepted, in bytes. Default 512 KB. */
  maxBytes?: number;
}

const HTML_BYTES = 256_000;
const DEFAULT_MAX_BYTES = 512_000;
const DEFAULT_TIMEOUT_MS = 8_000;
/** Declared links tried per kind: when the best one fails, the smaller variants usually fail too. */
const LINKS_PER_KIND = 2;
const USER_AGENT = 'Searchkeep icon reader';

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e: string) => {
    const k = e.toLowerCase();
    if (k.startsWith('#x')) return String.fromCodePoint(Number.parseInt(k.slice(2), 16));
    if (k.startsWith('#')) return String.fromCodePoint(Number.parseInt(k.slice(1), 10));
    return ENTITIES[k] ?? m;
  });
}

function attributes(tag: string): Map<string, string> {
  const attrs = new Map<string, string>();
  const body = tag.replace(/^<link\b/i, '').replace(/\/?>$/, '');
  for (const m of body.matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
    const name = m[1]!.toLowerCase();
    if (!attrs.has(name)) attrs.set(name, decodeEntities(m[2] ?? m[3] ?? m[4] ?? ''));
  }
  return attrs;
}

function largestSide(sizes: string): number {
  let max = 0;
  for (const token of sizes.toLowerCase().split(/\s+/)) {
    if (token === 'any') return Infinity;
    const m = /^(\d+)x(\d+)$/.exec(token);
    if (m) max = Math.max(max, Number(m[1]), Number(m[2]));
  }
  return max;
}

/**
 * The icons a page declares with `<link rel="apple-touch-icon">` and
 * `<link rel="icon">`, best first: apple-touch-icons before icons, links
 * without `media` first, then the largest (SVG counts as largest). URLs are
 * resolved against `baseUrl`; links that are not http(s) (such as `data:`)
 * are left out.
 */
export function parseIconLinks(html: string, baseUrl: string): IconLink[] {
  const text = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style|template)\b[\s\S]*?<\/\1\s*>/gi, '');
  const links: Array<IconLink & { order: number }> = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(/<link\b[^>]*>/gi)) {
    const attrs = attributes(m[0]);
    const rel = (attrs.get('rel') ?? '').toLowerCase().split(/\s+/);
    const kind =
      rel.includes('apple-touch-icon') || rel.includes('apple-touch-icon-precomposed')
        ? 'apple-touch-icon'
        : rel.includes('icon')
          ? 'icon'
          : null;
    const href = attrs.get('href')?.trim();
    if (!kind || !href) continue;
    let url: URL;
    try {
      url = new URL(href, baseUrl);
    } catch {
      continue;
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') continue;
    url.hash = '';
    if (seen.has(url.href)) continue;
    seen.add(url.href);
    const svg = (attrs.get('type') ?? '').toLowerCase() === 'image/svg+xml' || /\.svgz?$/i.test(url.pathname);
    const sizes = attrs.get('sizes');
    const size = svg ? Infinity : sizes ? largestSide(sizes) : kind === 'apple-touch-icon' ? 180 : 0;
    links.push({ url: url.href, kind, size, media: Boolean(attrs.get('media')?.trim()), order: links.length });
  }
  return links
    .sort(
      (a, b) =>
        Number(a.kind === 'icon') - Number(b.kind === 'icon') ||
        Number(a.media) - Number(b.media) ||
        (a.size === b.size ? 0 : b.size > a.size ? 1 : -1) ||
        a.order - b.order,
    )
    .map(({ order: _order, ...link }) => link);
}

/** The image type of `bytes` (PNG, ICO, GIF, JPEG, WebP, AVIF or SVG), or null when they are not an image. */
export function sniffImage(bytes: Uint8Array): string | null {
  const at = (i: number, ...sig: number[]) => sig.every((b, j) => bytes[i + j] === b);
  const ascii = (i: number, s: string) => at(i, ...Array.from(s, (ch) => ch.charCodeAt(0)));
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png';
  if (at(0, 0x00, 0x00, 0x01, 0x00)) return 'image/x-icon';
  if (ascii(0, 'GIF8')) return 'image/gif';
  if (at(0, 0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (ascii(0, 'RIFF') && ascii(8, 'WEBP')) return 'image/webp';
  if (ascii(4, 'ftypavif') || ascii(4, 'ftypavis')) return 'image/avif';
  const head = new TextDecoder().decode(bytes.subarray(0, 4096)).replace(/^﻿/, '').trimStart();
  if (head.startsWith('<') && /<svg[\s>]/i.test(head) && !/<!doctype html|<(?:html|head|body)[\s>]/i.test(head)) return 'image/svg+xml';
  return null;
}

async function read(
  f: typeof fetch,
  url: string,
  accept: string,
  max: number,
  signal: AbortSignal,
): Promise<{ url: string; bytes: Uint8Array; truncated: boolean } | null> {
  try {
    const res = await f(url, { headers: { accept, 'user-agent': USER_AGENT }, redirect: 'follow', signal });
    if (!res.ok || !res.body) {
      res.body?.cancel().catch(() => undefined);
      return null;
    }
    return { url: res.url || url, ...(await readCapped(res.body, max)) };
  } catch {
    // Network errors, timeouts and bot challenges all mean "no icon here".
    return null;
  }
}

/** The site's icon, or null when it declares none that loads. Never throws. */
export async function findSiteIcon(domain: string, opts: SiteIconOptions = {}): Promise<SiteIcon | null> {
  const f = opts.fetch ?? fetch;
  const max = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const signal = AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const home = `https://${domain}/`;

  const page = await read(f, home, 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5', HTML_BYTES, signal);
  const links = page ? parseIconLinks(new TextDecoder().decode(page.bytes), page.url) : [];
  const candidates = [
    ...links
      .filter((l) => l.kind === 'apple-touch-icon')
      .slice(0, LINKS_PER_KIND)
      .map((l) => l.url),
    new URL('/apple-touch-icon.png', home).href,
    ...links
      .filter((l) => l.kind === 'icon')
      .slice(0, LINKS_PER_KIND)
      .map((l) => l.url),
    new URL('/favicon.ico', home).href,
  ];

  const tried = new Set<string>();
  for (const url of candidates) {
    if (signal.aborted) break;
    if (tried.has(url) || !onSiteDomain(url, domain)) continue;
    tried.add(url);
    const icon = await read(f, url, 'image/avif,image/webp,image/svg+xml,image/*;q=0.9,*/*;q=0.5', max, signal);
    if (!icon || icon.truncated || icon.bytes.byteLength === 0) continue;
    const contentType = sniffImage(icon.bytes);
    if (contentType) return { contentType, body: icon.bytes, url };
  }
  return null;
}
