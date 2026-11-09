import { describe, expect, it } from 'vitest';
import { clearPlayTokenCache, createPlayClient, PLAY_SCOPES } from '../src/index.js';

async function pemKey() {
  const pair = (await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair;
  const der = new Uint8Array((await crypto.subtle.exportKey('pkcs8', pair.privateKey)) as ArrayBuffer);
  let bin = '';
  for (const b of der) bin += String.fromCharCode(b);
  return `-----BEGIN PRIVATE KEY-----\n${btoa(bin)
    .match(/.{1,64}/g)!
    .join('\n')}\n-----END PRIVATE KEY-----\n`;
}

function utf16le(text: string): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(2 + text.length * 2);
  out[0] = 0xff;
  out[1] = 0xfe;
  for (let i = 0; i < text.length; i++) {
    out[2 + i * 2] = text.charCodeAt(i) & 0xff;
    out[3 + i * 2] = text.charCodeAt(i) >> 8;
  }
  return out;
}

describe('google play', () => {
  it('lists report files, reads a UTF-16 CSV and queries crash rates with read-only scopes', async () => {
    clearPlayTokenCache();
    const pk = await pemKey();
    const urls: string[] = [];
    let scope = '';
    const fetchMock = (async (url: string, init?: RequestInit) => {
      urls.push(url);
      if (url.includes('oauth2')) {
        const assertion = new URLSearchParams(String(init?.body)).get('assertion')!;
        scope = JSON.parse(atob(assertion.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/'))).scope;
        return Response.json({ access_token: 'tok', expires_in: 3600 });
      }
      expect((init?.headers as Record<string, string>).authorization).toBe('Bearer tok');
      if (url.includes('/o?')) {
        if (!url.includes('pageToken'))
          return Response.json({
            items: [{ name: 'stats/installs/installs_com.a_202610_country.csv', generation: '17', size: '20' }],
            nextPageToken: 'p2',
          });
        return Response.json({ items: [{ name: 'stats/installs/installs_com.a_202609_country.csv', generation: '9', size: '20' }] });
      }
      if (url.includes('alt=media'))
        return new Response(utf16le('Date,Package Name,Country,Daily Device Installs\n2026-10-01,com.a,US,5\n'));
      if (url.includes('crashRateMetricSet:query')) {
        const body = JSON.parse(String(init?.body));
        expect(body.timelineSpec).toEqual({
          aggregationPeriod: 'DAILY',
          startTime: { year: 2026, month: 10, day: 1, timeZone: { id: 'America/Los_Angeles' } },
          endTime: { year: 2026, month: 10, day: 3, timeZone: { id: 'America/Los_Angeles' } },
        });
        expect(body.dimensions).toEqual(['versionCode']);
        return Response.json({
          rows: [
            {
              aggregationPeriod: 'DAILY',
              startTime: { year: 2026, month: 10, day: 2, timeZone: { id: 'America/Los_Angeles' } },
              dimensions: [{ dimension: 'versionCode', int64Value: '31' }],
              metrics: [
                { metric: 'crashRate', decimalValue: { value: '0.0123' } },
                { metric: 'userPerceivedCrashRate', decimalValue: { value: '0.01' } },
                { metric: 'distinctUsers', decimalValue: { value: '412' } },
              ],
            },
          ],
        });
      }
      if (url.includes('apps:search'))
        return Response.json({ apps: [{ name: 'apps/com.a', packageName: 'com.a', displayLabel: 'A', displayName: 'A' }] });
      return new Response('{}', { status: 404 });
    }) as typeof fetch;
    const play = createPlayClient({ clientEmail: 'sa@p.iam.gserviceaccount.com', privateKey: pk, fetch: fetchMock });
    const objects = await play.listObjects('pubsite_prod_rev_1', 'stats/installs/installs_com.a_');
    expect(objects.map((o) => [o.name, o.generation])).toEqual([
      ['stats/installs/installs_com.a_202610_country.csv', '17'],
      ['stats/installs/installs_com.a_202609_country.csv', '9'],
    ]);
    expect(urls[1]).toContain('/b/pubsite_prod_rev_1/o?prefix=stats%2Finstalls%2Finstalls_com.a_');
    const rows: Array<Record<string, string>> = [];
    await play.readCsv('pubsite_prod_rev_1', 'stats/installs/installs_com.a_202610_country.csv', (r) => rows.push(r));
    expect(rows).toEqual([{ date: '2026-10-01', 'package name': 'com.a', country: 'US', 'daily device installs': '5' }]);
    expect(urls.find((u) => u.includes('alt=media'))).toContain('/o/stats%2Finstalls%2Finstalls_com.a_202610_country.csv?alt=media');
    expect(await play.vitals('com.a', 'crash', { start: '2026-10-01', end: '2026-10-02' })).toEqual([
      { date: '2026-10-02', version: '31', rate: 0.0123, userPerceivedRate: 0.01, distinctUsers: 412 },
    ]);
    expect(await play.listApps()).toEqual([{ packageName: 'com.a', name: 'A' }]);
    expect(scope).toBe(PLAY_SCOPES);
    expect(urls.filter((u) => u.includes('oauth2'))).toHaveLength(1);
  });

  it('reports a file it cannot read by name and status', async () => {
    clearPlayTokenCache();
    const pk = await pemKey();
    const fetchMock = (async (url: string) =>
      url.includes('oauth2')
        ? Response.json({ access_token: 'tok', expires_in: 3600 })
        : new Response('denied', { status: 403 })) as typeof fetch;
    const play = createPlayClient({ clientEmail: 'sa@x', privateKey: pk, fetch: fetchMock });
    await expect(play.readCsv('b', 'reviews/reviews_com.a_202610.csv', () => {})).rejects.toThrow(
      'play: could not read reviews/reviews_com.a_202610.csv (HTTP 403)',
    );
  });
});
