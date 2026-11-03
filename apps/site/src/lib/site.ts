export const SITE = {
  name: 'Searchkeep',
  origin: 'https://searchkeep.dev',
  tagline: 'Your search data, kept.',
  description:
    'Self-hosted SEO & GEO analytics that runs in your own Cloudflare account. Connect Google Search Console, Bing Webmaster Tools and Cloudflare, see which pages AI crawlers read, cite and send clicks to, and ask about it over MCP.',
  repo: 'https://github.com/noobnooc/searchkeep',
  license: 'MIT',
  version: '0.1.0',
  releaseDate: '2026-11-03',
  lastUpdated: '2026-11-03',
} as const;

export const GITHUB = {
  repo: SITE.repo,
  issues: `${SITE.repo}/issues`,
  releases: `${SITE.repo}/releases`,
  deployRunbook: `${SITE.repo}/blob/main/docs/deploy.md`,
  agents: `${SITE.repo}/blob/main/AGENTS.md`,
  license: `${SITE.repo}/blob/main/LICENSE`,
  security: `${SITE.repo}/security`,
} as const;

/** Absolute canonical URL for a site path (no trailing slash except the root). */
export function absolute(path: string): string {
  if (path === '/' || path === '') return `${SITE.origin}/`;
  return `${SITE.origin}${path.replace(/\/$/, '')}`;
}
