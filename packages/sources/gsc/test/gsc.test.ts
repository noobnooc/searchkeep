import { describe, expect, it } from 'vitest';
import { clearGscTokenCache, createGscClient, signServiceAccountJwt } from '../src/index.js';

async function pemKey() {
  const pair = (await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair;
  const der = new Uint8Array((await crypto.subtle.exportKey('pkcs8', pair.privateKey)) as ArrayBuffer);
  let bin = '';
  for (const b of der) bin += String.fromCharCode(b);
  const b64 = btoa(bin).match(/.{1,64}/g)!.join('\\n');
  return { pem: `-----BEGIN PRIVATE KEY-----\\n${b64}\\n-----END PRIVATE KEY-----\\n`, publicKey: pair.publicKey };
}

describe('gsc', () => {
  it('signs a verifiable service-account JWT (literal \\n in PEM accepted)', async () => {
    const { pem, publicKey } = await pemKey();
    const jwt = await signServiceAccountJwt('sa@p.iam.gserviceaccount.com', pem, 'scope-x', 1000);
    const [h, c, s] = jwt.split('.');
    const claims = JSON.parse(atob(c!.replace(/-/g, '+').replace(/_/g, '/')));
    expect(claims).toMatchObject({ iss: 'sa@p.iam.gserviceaccount.com', scope: 'scope-x', aud: 'https://oauth2.googleapis.com/token', iat: 1000, exp: 4600 });
    const sig = Uint8Array.from(atob(s!.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s!.length % 4)) % 4)), (ch) => ch.charCodeAt(0));
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
    const rows = await gsc.searchAnalytics({ property: 'sc-domain:acme.com', startDate: '2026-10-01', endDate: '2026-10-01', dimensions: ['date'], rowLimit: 10 });
    expect(rows).toHaveLength(1);
    expect(await gsc.listProperties()).toHaveLength(1);
    expect(calls.filter((c) => c.includes('oauth2'))).toHaveLength(1);
    expect(calls[1]).toContain('/sites/sc-domain%3Aacme.com/searchAnalytics/query');
  });

  it('refuses to submit sitemaps unless writes are enabled', async () => {
    const gsc = createGscClient({ clientEmail: 'sa@x', privateKey: 'x', fetch: (async () => new Response('{}')) as unknown as typeof fetch });
    await expect(gsc.submitSitemap('sc-domain:acme.com', 'https://acme.com/sitemap.xml')).rejects.toThrow(/writes are disabled/);
  });
});
