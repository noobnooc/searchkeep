import { describe, expect, it } from 'vitest';
import { isRateLimited } from '@searchkeep/core';
import { clearGscTokenCache, createGscClient, createSitemapReader, parseSitemap, signServiceAccountJwt } from '../src/index.js';

async function pemKey() {
  const pair = (await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair;
  const der = new Uint8Array((await crypto.subtle.exportKey('pkcs8', pair.privateKey)) as ArrayBuffer);
  let bin = '';
  for (const b of der) bin += String.fromCharCode(b);
  const b64 = btoa(bin)
    .match(/.{1,64}/g)!
    .join('\\n');
  return { pem: `-----BEGIN PRIVATE KEY-----\\n${b64}\\n-----END PRIVATE KEY-----\\n`, publicKey: pair.publicKey };
}

describe('gsc', () => {
  it('signs a verifiable service-account JWT (literal \\n in PEM accepted)', async () => {
    const { pem, publicKey } = await pemKey();
    const jwt = await signServiceAccountJwt('sa@p.iam.gserviceaccount.com', pem, 'scope-x', 1000);
    const [h, c, s] = jwt.split('.');
    const claims = JSON.parse(atob(c!.replace(/-/g, '+').replace(/_/g, '/')));
    expect(claims).toMatchObject({
      iss: 'sa@p.iam.gserviceaccount.com',
      scope: 'scope-x',
      aud: 'https://oauth2.googleapis.com/token',
      iat: 1000,
      exp: 4600,
    });
    const sig = Uint8Array.from(atob(s!.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s!.length % 4)) % 4)), (ch) =>
      ch.charCodeAt(0),
    );
    expect(await crypto.subtle.verify('RSASSA-PKCS1-v1_5', publicKey, sig, new TextEncoder().encode(`${h}.${c}`))).toBe(true);
  });

  it('exchanges a token once and queries search analytics', async () => {
    clearGscTokenCache();
    const { pem } = await pemKey();
    const calls: string[] = [];
    const fetchMock = (async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      if (url.includes('oauth2')) return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }));
      expect((init?.headers as Record<string, string>).authorization).toBe('Bearer tok');
      if (url.includes('searchAnalytics')) {
        expect(JSON.parse(String(init?.body))).toMatchObject({ dimensions: ['date'], rowLimit: 10, type: 'web', dataState: 'final' });
        return new Response(JSON.stringify({ rows: [{ keys: ['2026-10-01'], clicks: 1, impressions: 2, ctr: 0.5, position: 3 }] }));
      }
      return new Response(JSON.stringify({ siteEntry: [{ siteUrl: 'sc-domain:acme.com', permissionLevel: 'siteRestrictedUser' }] }));
    }) as typeof fetch;
    const gsc = createGscClient({ clientEmail: 'sa@x', privateKey: pem, fetch: fetchMock });
    const rows = await gsc.searchAnalytics({
      property: 'sc-domain:acme.com',
      startDate: '2026-10-01',
      endDate: '2026-10-01',
      dimensions: ['date'],
      rowLimit: 10,
    });
    expect(rows).toHaveLength(1);
    expect(await gsc.listProperties()).toHaveLength(1);
    expect(calls.filter((c) => c.includes('oauth2'))).toHaveLength(1);
    expect(calls[1]).toContain('/sites/sc-domain%3Aacme.com/searchAnalytics/query');
  });

  it('asks for other search types and filters by search appearance', async () => {
    clearGscTokenCache();
    const { pem } = await pemKey();
    const bodies: Array<Record<string, unknown>> = [];
    const fetchMock = (async (url: string, init?: RequestInit) => {
      if (url.includes('oauth2')) return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }));
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return new Response(JSON.stringify({ rows: [] }));
    }) as typeof fetch;
    const gsc = createGscClient({ clientEmail: 'sa@x', privateKey: pem, fetch: fetchMock });
    const base = { property: 'sc-domain:acme.com', startDate: '2026-10-01', endDate: '2026-10-30', rowLimit: 100 } as const;
    await gsc.searchAnalytics({ ...base, dimensions: ['date', 'page'], type: 'discover' });
    await gsc.searchAnalytics({ ...base, dimensions: ['date'], searchAppearance: 'VIDEO' });
    expect(bodies[0]).toMatchObject({ type: 'discover', dimensions: ['date', 'page'] });
    expect(bodies[0]).not.toHaveProperty('dimensionFilterGroups');
    expect(bodies[1]).toMatchObject({
      type: 'web',
      dimensionFilterGroups: [{ groupType: 'and', filters: [{ dimension: 'searchAppearance', operator: 'equals', expression: 'VIDEO' }] }],
    });
  });

  it('reads rich result types and issues from URL inspections, and leaves the deprecated indexed count out', async () => {
    clearGscTokenCache();
    const { pem } = await pemKey();
    const fetchMock = (async (url: string) => {
      if (url.includes('oauth2')) return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }));
      if (url.includes('sitemaps')) {
        return new Response(
          JSON.stringify({
            sitemap: [{ path: 'https://acme.com/sitemap.xml', contents: [{ type: 'web', submitted: '12', indexed: '0' }] }],
          }),
        );
      }
      return new Response(
        JSON.stringify({
          inspectionResult: {
            indexStatusResult: { verdict: 'PASS', coverageState: 'Submitted and indexed' },
            richResultsResult: {
              verdict: 'FAIL',
              detectedItems: [
                { richResultType: 'Breadcrumbs', items: [{ name: 'Unnamed item' }] },
                {
                  richResultType: 'Product snippets',
                  items: [
                    { name: 'A', issues: [{ issueMessage: 'Missing field "name"', severity: 'ERROR' }] },
                    { name: 'B', issues: [{ issueMessage: 'Missing field "name"', severity: 'ERROR' }] },
                  ],
                },
              ],
            },
          },
        }),
      );
    }) as typeof fetch;
    const gsc = createGscClient({ clientEmail: 'sa@x', privateKey: pem, fetch: fetchMock });
    expect(await gsc.inspectUrl('sc-domain:acme.com', 'https://acme.com/p')).toMatchObject({
      verdict: 'PASS',
      richResultsVerdict: 'FAIL',
      richResultTypes: ['Breadcrumbs', 'Product snippets'],
      richResultIssues: [{ type: 'Product snippets', severity: 'ERROR', message: 'Missing field "name"' }],
    });
    expect(await gsc.listSitemaps('sc-domain:acme.com')).toEqual([expect.objectContaining({ submitted: 12, indexed: null })]);
  });

  it('refuses to submit sitemaps unless writes are enabled', async () => {
    const gsc = createGscClient({
      clientEmail: 'sa@x',
      privateKey: 'x',
      fetch: (async () => new Response('{}')) as unknown as typeof fetch,
    });
    await expect(gsc.submitSitemap('sc-domain:acme.com', 'https://acme.com/sitemap.xml')).rejects.toThrow(/writes are disabled/);
  });
});

