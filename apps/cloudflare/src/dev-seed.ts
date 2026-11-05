/**
 * Demo data for local development (`pnpm dev`), so the dashboard has
 * something to show without real credentials. Never reachable in production.
 */
import {
  addDays,
  AI_CRAWLERS,
  normalizePage,
  SEARCH_CRAWLERS,
  toIsoDate,
  type AppearanceInput,
  type SearchFactInput,
  type Store,
  type UrlInspectionInput,
} from '@searchkeep/core';

function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

const PAGES = [
  '/',
  '/pricing',
  '/blog/what-is-geo',
  '/blog/ai-crawlers-explained',
  '/blog/gsc-16-month-limit',
  '/docs/getting-started',
  '/docs/mcp',
  '/compare/searchkeep-vs-saas',
  '/blog/llms-txt',
  '/changelog',
];
const QUERIES: Array<[string, string, number, number]> = [
  ['acme analytics', '/', 2.1, 900],
  ['acme pricing', '/pricing', 1.6, 300],
  ['what is generative engine optimization', '/blog/what-is-geo', 9.4, 2600],
  ['geo vs seo', '/blog/what-is-geo', 11.2, 1800],
  ['gptbot user agent', '/blog/ai-crawlers-explained', 6.3, 1400],
  ['block ai crawlers robots.txt', '/blog/ai-crawlers-explained', 13.8, 2100],
  ['search console 16 months data', '/blog/gsc-16-month-limit', 4.2, 700],
  ['export search console data', '/blog/gsc-16-month-limit', 8.9, 1500],
  ['mcp server seo', '/docs/mcp', 7.1, 650],
  ['llms.txt example', '/blog/llms-txt', 15.5, 3200],
  ['llms.txt', '/blog/llms-txt', 18.2, 4100],
  ['self hosted seo tool', '/compare/searchkeep-vs-saas', 12.4, 1900],
  ['self hosted seo tool', '/', 16.8, 700],
];

