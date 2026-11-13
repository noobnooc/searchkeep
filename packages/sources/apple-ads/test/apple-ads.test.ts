import { describe, expect, it } from 'vitest';
import { SourceError } from '@searchkeep/core';
import { clearAppleAdsTokenCache, createAppleAdsClient, sec1ToPkcs8, signAppleAdsSecret } from '../src/index.js';

/** A P-256 key as OpenSSL's `ecparam -genkey` writes it (SEC1, `EC PRIVATE KEY`), cut out of the PKCS#8 export. */
async function sec1Pem() {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const pkcs8 = new Uint8Array((await crypto.subtle.exportKey('pkcs8', pair.privateKey)) as ArrayBuffer);
  // PKCS#8 = SEQUENCE { INTEGER 0, AlgorithmIdentifier (21 bytes), OCTET STRING { ECPrivateKey } }.
  const header = (at: number) => (pkcs8[at + 1]! & 0x80 ? 2 + (pkcs8[at + 1]! & 0x7f) : 2);
  const length = (at: number) => {
    const b = pkcs8[at + 1]!;
    if (!(b & 0x80)) return b;
    let n = 0;
    for (let k = 0; k < (b & 0x7f); k++) n = (n << 8) | pkcs8[at + 2 + k]!;
    return n;
  };
  const octet = header(0) + 3 + 21;
  const sec1 = pkcs8.subarray(octet + header(octet), octet + header(octet) + length(octet));
  let bin = '';
  for (const b of sec1) bin += String.fromCharCode(b);
  const pem = `-----BEGIN EC PRIVATE KEY-----\n${btoa(bin)
    .match(/.{1,64}/g)!
    .join('\n')}\n-----END EC PRIVATE KEY-----\n`;
  return { pem, sec1, pkcs8, publicKey: pair.publicKey };
}

const b64 = (s: string) =>
  Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0));

const creds = { clientId: 'SEARCHADS.client', teamId: 'SEARCHADS.team', keyId: 'key-1' };

