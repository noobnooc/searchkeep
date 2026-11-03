import { DOC_PAGES } from './docs';

export interface SitePage {
  path: string;
  title: string;
  description: string;
  priority: number;
  changefreq: 'weekly' | 'monthly' | 'yearly';
}

/** Every indexable page, used by sitemap.xml and llms.txt. */
export const PAGES: SitePage[] = [
  {
    path: '/',
    title: 'Searchkeep',
    description: 'Self-hosted SEO & GEO analytics in your own Cloudflare account.',
    priority: 1,
    changefreq: 'weekly',
  },
  ...DOC_PAGES.map((p) => ({
    path: p.path,
    title: p.title,
    description: p.description,
    priority: p.path === '/docs' || p.path === '/docs/deploy' ? 0.9 : 0.8,
    changefreq: 'weekly' as const,
  })),
  {
    path: '/changelog',
    title: 'Changelog',
    description: 'Every Searchkeep release, with upgrade notes.',
    priority: 0.6,
    changefreq: 'weekly',
  },
  {
    path: '/privacy',
    title: 'Privacy',
    description: 'No cookies, no trackers, no telemetry.',
    priority: 0.3,
    changefreq: 'yearly',
  },
];
