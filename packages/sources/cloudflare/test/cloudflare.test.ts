import { describe, expect, it } from 'vitest';
import { isRateLimited, PUBLIC_EMAIL_DOMAINS } from '@searchkeep/core';
import { broadPolicyReasons, createCloudflareClient, managedOAuthEnabled } from '../src/index.js';

describe('cloudflare', () => {
  it('detects broad Access policies', () => {
    expect(
      broadPolicyReasons([{ id: 'p', decision: 'allow', include: [{ email: { email: 'me@acme.com' } }] }], PUBLIC_EMAIL_DOMAINS),
    ).toEqual([]);
    expect(broadPolicyReasons([{ id: 'p', name: 'all', decision: 'allow', include: [{ everyone: {} }] }], PUBLIC_EMAIL_DOMAINS)[0]).toMatch(
      /Everyone/,
    );
    expect(
      broadPolicyReasons([{ id: 'p', decision: 'allow', include: [{ email_domain: { domain: 'Gmail.com' } }] }], PUBLIC_EMAIL_DOMAINS)[0],
    ).toMatch(/gmail/i);
    expect(
      broadPolicyReasons([{ id: 'p', decision: 'bypass', include: [{ email: { email: 'a@b.c' } }] }], PUBLIC_EMAIL_DOMAINS)[0],
    ).toMatch(/Bypass/);
    expect(broadPolicyReasons([], PUBLIC_EMAIL_DOMAINS)[0]).toMatch(/No Allow policy/);
  });

  it('reads Managed OAuth state', () => {
    expect(managedOAuthEnabled({ id: 'a', aud: 'x' })).toBe(false);
    expect(managedOAuthEnabled({ id: 'a', aud: 'x', oauth_configuration: {} })).toBe(true);
    expect(managedOAuthEnabled({ id: 'a', aud: 'x', oauth_configuration: { enabled: false } })).toBe(false);
  });

  it('converts Web Vitals from microseconds and drops -1', async () => {
    const cf = createCloudflareClient({
      apiToken: 't',
      fetch: (async () =>
        new Response(
          JSON.stringify({
            data: {
              viewer: {
                accounts: [
                  {
                    rumWebVitalsEventsAdaptiveGroups: [
                      {
                        count: 4,
                        quantiles: {
                          largestContentfulPaintP75: 2_500_000,
                          interactionToNextPaintP75: 80_000,
                          cumulativeLayoutShiftP75: -1,
                        },
                        dimensions: { date: '2026-10-02', requestHost: 'acme.com', requestPath: '/' },
                      },
                    ],
                  },
                ],
              },
            },
          }),
        )) as unknown as typeof fetch,
    });
    // A range query: each row carries its own day.
    expect(await cf.webVitals('acct', 'tag', { start: '2026-10-01', end: '2026-10-31' })).toEqual({
      complete: true,
      rows: [{ date: '2026-10-02', host: 'acme.com', path: '/', lcpP75: 2500, inpP75: 80, clsP75: null, samples: 4 }],
    });
  });

  it('lists zones and Web Analytics sites across pages', async () => {
    const cf = createCloudflareClient({
      apiToken: 't',
      fetch: (async (url: string) => {
        if (url.includes('/zones')) {
          const page = Number(new URL(url).searchParams.get('page'));
          return Response.json({
            success: true,
            result: [{ id: `z${page}`, name: `site${page}.com` }],
            result_info: { page, total_pages: 2 },
          });
        }
        return Response.json({
          success: true,
          result: [{ site_tag: 'abc', host: null, ruleset: { zone_name: 'acme.com' } }],
          result_info: { page: 1, total_pages: 1 },
        });
      }) as unknown as typeof fetch,
    });
    expect(await cf.listZones!('acct')).toEqual([
      { id: 'z1', name: 'site1.com' },
      { id: 'z2', name: 'site2.com' },
    ]);
    expect(await cf.listWebAnalyticsSites!('acct')).toEqual([{ siteTag: 'abc', host: 'acme.com' }]);
  });

  it('surfaces GraphQL errors', async () => {
    const cf = createCloudflareClient({
      apiToken: 't',
      fetch: (async () =>
        new Response(JSON.stringify({ data: null, errors: [{ message: 'zone not authorized' }] }))) as unknown as typeof fetch,
    });
    await expect(cf.aiCrawlerRequests('z', { start: '2026-10-01', end: '2026-10-01' }, ['GPTBot'])).rejects.toThrow(/zone not authorized/);
  });

  it('asks for whole days and flags a range that hit the page limit', async () => {
    let variables: Record<string, string> = {};
    const full = Array.from({ length: 10_000 }, (_, i) => ({
      count: 1,
      dimensions: {
        date: '2026-10-01',
        userAgent: 'GPTBot',
        clientRequestHTTPHost: 'acme.com',
        clientRequestPath: `/${i}`,
        edgeResponseStatus: 200,
      },
    }));
    const cf = createCloudflareClient({
      apiToken: 't',
      fetch: (async (_url: string, init: RequestInit) => {
        variables = (JSON.parse(String(init.body)) as { variables: Record<string, string> }).variables;
        return new Response(JSON.stringify({ data: { viewer: { zones: [{ httpRequestsAdaptiveGroups: full }] } } }));
      }) as unknown as typeof fetch,
    });
    const res = await cf.aiCrawlerRequests('z', { start: '2026-10-01', end: '2026-10-30' }, ['GPTBot']);
    expect(variables).toMatchObject({ start: '2026-10-01T00:00:00Z', end: '2026-10-31T00:00:00Z' });
    expect(res.complete).toBe(false);
  });

  it('flags the GraphQL rate limit as a rate limit', async () => {
    const cf = createCloudflareClient({
      apiToken: 't',
      fetch: (async () =>
        new Response(
          JSON.stringify({
            data: null,
            errors: [{ message: 'Rate limiter budget depleted. Please try again after 5 minutes.', extensions: { code: 'budget' } }],
          }),
        )) as unknown as typeof fetch,
    });
    const err = await cf.webAnalytics('acct', 'tag', { start: '2026-10-01', end: '2026-10-01' }).catch((e: unknown) => e);
    expect(isRateLimited(err)).toBe(true);
    expect((err as { retryAfterMs: number }).retryAfterMs).toBe(300_000);
  });
});
