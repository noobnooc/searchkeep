import { PAGES } from '#lib/pages.ts';
import { SITE, absolute } from '#lib/site.ts';

export const prerender = true;

export function GET() {
  const urls = PAGES.map(
    (p) => `  <url>
    <loc>${absolute(p.path)}</loc>
    <lastmod>${SITE.lastUpdated}</lastmod>
    <changefreq>${p.changefreq}</changefreq>
    <priority>${p.priority.toFixed(1)}</priority>
  </url>`,
  ).join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;
  return new Response(xml, { headers: { 'content-type': 'application/xml; charset=utf-8' } });
}
