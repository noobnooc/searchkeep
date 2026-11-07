/**
 * Reads the site's own sitemaps (sitemaps.org protocol) for the index coverage
 * snapshot: `<urlset>` files list pages, `<sitemapindex>` files list further
 * sitemaps, and plain-text sitemaps list one URL per line. Gzipped files are
 * unpacked with DecompressionStream. Reads at most `maxBytes` per file.
 */
import { readCapped, SourceError, type SitemapContents, type SitemapReader } from '@searchkeep/core';

export interface SitemapReaderOptions {
  fetch?: typeof fetch;
  /** Bytes read per file (after unpacking); the rest is ignored. Default 5 MB. */
  maxBytes?: number;
}

const DEFAULT_MAX_BYTES = 5_000_000;

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeXml(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e: string) => {
    const k = e.toLowerCase();
    if (k.startsWith('#x')) return String.fromCodePoint(Number.parseInt(k.slice(2), 16));
    if (k.startsWith('#')) return String.fromCodePoint(Number.parseInt(k.slice(1), 10));
    return ENTITIES[k] ?? m;
  });
}

/**
 * Page URLs and child sitemaps of one sitemap file. Only `<loc>` elements count:
 * `<image:loc>`, `<video:content_loc>` and alternates are not pages.
 */
export function parseSitemap(text: string): SitemapContents {
  const t = text.replace(/^﻿/, '').trim();
  const isUrl = (u: string) => /^https?:\/\//i.test(u);
  if (!t.startsWith('<')) {
    return {
      urls: t
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(isUrl),
      sitemaps: [],
    };
  }
  const isIndex = /<(?:[\w-]+:)?sitemapindex[\s>]/i.test(t);
  const locs: string[] = [];
  for (const m of t.matchAll(/<loc>\s*(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?\s*<\/loc>/gi)) {
    const url = decodeXml(m[1]!.trim());
    if (isUrl(url)) locs.push(url);
  }
  return isIndex ? { urls: [], sitemaps: locs } : { urls: locs, sitemaps: [] };
}

export function createSitemapReader(opts: SitemapReaderOptions = {}): SitemapReader {
  const f = opts.fetch ?? fetch;
  const max = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  return {
    async read(url: string): Promise<SitemapContents> {
      let res: Response;
      try {
        res = await f(url, {
          headers: { accept: 'application/xml, text/xml, text/plain;q=0.9, */*;q=0.5', 'user-agent': 'Searchkeep sitemap reader' },
          redirect: 'follow',
        });
      } catch (err) {
        throw new SourceError('sitemap', 0, `network error (${err instanceof Error ? err.name : 'unknown'})`, { rateLimited: false });
      }
      // The site's own server: its errors never pause Search Console.
      if (!res.ok || !res.body) throw new SourceError('sitemap', res.status, `HTTP ${res.status}`, { rateLimited: false });
      let { bytes, truncated } = await readCapped(res.body, max);
      // A .xml.gz file served as-is (not with Content-Encoding, which fetch unpacks itself).
      if (bytes[0] === 0x1f && bytes[1] === 0x8b && !truncated) {
        const unpacked = new Blob([bytes as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream('gzip'));
        ({ bytes, truncated } = await readCapped(unpacked, max));
      }
      const contents = parseSitemap(new TextDecoder().decode(bytes));
      return truncated ? { ...contents, truncated: true } : contents;
    },
  };
}