describe('apple ads', () => {
  it('wraps an OpenSSL EC key for WebCrypto and signs a verifiable client secret', async () => {
    const { pem, sec1, pkcs8, publicKey } = await sec1Pem();
    expect([...sec1ToPkcs8(sec1)]).toEqual([...pkcs8]);
    const jwt = await signAppleAdsSecret({ ...creds, privateKey: pem }, 1000);
    const [h, c, s] = jwt.split('.');
    expect(JSON.parse(new TextDecoder().decode(b64(h!)))).toEqual({ alg: 'ES256', kid: 'key-1' });
    expect(JSON.parse(new TextDecoder().decode(b64(c!)))).toEqual({
      sub: 'SEARCHADS.client',
      aud: 'https://appleid.apple.com',
      iat: 1000,
      exp: 1000 + 3600,
      iss: 'SEARCHADS.team',
    });
    expect(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, publicKey, b64(s!), new TextEncoder().encode(`${h}.${c}`))).toBe(
      true,
    );
    await expect(signAppleAdsSecret({ ...creds, privateKey: 'nope' })).rejects.toThrow(/APPLE_ADS_PRIVATE_KEY/);
  });

  it('reads accounts, campaigns, daily search terms and impression share without writing anything', async () => {
    clearAppleAdsTokenCache();
    const { pem } = await sec1Pem();
    const seen: Array<{ url: string; method: string; context: string | null; body: any }> = [];
    const fetchMock = (async (url: string, init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      seen.push({
        url,
        method: init?.method ?? 'GET',
        context: headers['x-ap-context'] ?? null,
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });
      if (url.startsWith('https://appleid.apple.com/'))
        return Response.json({ access_token: 'tok', token_type: 'Bearer', expires_in: 3600, scope: 'searchadsorg' });
      if (url.endsWith('/v1/acls'))
        return Response.json({
          result: { acls: [{ adAccount: { id: 123456789, name: 'Echobell', orgId: 9 }, roles: ['API Account Read Only'] }] },
        });
      if (url.endsWith('/v1/campaigns/query'))
        return Response.json({
          result: [{ id: 555, name: 'US Search', promotedObjectId: '6400000000', promotedObjectType: 'APPSTORE_APP' }],
          pagination: { offset: 0, pageSize: 1, totalCount: 1 },
        });
      if (url.endsWith('/v1/reports/apps/searchterms/query'))
        return Response.json({
          result: {
            rows: [
              {
                metadata: { campaignId: 555, searchTermText: 'alarm app', searchTermSource: 'TARGETED', keyword: { text: 'alarm' } },
                totalMetrics: { impressions: 300, taps: 30 },
                granularMetrics: [
                  {
                    date: '2026-11-08',
                    impressions: 100,
                    taps: 10,
                    totalInstalls: 4,
                    totalNewDownloads: 3,
                    localSpend: { amount: '12.34', currency: 'USD' },
                  },
                  {
                    date: '2026-11-09',
                    impressions: 200,
                    taps: 20,
                    totalInstalls: 6,
                    totalNewDownloads: 5,
                    localSpend: { amount: '20.00', currency: 'USD' },
                  },
                ],
              },
              // Withheld by Apple (few impressions): no text.
              { metadata: { campaignId: 555, searchTermText: null }, granularMetrics: [{ date: '2026-11-08', impressions: 3 }] },
            ],
          },
          pagination: { offset: 0, pageSize: 2, totalCount: 2 },
        });
      if (url.endsWith('/v1/insights/apps/impression-share/query'))
        return Response.json({
          result: {
            rows: [
              {
                day: '2026-11-09',
                appName: 'Echobell',
                promotedObjectId: '6400000000',
                countryOrRegion: 'us',
                searchTerm: 'alarm app',
                lowImpressionShare: 0.3,
                highImpressionShare: 0.4,
                rank: 2,
                searchPopularity1to5: 4,
              },
            ],
          },
          pagination: { offset: 0, pageSize: 1, totalCount: 1 },
        });
      return new Response('{}', { status: 404 });
    }) as typeof fetch;
    const ads = createAppleAdsClient({ ...creds, privateKey: pem, fetch: fetchMock });
    expect(await ads.accounts()).toEqual([{ id: '123456789', name: 'Echobell', roles: ['API Account Read Only'] }]);
    const token = new URL(seen[0]!.url);
    expect(token.searchParams.get('grant_type')).toBe('client_credentials');
    expect(token.searchParams.get('scope')).toBe('searchadsorg');
    expect(token.searchParams.get('client_id')).toBe('SEARCHADS.client');
    expect(seen[1]!.context).toBeNull();

    expect(await ads.campaigns('123456789', '6400000000')).toEqual([{ id: '555', name: 'US Search' }]);
    const campaignQuery = seen.find((x) => x.url.endsWith('/campaigns/query'))!;
    expect(campaignQuery.context).toBe('adAccountId=123456789');
    expect(campaignQuery.body.filters).toContainEqual({ field: 'promotedObjectId', operator: 'EQUALS', value: '6400000000' });

    const terms = await ads.searchTerms('123456789', '555', { start: '2026-11-08', end: '2026-11-09' });
    expect(terms).toEqual([
      {
        date: '2026-11-08',
        campaignId: '555',
        term: 'alarm app',
        keyword: 'alarm',
        impressions: 100,
        taps: 10,
        installs: 4,
        newDownloads: 3,
        spendCents: 1234,
        currency: 'USD',
      },
      {
        date: '2026-11-09',
        campaignId: '555',
        term: 'alarm app',
        keyword: 'alarm',
        impressions: 200,
        taps: 20,
        installs: 6,
        newDownloads: 5,
        spendCents: 2000,
        currency: 'USD',
      },
    ]);
    const report = seen.find((x) => x.url.endsWith('/searchterms/query'))!;
    expect(report.body.timeRange).toEqual({ start: '2026-11-08', end: '2026-11-09', timeZone: 'UTC', granularity: 'DAILY' });
    expect(report.body.filters).toEqual([{ field: 'campaignId', operator: 'EQUALS', value: 555 }]);

    expect(await ads.impressionShare('123456789', '6400000000', { start: '2026-11-09', end: '2026-11-09' })).toEqual([
      { date: '2026-11-09', territory: 'US', term: 'alarm app', lowShare: 0.3, highShare: 0.4, rank: 2, popularity: 4 },
    ]);
    // Only queries: no creating, changing or deleting.
    expect(
      seen.filter((x) => x.url.startsWith('https://api.ads.apple.com/')).every((x) => x.method === 'GET' || x.url.endsWith('/query')),
    ).toBe(true);
    // The token is fetched once.
    expect(seen.filter((x) => x.url.startsWith('https://appleid.apple.com/'))).toHaveLength(1);
  });

  it('reports refused credentials without the client secret', async () => {
    clearAppleAdsTokenCache();
    const { pem } = await sec1Pem();
    const fetchMock = (async () => Response.json({ error: 'invalid_client' }, { status: 401 })) as unknown as typeof fetch;
    const ads = createAppleAdsClient({ ...creds, privateKey: pem, fetch: fetchMock });
    const err = await ads.accounts().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SourceError);
    expect((err as SourceError).status).toBe(401);
    expect((err as SourceError).message).toContain('invalid_client');
    expect((err as SourceError).message).not.toMatch(/eyJ/);
  });
});
