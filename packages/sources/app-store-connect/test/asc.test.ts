import { describe, expect, it } from 'vitest';
import { SourceError } from '@searchkeep/core';
import { clearAscTokenCache, createAscClient, signAscJwt } from '../src/index.js';

async function p8() {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const der = new Uint8Array((await crypto.subtle.exportKey('pkcs8', pair.privateKey)) as ArrayBuffer);
  let bin = '';
  for (const b of der) bin += String.fromCharCode(b);
  const b64 = btoa(bin)
    .match(/.{1,64}/g)!
    .join('\n');
  return { pem: `-----BEGIN PRIVATE KEY-----\n${b64}\n-----END PRIVATE KEY-----\n`, publicKey: pair.publicKey };
}

const b64 = (s: string) =>
  Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0));

async function gzip(text: string): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Blob([text])
    .stream()
    .pipeThrough(new CompressionStream('gzip') as unknown as ReadableWritablePair<Uint8Array, Uint8Array>);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

describe('app store connect', () => {
  it('signs a verifiable ES256 token for the App Store Connect API', async () => {
    const { pem, publicKey } = await p8();
    const jwt = await signAscJwt('KEY123', 'issuer-uuid', pem, 1000);
    const [h, c, s] = jwt.split('.');
    expect(JSON.parse(new TextDecoder().decode(b64(h!)))).toEqual({ alg: 'ES256', kid: 'KEY123', typ: 'JWT' });
    expect(JSON.parse(new TextDecoder().decode(b64(c!)))).toEqual({
      iss: 'issuer-uuid',
      iat: 1000,
      exp: 1000 + 19 * 60,
      aud: 'appstoreconnect-v1',
    });
    expect(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, publicKey, b64(s!), new TextEncoder().encode(`${h}.${c}`))).toBe(
      true,
    );
  });

  it('rejects a key that is not a .p8 key without echoing it', async () => {
    await expect(signAscJwt('K', 'I', 'not a key')).rejects.toThrow(/not be imported|not a valid/);
  });

  it('follows report requests to instances and reads a gzip segment without sending the token to the download host', async () => {
    clearAscTokenCache();
    const { pem } = await p8();
    const seen: Array<{ url: string; auth: string | undefined; method: string }> = [];
    const segment = await gzip('Date\tEvent\tCounts\n2026-10-18\tImpression\t12\n');
    const fetchMock = (async (url: string, init?: RequestInit) => {
      const auth = (init?.headers as Record<string, string> | undefined)?.authorization;
      seen.push({ url, auth, method: init?.method ?? 'GET' });
      if (url.startsWith('https://s3.example.com/')) return new Response(segment);
      if (url.includes('/v1/apps/123/analyticsReportRequests'))
        return Response.json({ data: [{ id: 'req', attributes: { accessType: 'ONGOING', stoppedDueToInactivity: false } }] });
      if (url.includes('/reports?limit=200') && !url.includes('cursor'))
        return Response.json({
          data: [{ id: 'r1', attributes: { name: 'App Crashes', category: 'APP_USAGE' } }],
          links: { next: 'https://api.appstoreconnect.apple.com/v1/analyticsReportRequests/req/reports?limit=200&cursor=x' },
        });
      if (url.includes('cursor=x'))
        return Response.json({ data: [{ id: 'r2', attributes: { name: 'App Downloads Standard', category: 'APP_STORE_COMMERCE' } }] });
      if (url.includes('/instances'))
        return Response.json({ data: [{ id: 'i1', attributes: { granularity: 'DAILY', processingDate: '2026-10-19' } }] });
      if (url.includes('/segments'))
        return Response.json({
          data: [{ id: 's1', attributes: { url: 'https://s3.example.com/x.csv.gz?X-Amz-Security-Token=secret', sizeInBytes: 10 } }],
        });
      if (url.endsWith('/v1/analyticsReportRequests') && init?.method === 'POST') {
        expect(JSON.parse(String(init.body))).toEqual({
          data: {
            type: 'analyticsReportRequests',
            attributes: { accessType: 'ONE_TIME_SNAPSHOT' },
            relationships: { app: { data: { type: 'apps', id: '123' } } },
          },
        });
        return Response.json(
          { data: { id: 'snap', attributes: { accessType: 'ONE_TIME_SNAPSHOT', stoppedDueToInactivity: false } } },
          { status: 201 },
        );
      }
      return new Response('{}', { status: 404 });
    }) as typeof fetch;
    const asc = createAscClient({ keyId: 'K', issuerId: 'I', privateKey: pem, fetch: fetchMock });
    expect(await asc.listReportRequests('123')).toEqual([{ id: 'req', accessType: 'ONGOING', stoppedDueToInactivity: false }]);
    expect((await asc.listReports('req')).map((r) => r.name)).toEqual(['App Crashes', 'App Downloads Standard']);
    expect(await asc.listInstances('r1', 'DAILY')).toEqual([{ id: 'i1', granularity: 'DAILY', processingDate: '2026-10-19' }]);
    expect(seen.find((s) => s.url.includes('/instances'))!.url).toContain('filter%5Bgranularity%5D=DAILY');
    const [seg] = await asc.listSegments('i1');
    const rows: Array<Record<string, string>> = [];
    expect(await asc.readSegment(seg!, (r) => rows.push(r))).toBe(1);
    expect(rows).toEqual([{ date: '2026-10-18', event: 'Impression', counts: '12' }]);
    expect(seen.find((s) => s.url.startsWith('https://s3.example.com/'))!.auth).toBeUndefined();
    expect(seen.filter((s) => s.url.startsWith('https://api.')).every((s) => s.auth?.startsWith('Bearer '))).toBe(true);
    expect(await asc.createReportRequest('123', 'ONE_TIME_SNAPSHOT')).toMatchObject({ id: 'snap' });
  });

  it("reports Apple's error codes, and segment failures without the presigned URL", async () => {
    clearAscTokenCache();
    const { pem } = await p8();
    const fetchMock = (async (url: string) => {
      if (url.startsWith('https://s3.example.com/')) return new Response('nope', { status: 403 });
      return Response.json(
        { errors: [{ status: '403', code: 'FORBIDDEN_ERROR', detail: 'This request is forbidden for security reasons' }] },
        { status: 403 },
      );
    }) as typeof fetch;
    const asc = createAscClient({ keyId: 'K', issuerId: 'I', privateKey: pem, fetch: fetchMock });
    const err = await asc.listReportRequests('123').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SourceError);
    expect((err as SourceError).status).toBe(403);
    expect((err as Error).message).toContain('FORBIDDEN_ERROR');
    const seg = await asc
      .readSegment({ id: 's', url: 'https://s3.example.com/x?X-Amz-Signature=abc', sizeInBytes: 1 }, () => {})
      .catch((e: unknown) => e);
    expect((seg as Error).message).toBe('asc: report segment download failed (HTTP 403)');
  });

  it('pages customer reviews newest first', async () => {
    clearAscTokenCache();
    const { pem } = await p8();
    const urls: string[] = [];
    const fetchMock = (async (url: string) => {
      urls.push(url);
      return Response.json({
        data: [
          {
            id: 'r1',
            attributes: {
              rating: 4,
              title: 'Nice',
              body: 'Good',
              reviewerNickname: 'Ann',
              createdDate: '2026-10-18T10:00:00-07:00',
              territory: 'USA',
            },
          },
        ],
        links: { next: 'https://api.appstoreconnect.apple.com/v1/apps/123/customerReviews?cursor=Q' },
      });
    }) as typeof fetch;
    const asc = createAscClient({ keyId: 'K', issuerId: 'I', privateKey: pem, fetch: fetchMock });
    const page = await asc.listReviews('123', { limit: 200 });
    expect(page.reviews).toEqual([
      { id: 'r1', rating: 4, title: 'Nice', body: 'Good', createdDate: '2026-10-18T10:00:00-07:00', territory: 'USA' },
    ]);
    expect(urls[0]).toContain('/v1/apps/123/customerReviews?sort=-createdDate&limit=200');
    await asc.listReviews('123', { limit: 200, cursor: page.next });
    expect(urls[1]).toContain('cursor=Q');
    await expect(asc.listReviews('123', { limit: 200, cursor: 'https://evil.example.com/x' })).rejects.toThrow(
      /unexpected pagination link/,
    );
  });

  it('reads the icon of the newest build that has one', async () => {
    const { pem } = await p8();
    const urls: string[] = [];
    const fetchMock = (async (url: string) => {
      urls.push(url);
      if (url.includes('filter%5Bapp%5D=999')) return Response.json({ data: [] });
      return Response.json({
        data: [
          { id: 'b3', attributes: { iconAssetToken: null } },
          {
            id: 'b2',
            attributes: { iconAssetToken: { templateUrl: 'https://is1-ssl.mzstatic.com/a/{w}x{h}bb.{f}', width: 1024, height: 1024 } },
          },
        ],
      });
    }) as typeof fetch;
    const asc = createAscClient({ keyId: 'K', issuerId: 'I', privateKey: pem, fetch: fetchMock });
    expect(await asc.latestBuildIcon('123')).toEqual({
      templateUrl: 'https://is1-ssl.mzstatic.com/a/{w}x{h}bb.{f}',
      width: 1024,
      height: 1024,
    });
    expect(urls[0]).toContain('/v1/builds?filter%5Bapp%5D=123&sort=-uploadedDate&limit=5&fields%5Bbuilds%5D=iconAssetToken');
    expect(await asc.latestBuildIcon('999')).toBeNull();
  });

  it('downloads a day of Summary Sales (gzip), answers null when Apple has no report, and reports a refused key', async () => {
    clearAscTokenCache();
    const { pem } = await p8();
    // Summary Sales Report columns (Apple's sample report header), tab separated.
    const tsv = [
      'Provider\tProvider Country\tSKU\tDeveloper\tTitle\tVersion\tProduct Type Identifier\tUnits\tDeveloper Proceeds\tBegin Date\tEnd Date\tCustomer Currency\tCountry Code\tCurrency of Proceeds\tApple Identifier\tCustomer Price\tPromo Code\tParent Identifier\tSubscription\tPeriod\tCategory\tCMB\tDevice\tSupported Platforms\tProceeds Reason\tPreserved Pricing\tClient\tOrder Type',
      'APPLE\tUS\techobell.pro.monthly\tAcme\techobell.pro.monthly\t\tIAY\t3\t3.49\t11/08/2026\t11/08/2026\tUSD\tUS\tUSD\t6450000001\t4.99\t\tECHOBELL\tNew\t1 Month\tUtilities\t\tiPhone\tiOS\t\t\t\t',
    ].join('\n');
    const body = await gzip(tsv);
    const seen: string[] = [];
    const fetchMock = (async (url: string) => {
      seen.push(url);
      if (url.includes('=2026-11-08')) return new Response(body, { headers: { 'content-type': 'application/a-gzip' } });
      if (url.includes('=2026-11-09'))
        return Response.json(
          { errors: [{ status: '404', code: 'NOT_FOUND', detail: 'There were no sales for the date specified.' }] },
          { status: 404 },
        );
      return Response.json(
        { errors: [{ status: '403', code: 'FORBIDDEN_ERROR', detail: 'This request is forbidden for security reasons' }] },
        { status: 403 },
      );
    }) as typeof fetch;
    const asc = createAscClient({ keyId: 'K', issuerId: 'I', privateKey: pem, fetch: fetchMock });
    const rows: Array<Record<string, string>> = [];
    expect(await asc.salesReport!('85000000', '2026-11-08', (r) => rows.push(r))).toBe(1);
    expect(rows[0]).toMatchObject({ sku: 'echobell.pro.monthly', units: '3', subscription: 'New', 'parent identifier': 'ECHOBELL' });
    const url = new URL(seen[0]!);
    const param = (k: string) => url.searchParams.get(k);
    expect(['frequency', 'reportDate', 'reportSubType', 'reportType', 'vendorNumber'].map((k) => param(`filter[${k}]`))).toEqual([
      'DAILY',
      '2026-11-08',
      'SUMMARY',
      'SALES',
      '85000000',
    ]);
    expect(await asc.salesReport!('85000000', '2026-11-09', () => undefined)).toBeNull();
    const err = await asc.salesReport!('85000000', '2026-11-10', () => undefined).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SourceError);
    expect((err as SourceError).status).toBe(403);
    expect((err as SourceError).message).toContain('FORBIDDEN_ERROR');
  });
});
