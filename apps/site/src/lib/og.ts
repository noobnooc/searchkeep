/**
 * Open Graph images: one per indexable page, each with its own line (seeded by the path),
 * rendered by scripts/render-assets.mjs into static/og/. The home page uses static/og.png.
 * Relative imports with extensions so the render script can import this file with Node.
 */
import { DOCS } from './docs.ts';

export interface OgPage {
  path: string;
  /** Small label above the title. */
  section: string;
  title: string;
  description: string;
}

export const OG_PAGES: OgPage[] = [
  ...DOCS.flatMap((s) =>
    s.pages.map((p) => ({
      path: p.path,
      section: p.path === '/docs' ? 'Docs' : `Docs · ${s.title}`,
      title: p.path === '/docs' ? 'Docs' : p.title,
      description: p.description,
    })),
  ),
  {
    path: '/changelog',
    section: 'Changelog',
    title: 'Changelog',
    description: 'Every Searchkeep release, with what changed and any upgrade steps.',
  },
  {
    path: '/privacy',
    section: 'Privacy',
    title: 'Privacy',
    description: 'No cookies, no trackers, no telemetry. Your data stays in your Cloudflare account.',
  },
];

/** The file name of a page's OG image under static/og/, or null for pages that use og.png. */
export function ogFile(path: string): string | null {
  if (!OG_PAGES.some((p) => p.path === path)) return null;
  return `${path.replace(/^\//, '').replace(/\//g, '-')}.png`;
}

/** The absolute path of a page's OG image on the site. */
export function ogImagePath(path: string): string {
  const file = ogFile(path);
  return file ? `/og/${file}` : '/og.png';
}

/**
 * A deterministic, slightly noisy climbing line for a page: `n` y values in [top, bottom],
 * rising from left to right. Seeded by the path so every page gets its own line.
 */
export function pageLine(path: string, n = 31, top = 20, bottom = 120): number[] {
  let h = 2166136261;
  for (const ch of path) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  let s = h >>> 0;
  const rand = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const span = bottom - top;
  return Array.from({ length: n }, (_, i) => {
    const trend = bottom - (span * 0.85 * i) / (n - 1);
    const noise = (i % 2 === 0 ? -1 : 1) * span * (0.03 + rand() * 0.06);
    return i === n - 1 ? top : Math.round(Math.min(bottom, Math.max(top, trend + noise)));
  });
}