describe('sitemaps', () => {
  it('parses url sets, sitemap indexes and plain-text sitemaps', () => {
    const urlset = `<?xml version="1.0" encoding="UTF-8"?>
      <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
        <url><loc>https://acme.com/a?x=1&amp;y=2</loc><image:image><image:loc>https://acme.com/a.png</image:loc></image:image></url>
        <url><loc> <![CDATA[https://acme.com/b]]> </loc></url>
        <url><loc>not a url</loc></url>
      </urlset>`;
    expect(parseSitemap(urlset)).toEqual({ urls: ['https://acme.com/a?x=1&y=2', 'https://acme.com/b'], sitemaps: [] });
    const index = '<sitemapindex><sitemap><loc>https://acme.com/s1.xml</loc></sitemap></sitemapindex>';
    expect(parseSitemap(index)).toEqual({ urls: [], sitemaps: ['https://acme.com/s1.xml'] });
    expect(parseSitemap('https://acme.com/\nhttps://acme.com/c\n# comment\n')).toEqual({
      urls: ['https://acme.com/', 'https://acme.com/c'],
      sitemaps: [],
    });
  });

  it('reads gzipped sitemaps, caps large ones and never reports the site as a rate limit', async () => {
    const xml = '<urlset><url><loc>https://acme.com/z</loc></url></urlset>';
    const gz = new Uint8Array(await new Response(new Blob([xml]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
    const seen: Array<string | null> = [];
    const reader = createSitemapReader({
      fetch: (async (url: string, init?: RequestInit) => {
        seen.push(new Headers(init?.headers).get('user-agent'));
        if (url.endsWith('.gz')) return new Response(gz);
        if (url.endsWith('big.xml')) return new Response(`<urlset>${'<url><loc>https://acme.com/p</loc></url>'.repeat(100)}</urlset>`);
        return new Response('slow down', { status: 429 });
      }) as typeof fetch,
      maxBytes: 200,
    });
    expect(await reader.read('https://acme.com/sitemap.xml.gz')).toEqual({ urls: ['https://acme.com/z'], sitemaps: [] });
    const big = await reader.read('https://acme.com/big.xml');
    expect(big.truncated).toBe(true);
    expect(big.urls.length).toBeGreaterThan(0);
    expect(big.urls.length).toBeLessThan(100);
    const err = await reader.read('https://acme.com/missing.xml').catch((e: Error) => e);
    expect(String(err)).toContain('HTTP 429');
    expect(isRateLimited(err)).toBe(false);
    expect(seen[0]).toBe('Searchkeep sitemap reader');
  });
});
