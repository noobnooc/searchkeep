import { describe, expect, it } from 'vitest';
import { createBingClient, crawlIssueNames, parseBingDate } from '../src/index.js';

describe('bing', () => {
  it('parses WCF dates in their own offset', () => {
    expect(parseBingDate('/Date(1316156400000-0700)/')).toBe('2011-09-16');
    expect(parseBingDate('/Date(1700000000000)/')).toBe('2023-11-14');
    expect(parseBingDate(null)).toBeNull();
  });

  it('decodes crawl issue flags', () => {
    expect(crawlIssueNames(4 | 16)).toEqual(['Code4xx', 'BlockedByRobotsTxt']);
  });

  it('maps query stats and never leaks the key in errors', async () => {
    const ok = createBingClient({
      apiKey: 'k3y',
      fetch: (async () =>
        new Response(
          JSON.stringify({
            d: [
              {
                __type: 'QueryStats',
                Query: 'widgets',
                Date: '/Date(1700000000000)/',
                Clicks: 3,
                Impressions: 30,
                AvgImpressionPosition: 4.2,
              },
            ],
          }),
        )) as unknown as typeof fetch,
    });
    expect(await ok.getQueryStats('https://acme.com/')).toEqual([
      { date: '2023-11-14', query: 'widgets', clicks: 3, impressions: 30, avgImpressionPosition: 4.2 },
    ]);
    const bad = createBingClient({
      apiKey: 'k3y',
      fetch: (async () => new Response('{"Message":"Invalid API key","ErrorCode":3}', { status: 400 })) as unknown as typeof fetch,
    });
    const err = await bad.getUserSites().catch((e: Error) => e);
    expect(String(err)).toContain('Invalid API key');
    expect(String(err)).not.toContain('k3y');
  });
});
