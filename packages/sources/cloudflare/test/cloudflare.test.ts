import { describe, expect, it } from 'vitest';
import { PUBLIC_EMAIL_DOMAINS } from '@searchkeep/core';
import { broadPolicyReasons, createCloudflareClient, managedOAuthEnabled } from '../src/index.js';

describe('cloudflare', () => {
  it('detects broad Access policies', () => {
    expect(broadPolicyReasons([{ id: 'p', decision: 'allow', include: [{ email: { email: 'me@acme.com' } }] }], PUBLIC_EMAIL_DOMAINS)).toEqual([]);
    expect(broadPolicyReasons([{ id: 'p', name: 'all', decision: 'allow', include: [{ everyone: {} }] }], PUBLIC_EMAIL_DOMAINS)[0]).toMatch(/Everyone/);
    expect(broadPolicyReasons([{ id: 'p', decision: 'allow', include: [{ email_domain: { domain: 'Gmail.com' } }] }], PUBLIC_EMAIL_DOMAINS)[0]).toMatch(/gmail/i);
    expect(broadPolicyReasons([{ id: 'p', decision: 'bypass', include: [{ email: { email: 'a@b.c' } }] }], PUBLIC_EMAIL_DOMAINS)[0]).toMatch(/Bypass/);
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
                      { count: 4, quantiles: { largestContentfulPaintP75: 2_500_000, interactionToNextPaintP75: 80_000, cumulativeLayoutShiftP75: -1 }, dimensions: { requestHost: 'acme.com', requestPath: '/' } },
                    ],
                  },
                ],
              },
            },
          }),
        )) as unknown as typeof fetch,
    });
    expect(await cf.webVitals('acct', 'tag', '2026-10-01')).toEqual([{ date: '2026-10-01', host: 'acme.com', path: '/', lcpP75: 2500, inpP75: 80, clsP75: null, samples: 4 }]);
  });

  it('surfaces GraphQL errors', async () => {
    const cf = createCloudflareClient({ apiToken: 't', fetch: (async () => new Response(JSON.stringify({ data: null, errors: [{ message: 'zone not authorized' }] }))) as unknown as typeof fetch });
    await expect(cf.aiCrawlerRequests('z', '2026-10-01', ['GPTBot'])).rejects.toThrow(/zone not authorized/);
  });
});
