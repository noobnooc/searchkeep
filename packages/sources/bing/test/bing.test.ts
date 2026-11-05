import { describe, expect, it } from 'vitest';
import { isRateLimited } from '@searchkeep/core';
import { bingThrottle, createBingClient, crawlIssueNames, parseBingDate } from '../src/index.js';

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
    expect(isRateLimited(err)).toBe(false);
  });

  it('recognizes throttling, which Bing answers with HTTP 400, without retrying', async () => {
    expect(bingThrottle('{"ErrorCode":4,"Message":"ERROR!!! ThrottleUser"}')).toBe('ThrottleUser');
    expect(bingThrottle('{"ErrorCode":5}')).toBe('ThrottleHost');
    // What Workers get from Bing: Cloudflare's egress IPs are throttled.
    expect(bingThrottle('{"ErrorCode":17,"Message":"ERROR!!! ThrottleIP"}')).toBe('ThrottleIP');
    expect(bingThrottle('{"ErrorCode":99,"Message":"ERROR!!! ThrottleSomething"}')).toBe('ThrottleSomething');
    expect(bingThrottle('{"ErrorCode":3,"Message":"Invalid API key"}')).toBeNull();
    expect(bingThrottle('not json')).toBeNull();
    let calls = 0;
    const throttled = createBingClient({
      apiKey: 'k3y',
      fetch: (async () => {
        calls++;
        return new Response('{"ErrorCode":4,"Message":"ERROR!!! ThrottleUser"}', { status: 400 });
      }) as unknown as typeof fetch,
    });
    const err = await throttled.getQueryStats('https://acme.com/').catch((e: Error) => e);
    expect(isRateLimited(err)).toBe(true);
    expect(String(err)).toContain('rate limited by Bing (ThrottleUser)');
    expect(String(err)).not.toContain('k3y');
    expect(calls).toBe(1);
  });
});
