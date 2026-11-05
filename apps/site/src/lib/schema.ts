import { SITE, absolute } from './site';
import type { Faq } from './content';

type Json = Record<string, unknown>;

export const organization: Json = {
  '@type': 'Organization',
  '@id': `${SITE.origin}/#organization`,
  name: SITE.name,
  url: `${SITE.origin}/`,
  logo: { '@type': 'ImageObject', url: `${SITE.origin}/icon-512.png`, width: 512, height: 512 },
  sameAs: [SITE.repo],
};

export const website: Json = {
  '@type': 'WebSite',
  '@id': `${SITE.origin}/#website`,
  name: SITE.name,
  url: `${SITE.origin}/`,
  description: SITE.description,
  inLanguage: 'en',
  publisher: { '@id': `${SITE.origin}/#organization` },
};

export const softwareApplication: Json = {
  '@type': 'SoftwareApplication',
  '@id': `${SITE.origin}/#software`,
  name: SITE.name,
  description: SITE.description,
  url: `${SITE.origin}/`,
  image: `${SITE.origin}/og.png`,
  screenshot: `${SITE.origin}/screenshots/dashboard-overview.webp`,
  applicationCategory: 'DeveloperApplication',
  applicationSubCategory: 'SEO and GEO analytics',
  operatingSystem: 'Cloudflare Workers',
  softwareVersion: SITE.version,
  datePublished: SITE.releaseDate,
  license: 'https://opensource.org/licenses/MIT',
  codeRepository: SITE.repo,
  downloadUrl: SITE.repo,
  isAccessibleForFree: true,
  offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
  publisher: { '@id': `${SITE.origin}/#organization` },
  featureList: [
    'GEO funnel per page: crawled by AI, cited by AI, clicked from AI',
    'Unlimited history beyond the 16 months kept by Google Search Console',
    'MCP server with 14 read-only analysis tools and one opt-in write',
    'Dashboard for Google Search Console, Bing Webmaster Tools and Cloudflare data',
    'Self-hosted in your own Cloudflare account, protected by Cloudflare Access',
  ],
};

export function faqPage(faqs: Faq[], path: string): Json {
  return {
    '@type': 'FAQPage',
    '@id': `${absolute(path)}#faq`,
    mainEntity: faqs.map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  };
}

export function breadcrumbs(items: { name: string; path: string }[]): Json {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: item.name,
      item: absolute(item.path),
    })),
  };
}

export function graph(nodes: Json[]): string {
  const json = JSON.stringify({ '@context': 'https://schema.org', '@graph': nodes });
  // Keep the payload inert inside a <script> element.
  return json.replace(/</g, '\\u003c');
}
