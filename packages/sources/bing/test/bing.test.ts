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

  it('switches to the fallback transport when Bing refuses the IP (ThrottleIP), and stays on it', async () => {
    const sites = JSON.stringify({ d: [{ Url: 'https://acme.com/', IsVerified: true }] });
    let direct = 0;
    let fallback = 0;
    let switched = 0;
    const client = createBingClient({
      apiKey: 'k3y',
      fetch: (async () => {
        direct++;
        return new Response('{"ErrorCode":17,"Message":"ERROR!!! ThrottleIP"}', { status: 400 });
      }) as unknown as typeof fetch,
      fallbackFetch: (async () => {
        fallback++;
        return new Response(sites);
      }) as unknown as typeof fetch,
      onFallback: () => switched++,
    });
    expect(await client.getUserSites()).toEqual([{ url: 'https://acme.com/', verified: true }]);
    expect(await client.getUserSites()).toHaveLength(1);
    expect({ direct, fallback, switched }).toEqual({ direct: 1, fallback: 2, switched: 1 });
  });

  it('keeps other errors, and ThrottleIP without a fallback, as they are', async () => {
    let fallback = 0;
    const fallbackFetch = (async () => {
      fallback++;
      return new Response('{"d":[]}');
    }) as unknown as typeof fetch;
    const throttledUser = createBingClient({
      apiKey: 'k3y',
      fetch: (async () => new Response('{"ErrorCode":4,"Message":"ERROR!!! ThrottleUser"}', { status: 400 })) as unknown as typeof fetch,
      fallbackFetch,
    });
    const err = await throttledUser.getUserSites().catch((e: Error) => e);
    expect(isRateLimited(err)).toBe(true);
    expect(String(err)).toContain('ThrottleUser');
    expect(fallback).toBe(0);
    const noFallback = createBingClient({
      apiKey: 'k3y',
      fetch: (async () => new Response('{"ErrorCode":17,"Message":"ERROR!!! ThrottleIP"}', { status: 400 })) as unknown as typeof fetch,
    });
    expect(String(await noFallback.getUserSites().catch((e: Error) => e))).toContain('ThrottleIP');
  });
});