export async function seedDemo(store: Store, siteId: string, domain: string, today = toIsoDate(new Date())): Promise<number> {
  const r = rng(42);
  let n = 0;
  const end = addDays(today, -3);
  const days = 540;
  for (let chunk = 0; chunk < days; chunk += 30) {
    const facts: SearchFactInput[] = [];
    for (let i = chunk; i < Math.min(days, chunk + 30); i++) {
      const date = addDays(end, -i);
      const growth = 1 + (days - i) / days;
      const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
      const season = weekday === 0 || weekday === 6 ? 0.7 : 1;
      let tc = 0;
      let ti = 0;
      for (const [q, page, pos, imp] of QUERIES) {
        const decay = page === '/blog/gsc-16-month-limit' && i < 90 ? 0.35 + i / 140 : 1;
        const impressions = Math.round((imp / 30) * growth * season * (0.8 + r() * 0.4));
        const position = Math.max(1, pos + (r() - 0.5) * 2);
        const ctrBase = position < 3 ? 0.25 : position < 6 ? 0.08 : position < 10 ? 0.03 : 0.008;
        const ctr = q === 'what is generative engine optimization' ? ctrBase * 0.3 : ctrBase;
        const clicks = Math.round(impressions * ctr * decay * (0.7 + r() * 0.6));
        tc += clicks;
        ti += impressions;
        facts.push({ date, kind: 'query_page', query: q, page, clicks, impressions, position });
      }
      facts.push({ date, kind: 'total', clicks: Math.round(tc * 1.25), impressions: Math.round(ti * 1.3), position: 9.1 });
    }
    n += await store.writeSearchFacts(siteId, 'gsc', facts);
  }
  // Bing: weekly buckets.
  const bing: SearchFactInput[] = [];
  for (let w = 0; w < 26; w++) {
    const date = addDays(end, -w * 7);
    bing.push({ date, kind: 'total', clicks: Math.round(140 + r() * 60), impressions: Math.round(3800 + r() * 900) });
    for (const [q, page, pos, imp] of QUERIES.slice(0, 8)) {
      bing.push({
        date,
        kind: 'query',
        query: q,
        clicks: Math.round(imp / 40 + r() * 5),
        impressions: Math.round(imp / 5),
        position: pos + 1,
      });
      bing.push({ date, kind: 'page', page, clicks: Math.round(imp / 50), impressions: Math.round(imp / 6), position: pos });
    }
  }
  n += await store.writeSearchFacts(siteId, 'bing', bing);
  // Search Console image search and search appearance for the last 90 days.
  const image: SearchFactInput[] = [];
  const appearances: AppearanceInput[] = [];
  for (let i = 0; i < 90; i++) {
    const date = addDays(end, -i);
    image.push({ date, kind: 'total', clicks: Math.round(4 + r() * 6), impressions: Math.round(300 + r() * 200), position: 14 });
    image.push({
      date,
      kind: 'query_page',
      query: 'gptbot user agent',
      page: '/blog/ai-crawlers-explained',
      clicks: Math.round(r() * 4),
      impressions: Math.round(80 + r() * 60),
      position: 9,
    });
    appearances.push({ date, appearance: 'VIDEO', clicks: Math.round(3 + r() * 5), impressions: Math.round(90 + r() * 40), position: 6.5 });
    appearances.push({
      date,
      appearance: 'REVIEW_SNIPPET',
      clicks: Math.round(r() * 3),
      impressions: Math.round(30 + r() * 20),
      position: 8,
    });
  }
  n += await store.writeSearchFacts(siteId, 'gsc', image, 'image');
  n += await store.writeSearchAppearances(siteId, 'web', appearances);
  // Cloudflare: AI crawlers and AI referrals for the last 30 days.
  const crawlers = AI_CRAWLERS.slice(0, 12);
  for (let i = 0; i < 30; i++) {
    const date = addDays(today, -1 - i);
    n += await store.writeCrawlerRequests(
      siteId,
      PAGES.flatMap((path, pi) =>
        crawlers
          .filter((_c, ci) => (ci + pi + i) % 3 !== 0)
          .map((c, ci) => ({
            date,
            crawler: c.name,
            operator: c.operator,
            purpose: c.purpose,
            path: normalizePage(path, domain),
            status: (ci + pi) % 11 === 0 ? 404 : 200,
            requests: Math.round(2 + r() * (c.purpose === 'training' ? 30 : 10)),
          })),
      ),
    );
    n += await store.writeCrawlerRequests(
      siteId,
      PAGES.flatMap((path, pi) =>
        SEARCH_CRAWLERS.filter((c) => ['Googlebot', 'Googlebot-Image', 'Bingbot', 'Applebot', 'YandexBot'].includes(c.name)).map(
          (c, ci) => ({
            date,
            crawler: c.name,
            operator: c.operator,
            purpose: c.purpose,
            path: normalizePage(path, domain),
            status: (ci + pi + i) % 17 === 0 ? 404 : (ci + pi) % 9 === 0 ? 301 : 200,
            requests: Math.round(1 + r() * (c.name === 'Googlebot' ? 40 : 8)),
          }),
        ),
      ),
      'search',
    );
    n += await store.writeWebAnalytics(
      siteId,
      PAGES.flatMap((path) => [
        { date, path, refererHost: 'www.google.com', visits: Math.round(10 + r() * 40), pageViews: Math.round(14 + r() * 50) },
        {
          date,
          path,
          refererHost: 'chatgpt.com',
          visits: Math.round(r() * (path.startsWith('/blog') ? 9 : 2)),
          pageViews: Math.round(r() * 10),
        },
        { date, path, refererHost: 'www.perplexity.ai', visits: Math.round(r() * 4), pageViews: Math.round(r() * 5) },
        { date, path, refererHost: '', visits: Math.round(5 + r() * 20), pageViews: Math.round(6 + r() * 25) },
      ]),
    );
    n += await store.writeWebVitals(
      siteId,
      PAGES.map((path) => ({
        date,
        path,
        lcpP75: Math.round(1400 + r() * 1800),
        inpP75: Math.round(80 + r() * 220),
        clsP75: Math.round(r() * 150) / 1000,
        samples: Math.round(20 + r() * 80),
      })),
    );
  }
  n += await store.writeAiCitations(
    siteId,
    PAGES.slice(1, 7).map((page, i) => ({ date: addDays(today, -7), page, surface: 'bing_copilot', citations: 40 - i * 6 })),
  );
  await store.replaceSitemaps(siteId, 'gsc', [
    {
      path: `https://${domain}/sitemap.xml`,
      lastSubmitted: `${addDays(today, -20)}T08:00:00Z`,
      lastDownloaded: `${addDays(today, -1)}T03:12:00Z`,
      errors: 0,
      warnings: 0,
      submitted: 128,
      indexed: null,
    },
  ]);
  // Index coverage: the sitemap's URLs, most inspected.
  const urls = PAGES.map((p) => `https://${domain}${p}`);
  n += await store.addIndexUrls(siteId, urls, addDays(today, -1), 5_000);
  const states: Array<[string, string]> = [
    ['PASS', 'Submitted and indexed'],
    ['PASS', 'Submitted and indexed'],
    ['NEUTRAL', 'Crawled - currently not indexed'],
    ['PASS', 'Submitted and indexed'],
    ['NEUTRAL', 'Duplicate, Google chose different canonical than user'],
    ['PASS', 'Submitted and indexed'],
    ['PASS', 'Submitted and indexed'],
    ['FAIL', 'Soft 404'],
  ];
  n += await store.writeUrlInspections(
    siteId,
    states.map(([verdict, coverageState], i): UrlInspectionInput => ({
      url: urls[i]!,
      inspectedAt: `${addDays(today, -1 - (i % 3))}T04:00:00.000Z`,
      verdict,
      coverageState,
      indexingState: 'INDEXING_ALLOWED',
      pageFetchState: verdict === 'FAIL' ? 'SOFT_404' : 'SUCCESSFUL',
      robotsTxtState: 'ALLOWED',
      lastCrawlTime: `${addDays(today, -4 - i)}T11:20:00Z`,
      googleCanonical: verdict === 'PASS' ? urls[i]! : null,
      userCanonical: urls[i]!,
      crawledAs: 'MOBILE',
      richResultsVerdict: i === 2 || i === 5 ? (i === 5 ? 'FAIL' : 'PASS') : null,
      richResultTypes: i === 2 || i === 5 ? ['Breadcrumbs', 'FAQ'] : [],
      richResultIssues: i === 5 ? [{ type: 'FAQ', severity: 'ERROR', message: 'Missing field "acceptedAnswer"' }] : [],
    })),
  );
  await store.replaceCrawlIssues(siteId, 'bing', [
    { url: `https://${domain}/old-page`, issue: 'Code4xx', httpCode: 404, detectedAt: today },
  ]);
  return n;
}
